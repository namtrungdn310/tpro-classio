from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_admin
from app.schemas.fee import (
    FeeBatchNotifyRequest,
    FeeBatchPayRequest,
    FeeBatchRefundRequest,
    FeeBatchRequest,
    FeeBatchResponse,
    FeeBatchUnpayRequest,
    FeeMessageTemplatesResponse,
    FeeMessageTemplatesUpdate,
    FeeNotifyRequest,
    FeePaymentMethod,
    FeePeriodListResponse,
    FeeQueryState,
    FeeRecordListResponse,
    FeeRecordResponse,
    FeeRefundBatchResponse,
    FeeRefundReversalRequest,
    FeeRefundReversalResponse,
    FeeTransactionListResponse,
    FeeTransactionBatchResponse,
    FeeUnpayTargetState,
)
from app.services.fee_service import (
    get_fee_transactions,
    get_fee_transactions_batch,
    get_fee_records,
    get_fee_periods,
    mark_fee_notified,
    mark_fee_paid,
    mark_fee_unpaid,
    mark_fees_notified,
    mark_fees_paid,
    mark_fees_unnotified,
    mark_fees_unpaid,
    refund_fee_records,
    reverse_fee_refund,
    sync_fee_records_for_period,
)
from app.services.fee_template_service import (
    get_fee_message_templates,
    update_fee_message_templates,
)

router = APIRouter(tags=["fees"])


@router.get("/periods", response_model=FeePeriodListResponse)
async def list_fee_periods(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(get_current_user),
) -> FeePeriodListResponse:
    return await get_fee_periods(db)


@router.get("/message-templates", response_model=FeeMessageTemplatesResponse)
async def read_fee_message_templates(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeMessageTemplatesResponse:
    return await get_fee_message_templates(db)


@router.put("/message-templates", response_model=FeeMessageTemplatesResponse)
async def save_fee_message_templates(
    payload: FeeMessageTemplatesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeMessageTemplatesResponse:
    return await update_fee_message_templates(
        db,
        payload,
        actor_id=_get_actor_id(current_user),
    )


@router.get("", response_model=FeeRecordListResponse)
async def list_fee_records(
    period: str = Query(pattern=r"^\d{4}-\d{2}$"),
    class_id: UUID | None = Query(default=None),
    state: FeeQueryState | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(get_current_user),
) -> FeeRecordListResponse:
    return await get_fee_records(db, period=period, class_id=class_id, state=state)


@router.post("/sync", response_model=FeeRecordListResponse)
async def sync_fee_records(
    period: str = Query(pattern=r"^\d{4}-\d{2}$"),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeRecordListResponse:
    await sync_fee_records_for_period(
        db,
        period,
        actor_id=_get_actor_id(current_user),
    )
    return await get_fee_records(db, period=period)


@router.patch("/actions/notify", response_model=FeeBatchResponse)
async def notify_fee_records(
    payload: FeeBatchNotifyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeBatchResponse:
    return await mark_fees_notified(
        db,
        payload.record_ids,
        payload.message,
        payload.channel,
        actor_id=_get_actor_id(current_user),
        request_id=payload.request_id,
    )


@router.patch("/actions/paid", response_model=FeeBatchResponse)
async def pay_fee_records(
    payload: FeeBatchPayRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeBatchResponse:
    return await mark_fees_paid(
        db,
        payload.record_ids,
        actor_id=_get_actor_id(current_user),
        payment_method=payload.payment_method,
        request_id=payload.request_id,
    )


@router.patch("/actions/unpaid", response_model=FeeBatchResponse)
async def unpay_fee_records(
    payload: FeeBatchUnpayRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeBatchResponse:
    return await mark_fees_unpaid(
        db,
        payload.record_ids,
        actor_id=_get_actor_id(current_user),
        target_notification_state=payload.target_notification_state,
        request_id=payload.request_id,
    )


@router.patch("/actions/unnotify", response_model=FeeBatchResponse)
async def unnotify_fee_records(
    payload: FeeBatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeBatchResponse:
    return await mark_fees_unnotified(
        db,
        payload.record_ids,
        actor_id=_get_actor_id(current_user),
        request_id=payload.request_id,
    )


@router.post("/actions/refund", response_model=FeeRefundBatchResponse)
async def refund_paid_fee_records(
    payload: FeeBatchRefundRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeRefundBatchResponse:
    return await refund_fee_records(
        db,
        payload,
        actor_id=_get_required_actor_id(current_user),
    )


@router.post(
    "/actions/refund-reversal",
    response_model=FeeRefundReversalResponse,
)
async def reverse_refund_transaction(
    payload: FeeRefundReversalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeRefundReversalResponse:
    return await reverse_fee_refund(
        db,
        payload,
        actor_id=_get_required_actor_id(current_user),
    )


@router.get("/{id}/transactions", response_model=FeeTransactionListResponse)
async def read_fee_transactions(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(get_current_user),
) -> FeeTransactionListResponse:
    result = await get_fee_transactions(db, id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học phí",
        )
    return result


@router.post(
    "/transactions/batch",
    response_model=FeeTransactionBatchResponse,
)
async def read_fee_transaction_batch(
    payload: FeeBatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(get_current_user),
) -> FeeTransactionBatchResponse:
    return await get_fee_transactions_batch(db, payload.record_ids)


@router.patch("/{id}/notify", response_model=FeeRecordResponse)
async def notify_fee_record(
    id: UUID,
    payload: FeeNotifyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeRecordResponse:
    record = await mark_fee_notified(
        db,
        id,
        payload.message,
        payload.channel,
        actor_id=_get_actor_id(current_user),
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học phí",
        )
    return record


@router.patch("/{id}/paid", response_model=FeeRecordResponse)
async def pay_fee_record(
    id: UUID,
    payment_method: FeePaymentMethod = Query(default="bank_transfer"),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeRecordResponse:
    record = await mark_fee_paid(
        db,
        id,
        actor_id=_get_actor_id(current_user),
        payment_method=payment_method,
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học phí",
        )
    return record


@router.patch("/{id}/unpaid", response_model=FeeRecordResponse)
async def unpay_fee_record(
    id: UUID,
    target_notification_state: FeeUnpayTargetState = Query(default="NOTIFIED_UNPAID"),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeRecordResponse:
    record = await mark_fee_unpaid(
        db,
        id,
        actor_id=_get_actor_id(current_user),
        target_notification_state=target_notification_state,
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học phí",
        )
    return record


@router.patch("/{id}/unnotify", response_model=FeeBatchResponse)
async def unnotify_fee_record(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> FeeBatchResponse:
    return await mark_fees_unnotified(db, [id])


def _get_actor_id(current_user: dict[str, str | bool | None]) -> str | None:
    actor_id = current_user.get("id")
    return actor_id if isinstance(actor_id, str) else None


def _get_required_actor_id(
    current_user: dict[str, str | bool | None],
) -> str:
    actor_id = _get_actor_id(current_user)
    if actor_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập không có định danh người thao tác",
        )
    return actor_id
