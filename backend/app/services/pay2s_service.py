"""Pay2S Partner API adapter and webhook reconciliation.

The public Partner contract uses Access Key/Secret Key to obtain a temporary
Bearer token. Each webhook receives its own Bearer token; it is not an HMAC
signature. This module keeps provider credentials server-side and maps each
webhook to exactly one TPRO workspace and bank account.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import hmac
import json
import re
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_credentials import (
    decrypt_credential,
    encrypt_credential,
    keyed_secret_hash,
)
from app.core.config import settings
from app.core.workspace import reset_workspace_id, set_workspace_id
from app.models.banking import WorkspacePaymentAccount, WorkspacePaymentProvider
from app.models.payment_request import (
    PaymentRequest,
    PaymentRequestEvent,
    PaymentRequestItem,
)
from app.services.pay2s_catalog import get_pay2s_payment_bank

_ACCESS_KEY_PURPOSE = "pay2s-access-key-v1"
_CREDENTIAL_KEY_PURPOSE = "pay2s-secret-key-v1"
_BEARER_TOKEN_PURPOSE = "pay2s-bearer-token-v1"
_TOKEN_HASH_PURPOSE = "pay2s-webhook-token-hash-v1"


class Pay2SError(RuntimeError):
    """A provider request failed or returned an unusable response."""


def _as_mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _message(payload: dict[str, Any]) -> str:
    value = payload.get("message") or payload.get("error")
    if isinstance(value, dict):
        value = value.get("message") or value.get("detail")
    return str(value or "Pay2S trả về lỗi không xác định.")


def _data(payload: dict[str, Any]) -> Any:
    return payload.get("data", payload.get("message"))


def _collection_redirect_url() -> str:
    """Return the public HTTPS completion URL required by Pay2S.

    A localhost HTTP fallback looks convenient in development but Pay2S
    rejects it only after the local payment request has been persisted. Fail
    before the provider call with an actionable configuration error instead.
    """

    value = (
        settings.pay2s_redirect_url.strip()
        or settings.frontend_url.rstrip("/") + "/fees"
    )
    parsed = urlsplit(value)
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PAY2S_REDIRECT_URL phải là địa chỉ HTTPS công khai.",
        )
    return value


def _authorization_result(payload: dict[str, Any]) -> tuple[str, int]:
    """Read both the current and legacy Pay2S authorization response shapes."""

    data = _as_mapping(payload.get("data"))
    token = (
        data.get("access_token")
        or data.get("token")
        or payload.get("access_token")
        or payload.get("token")
    )
    if not isinstance(token, str) or not token.strip():
        raise Pay2SError("Pay2S không trả về Bearer token.")
    expires = data.get("expires_in") or payload.get("expires_in") or 3600
    try:
        ttl = max(60, min(3600, int(expires)))
    except (TypeError, ValueError):
        ttl = 3600
    return token.strip(), ttl


class Pay2SClient:
    """Small, provider-contract-focused HTTP client."""

    def __init__(self, access_key: str, secret_key: str) -> None:
        self.access_key = access_key
        self.secret_key = secret_key
        self.base_url = settings.pay2s_api_base_url.rstrip("/")

    async def _request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=settings.pay2s_http_timeout_seconds,
                follow_redirects=False,
            ) as client:
                response = await client.request(
                    method, path, headers=headers, json=json_body
                )
        except httpx.HTTPError as exc:
            raise Pay2SError("Không thể kết nối Pay2S.") from exc
        try:
            payload = _as_mapping(response.json())
        except (ValueError, json.JSONDecodeError) as exc:
            raise Pay2SError("Pay2S trả về dữ liệu không hợp lệ.") from exc
        if response.status_code >= 400:
            raise Pay2SError(_message(payload))
        if payload.get("success") is False or payload.get("status") is False:
            raise Pay2SError(_message(payload))
        return payload

    async def authorize(self) -> tuple[str, int]:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=settings.pay2s_http_timeout_seconds,
                follow_redirects=False,
            ) as client:
                response = await client.post(
                    "/v1/auth/authorize",
                    auth=(self.access_key, self.secret_key),
                    headers={"Content-Type": "application/json"},
                )
        except httpx.HTTPError as exc:
            raise Pay2SError("Không thể kết nối Pay2S để xác thực.") from exc
        try:
            payload = _as_mapping(response.json())
        except (ValueError, json.JSONDecodeError) as exc:
            raise Pay2SError("Pay2S trả về dữ liệu xác thực không hợp lệ.") from exc
        if response.status_code >= 400 or payload.get("success") is False:
            raise Pay2SError(_message(payload))
        return _authorization_result(payload)

    async def list_banks(self, token: str) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/v1/banks", token=token)
        value = _data(payload)
        if isinstance(value, dict):
            value = value.get("message") or value.get("data") or []
        return (
            [item for item in value if isinstance(item, dict)]
            if isinstance(value, list)
            else []
        )

    async def add_bank(self, token: str, body: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/v1/banks", token=token, json_body=body)

    async def confirm_bank_otp(
        self, token: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._request(
            "POST", "/v1/banks/confirm-otp", token=token, json_body=body
        )

    async def create_webhook(
        self,
        token: str,
        *,
        user_bank_id: str,
        webhook_url: str,
        webhook_type: str = "IN",
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/v1/webhooks",
            token=token,
            json_body={
                "user_bank_id": int(user_bank_id)
                if str(user_bank_id).isdigit()
                else user_bank_id,
                "webhook_url": webhook_url,
                "type": webhook_type,
            },
        )

    async def list_webhooks(self, token: str) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/v1/webhooks", token=token)
        value = _data(payload)
        if isinstance(value, dict):
            value = value.get("data") or value.get("message") or []
        return (
            [item for item in value if isinstance(item, dict)]
            if isinstance(value, list)
            else []
        )

    async def update_webhook(
        self,
        token: str,
        webhook_id: str,
        *,
        webhook_url: str,
        webhook_type: str = "IN",
    ) -> dict[str, Any]:
        return await self._request(
            "PATCH",
            f"/v1/webhooks/{webhook_id}",
            token=token,
            json_body={"webhook_url": webhook_url, "type": webhook_type},
        )


async def _provider_credentials(
    db: AsyncSession,
    provider: WorkspacePaymentProvider,
) -> tuple[str, str] | None:
    if not provider.access_key_ciphertext or not provider.secret_key_ciphertext:
        # The first scaffold accepted one opaque API key. It cannot be safely
        # promoted to the Partner Access/Secret pair, so require re-entry.
        return None
    return (
        decrypt_credential(provider.access_key_ciphertext, purpose=_ACCESS_KEY_PURPOSE),
        decrypt_credential(provider.secret_key_ciphertext, purpose=_CREDENTIAL_KEY_PURPOSE),
    )


async def get_pay2s_client(
    db: AsyncSession,
    provider: WorkspacePaymentProvider,
    *,
    refresh: bool = False,
) -> tuple[Pay2SClient, str]:
    credentials = await _provider_credentials(db, provider)
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Chưa có Access Key và Secret Key Pay2S hợp lệ cho đơn vị này.",
        )
    client = Pay2SClient(*credentials)
    now = datetime.now(timezone.utc)
    if (
        not refresh
        and provider.bearer_token_ciphertext
        and provider.bearer_token_expires_at
        and provider.bearer_token_expires_at > now + timedelta(seconds=30)
    ):
        return client, decrypt_credential(
            provider.bearer_token_ciphertext, purpose=_BEARER_TOKEN_PURPOSE
        )
    token, ttl = await client.authorize()
    provider.bearer_token_ciphertext = encrypt_credential(
        token, purpose=_BEARER_TOKEN_PURPOSE
    )
    provider.bearer_token_expires_at = now + timedelta(seconds=ttl)
    return client, token


def _bearer_value(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.casefold() != "bearer" or not value.strip():
        return None
    return value.strip()


def _transaction_amount(value: Any) -> int | None:
    try:
        amount = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError, TypeError):
        return None
    if amount != amount.to_integral_value():
        return None
    return int(amount)


def _normalized_content(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").upper()).strip()


_PAYMENT_REFERENCE_TOKEN = re.compile(
    r"(?<![A-Z0-9])(TP[0-9]{9}P[0-9A-HJKMNP-TV-Z]{8})(?![A-Z0-9])"
)


def _payment_references_in_content(value: Any) -> tuple[str, ...]:
    """Extract exact TPRO references from a bank's decorated description.

    Banks and Pay2S may wrap the customer-entered transfer content with the
    bank name, receiving account and reconciliation identifiers.  Matching a
    bounded, fixed-format TPRO token preserves the user's intended content
    while refusing partial/prefix matches and arbitrary free-text substrings.
    """
    content = _normalized_content(value)
    return tuple(dict.fromkeys(_PAYMENT_REFERENCE_TOKEN.findall(content)))


def _collection_ipn_canonical(payload: dict[str, Any], access_key: str) -> str:
    """Build the documented Collection Link IPN HMAC source string.

    Pay2S signs named values rather than the raw JSON body.  Missing optional
    fields are represented by an empty value; sorting/JSON serialisation would
    produce a different signature and must not be used here.
    """
    fields = (
        "amount",
        "extraData",
        "message",
        "orderId",
        "orderInfo",
        "orderType",
        "partnerCode",
        "payType",
        "requestId",
        "responseTime",
        "resultCode",
        "transId",
    )
    signed_fields = [f"accessKey={access_key}"]
    signed_fields.extend(f"{name}={payload.get(name, '')}" for name in fields)
    return "&".join(signed_fields)


def _collection_ipn_signature_is_valid(
    payload: dict[str, Any], access_key: str, secret_key: str
) -> bool:
    received = str(payload.get("m2signature") or "").strip().lower()
    if not received or not re.fullmatch(r"[0-9a-f]{64}", received):
        return False
    expected = hmac.new(
        secret_key.encode("utf-8"),
        _collection_ipn_canonical(payload, access_key).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, received)


def _transaction_belongs_to_account(
    transaction: dict[str, Any], account: WorkspacePaymentAccount
) -> bool:
    """Fail closed when Pay2S includes an account/VA identifier.

    The webhook itself is already registered against one bank.  Pay2S can
    omit these fields for some providers, so absence is tolerated; when a
    field is present it must match the exact account (or VA) TPRO linked.
    """
    expected = {
        str(value).strip()
        for value in (account.account_number, account.va_number)
        if value
    }
    observed = {
        str(transaction.get(key)).strip()
        for key in ("accountNumber", "account_number", "vaNumber", "va_number")
        if transaction.get(key) not in (None, "")
    }
    return not observed or bool(observed & expected)


async def _match_open_request(
    db: AsyncSession,
    *,
    account: WorkspacePaymentAccount,
    content: str,
    amount: int,
) -> PaymentRequest | None:
    if amount <= 0:
        return None
    references = _payment_references_in_content(content)
    if len(references) != 1:
        return None
    request_result = await db.execute(
        select(PaymentRequest)
        .where(
            PaymentRequest.status == "OPEN",
            PaymentRequest.payment_reference == references[0],
            PaymentRequest.expected_amount == amount,
            PaymentRequest.settlement_account_id == str(account.id),
        )
        .with_for_update()
    )
    matches = request_result.scalars().all()
    # References are globally unique, but fail closed if database corruption
    # or a future schema change ever makes the candidate ambiguous.
    return matches[0] if len(matches) == 1 else None


async def _insert_delivery(
    db: AsyncSession,
    *,
    workspace_id: str,
    event_id: str,
    provider_transaction_id: str,
    payload_hash: str,
    status_value: str,
) -> str | None:
    result = await db.execute(
        text(
            "insert into public.payment_provider_deliveries "
            "(workspace_id, provider, provider_event_id, provider_transaction_id, "
            "payload_hash, raw_payload_hash, status) "
            "values (:workspace_id, 'pay2s', :event_id, :transaction_id, "
            ":payload_hash, :raw_payload_hash, :status) "
            "on conflict (provider, provider_event_id, provider_transaction_id) "
            "do nothing returning id"
        ),
        {
            "workspace_id": workspace_id,
            "event_id": event_id,
            "transaction_id": provider_transaction_id,
            "payload_hash": payload_hash,
            "raw_payload_hash": payload_hash,
            "status": status_value,
        },
    )
    value = result.scalar_one_or_none()
    return str(value) if value is not None else None


async def _insert_posting_queue(
    db: AsyncSession,
    *,
    workspace_id: str,
    delivery_id: str | None,
    payment_request_id: str | None,
    queue_status: str,
    review_reason: str | None,
    transaction_snapshot: dict[str, object],
) -> None:
    if delivery_id is None:
        return
    resolved = queue_status in {"POSTED", "DEAD"}
    await db.execute(
        text(
            "insert into public.payment_posting_queue "
            "(workspace_id, delivery_id, payment_request_id, status, review_reason, "
            " transaction_snapshot, resolution, resolved_at) "
            "values (:workspace_id, :delivery_id, :payment_request_id, :status, "
            " :review_reason, cast(:snapshot as jsonb), :resolution, "
            " case when :resolved then now() else null end) "
            "on conflict (delivery_id) do nothing"
        ),
        {
            "workspace_id": workspace_id,
            "delivery_id": delivery_id,
            "payment_request_id": payment_request_id,
            "status": queue_status,
            "review_reason": review_reason,
            "snapshot": json.dumps(transaction_snapshot, ensure_ascii=False),
            "resolution": "automatic_post" if resolved else None,
            "resolved": resolved,
        },
    )


async def ingest_pay2s_webhook(
    db: AsyncSession,
    *,
    raw_body: bytes,
    authorization: str | None = None,
    # Compatibility parameters from the old scaffold. Pay2S Partner uses the
    # documented Bearer token per webhook instead.
    signature: str | None = None,
    event_id_header: str | None = None,
    merchant_id_header: str | None = None,
) -> str:
    if (
        not settings.payment_webhook_ingress_enabled
        or settings.payment_provider.casefold() != "pay2s"
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Webhook thanh toán chưa được bật ở máy chủ.",
        )
    token = _bearer_value(authorization)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Thiếu Bearer token webhook Pay2S.",
        )
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload webhook không hợp lệ.",
        ) from exc
    if not isinstance(payload, dict) or not isinstance(
        payload.get("transactions"), list
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload Pay2S phải chứa mảng transactions.",
        )
    if len(payload["transactions"]) > 500:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Payload webhook chứa quá nhiều giao dịch trong một lần gửi.",
        )

    token_hash = keyed_secret_hash(token, purpose=_TOKEN_HASH_PURPOSE)
    matched = await db.execute(
        text(
            "select id, workspace_id, provider_id, bank_account_id "
            "from public.workspace_payment_webhooks "
            "where webhook_token_hash = :token_hash and status = 'active'"
        ),
        {"token_hash": token_hash},
    )
    webhook_row = matched.mappings().first()
    if webhook_row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token webhook Pay2S không hợp lệ.",
        )

    workspace_id = str(webhook_row["workspace_id"])
    workspace_token = set_workspace_id(workspace_id)
    try:
        await db.execute(
            text("select set_config('app.workspace_id', :workspace_id, false)"),
            {"workspace_id": workspace_id},
        )
        account = await db.scalar(
            select(WorkspacePaymentAccount).where(
                WorkspacePaymentAccount.id == str(webhook_row["bank_account_id"])
            )
        )
        provider = await db.scalar(
            select(WorkspacePaymentProvider).where(
                WorkspacePaymentProvider.id == str(webhook_row["provider_id"])
            )
        )
        if account is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Webhook Pay2S không còn liên kết với tài khoản ngân hàng.",
            )
        provider_disabled = provider is None or provider.status == "disabled"

        payload_hash = hashlib.sha256(raw_body).hexdigest()
        first_delivery_id: str | None = None
        fallback_event_id = "webhook:empty"
        for transaction in payload["transactions"]:
            if not isinstance(transaction, dict):
                continue
            provider_id = str(transaction.get("id") or "").strip()
            provider_transaction_id = str(
                transaction.get("transactionNumber") or provider_id
            ).strip()
            if not provider_id or not provider_transaction_id:
                continue
            fallback_event_id = f"webhook:{webhook_row['id']}:{provider_id}"
            # Serialize retries for the same provider transaction before any
            # fee mutation.  The delivery row is intentionally append-only,
            # so the lock + existence check is the safe dedupe boundary.
            await db.execute(
                text("select pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
                {"lock_key": f"pay2s:transaction:{provider_transaction_id}"},
            )
            duplicate_delivery = await db.scalar(
                text(
                    "select id from public.payment_provider_deliveries "
                    "where provider = 'pay2s' "
                    "and provider_event_id = :event_id "
                    "and provider_transaction_id = :transaction_id "
                    "limit 1"
                ),
                {
                    "event_id": fallback_event_id,
                    "transaction_id": provider_transaction_id,
                },
            )
            if duplicate_delivery is not None:
                continue
            transfer_type = str(transaction.get("transferType") or "").upper()
            amount = _transaction_amount(transaction.get("transferAmount"))
            content = _normalized_content(transaction.get("content"))
            request = None
            review_reason = "unmatched_reference_or_amount"
            if (
                transfer_type == "IN"
                and amount is not None
                and _transaction_belongs_to_account(transaction, account)
            ):
                request = await _match_open_request(
                    db, account=account, content=content, amount=amount
                )
            elif transfer_type != "IN":
                review_reason = "outgoing_transfer"
            elif amount is None:
                review_reason = "invalid_amount"
            else:
                review_reason = "receiving_account_mismatch"
            status_value = "QUARANTINED"
            if (
                request is not None
                and settings.payment_auto_post_enabled
                and not provider_disabled
            ):
                item_result = await db.execute(
                    select(PaymentRequestItem)
                    .where(PaymentRequestItem.payment_request_id == request.id)
                    .order_by(PaymentRequestItem.id)
                )
                item_ids = [
                    UUID(item.fee_record_id) for item in item_result.scalars().all()
                ]
                if item_ids:
                    from app.services.fee_service import mark_fees_paid

                    await mark_fees_paid(
                        db,
                        item_ids,
                        actor_id=None,
                        payment_method="bank_transfer",
                        settlement_account_id=account.id,
                        allow_early=True,
                        request_id=UUID(str(request.request_id)),
                        payment_origin="pay2s",
                        provider_transaction_id=provider_transaction_id,
                        preserve_payment_request=True,
                        commit=False,
                    )
                    request.status = "PAID"
                    request.paid_at = datetime.now(timezone.utc)
                    db.add(
                        PaymentRequestEvent(
                            payment_request_id=request.id,
                            event_type="PAID",
                            old_status="OPEN",
                            new_status="PAID",
                            actor_user_id=None,
                        )
                    )
                    status_value = "PROCESSED"
                    review_reason = None
            elif request is not None and provider_disabled:
                review_reason = "provider_disabled"
            elif request is not None and not settings.payment_auto_post_enabled:
                review_reason = "auto_post_disabled"

            delivery_id = await _insert_delivery(
                db,
                workspace_id=workspace_id,
                event_id=fallback_event_id,
                provider_transaction_id=provider_transaction_id,
                payload_hash=payload_hash,
                status_value=status_value,
            )
            if first_delivery_id is None and delivery_id is not None:
                first_delivery_id = delivery_id
            await _insert_posting_queue(
                db,
                workspace_id=workspace_id,
                delivery_id=delivery_id,
                payment_request_id=str(request.id) if request is not None else None,
                queue_status="POSTED" if status_value == "PROCESSED" else "REVIEW",
                review_reason=review_reason,
                transaction_snapshot={
                    "source": "partner_webhook",
                    "provider_transaction_id": provider_transaction_id,
                    "bank_account_id": str(account.id),
                    "bank_name": account.bank_name,
                    "account_number": account.account_number,
                    "transfer_type": transfer_type,
                    "amount": amount,
                    "content": content,
                    "transaction_date": transaction.get("transactionDate"),
                },
            )

        await db.commit()
        return first_delivery_id or fallback_event_id
    finally:
        reset_workspace_id(workspace_token)


async def ingest_pay2s_collection_ipn(
    db: AsyncSession,
    *,
    raw_body: bytes,
) -> str:
    """Validate and process a Pay2S Collection Link result.

    This endpoint intentionally does not accept the Partner transaction
    webhook shape.  Collection Link binds a unique TPRO request/order id and
    is therefore the primary automatic-payment channel; transaction webhooks
    remain an independent reconciliation feed.
    """
    if (
        not settings.payment_webhook_ingress_enabled
        or settings.payment_provider.casefold() != "pay2s"
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Webhook thanh toán chưa được bật ở máy chủ.",
        )
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="IPN Pay2S không hợp lệ.",
        ) from exc
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="IPN Pay2S phải là một đối tượng JSON.",
        )

    partner_code = str(payload.get("partnerCode") or "").strip()
    request_key = str(payload.get("requestId") or "").strip()
    order_key = str(payload.get("orderId") or "").strip()
    transaction_id = str(payload.get("transId") or "").strip()
    amount = _transaction_amount(payload.get("amount"))
    if (
        not partner_code
        or not request_key
        or not order_key
        or not transaction_id
        or amount is None
        or amount <= 0
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="IPN Pay2S thiếu mã yêu cầu, giao dịch hoặc số tiền hợp lệ.",
        )
    try:
        UUID(request_key)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="requestId IPN Pay2S không hợp lệ.",
        ) from exc

    # Resolve by request id first. Each workspace has an independent provider
    # connection, and the selected provider must own the callback code.
    matched = await db.execute(
        text(
            "select provider.id as provider_id, provider.workspace_id "
            "from public.workspace_payment_providers provider "
            "join public.payment_requests request "
            "  on request.workspace_id = provider.workspace_id "
            "where provider.provider = 'pay2s' "
            "  and provider.status <> 'disabled' "
            "  and request.request_id = :request_id "
            "  and coalesce(provider.collection_partner_code, provider.partner_code) = :partner_code "
            "limit 2"
        ),
        {"request_id": request_key, "partner_code": partner_code},
    )
    matches = matched.mappings().all()
    if len(matches) != 1:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy yêu cầu Collection Link Pay2S tương ứng.",
        )

    workspace_id = str(matches[0]["workspace_id"])
    provider_id = str(matches[0]["provider_id"])
    workspace_token = set_workspace_id(workspace_id)
    try:
        await db.execute(
            text("select set_config('app.workspace_id', :workspace_id, false)"),
            {"workspace_id": workspace_id},
        )
        provider = await db.scalar(
            select(WorkspacePaymentProvider).where(
                WorkspacePaymentProvider.id == provider_id,
                WorkspacePaymentProvider.provider == "pay2s",
            )
        )
        request = await db.scalar(
            select(PaymentRequest)
            .where(PaymentRequest.request_id == request_key)
            .with_for_update()
        )
        if provider is None or request is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Yêu cầu thanh toán không còn tồn tại.",
            )
        credentials = await _provider_credentials(db, provider)
        if credentials is None or not _collection_ipn_signature_is_valid(
            payload, credentials[0], credentials[1]
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Chữ ký IPN Pay2S không hợp lệ.",
            )

        collection_link = _as_mapping(
            (request.provider_metadata or {}).get("collection_link")
        )
        if (
            request.status != "OPEN"
            or order_key != str(request.request_id)
            or request_key != str(request.request_id)
            or int(request.expected_amount) != amount
            or _normalized_content(payload.get("orderInfo"))
            != _normalized_content(
                collection_link.get("order_info")
                or re.sub(r"[^A-Za-z0-9]", "", request.payment_reference)[:32]
            )
            or collection_link.get("request_id") != request_key
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="IPN Pay2S không khớp yêu cầu thanh toán đang mở.",
            )

        await db.execute(
            text("select pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
            {"lock_key": f"pay2s:collection:{transaction_id}"},
        )
        event_id = f"collection-ipn:{request_key}:{transaction_id}"
        duplicate = await db.scalar(
            text(
                "select id from public.payment_provider_deliveries "
                "where provider = 'pay2s' and provider_transaction_id = :transaction_id "
                "limit 1"
            ),
            {"transaction_id": transaction_id},
        )
        if duplicate is not None:
            await db.commit()
            return str(duplicate)

        payload_hash = hashlib.sha256(raw_body).hexdigest()
        result_code = str(payload.get("resultCode") or "")
        if result_code != "0":
            delivery_id = await _insert_delivery(
                db,
                workspace_id=workspace_id,
                event_id=event_id,
                provider_transaction_id=transaction_id,
                payload_hash=payload_hash,
                status_value="FAILED",
            )
            await _insert_posting_queue(
                db,
                workspace_id=workspace_id,
                delivery_id=delivery_id,
                payment_request_id=str(request.id),
                queue_status="REVIEW",
                review_reason="provider_payment_failed",
                transaction_snapshot={
                    "source": "collection_ipn",
                    "provider_transaction_id": transaction_id,
                    "bank_account_id": str(request.settlement_account_id or ""),
                    "amount": amount,
                    "content": _normalized_content(payload.get("orderInfo")),
                    "result_code": result_code,
                    "message": str(payload.get("message") or "")[:240],
                },
            )
            await db.commit()
            return delivery_id or event_id

        delivery_status = "QUARANTINED"
        if settings.payment_auto_post_enabled:
            item_result = await db.execute(
                select(PaymentRequestItem)
                .where(PaymentRequestItem.payment_request_id == request.id)
                .order_by(PaymentRequestItem.id)
            )
            item_ids = [
                UUID(item.fee_record_id) for item in item_result.scalars().all()
            ]
            if not item_ids:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Yêu cầu Pay2S không có khoản học phí để ghi nhận.",
                )
            from app.services.fee_service import mark_fees_paid

            await mark_fees_paid(
                db,
                item_ids,
                actor_id=None,
                payment_method="bank_transfer",
                settlement_account_id=(
                    request.settlement_account_id
                    or collection_link.get("bank_account_id")
                ),
                allow_early=True,
                request_id=UUID(str(request.request_id)),
                payment_origin="pay2s",
                provider_transaction_id=transaction_id,
                preserve_payment_request=True,
                commit=False,
            )
            request.status = "PAID"
            request.paid_at = datetime.now(timezone.utc)
            db.add(
                PaymentRequestEvent(
                    payment_request_id=request.id,
                    event_type="PAID",
                    old_status="OPEN",
                    new_status="PAID",
                    actor_user_id=None,
                    event_metadata={
                        "source": "pay2s_collection_ipn",
                        "provider_transaction_id": transaction_id,
                    },
                )
            )
            delivery_status = "PROCESSED"

        delivery_id = await _insert_delivery(
            db,
            workspace_id=workspace_id,
            event_id=event_id,
            provider_transaction_id=transaction_id,
            payload_hash=payload_hash,
            status_value=delivery_status,
        )
        await _insert_posting_queue(
            db,
            workspace_id=workspace_id,
            delivery_id=delivery_id,
            payment_request_id=str(request.id),
            queue_status=("POSTED" if delivery_status == "PROCESSED" else "REVIEW"),
            review_reason=(
                None if delivery_status == "PROCESSED" else "auto_post_disabled"
            ),
            transaction_snapshot={
                "source": "collection_ipn",
                "provider_transaction_id": transaction_id,
                "bank_account_id": str(request.settlement_account_id or ""),
                "amount": amount,
                "content": _normalized_content(payload.get("orderInfo")),
                "result_code": result_code,
            },
        )
        await db.commit()
        return delivery_id or event_id
    finally:
        reset_workspace_id(workspace_token)


async def create_pay2s_collection_link(
    db: AsyncSession,
    request: PaymentRequest,
    *,
    provider: WorkspacePaymentProvider,
) -> dict[str, Any]:
    """Create a Pay2S Collection Link and persist its immutable snapshot.

    Collection Link uses the partner access key plus an HMAC signature. The
    resulting URL/QR list is stored in ``provider_metadata`` so a browser
    refresh never regenerates a different order.
    """
    credentials = await _provider_credentials(db, provider)
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Chưa có Access Key và Secret Key Pay2S cho đơn vị này.",
        )
    access_key, secret_key = credentials
    if provider.status != "connected":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Kết nối Pay2S chưa sẵn sàng. Hãy xác thực lại trước khi tạo QR.",
        )
    partner_code = provider.collection_partner_code or provider.partner_code
    if not partner_code:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pay2S chưa cấp partnerCode cho Collection Link.",
        )
    redirect_url = _collection_redirect_url()
    # Collection Link IPN has a signed order-result payload, unlike the
    # Partner transaction webhook's ``transactions[]`` payload.  They must
    # never share the same endpoint.
    ipn_url = settings.pay2s_ipn_url
    if not ipn_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Máy chủ chưa cấu hình PAY2S_IPN_URL.",
        )
    existing_link = _as_mapping(
        (request.provider_metadata or {}).get("collection_link")
    )
    if existing_link.get("request_id") == str(request.request_id) and (
        existing_link.get("payment_url") or existing_link.get("qr_list")
    ):
        return existing_link

    account_result = await db.execute(
        select(WorkspacePaymentAccount)
        .where(
            WorkspacePaymentAccount.workspace_id == provider.workspace_id,
            WorkspacePaymentAccount.is_active.is_(True),
            WorkspacePaymentAccount.provider_bank_id.is_not(None),
            WorkspacePaymentAccount.provider_account_id.is_not(None),
            WorkspacePaymentAccount.provider_status.notin_(
                ("manual", "disabled", "error")
            ),
        )
        .order_by(
            WorkspacePaymentAccount.is_default.desc(),
            WorkspacePaymentAccount.created_at,
        )
    )
    accounts = [
        account
        for account in account_result.scalars().all()
        if get_pay2s_payment_bank(account.bank_code) is not None
    ]
    if not accounts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Đơn vị này chưa có tài khoản Pay2S sẵn sàng. Hãy liên kết một "
                "ngân hàng Pay2S được hỗ trợ trước khi tạo QR."
            ),
        )
    # One request deliberately targets one linked account.  Sending every
    # active/manual account to Pay2S would make QR settlement ambiguous.
    account = accounts[0]
    request.settlement_account_id = account.id
    bank_accounts = [
        {"account_number": account.account_number, "bank_id": account.bank_code}
    ]
    amount = int(request.expected_amount)
    request_key = str(request.request_id)
    order_info = re.sub(r"[^A-Za-z0-9]", "", request.payment_reference)[:32]
    # Pay2S' published examples intentionally sign the literal marker
    # ``bankAccounts=Array`` rather than the JSON representation of the list.
    # Signing the serialized JSON produces a valid-looking HMAC that Pay2S
    # rejects, so keep this string exactly aligned with their contract.
    canonical = (
        f"accessKey={access_key}&amount={amount}&bankAccounts=Array&ipnUrl={ipn_url}"
        f"&orderId={request_key}&orderInfo={order_info}&partnerCode={partner_code}"
        f"&redirectUrl={redirect_url}&requestId={request_key}&requestType=pay2s"
    )
    body = {
        "accessKey": access_key,
        "partnerCode": partner_code,
        "partnerName": "TPRO Classio",
        "requestId": request_key,
        "amount": amount,
        "orderId": request_key,
        "orderInfo": order_info,
        "orderType": "pay2s",
        "bankAccounts": bank_accounts,
        "redirectUrl": redirect_url,
        "ipnUrl": ipn_url,
        "requestType": "pay2s",
        "signature": hmac.new(
            secret_key.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256
        ).hexdigest(),
    }
    try:
        async with httpx.AsyncClient(
            base_url=settings.pay2s_collection_base_url.rstrip("/"),
            timeout=settings.pay2s_http_timeout_seconds,
            follow_redirects=False,
        ) as client:
            response = await client.post(
                "/v1/gateway/api/create",
                headers={"Content-Type": "application/json; charset=UTF-8"},
                json=body,
            )
        payload = _as_mapping(response.json())
    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không thể tạo liên kết thanh toán Pay2S.",
        ) from exc
    result_code = payload.get("resultCode")
    if (
        response.status_code >= 400
        or (result_code is not None and str(result_code) != "0")
        or payload.get("success") is False
    ):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_message(payload),
        )
    metadata = dict(request.provider_metadata or {})
    metadata["collection_link"] = {
        "provider": "pay2s",
        "request_id": request_key,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "payment_url": payload.get("payUrl")
        or payload.get("paymentUrl")
        or payload.get("url"),
        "qr_list": payload.get("qrList") or payload.get("qr_list") or [],
        "result_code": payload.get("resultCode", 0),
        "bank_account_id": str(account.id),
        "bank_code": account.bank_code,
        "bank_name": account.bank_name,
        "order_info": order_info,
    }
    request.provider_metadata = metadata
    await db.flush()
    return metadata["collection_link"]
