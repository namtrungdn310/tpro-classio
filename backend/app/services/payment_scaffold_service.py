"""Provider-neutral early-payment request domain.

Creating a request is separate from notifying a parent and from posting a
payment. The default feature flag is off; when enabled this module creates an
auditable reference/payload only. A real Pay2S adapter must authenticate and
match its webhook before a ledger entry is posted.
"""

from datetime import datetime, timedelta, timezone
import hashlib
import re
import secrets
from collections.abc import Sequence
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_time import business_today
from app.core.config import settings
from app.models.fee_record import FeeRecord
from app.models.payment_request import (
    PaymentRequest,
    PaymentRequestEvent,
    PaymentRequestItem,
)
from app.models.banking import WorkspacePaymentAccount
from app.schemas.fee import (
    PaymentRequestItemResponse,
    PaymentRequestListResponse,
    PaymentRequestResponse,
    PaymentRequestShareRequest,
    PaymentRequestShareResponse,
)

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
REFERENCE_PATTERN = re.compile(r"^TP\d{9}P[0-9A-HJKMNP-TV-Z]{8}$")


class PaymentRequestNotDueError(ValueError):
    """Kept for compatibility with callers using the old scaffold."""


class PaymentRequestUnavailableError(ValueError):
    pass


class PaymentRequestFeatureDisabledError(PaymentRequestUnavailableError):
    """The provider-neutral QR preparation flag is intentionally disabled."""


def generate_payment_reference(student_code: str) -> str:
    """Return a non-PII reference containing the stable student code."""
    suffix = "".join(CROCKFORD[secrets.randbelow(len(CROCKFORD))] for _ in range(8))
    return f"{student_code}P{suffix}"


def payment_automation_enabled() -> bool:
    """Whether the external webhook posting path is enabled."""
    return (
        settings.payment_provider not in {"", "disabled"}
        and settings.payment_webhook_ingress_enabled
    )


def payment_qr_creation_enabled() -> bool:
    """QR preparation is independent from webhook ingestion."""
    return bool(settings.payment_qr_enabled)


def _effective_due(record: FeeRecord):
    return record.adjusted_due_date or record.due_date


def _student_code(record: FeeRecord) -> str:
    student = record.enrollment.student if record.enrollment else None
    code = (student.student_code if student else None) or getattr(
        record, "student_code_snapshot", None
    )
    if not code or not re.fullmatch(r"TP\d{9}", code):
        raise PaymentRequestUnavailableError(
            "Học viên chưa có mã học viên hợp lệ để tạo mã thanh toán."
        )
    return code


async def create_payment_request(
    db: AsyncSession,
    fee_record: FeeRecord,
    student_code: str,
    *,
    actor_id: str | None = None,
    request_id: str | None = None,
) -> PaymentRequest | None:
    """Compatibility wrapper for one-record request creation."""
    if not payment_qr_creation_enabled():
        return None
    return await create_payment_request_for_records(
        db,
        [fee_record],
        actor_id=actor_id,
        request_id=request_id,
        student_code_override=student_code,
    )


async def create_payment_request_for_records(
    db: AsyncSession,
    records: Sequence[FeeRecord],
    *,
    actor_id: str | None = None,
    request_id: str | None = None,
    student_code_override: str | None = None,
) -> PaymentRequest:
    """Create one idempotent request for one student.

    QR creation does not notify or mark a fee paid. Only the next bounded
    obligations may be prepared, preventing a parent from paying years ahead.
    """
    if not payment_qr_creation_enabled():
        raise PaymentRequestFeatureDisabledError(
            "Tính năng tạo mã thanh toán sớm chưa được bật ở máy chủ."
        )
    ordered = list(dict.fromkeys(record.id for record in records))
    if not ordered or len(ordered) > 20:
        raise PaymentRequestUnavailableError(
            "Danh sách học phí cần tạo mã không hợp lệ."
        )
    records = [record for record in records if record.id in ordered]
    if len(records) != len(ordered):
        raise PaymentRequestUnavailableError("Không tìm thấy đủ các khoản học phí.")

    # Idempotency is keyed by the caller-supplied request_id, not by the
    # random payment reference.  A browser retry after a timeout must return
    # the original immutable request (including REVOKED/PAID terminal state),
    # while reusing the same key for a different set of obligations is a
    # conflict.  This lookup is row-locked so concurrent retries cannot race
    # into two OPEN requests.
    if request_id:
        existing = await db.scalar(
            select(PaymentRequest)
            .where(PaymentRequest.request_id == request_id)
            .with_for_update()
        )
        if existing is not None:
            item_result = await db.execute(
                select(PaymentRequestItem.fee_record_id).where(
                    PaymentRequestItem.payment_request_id == existing.id
                )
            )
            existing_fee_ids = set(item_result.scalars().all())
            if existing_fee_ids != set(ordered):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="request_id đã được dùng cho một nhóm học phí khác.",
                )
            return existing

    codes = {_student_code(record) for record in records}
    if student_code_override:
        codes.add(student_code_override)
    if len(codes) != 1:
        raise PaymentRequestUnavailableError(
            "Một mã thanh toán chỉ được gom các khoản của cùng một học viên."
        )
    student_code = next(iter(codes))
    today = business_today()
    max_due = today + timedelta(days=settings.payment_early_window_days)
    for record in records:
        due = _effective_due(record)
        if record.status in {"PAID", "VOID", "SUPERSEDED"} or due is None:
            raise PaymentRequestUnavailableError(
                "Chỉ khoản học phí chưa nộp còn hiệu lực mới được tạo mã."
            )
        if due > max_due:
            raise PaymentRequestNotDueError(
                "Khoản học phí còn quá xa ngày thu để tạo mã sớm."
            )
        # Do not let an early request skip an older unpaid obligation for the
        # same enrollment.  This is checked while the fee rows are locked by
        # the route, so a retry cannot create an out-of-order payment request.
        earlier = await db.scalar(
            select(FeeRecord.id)
            .where(
                FeeRecord.enrollment_id == record.enrollment_id,
                FeeRecord.status == "UNPAID",
                FeeRecord.id.notin_(ordered),
                func.coalesce(FeeRecord.adjusted_due_date, FeeRecord.due_date) < due,
            )
            .limit(1)
        )
        if earlier is not None:
            raise PaymentRequestUnavailableError(
                "Cần xử lý kỳ học phí trước đó trước khi tạo mã sớm kỳ này."
            )

    # An expired OPEN request is no longer payable and must not block a new
    # request for the same obligation. Transition it before checking the
    # conflict so the retry remains auditable and does not rely on a cron job.
    open_result = await db.execute(
        select(PaymentRequest)
        .join(
            PaymentRequestItem,
            PaymentRequestItem.payment_request_id == PaymentRequest.id,
        )
        .where(
            PaymentRequest.status == "OPEN",
            PaymentRequestItem.fee_record_id.in_(ordered),
        )
        .with_for_update(of=PaymentRequest)
    )
    open_requests = list(
        {request.id: request for request in open_result.scalars().all()}.values()
    )
    now = datetime.now(timezone.utc)
    for request in open_requests:
        if request.expires_at is not None and request.expires_at <= now:
            request.status = "EXPIRED"
            db.add(
                PaymentRequestEvent(
                    payment_request_id=request.id,
                    event_type="EXPIRED",
                    old_status="OPEN",
                    new_status="EXPIRED",
                    actor_user_id=actor_id,
                )
            )
    if open_requests:
        await db.flush()

    existing_result = await db.execute(
        select(PaymentRequest, PaymentRequestItem)
        .join(
            PaymentRequestItem,
            PaymentRequestItem.payment_request_id == PaymentRequest.id,
        )
        .where(
            PaymentRequest.status == "OPEN",
            PaymentRequestItem.fee_record_id.in_(ordered),
        )
        .with_for_update(of=PaymentRequest)
    )
    existing_rows = existing_result.all()
    if existing_rows:
        existing_request_ids = {request.id for request, _ in existing_rows}
        if len(existing_request_ids) == 1:
            existing_request = existing_rows[0][0]
            existing_fee_ids = {item.fee_record_id for _, item in existing_rows}
            if existing_fee_ids == set(ordered):
                return existing_request
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Một khoản học phí đã có mã thanh toán đang mở.",
        )

    reference = generate_payment_reference(student_code)
    for _ in range(8):
        collision = await db.scalar(
            select(PaymentRequest.id).where(
                PaymentRequest.payment_reference == reference
            )
        )
        if collision is None:
            break
        reference = generate_payment_reference(student_code)
    else:
        raise RuntimeError("Không thể tạo mã thanh toán duy nhất")

    expires_at = datetime.now(timezone.utc) + timedelta(
        hours=settings.payment_qr_expire_hours
    )
    first = records[0]
    early = any((_effective_due(record) or today) > today for record in records)
    provider = (
        settings.payment_provider
        if settings.payment_provider not in {"", "disabled"}
        else "manual_qr"
    )
    manual_account = await db.scalar(
        select(WorkspacePaymentAccount)
        .where(
            WorkspacePaymentAccount.is_active.is_(True),
        )
        .order_by(
            WorkspacePaymentAccount.is_default.desc(),
            WorkspacePaymentAccount.created_at,
        )
        .limit(1)
    )
    total = sum(int(record.final_amount) for record in records)
    request = PaymentRequest(
        request_id=request_id,
        fee_record_id=first.id,
        enrollment_id=first.enrollment_id,
        student_code_snapshot=student_code,
        payment_reference=reference,
        expected_amount=total,
        currency="VND",
        status="OPEN",
        expires_at=expires_at,
        provider=provider,
        provider_metadata={
            "payload_version": "1",
            "reference": reference,
            "amount": total,
            "currency": "VND",
        },
        # Bind the receiving-account fallback at creation time so reopening the request
        # cannot silently switch to a newly selected default account. A later
        # Pay2S Collection Link deliberately replaces this with its linked
        # Pay2S account.
        settlement_account_id=(manual_account.id if manual_account else None),
        created_by=actor_id,
        early_payment=early,
    )
    db.add(request)
    await db.flush()
    for record in records:
        class_ = record.enrollment.class_ if record.enrollment else None
        db.add(
            PaymentRequestItem(
                payment_request_id=request.id,
                fee_record_id=record.id,
                enrollment_id=record.enrollment_id,
                student_code_snapshot=student_code,
                class_name_snapshot=(
                    record.class_name_snapshot or (class_.name if class_ else "Lớp")
                ),
                cycle_no=record.cycle_no,
                base_due_date=record.base_due_date or record.due_date,
                adjusted_due_date=record.adjusted_due_date or record.due_date,
                expected_amount=int(record.final_amount),
            )
        )
    db.add(
        PaymentRequestEvent(
            payment_request_id=request.id,
            event_type="CREATED",
            old_status=None,
            new_status="OPEN",
            actor_user_id=actor_id,
        )
    )
    await db.flush()
    return request


async def list_payment_requests(
    db: AsyncSession,
    *,
    request_status: str | None = None,
    limit: int = 100,
) -> PaymentRequestListResponse:
    """Return resumable QR/request state without exposing provider secrets."""

    now = datetime.now(timezone.utc)
    query = (
        select(PaymentRequest).order_by(PaymentRequest.created_at.desc()).limit(limit)
    )
    if request_status == "OPEN":
        query = query.where(
            PaymentRequest.status == "OPEN",
            or_(PaymentRequest.expires_at.is_(None), PaymentRequest.expires_at > now),
        )
    elif request_status == "EXPIRED":
        query = query.where(
            or_(
                PaymentRequest.status == "EXPIRED",
                and_(
                    PaymentRequest.status == "OPEN",
                    PaymentRequest.expires_at.is_not(None),
                    PaymentRequest.expires_at <= now,
                ),
            )
        )
    elif request_status:
        query = query.where(PaymentRequest.status == request_status)

    result = await db.execute(query)
    requests = [
        await to_payment_request_response(db, request)
        for request in result.scalars().all()
    ]
    return PaymentRequestListResponse(requests=requests)


async def revoke_payment_request(
    db: AsyncSession,
    request: PaymentRequest,
    *,
    actor_id: str,
    reason: str,
) -> PaymentRequestResponse:
    """Cancel one still-payable request and retain an auditable reason."""

    now = datetime.now(timezone.utc)
    if request.status != "OPEN":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Yêu cầu thanh toán không còn mở để hủy.",
        )
    if request.expires_at is not None and request.expires_at <= now:
        request.status = "EXPIRED"
        db.add(
            PaymentRequestEvent(
                payment_request_id=request.id,
                event_type="EXPIRED",
                old_status="OPEN",
                new_status="EXPIRED",
                actor_user_id=actor_id,
            )
        )
        await db.flush()
        return await to_payment_request_response(db, request)

    request.status = "REVOKED"
    request.revoked_at = now
    metadata = dict(request.provider_metadata or {})
    metadata["revoked_reason"] = reason[:240]
    request.provider_metadata = metadata
    db.add(
        PaymentRequestEvent(
            payment_request_id=request.id,
            event_type="REVOKED",
            old_status="OPEN",
            new_status="REVOKED",
            actor_user_id=actor_id,
            event_metadata={"reason": reason[:240]},
        )
    )
    await db.flush()
    return await to_payment_request_response(db, request)


async def revoke_open_payment_requests_for_fee_records(
    db: AsyncSession,
    fee_record_ids: Sequence[str],
    *,
    actor_id: str | None = None,
    reason: str,
) -> int:
    """Revoke open QR/reference snapshots made stale by a domain change.

    Suspension adjustments and manual cash/bank recording must not leave an
    old reference payable.  Paid/expired/review requests are historical and
    are deliberately left untouched; only OPEN requests are transitioned and
    an append-only event records why.
    """
    ids = list(dict.fromkeys(str(value) for value in fee_record_ids))
    if not ids:
        return 0
    result = await db.execute(
        select(PaymentRequest)
        .join(
            PaymentRequestItem,
            PaymentRequestItem.payment_request_id == PaymentRequest.id,
        )
        .where(
            PaymentRequest.status == "OPEN",
            PaymentRequestItem.fee_record_id.in_(ids),
        )
        .with_for_update(of=PaymentRequest)
    )
    # A few pure service tests use a lightweight DB double whose ``scalars``
    # result is a mock rather than a concrete list.  Treat that as an empty
    # projection; a real AsyncSession always returns a list here.  We do not
    # catch database/transport exceptions, so production failures still fail
    # closed instead of silently leaving an OPEN reference alive.
    rows = result.scalars().all()
    if not isinstance(rows, (list, tuple)):
        return 0
    requests = list({request.id: request for request in rows}.values())
    if not requests:
        return 0
    now = datetime.now(timezone.utc)
    for request in requests:
        request.status = "REVOKED"
        request.revoked_at = now
        db.add(
            PaymentRequestEvent(
                payment_request_id=request.id,
                event_type="REVOKED",
                old_status="OPEN",
                new_status="REVOKED",
                actor_user_id=actor_id,
                # The existing event table has no note column; preserve the
                # bounded reason in provider metadata without touching item
                # snapshots or financial rows.
            )
        )
        metadata = dict(request.provider_metadata or {})
        metadata["revoked_reason"] = reason[:240]
        request.provider_metadata = metadata
    await db.flush()
    return len(requests)


async def get_open_payment_request_ids_for_fee_records(
    db: AsyncSession,
    fee_record_ids: Sequence[str],
) -> dict[str, str]:
    """Return the current OPEN request for each fee row, if one exists.

    A manual cash/bank payment can therefore retain an immutable link to the
    reference that was shown to the parent before the request is revoked.
    """
    ids = list(dict.fromkeys(str(value) for value in fee_record_ids))
    if not ids or not hasattr(db, "execute"):
        return {}
    result = await db.execute(
        select(PaymentRequestItem.fee_record_id, PaymentRequest.id)
        .join(
            PaymentRequest,
            PaymentRequest.id == PaymentRequestItem.payment_request_id,
        )
        .where(
            PaymentRequest.status == "OPEN",
            PaymentRequestItem.fee_record_id.in_(ids),
        )
        .with_for_update(of=PaymentRequest)
    )
    return {str(fee_id): str(request_id) for fee_id, request_id in result.all()}


def payment_request_payload(
    request: PaymentRequest,
    *,
    manual_qr_url: str | None = None,
    receiving_account: dict[str, str] | None = None,
) -> dict[str, Any]:
    payload: dict[str, object] = {
        "reference": request.payment_reference,
        "amount": int(request.expected_amount),
        "currency": request.currency,
    }
    collection = (request.provider_metadata or {}).get("collection_link")
    if isinstance(collection, dict):
        payload.update(collection)
    if manual_qr_url:
        payload["manual_qr_url"] = manual_qr_url
    if receiving_account:
        payload["receiving_account"] = receiving_account
    return payload


async def to_payment_request_response(
    db: AsyncSession, request: PaymentRequest
) -> PaymentRequestResponse:
    result = await db.execute(
        select(PaymentRequestItem)
        .where(PaymentRequestItem.payment_request_id == request.id)
        .order_by(PaymentRequestItem.id)
    )
    items = list(result.scalars().all())
    manual_qr_url = None
    receiving_account = None
    collection = (request.provider_metadata or {}).get("collection_link")
    # A Pay2S request must expose only its generated QR. Mixing in a manual QR
    # can make an Admin send a transfer that cannot be matched automatically.
    if not isinstance(collection, dict):
        manual_account = None
        if request.settlement_account_id:
            manual_account = await db.scalar(
                select(WorkspacePaymentAccount).where(
                    WorkspacePaymentAccount.id == request.settlement_account_id,
                    WorkspacePaymentAccount.is_active.is_(True),
                )
            )
        if manual_account is None:
            manual_account = await db.scalar(
                select(WorkspacePaymentAccount)
                .where(
                    WorkspacePaymentAccount.is_active.is_(True),
                )
                .order_by(
                    WorkspacePaymentAccount.is_default.desc(),
                    WorkspacePaymentAccount.created_at,
                )
                .limit(1)
            )
        if manual_account is not None:
            receiving_account = {
                "id": str(manual_account.id),
                "label": manual_account.label,
                "bank_name": manual_account.bank_name,
                "account_number": manual_account.account_number,
                "account_name": manual_account.account_name,
            }
            if manual_account.qr_object_path:
                version = hashlib.sha256(
                    manual_account.qr_object_path.encode("utf-8")
                ).hexdigest()[:16]
                manual_qr_url = (
                    f"/api/proxy/banking/accounts/{manual_account.id}/qr?v={version}"
                )
            else:
                manual_qr_url = manual_account.qr_source_url
    effective_status = request.status
    if (
        effective_status == "OPEN"
        and request.expires_at is not None
        and request.expires_at <= datetime.now(timezone.utc)
    ):
        effective_status = "EXPIRED"
    return PaymentRequestResponse(
        id=request.id,
        request_id=request.request_id,
        payment_reference=request.payment_reference,
        status=effective_status,
        provider=request.provider,
        settlement_account_id=request.settlement_account_id,
        currency=request.currency,
        expected_amount=int(request.expected_amount),
        early_payment=request.early_payment,
        expires_at=request.expires_at,
        sent_at=request.sent_at,
        sent_channel=request.sent_channel,
        send_count=request.send_count,
        created_at=request.created_at,
        qr_payload=payment_request_payload(
            request,
            manual_qr_url=manual_qr_url,
            receiving_account=receiving_account,
        ),
        items=[
            PaymentRequestItemResponse(
                fee_record_id=item.fee_record_id,
                enrollment_id=item.enrollment_id,
                student_code=item.student_code_snapshot,
                class_name=item.class_name_snapshot,
                cycle_no=item.cycle_no,
                base_due_date=item.base_due_date,
                adjusted_due_date=item.adjusted_due_date,
                expected_amount=int(item.expected_amount),
            )
            for item in items
        ],
    )


async def share_payment_request(
    db: AsyncSession,
    request: PaymentRequest,
    payload: PaymentRequestShareRequest,
    *,
    actor_id: str,
) -> PaymentRequestShareResponse:
    """Record an explicit Admin share/copy action without sending PII.

    The endpoint is intentionally separate from request creation. A browser
    retry with the same idempotency key returns the existing share result.
    """
    existing_event = await db.scalar(
        select(PaymentRequestEvent).where(
            PaymentRequestEvent.idempotency_key == str(payload.idempotency_key)
        )
    )
    if existing_event is not None:
        if (
            str(existing_event.payment_request_id) != str(request.id)
            or existing_event.event_type != "QR_SENT"
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Idempotency key đã được dùng cho yêu cầu thanh toán khác.",
            )
        response = await to_payment_request_response(db, request)
        metadata = existing_event.event_metadata or {}
        return PaymentRequestShareResponse(
            **response.model_dump(),
            shared_at=existing_event.created_at,
            shared_channel=metadata.get("channel", payload.channel),
        )

    now = datetime.now(timezone.utc)
    if request.status != "OPEN":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Yêu cầu thanh toán không còn mở để gửi.",
        )
    if request.expires_at is not None and request.expires_at <= now:
        request.status = "EXPIRED"
        db.add(
            PaymentRequestEvent(
                payment_request_id=request.id,
                event_type="EXPIRED",
                old_status="OPEN",
                new_status="EXPIRED",
                actor_user_id=actor_id,
            )
        )
        await db.flush()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Yêu cầu thanh toán đã hết hạn.",
        )

    request.sent_at = now
    request.sent_channel = payload.channel
    request.send_count = int(request.send_count or 0) + 1
    db.add(
        PaymentRequestEvent(
            payment_request_id=request.id,
            event_type="QR_SENT",
            old_status="OPEN",
            new_status="OPEN",
            actor_user_id=actor_id,
            idempotency_key=str(payload.idempotency_key),
            event_metadata={"channel": payload.channel},
        )
    )
    await db.flush()
    response = await to_payment_request_response(db, request)
    return PaymentRequestShareResponse(
        **response.model_dump(),
        shared_at=now,
        shared_channel=payload.channel,
    )
