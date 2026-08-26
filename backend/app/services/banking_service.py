import hashlib
from uuid import UUID

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_credentials import encrypt_credential, keyed_secret_hash
from app.core.config import settings
from app.models.banking import (
    WorkspacePaymentAccount,
    WorkspacePaymentProvider,
    WorkspacePaymentWebhook,
)
from app.schemas.banking import (
    BankAccountCreate,
    BankAccountListResponse,
    BankAccountResponse,
    BankAccountUpdate,
    BankingOverviewResponse,
    Pay2SConnectionUpsert,
    Pay2SProviderStatusResponse,
    Pay2SBankConnectRequest,
    Pay2SBankConnectResponse,
    Pay2SBankOtpRequest,
    Pay2SSupportedBankResponse,
    Pay2SSupportedBanksResponse,
    Pay2SWebhookResponse,
)
from app.services.pay2s_service import Pay2SError, get_pay2s_client
from app.services.pay2s_catalog import (
    PAY2S_PAYMENT_BANKS,
    get_pay2s_payment_bank,
    resolve_pay2s_payment_bank,
)
from app.services.banking_qr_storage_service import store_bank_qr_image
from app.services.payment_readiness_service import get_pay2s_readiness

_PAY2S_ACCESS_KEY_PURPOSE = "pay2s-access-key-v1"
_PAY2S_CREDENTIAL_KEY_PURPOSE = "pay2s-secret-key-v1"
_PAY2S_WEBHOOK_TOKEN_PURPOSE = "pay2s-webhook-token-v1"
_PAY2S_WEBHOOK_TOKEN_HASH_PURPOSE = "pay2s-webhook-token-hash-v1"
_PAY2S_CATALOG_VERIFIED_AT = datetime(2026, 8, 21, tzinfo=timezone.utc)


def _account_response(
    account: WorkspacePaymentAccount, *, webhook_configured: bool = False
) -> BankAccountResponse:
    response = BankAccountResponse.model_validate(account, from_attributes=True)
    qr_source_url = account.qr_source_url
    if account.qr_object_path:
        version = hashlib.sha256(account.qr_object_path.encode("utf-8")).hexdigest()[
            :16
        ]
        qr_source_url = f"/api/proxy/banking/accounts/{account.id}/qr?v={version}"
    return response.model_copy(
        update={
            "qr_source_url": qr_source_url,
            "connection_type": (
                "pay2s"
                if account.provider_bank_id and account.provider_account_id
                else "external"
            ),
            "webhook_configured": webhook_configured,
        }
    )


def _provider_response(
    provider: WorkspacePaymentProvider | None,
) -> Pay2SProviderStatusResponse:
    if provider is None:
        return Pay2SProviderStatusResponse(
            provider="pay2s",
            status="not_configured",
            plan="unconfirmed",
            merchant_id=None,
            partner_code=None,
            collection_partner_code=None,
            access_key_configured=False,
            webhook_configured=False,
            webhook_url=None,
            connected_at=None,
            last_error=None,
        )
    return Pay2SProviderStatusResponse(
        provider="pay2s",
        status=provider.status,
        plan=provider.plan,
        merchant_id=provider.merchant_id,
        partner_code=provider.partner_code,
        collection_partner_code=provider.collection_partner_code,
        access_key_configured=bool(
            provider.access_key_ciphertext and provider.secret_key_ciphertext
        ),
        webhook_configured=bool(provider.webhook_url),
        webhook_url=provider.webhook_url or settings.pay2s_webhook_url or None,
        connected_at=provider.connected_at,
        last_error=provider.last_error,
    )


async def list_bank_accounts(db: AsyncSession) -> BankAccountListResponse:
    result = await db.execute(
        select(WorkspacePaymentAccount).order_by(
            WorkspacePaymentAccount.is_active.desc(),
            WorkspacePaymentAccount.is_default.desc(),
            WorkspacePaymentAccount.created_at.desc(),
        )
    )
    accounts = list(result.scalars().all())
    active_webhook_result = await db.execute(
        select(WorkspacePaymentWebhook.bank_account_id).where(
            WorkspacePaymentWebhook.status == "active"
        )
    )
    active_webhook_account_ids = {
        str(account_id) for account_id in active_webhook_result.scalars().all()
    }
    return BankAccountListResponse(
        accounts=[
            _account_response(
                account,
                webhook_configured=str(account.id) in active_webhook_account_ids,
            )
            for account in accounts
        ]
    )


async def create_bank_account(
    db: AsyncSession,
    payload: BankAccountCreate,
    *,
    actor_id: str,
    qr_image: UploadFile | None = None,
    workspace_id: str | None = None,
) -> BankAccountResponse:
    has_provider_link = bool(payload.provider_account_id or payload.provider_bank_id)
    if qr_image is not None and has_provider_link:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ảnh QR gốc chỉ áp dụng cho tài khoản chuyển khoản thủ công.",
        )
    if qr_image is not None and not workspace_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Không xác định được không gian dữ liệu để lưu ảnh QR.",
        )
    if has_provider_link:
        if not payload.provider_account_id or not payload.provider_bank_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Tài khoản Pay2S phải có đủ mã tài khoản và mã ngân hàng từ Pay2S.",
            )
        if get_pay2s_payment_bank(payload.bank_code) is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Ngân hàng này chưa được xác nhận trong danh mục Pay2S.",
            )

    duplicate = await db.scalar(
        select(WorkspacePaymentAccount.id).where(
            and_(
                WorkspacePaymentAccount.bank_code == payload.bank_code,
                WorkspacePaymentAccount.account_number == payload.account_number,
                WorkspacePaymentAccount.is_active.is_(True),
            )
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tài khoản ngân hàng này đã được thêm trong workspace.",
        )
    if payload.is_default:
        await db.execute(
            update(WorkspacePaymentAccount)
            .values(is_default=False)
            .where(
                WorkspacePaymentAccount.is_default.is_(True),
                WorkspacePaymentAccount.is_active.is_(True),
            )
        )
    account = WorkspacePaymentAccount(
        **payload.model_dump(),
        provider_status="connected" if has_provider_link else "manual",
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(account)
    await db.flush()
    if qr_image is not None:
        account.qr_object_path = await store_bank_qr_image(
            qr_image,
            workspace_id=workspace_id or "",
            account_id=str(account.id),
        )
        # Do not keep a user-supplied URL beside a managed private object.
        account.qr_source_url = None
        await db.flush()
    return _account_response(account)


async def update_bank_account(
    db: AsyncSession,
    account_id: UUID,
    payload: BankAccountUpdate,
    *,
    actor_id: str,
) -> BankAccountResponse | None:
    account = await db.scalar(
        select(WorkspacePaymentAccount).where(
            WorkspacePaymentAccount.id == str(account_id)
        )
    )
    if account is None:
        return None
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("is_default") is True:
        await db.execute(
            update(WorkspacePaymentAccount)
            .values(is_default=False)
            .where(
                WorkspacePaymentAccount.id != str(account_id),
                WorkspacePaymentAccount.is_default.is_(True),
                WorkspacePaymentAccount.is_active.is_(True),
            )
        )
    for key, value in changes.items():
        setattr(account, key, value)
    account.updated_by = actor_id
    await db.flush()
    return _account_response(account)


async def archive_bank_account(
    db: AsyncSession, account_id: UUID, *, actor_id: str
) -> bool:
    account = await db.scalar(
        select(WorkspacePaymentAccount).where(
            WorkspacePaymentAccount.id == str(account_id)
        )
    )
    if account is None:
        return False
    account.is_active = False
    account.is_default = False
    account.updated_by = actor_id
    await db.flush()
    return True


async def get_banking_overview(db: AsyncSession) -> BankingOverviewResponse:
    accounts = await list_bank_accounts(db)
    provider = await db.scalar(
        select(WorkspacePaymentProvider).where(
            WorkspacePaymentProvider.provider == "pay2s"
        )
    )
    readiness = await get_pay2s_readiness(db)
    return BankingOverviewResponse(
        accounts=accounts.accounts,
        provider=_provider_response(provider),
        readiness=readiness.__dict__,
    )


async def get_pay2s_status(db: AsyncSession) -> Pay2SProviderStatusResponse:
    provider = await db.scalar(
        select(WorkspacePaymentProvider).where(
            WorkspacePaymentProvider.provider == "pay2s"
        )
    )
    return _provider_response(provider)


async def get_pay2s_supported_banks() -> Pay2SSupportedBanksResponse:
    """Return the provider allow-list, never the generic VietQR directory."""
    return Pay2SSupportedBanksResponse(
        banks=[
            Pay2SSupportedBankResponse(
                code=bank.code, short_name=bank.short_name, name=bank.name
            )
            for bank in PAY2S_PAYMENT_BANKS
        ],
        source="pay2s_official_snapshot",
        verified_at=_PAY2S_CATALOG_VERIFIED_AT,
    )


async def upsert_pay2s_connection(
    db: AsyncSession,
    payload: Pay2SConnectionUpsert,
    *,
    actor_id: str,
) -> Pay2SProviderStatusResponse:
    provider = await db.scalar(
        select(WorkspacePaymentProvider).where(
            WorkspacePaymentProvider.provider == "pay2s"
        )
    )
    if provider is None:
        provider = WorkspacePaymentProvider(provider="pay2s", created_by=actor_id)
        db.add(provider)
    provider.connection_mode = "byo"
    access = payload.access_key or payload.api_key
    if access is not None:
        provider.access_key_ciphertext = encrypt_credential(
            access.get_secret_value(), purpose=_PAY2S_ACCESS_KEY_PURPOSE
        )
    if payload.secret_key is not None:
        provider.secret_key_ciphertext = encrypt_credential(
            payload.secret_key.get_secret_value(), purpose=_PAY2S_CREDENTIAL_KEY_PURPOSE
        )
    provider.merchant_id = payload.merchant_id
    provider.partner_code = payload.partner_code
    provider.collection_partner_code = payload.collection_partner_code
    provider.plan = payload.plan
    provider.status = "pending_verification"
    provider.last_error = None
    provider.updated_by = actor_id
    await db.flush()
    return _provider_response(provider)


async def _get_provider(db: AsyncSession) -> WorkspacePaymentProvider:
    provider = await db.scalar(
        select(WorkspacePaymentProvider).where(
            WorkspacePaymentProvider.provider == "pay2s"
        )
    )
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Đơn vị này chưa thiết lập kết nối Pay2S.",
        )
    return provider


async def verify_pay2s_connection(
    db: AsyncSession, *, actor_id: str
) -> Pay2SProviderStatusResponse:
    provider = await _get_provider(db)
    try:
        client, token = await get_pay2s_client(db, provider, refresh=True)
        banks = await client.list_banks(token)
        await _sync_remote_pay2s_banks(db, banks, actor_id=actor_id)
    except Pay2SError as exc:
        provider.status = "error"
        provider.last_error = str(exc)[:500]
        await db.flush()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
    provider.status = "connected"
    provider.connected_at = datetime.now(timezone.utc)
    provider.last_error = None
    await db.flush()
    return _provider_response(provider)


def _bank_account_from_remote(
    remote: dict[str, Any],
    *,
    label: str | None,
    actor_id: str | None,
    fallback_bank_code: str | None = None,
    fallback_bank_name: str | None = None,
    fallback_account_number: str | None = None,
    fallback_account_name: str | None = None,
) -> WorkspacePaymentAccount | None:
    provider_id = remote.get("id") or remote.get("user_bank_id")
    account_number = (
        remote.get("accountNumber")
        or remote.get("account_number")
        or fallback_account_number
    )
    bank_code = (
        remote.get("shortBankName") or remote.get("bankShortName") or fallback_bank_code
    )
    bank_name = remote.get("bankName") or fallback_bank_name or remote.get("name")
    account_name = (
        remote.get("accName")
        or remote.get("accountName")
        or fallback_account_name
        or remote.get("name")
    )
    if (
        provider_id is None
        or not account_number
        or not bank_code
        or not bank_name
        or not account_name
    ):
        return None
    return WorkspacePaymentAccount(
        label=label or f"{bank_code} · {account_number}",
        bank_code=str(bank_code),
        bank_name=str(bank_name),
        account_number=str(account_number),
        account_name=str(account_name),
        provider_account_id=str(provider_id),
        provider_bank_id=str(provider_id),
        va_number=(str(remote.get("vaNumber")) if remote.get("vaNumber") else None),
        provider_status=(str(remote.get("statusText") or "active")),
        provider_metadata=_safe_remote_bank_metadata(remote),
        last_synced_at=datetime.now(timezone.utc),
        created_by=actor_id,
        updated_by=actor_id,
    )


def _safe_remote_bank_metadata(remote: dict[str, Any]) -> dict[str, Any]:
    """Keep reconciliation metadata without persisting login or balance data."""

    allowed_keys = {
        "id",
        "user_bank_id",
        "bankName",
        "shortBankName",
        "bankShortName",
        "status",
        "statusText",
        "vaNumber",
        "created_at",
    }
    return {key: remote[key] for key in allowed_keys if key in remote}


def _remote_bank_is_active(remote: dict[str, Any]) -> bool:
    status_value = remote.get("status")
    if status_value is not None:
        return status_value is True or str(status_value).strip() == "1"
    status_text = str(remote.get("statusText") or "").strip().lower()
    return not status_text or "hoạt động" in status_text or "active" in status_text


async def _sync_remote_pay2s_banks(
    db: AsyncSession,
    banks: list[dict[str, Any]],
    *,
    actor_id: str,
) -> int:
    """Idempotently import Pay2S banks already linked outside TPRO."""

    synced = 0
    for remote in banks:
        catalog_bank = resolve_pay2s_payment_bank(
            remote.get("shortBankName") or remote.get("bankShortName"),
            remote.get("bankName"),
        )
        if catalog_bank is None:
            continue
        incoming = _bank_account_from_remote(
            remote,
            label=None,
            actor_id=actor_id,
            fallback_bank_code=catalog_bank.code,
            fallback_bank_name=catalog_bank.name,
        )
        if incoming is None:
            continue
        existing = await db.scalar(
            select(WorkspacePaymentAccount).where(
                or_(
                    WorkspacePaymentAccount.provider_bank_id
                    == incoming.provider_bank_id,
                    and_(
                        WorkspacePaymentAccount.bank_code == incoming.bank_code,
                        WorkspacePaymentAccount.account_number
                        == incoming.account_number,
                    ),
                )
            )
        )
        if existing is None:
            incoming.is_active = _remote_bank_is_active(remote)
            db.add(incoming)
        else:
            for key in (
                "bank_code",
                "bank_name",
                "account_number",
                "account_name",
                "provider_account_id",
                "provider_bank_id",
                "va_number",
                "provider_status",
                "provider_metadata",
                "last_synced_at",
            ):
                setattr(existing, key, getattr(incoming, key))
            existing.is_active = _remote_bank_is_active(remote)
            existing.updated_by = actor_id
        synced += 1
    if synced:
        await db.flush()
    return synced


def _matches_remote_bank(
    remote: dict[str, Any], *, account_number: str, bank_code: str
) -> bool:
    """Match Pay2S rows even when its list response omits shortBankName."""
    remote_account = str(
        remote.get("accountNumber") or remote.get("account_number") or ""
    )
    remote_code = remote.get("shortBankName") or remote.get("bankShortName")
    return remote_account == account_number and (
        not remote_code or str(remote_code) == bank_code
    )


async def connect_pay2s_bank(
    db: AsyncSession,
    payload: Pay2SBankConnectRequest,
    *,
    actor_id: str,
) -> Pay2SBankConnectResponse:
    catalog_bank = get_pay2s_payment_bank(payload.bank_short_name)
    if catalog_bank is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Ngân hàng này chưa nằm trong danh mục thanh toán Pay2S của TPRO. "
                "Hãy thêm nó dưới dạng tài khoản chuyển khoản thủ công."
            ),
        )
    provider = await _get_provider(db)
    try:
        client, token = await get_pay2s_client(db, provider)
        body: dict[str, Any] = {
            "type": payload.bank_type,
            "bankShortName": catalog_bank.code,
            "accountNumber": payload.account_number,
        }
        if payload.bank_type == "openapi":
            for key, value in {
                "accName": payload.account_name,
                "cccd": payload.cccd,
                "merchantId": payload.merchant_id or provider.merchant_id,
                "accMobile": payload.acc_mobile,
                "accEmail": payload.acc_email,
            }.items():
                if value:
                    body[key] = value
        else:
            body["username"] = payload.internet_banking_username
            body["password"] = (
                payload.internet_banking_password.get_secret_value()
                if payload.internet_banking_password
                else None
            )
        response = await client.add_bank(token, body)
    except Pay2SError as exc:
        provider.status = "error"
        provider.last_error = str(exc)[:500]
        await db.flush()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc

    raw_data = response.get("data")
    remote = raw_data if isinstance(raw_data, dict) else response.get("message")
    if isinstance(remote, list):
        remote = remote[0] if remote else {}
    remote = remote if isinstance(remote, dict) else {}
    otp_required = bool(
        response.get("OTP")
        or response.get("otp")
        or remote.get("OTP")
        or remote.get("otp")
    )
    account = None
    if not otp_required:
        banks = await client.list_banks(token)
        remote_bank = next(
            (
                bank
                for bank in banks
                if _matches_remote_bank(
                    bank,
                    account_number=payload.account_number,
                    bank_code=payload.bank_short_name,
                )
            ),
            remote,
        )
        account = _bank_account_from_remote(
            remote_bank,
            label=payload.label,
            actor_id=actor_id,
            fallback_bank_code=catalog_bank.code,
            fallback_bank_name=catalog_bank.name,
            fallback_account_number=payload.account_number,
            fallback_account_name=payload.account_name,
        )
        if account is not None:
            existing = await db.scalar(
                select(WorkspacePaymentAccount).where(
                    WorkspacePaymentAccount.provider_bank_id == account.provider_bank_id
                )
            )
            if existing is None:
                db.add(account)
            else:
                for key in (
                    "label",
                    "bank_code",
                    "bank_name",
                    "account_number",
                    "account_name",
                    "provider_account_id",
                    "provider_bank_id",
                    "va_number",
                    "provider_status",
                    "provider_metadata",
                    "last_synced_at",
                ):
                    setattr(existing, key, getattr(account, key))
                existing.is_active = True
                existing.updated_by = actor_id
                account = existing
            await db.flush()
    return Pay2SBankConnectResponse(
        accepted=True,
        otp_required=otp_required,
        message="Pay2S đã gửi OTP." if otp_required else "Đã liên kết ngân hàng Pay2S.",
        provider_bank_id=(account.provider_bank_id if account else None),
        va_number=(account.va_number if account else None),
        account=(_account_response(account) if account else None),
    )


async def confirm_pay2s_bank_otp(
    db: AsyncSession,
    payload: Pay2SBankOtpRequest,
    *,
    actor_id: str,
) -> Pay2SBankConnectResponse:
    catalog_bank = get_pay2s_payment_bank(payload.bank_short_name)
    if catalog_bank is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngân hàng không thuộc danh mục thanh toán Pay2S.",
        )
    provider = await _get_provider(db)
    try:
        client, token = await get_pay2s_client(db, provider)
        body: dict[str, Any] = {
            "type": payload.bank_type,
            "bankShortName": payload.bank_short_name,
            "accountNumber": payload.account_number,
            "otp": payload.otp,
        }
        if payload.merchant_id or provider.merchant_id:
            body["merchantId"] = payload.merchant_id or provider.merchant_id
        if payload.bank_type == "personal":
            body["username"] = payload.internet_banking_username
            body["password"] = (
                payload.internet_banking_password.get_secret_value()
                if payload.internet_banking_password
                else None
            )
        await client.confirm_bank_otp(token, body)
        banks = await client.list_banks(token)
    except Pay2SError as exc:
        provider.status = "error"
        provider.last_error = str(exc)[:500]
        await db.flush()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
    remote = next(
        (
            bank
            for bank in banks
            if _matches_remote_bank(
                bank,
                account_number=payload.account_number,
                bank_code=payload.bank_short_name,
            )
        ),
        None,
    )
    account = _bank_account_from_remote(
        remote or {},
        label=None,
        actor_id=actor_id,
        fallback_bank_code=catalog_bank.code,
        fallback_bank_name=catalog_bank.name,
        fallback_account_number=payload.account_number,
        fallback_account_name=(
            str(
                (remote or {}).get("accName") or (remote or {}).get("accountName") or ""
            )
            or None
        ),
    )
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Pay2S xác nhận OTP nhưng không trả về tài khoản ngân hàng.",
        )
    existing = await db.scalar(
        select(WorkspacePaymentAccount).where(
            WorkspacePaymentAccount.provider_bank_id == account.provider_bank_id
        )
    )
    if existing is None:
        db.add(account)
    else:
        for key in (
            "provider_bank_id",
            "provider_account_id",
            "va_number",
            "provider_status",
            "provider_metadata",
            "last_synced_at",
        ):
            setattr(existing, key, getattr(account, key))
        account = existing
    await db.flush()
    return Pay2SBankConnectResponse(
        accepted=True,
        otp_required=False,
        message="Đã xác nhận OTP và liên kết ngân hàng.",
        provider_bank_id=account.provider_bank_id,
        va_number=account.va_number,
        account=_account_response(account),
    )


def _find_active_remote_webhook(
    remote_webhooks: list[dict[str, Any]], provider_bank_id: str
) -> dict[str, Any] | None:
    return next(
        (
            item
            for item in remote_webhooks
            if str(item.get("user_bank_id") or item.get("bank_id"))
            == str(provider_bank_id)
            and str(item.get("status", "1")) in {"1", "active", "ACTIVE"}
            and isinstance(item.get("token"), str)
            and item.get("token")
        ),
        None,
    )


async def create_pay2s_webhook(
    db: AsyncSession,
    bank_account_id: str,
    *,
    actor_id: str,
) -> Pay2SWebhookResponse:
    provider = await _get_provider(db)
    account = await db.scalar(
        select(WorkspacePaymentAccount).where(
            WorkspacePaymentAccount.id == bank_account_id
        )
    )
    if account is None or not account.provider_bank_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tài khoản chưa được liên kết với Pay2S.",
        )
    webhook_url = provider.webhook_url or settings.pay2s_webhook_url
    if not webhook_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Máy chủ chưa có địa chỉ nhận giao dịch Pay2S.",
        )
    existing = await db.scalar(
        select(WorkspacePaymentWebhook).where(
            WorkspacePaymentWebhook.bank_account_id == bank_account_id
        )
    )
    if existing is not None and existing.status == "active":
        return Pay2SWebhookResponse(
            id=existing.id,
            provider_webhook_id=existing.provider_webhook_id,
            status=existing.status,
            webhook_url=existing.webhook_url,
            webhook_type=existing.webhook_type,
            bank_account_id=existing.bank_account_id,
        )
    try:
        client, token = await get_pay2s_client(db, provider)
        # A previous deployment or an operator may already have registered
        # this bank remotely.  Reuse that hook (and its token) instead of
        # consuming another Pay2S plan slot or creating duplicate callbacks.
        remote_webhooks = await client.list_webhooks(token)
        remote_existing = _find_active_remote_webhook(
            remote_webhooks, account.provider_bank_id
        )
        if remote_existing is not None:
            remote_webhook_url = remote_existing.get("webhook_url")
            remote_webhook_id = remote_existing.get("id") or remote_existing.get(
                "webhook_id"
            )
            remote_webhook_type = str(remote_existing.get("type") or "IN").upper()
            if remote_webhook_type not in {"IN", "OUT", "ALL"}:
                remote_webhook_type = "IN"
            if remote_webhook_id is not None and (
                not isinstance(remote_webhook_url, str)
                or remote_webhook_url != webhook_url
                or remote_webhook_type != "IN"
            ):
                await client.update_webhook(
                    token,
                    str(remote_webhook_id),
                    webhook_url=webhook_url,
                    webhook_type="IN",
                )
                remote_existing = {
                    **remote_existing,
                    "webhook_url": webhook_url,
                    "type": "IN",
                }
            response = {"data": remote_existing}
        else:
            response = await client.create_webhook(
                token,
                user_bank_id=account.provider_bank_id,
                webhook_url=webhook_url,
                webhook_type="IN",
            )
            # Pay2S may acknowledge creation with only status/message while
            # the token and remote id are exposed by the list endpoint. Read
            # the created hook back before persisting the local subscription.
            response_data = (
                response.get("data")
                if isinstance(response.get("data"), dict)
                else response
            )
            if not response_data.get("token") or not (
                response_data.get("id") or response_data.get("webhook_id")
            ):
                try:
                    refreshed_webhooks = await client.list_webhooks(token)
                except Pay2SError:
                    refreshed_webhooks = []
                remote_created = _find_active_remote_webhook(
                    refreshed_webhooks, account.provider_bank_id
                )
                if remote_created is not None:
                    response = {"data": remote_created}
    except Pay2SError as exc:
        provider.last_error = str(exc)[:500]
        await db.flush()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
    raw_data = response.get("data")
    data = raw_data if isinstance(raw_data, dict) else response
    provider_webhook_id = data.get("id") or data.get("webhook_id")
    webhook_token = data.get("token")
    if not isinstance(webhook_token, str) or not webhook_token.strip():
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Pay2S chưa trả về thông tin xác thực để nhận giao dịch.",
        )
    if existing is None:
        existing = WorkspacePaymentWebhook(
            provider_id=provider.id,
            bank_account_id=account.id,
            webhook_url=webhook_url,
            webhook_type="IN",
        )
        db.add(existing)
    existing.provider_webhook_id = (
        str(provider_webhook_id) if provider_webhook_id is not None else None
    )
    existing.webhook_token_ciphertext = encrypt_credential(
        webhook_token.strip(), purpose=_PAY2S_WEBHOOK_TOKEN_PURPOSE
    )
    existing.webhook_token_hash = keyed_secret_hash(
        webhook_token.strip(), purpose=_PAY2S_WEBHOOK_TOKEN_HASH_PURPOSE
    )
    existing.status = "active"
    existing.last_error = None
    provider.webhook_url = webhook_url
    await db.flush()
    return Pay2SWebhookResponse(
        id=existing.id,
        provider_webhook_id=existing.provider_webhook_id,
        status=existing.status,
        webhook_url=existing.webhook_url,
        webhook_type=existing.webhook_type,
        bank_account_id=existing.bank_account_id,
    )
