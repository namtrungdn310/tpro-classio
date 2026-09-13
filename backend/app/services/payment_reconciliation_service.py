from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.banking import WorkspacePaymentAccount
from app.models.payment_request import (
    PaymentRequest,
    PaymentRequestEvent,
    PaymentRequestItem,
)
from app.schemas.report import (
    PaymentReconciliationItemResponse,
    PaymentReconciliationListResponse,
    PaymentReconciliationResolveRequest,
)
from app.services.pay2s_service import _match_open_request


_STATUS_VALUES = {"PENDING", "PROCESSING", "POSTED", "REVIEW", "DEAD"}


def _uuid_or_none(value: object) -> UUID | None:
    if not value:
        return None
    try:
        return UUID(str(value))
    except ValueError:
        return None


def _response(row) -> PaymentReconciliationItemResponse:
    snapshot = dict(row["transaction_snapshot"] or {})
    return PaymentReconciliationItemResponse(
        id=UUID(str(row["id"])),
        delivery_id=UUID(str(row["delivery_id"])),
        status=row["status"],
        review_reason=row["review_reason"],
        resolution=row["resolution"],
        payment_request_id=_uuid_or_none(row["payment_request_id"]),
        provider_transaction_id=(
            str(snapshot.get("provider_transaction_id"))
            if snapshot.get("provider_transaction_id")
            else row["provider_transaction_id"]
        ),
        source=str(snapshot.get("source") or "") or None,
        bank_account_id=_uuid_or_none(snapshot.get("bank_account_id")),
        bank_name=str(snapshot.get("bank_name") or "") or None,
        account_number=str(snapshot.get("account_number") or "") or None,
        transfer_type=str(snapshot.get("transfer_type") or "") or None,
        amount=(
            int(snapshot["amount"]) if snapshot.get("amount") is not None else None
        ),
        content=str(snapshot.get("content") or "") or None,
        transaction_date=str(snapshot.get("transaction_date") or "") or None,
        result_code=str(snapshot.get("result_code") or "") or None,
        provider_message=str(snapshot.get("message") or "") or None,
        received_at=row["received_at"],
        resolved_at=row["resolved_at"],
    )


def assert_recordable_transaction(snapshot: dict[str, object]) -> None:
    """Reject provider events that can never represent received tuition."""
    transfer_type = str(snapshot.get("transfer_type") or "").upper()
    if transfer_type and transfer_type != "IN":
        raise HTTPException(
            status_code=409,
            detail="Giao dịch tiền ra không thể dùng để ghi nhận học phí.",
        )
    result_code = str(snapshot.get("result_code") or "")
    if result_code and result_code != "0":
        raise HTTPException(
            status_code=409,
            detail="Pay2S chưa xác nhận giao dịch thành công nên chưa thể ghi nhận học phí.",
        )


async def list_payment_reconciliation(
    db: AsyncSession,
    *,
    queue_status: str = "REVIEW",
    limit: int = 100,
) -> PaymentReconciliationListResponse:
    if queue_status not in _STATUS_VALUES:
        raise HTTPException(status_code=422, detail="Trạng thái đối soát không hợp lệ.")
    result = await db.execute(
        text(
            "select queue.id, queue.delivery_id, queue.status, queue.review_reason, "
            "queue.resolution, queue.payment_request_id, queue.transaction_snapshot, "
            "queue.resolved_at, delivery.provider_transaction_id, delivery.received_at "
            "from public.payment_posting_queue queue "
            "join public.payment_provider_deliveries delivery on delivery.id = queue.delivery_id "
            "where queue.status = :status order by queue.created_at desc limit :limit"
        ),
        {"status": queue_status, "limit": limit},
    )
    count = await db.scalar(
        text(
            "select count(*) from public.payment_posting_queue where status = 'REVIEW'"
        )
    )
    return PaymentReconciliationListResponse(
        items=[_response(row) for row in result.mappings().all()],
        review_count=int(count or 0),
    )


async def resolve_payment_reconciliation(
    db: AsyncSession,
    *,
    queue_id: UUID,
    payload: PaymentReconciliationResolveRequest,
    actor_id: str,
) -> PaymentReconciliationItemResponse:
    result = await db.execute(
        text(
            "select queue.id, queue.delivery_id, queue.status, queue.review_reason, "
            "queue.resolution, queue.payment_request_id, queue.transaction_snapshot, "
            "queue.resolved_at, delivery.provider_transaction_id, delivery.received_at "
            "from public.payment_posting_queue queue "
            "join public.payment_provider_deliveries delivery on delivery.id = queue.delivery_id "
            "where queue.id = :queue_id for update of queue"
        ),
        {"queue_id": str(queue_id)},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(
            status_code=404, detail="Không tìm thấy giao dịch đối soát."
        )
    if row["status"] != "REVIEW":
        raise HTTPException(status_code=409, detail="Giao dịch này đã được xử lý.")

    if payload.action == "ignore":
        await _finish_queue(
            db,
            queue_id=queue_id,
            status_value="DEAD",
            resolution=f"ignored:{payload.reason}",
            actor_id=actor_id,
            payment_request_id=None,
        )
        updated = dict(row)
        updated.update(
            status="DEAD",
            resolution=f"ignored:{payload.reason}",
            resolved_at=datetime.now(timezone.utc),
        )
        return _response(updated)

    snapshot = dict(row["transaction_snapshot"] or {})
    assert_recordable_transaction(snapshot)
    amount = snapshot.get("amount")
    account_id = _uuid_or_none(snapshot.get("bank_account_id"))
    if amount is None or int(amount) <= 0 or account_id is None:
        raise HTTPException(
            status_code=409,
            detail="Giao dịch thiếu số tiền hoặc tài khoản nhận để ghi nhận.",
        )
    account = await db.scalar(
        select(WorkspacePaymentAccount).where(
            WorkspacePaymentAccount.id == str(account_id),
            WorkspacePaymentAccount.is_active.is_(True),
        )
    )
    if account is None:
        raise HTTPException(
            status_code=409, detail="Tài khoản nhận tiền không còn hoạt động."
        )

    request: PaymentRequest | None = None
    if payload.action == "manual_match":
        if payload.payment_request_id is None:
            raise HTTPException(
                status_code=422, detail="Hãy chọn yêu cầu học phí cần ghép."
            )
        request = await db.scalar(
            select(PaymentRequest)
            .where(PaymentRequest.id == str(payload.payment_request_id))
            .with_for_update()
        )
    else:
        request = await _match_open_request(
            db,
            account=account,
            content=str(snapshot.get("content") or ""),
            amount=int(amount),
        )
    if request is None or request.status != "OPEN":
        raise HTTPException(
            status_code=409, detail="Không tìm thấy yêu cầu học phí đang mở phù hợp."
        )
    if int(request.expected_amount) != int(amount):
        raise HTTPException(
            status_code=409, detail="Số tiền giao dịch không khớp yêu cầu học phí."
        )
    if request.settlement_account_id and str(request.settlement_account_id) != str(
        account.id
    ):
        raise HTTPException(
            status_code=409, detail="Tài khoản nhận không khớp yêu cầu học phí."
        )

    item_result = await db.execute(
        select(PaymentRequestItem)
        .where(PaymentRequestItem.payment_request_id == request.id)
        .order_by(PaymentRequestItem.id)
    )
    record_ids = [UUID(item.fee_record_id) for item in item_result.scalars().all()]
    if not record_ids:
        raise HTTPException(
            status_code=409, detail="Yêu cầu không còn khoản học phí hợp lệ."
        )

    from app.services.fee_service import mark_fees_paid

    await mark_fees_paid(
        db,
        record_ids,
        actor_id=actor_id,
        payment_method="bank_transfer",
        settlement_account_id=account.id,
        allow_early=True,
        request_id=UUID(str(request.request_id)),
        payment_origin="pay2s",
        provider_transaction_id=row["provider_transaction_id"],
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
            actor_user_id=actor_id,
            event_metadata={
                "source": "manual_reconciliation"
                if payload.action == "manual_match"
                else "reconciliation_retry",
                "reason": payload.reason,
                "provider_transaction_id": row["provider_transaction_id"],
            },
        )
    )
    resolution = f"{payload.action}:{payload.reason}"
    await _finish_queue(
        db,
        queue_id=queue_id,
        status_value="POSTED",
        resolution=resolution,
        actor_id=actor_id,
        payment_request_id=request.id,
    )
    updated = dict(row)
    updated.update(
        status="POSTED",
        resolution=resolution,
        resolved_at=datetime.now(timezone.utc),
        payment_request_id=request.id,
    )
    return _response(updated)


async def _finish_queue(
    db: AsyncSession,
    *,
    queue_id: UUID,
    status_value: str,
    resolution: str,
    actor_id: str,
    payment_request_id: str | None,
) -> None:
    await db.execute(
        text(
            "update public.payment_posting_queue set status = :status, "
            "resolution = :resolution, resolved_at = now(), resolved_by = :actor_id, "
            "payment_request_id = coalesce(:payment_request_id, payment_request_id), "
            "claimed_until = null where id = :queue_id"
        ),
        {
            "status": status_value,
            "resolution": resolution[:320],
            "actor_id": actor_id,
            "payment_request_id": payment_request_id,
            "queue_id": str(queue_id),
        },
    )
