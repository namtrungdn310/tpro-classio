from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.core.dependencies import Principal, require_management
from app.schemas.fee import (
    FeeBatchNotifyRequest,
    FeeMessageDraftReadRequest,
    FeeMessageDraftResponse,
    FeeMessageDraftSaveRequest,
    FeeBatchPayRequest,
    FeeBatchRefundRequest,
    FeeBatchRequest,
    FeeBatchResponse,
    FeeBatchUnpayRequest,
    FeeMessageTemplatesResponse,
    FeeMessageTemplatesReset,
    FeeMessageTemplatesUpdate,
    FeeNotifyRequest,
    FeePaymentMethod,
    FeePaymentCapabilitiesResponse,
    FeePaymentRequestCreate,
    PaymentRequestListResponse,
    FeePeriodListResponse,
    FeeQueryState,
    FeeRecordListResponse,
    FeeRecordResponse,
    FeeRefundBatchResponse,
    FeeRefundReversalRequest,
    FeeRefundReversalResponse,
    FeeTransactionListResponse,
    FeeTransactionBatchResponse,
    PaymentRequestResponse,
    PaymentRequestShareRequest,
    PaymentRequestShareResponse,
    PaymentRequestRevokeRequest,
    FeeUnpayTargetState,
)
from app.services.fee_service import (
    get_fee_transactions,
    get_fee_transactions_batch,
    get_fee_records,
    get_outstanding_fee_records,
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
    get_fee_records_for_payment_request,
    get_upcoming_fee_records,
)
from app.services.payment_scaffold_service import (
    PaymentRequestFeatureDisabledError,
    PaymentRequestNotDueError,
    PaymentRequestUnavailableError,
    create_payment_request_for_records,
    list_payment_requests,
    revoke_payment_request,
    share_payment_request,
    to_payment_request_response,
)
from app.models.payment_request import PaymentRequest
from app.models.banking import WorkspacePaymentProvider
from app.services.payment_readiness_service import get_pay2s_readiness
from app.services.pay2s_service import create_pay2s_collection_link
from app.services.fee_template_service import (
    get_fee_message_templates,
    reset_fee_message_templates,
    update_fee_message_templates,
)
from app.services.fee_message_draft_service import (
    get_fee_message_draft,
    resolve_fee_message_draft,
    save_fee_message_draft as save_group_fee_message_draft,
)
from app.services.fee_operation_service import FeeOperationActorSnapshot

router = APIRouter(tags=["fees"])


@router.get("/periods", response_model=FeePeriodListResponse)
async def list_fee_periods(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeePeriodListResponse:
    return await get_fee_periods(db)


@router.get("/payment-capabilities", response_model=FeePaymentCapabilitiesResponse)
async def get_payment_capabilities(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeePaymentCapabilitiesResponse:
    """Expose safe UI capability flags; no provider credentials leave the server."""
    readiness = await get_pay2s_readiness(db)
    return FeePaymentCapabilitiesResponse(
        early_payment_enabled=True,
        qr_creation_enabled=bool(settings.payment_qr_enabled),
        pay2s_qr_ready=readiness.qr_creation_ready,
        automatic_recording_ready=readiness.automatic_recording_ready,
        pay2s_blocker=readiness.blocker,
        early_window_days=settings.payment_early_window_days,
    )


@router.get("/message-templates", response_model=FeeMessageTemplatesResponse)
async def read_fee_message_templates(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeMessageTemplatesResponse:
    return await get_fee_message_templates(db)


@router.put("/message-templates", response_model=FeeMessageTemplatesResponse)
async def save_fee_message_templates(
    payload: FeeMessageTemplatesUpdate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeMessageTemplatesResponse:
    return await update_fee_message_templates(
        db,
        payload,
        actor_id=principal.user_id,
    )


@router.post("/message-templates/reset", response_model=FeeMessageTemplatesResponse)
async def reset_message_templates(
    payload: FeeMessageTemplatesReset,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeMessageTemplatesResponse:
    return await reset_fee_message_templates(
        db, expected_version=payload.version, actor_id=principal.user_id
    )


@router.get("", response_model=FeeRecordListResponse)
async def list_fee_records(
    period: str = Query(pattern=r"^\d{4}-\d{2}$"),
    class_id: UUID | None = Query(default=None),
    state: FeeQueryState | None = Query(default=None),
    include_future: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeRecordListResponse:
    return await get_fee_records(
        db,
        period=period,
        class_id=class_id,
        state=state,
        include_future=include_future,
    )


@router.get("/outstanding", response_model=FeeRecordListResponse)
async def list_outstanding_fee_records(
    class_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeRecordListResponse:
    """List due debts across fee periods without mutating historical rows."""
    return await get_outstanding_fee_records(db, class_id=class_id)


@router.post("/sync", response_model=FeeRecordListResponse)
async def sync_fee_records(
    period: str = Query(pattern=r"^\d{4}-\d{2}$"),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeRecordListResponse:
    await sync_fee_records_for_period(
        db,
        period,
        actor_id=principal.user_id,
        actor_snapshot=_get_actor_snapshot(principal),
    )
    return await get_fee_records(db, period=period)


@router.get("/upcoming", response_model=FeeRecordListResponse)
async def list_upcoming_fee_records(
    class_id: UUID | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeRecordListResponse:
    """Bounded future obligations eligible for an explicit early-payment action."""
    return await get_upcoming_fee_records(db, class_id=class_id, limit=limit)


@router.patch("/actions/notify", response_model=FeeBatchResponse)
async def notify_fee_records(
    payload: FeeBatchNotifyRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeBatchResponse:
    message = payload.message
    if payload.draft_revision is not None and payload.source_fingerprint is not None:
        message = await resolve_fee_message_draft(
            db,
            payload.record_ids,
            kind="reminder",
            revision=payload.draft_revision,
            source_fingerprint=payload.source_fingerprint,
        )
    return await mark_fees_notified(
        db,
        payload.record_ids,
        message,
        payload.channel,
        actor_id=principal.user_id,
        request_id=payload.request_id,
        actor_snapshot=_get_actor_snapshot(principal),
    )


@router.post("/actions/message-draft/preview", response_model=FeeMessageDraftResponse)
async def preview_fee_message_draft(
    payload: FeeMessageDraftReadRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeMessageDraftResponse:
    return await get_fee_message_draft(db, payload.record_ids, kind=payload.kind)


@router.put("/actions/message-draft", response_model=FeeMessageDraftResponse)
async def save_fee_message_draft(
    payload: FeeMessageDraftSaveRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeMessageDraftResponse:
    return await save_group_fee_message_draft(
        db,
        payload.record_ids,
        kind=payload.kind,
        message=payload.message,
        expected_revision=payload.expected_revision,
        source_fingerprint=payload.source_fingerprint,
        actor_id=principal.user_id,
    )


@router.patch("/actions/paid", response_model=FeeBatchResponse)
async def pay_fee_records(
    payload: FeeBatchPayRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeBatchResponse:
    if (
        payload.payment_method == "bank_transfer"
        and payload.settlement_account_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hãy chọn tài khoản ngân hàng đã nhận khoản chuyển khoản.",
        )
    return await mark_fees_paid(
        db,
        payload.record_ids,
        actor_id=principal.user_id,
        payment_method=payload.payment_method,
        settlement_account_id=payload.settlement_account_id,
        request_id=payload.request_id,
        actor_snapshot=_get_actor_snapshot(principal),
    )


@router.patch("/actions/early-paid", response_model=FeeBatchResponse)
async def pay_fee_records_early(
    payload: FeeBatchPayRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeBatchResponse:
    """Explicit manager action for cash/bank payments before the due date."""
    if (
        payload.payment_method == "bank_transfer"
        and payload.settlement_account_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hãy chọn tài khoản ngân hàng đã nhận khoản chuyển khoản.",
        )
    return await mark_fees_paid(
        db,
        payload.record_ids,
        actor_id=principal.user_id,
        payment_method=payload.payment_method,
        settlement_account_id=payload.settlement_account_id,
        allow_early=True,
        request_id=payload.request_id,
        actor_snapshot=_get_actor_snapshot(principal),
    )


@router.post("/payment-requests", response_model=PaymentRequestResponse)
async def create_early_payment_request(
    payload: FeePaymentRequestCreate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> PaymentRequestResponse:
    """Prepare an early QR/reference without notifying or marking paid."""
    try:
        records = await get_fee_records_for_payment_request(db, payload.record_ids)
        request = await create_payment_request_for_records(
            db,
            records,
            actor_id=principal.user_id,
            request_id=str(payload.request_id),
        )
        response = await to_payment_request_response(db, request)
        await db.commit()
        return response
    except PaymentRequestNotDueError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    except PaymentRequestFeatureDisabledError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except PaymentRequestUnavailableError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc


@router.post(
    "/payment-requests/{request_id}/collection-link",
    response_model=PaymentRequestResponse,
)
async def create_payment_request_collection_link(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> PaymentRequestResponse:
    readiness = await get_pay2s_readiness(db)
    if not readiness.automatic_recording_ready:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Pay2S chưa sẵn sàng tự động ghi nhận học phí. "
                "Hãy hoàn tất cấu hình tại trang Ngân hàng trước khi tạo QR."
            ),
        )
    request = await db.scalar(
        select(PaymentRequest)
        .where(PaymentRequest.id == str(request_id))
        .with_for_update()
    )
    provider = await db.scalar(
        select(WorkspacePaymentProvider).where(
            WorkspacePaymentProvider.provider == "pay2s"
        )
    )
    if request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy yêu cầu thanh toán.",
        )
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Đơn vị này chưa thiết lập Pay2S.",
        )
    if request.status != "OPEN":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Yêu cầu thanh toán không còn mở.",
        )
    try:
        await create_pay2s_collection_link(db, request, provider=provider)
        response = await to_payment_request_response(db, request)
        await db.commit()
        return response
    except HTTPException:
        await db.rollback()
        raise


@router.get("/payment-requests", response_model=PaymentRequestListResponse)
async def list_early_payment_requests(
    request_status: str | None = Query(
        default=None,
        alias="status",
        pattern=r"^(OPEN|EXPIRED|REVOKED|PAID|FAILED|REVIEW)$",
    ),
    limit: int = Query(default=100, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> PaymentRequestListResponse:
    return await list_payment_requests(
        db,
        request_status=request_status,
        limit=limit,
    )


@router.post(
    "/payment-requests/{request_id}/share",
    response_model=PaymentRequestShareResponse,
)
async def share_early_payment_request(
    request_id: UUID,
    payload: PaymentRequestShareRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> PaymentRequestShareResponse:
    request = await db.scalar(
        select(PaymentRequest)
        .where(PaymentRequest.id == str(request_id))
        .with_for_update()
    )
    if request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy yêu cầu thanh toán.",
        )
    try:
        response = await share_payment_request(
            db, request, payload, actor_id=principal.user_id
        )
        await db.commit()
        return response
    except HTTPException:
        # Keep the auditable EXPIRED transition made by the service. Other
        # failed share attempts must remain side-effect free.
        if request.status == "EXPIRED":
            await db.commit()
        else:
            await db.rollback()
        raise


@router.post(
    "/payment-requests/{request_id}/revoke",
    response_model=PaymentRequestResponse,
)
async def revoke_early_payment_request(
    request_id: UUID,
    payload: PaymentRequestRevokeRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> PaymentRequestResponse:
    request = await db.scalar(
        select(PaymentRequest)
        .where(PaymentRequest.id == str(request_id))
        .with_for_update()
    )
    if request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy yêu cầu thanh toán.",
        )
    try:
        response = await revoke_payment_request(
            db,
            request,
            actor_id=principal.user_id,
            reason=payload.reason,
        )
        await db.commit()
        return response
    except HTTPException:
        await db.rollback()
        raise


@router.patch("/actions/unpaid", response_model=FeeBatchResponse)
async def unpay_fee_records(
    payload: FeeBatchUnpayRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeBatchResponse:
    return await mark_fees_unpaid(
        db,
        payload.record_ids,
        actor_id=principal.user_id,
        target_notification_state=payload.target_notification_state,
        request_id=payload.request_id,
        actor_snapshot=_get_actor_snapshot(principal),
    )


@router.patch("/actions/unnotify", response_model=FeeBatchResponse)
async def unnotify_fee_records(
    payload: FeeBatchRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeBatchResponse:
    return await mark_fees_unnotified(
        db,
        payload.record_ids,
        actor_id=principal.user_id,
        request_id=payload.request_id,
        actor_snapshot=_get_actor_snapshot(principal),
    )


@router.post("/actions/refund", response_model=FeeRefundBatchResponse)
async def refund_paid_fee_records(
    payload: FeeBatchRefundRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeRefundBatchResponse:
    return await refund_fee_records(
        db,
        payload,
        actor_id=principal.user_id,
        actor_snapshot=_get_actor_snapshot(principal),
    )


@router.post(
    "/actions/refund-reversal",
    response_model=FeeRefundReversalResponse,
)
async def reverse_refund_transaction(
    payload: FeeRefundReversalRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeRefundReversalResponse:
    return await reverse_fee_refund(
        db,
        payload,
        actor_id=principal.user_id,
        actor_snapshot=_get_actor_snapshot(principal),
    )


@router.get("/{id}/transactions", response_model=FeeTransactionListResponse)
async def read_fee_transactions(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
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
    principal: Principal = Depends(require_management),
) -> FeeTransactionBatchResponse:
    return await get_fee_transactions_batch(db, payload.record_ids)


@router.patch("/{id}/notify", response_model=FeeRecordResponse)
async def notify_fee_record(
    id: UUID,
    payload: FeeNotifyRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeRecordResponse:
    record = await mark_fee_notified(
        db,
        id,
        payload.message,
        payload.channel,
        actor_id=principal.user_id,
        actor_snapshot=_get_actor_snapshot(principal),
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
    settlement_account_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeRecordResponse:
    if payment_method == "bank_transfer" and settlement_account_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hãy chọn tài khoản ngân hàng đã nhận khoản chuyển khoản.",
        )
    record = await mark_fee_paid(
        db,
        id,
        actor_id=principal.user_id,
        payment_method=payment_method,
        settlement_account_id=settlement_account_id,
        actor_snapshot=_get_actor_snapshot(principal),
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
    principal: Principal = Depends(require_management),
) -> FeeRecordResponse:
    record = await mark_fee_unpaid(
        db,
        id,
        actor_id=principal.user_id,
        target_notification_state=target_notification_state,
        actor_snapshot=_get_actor_snapshot(principal),
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
    principal: Principal = Depends(require_management),
) -> FeeBatchResponse:
    return await mark_fees_unnotified(
        db,
        [id],
        actor_id=principal.user_id,
        actor_snapshot=_get_actor_snapshot(principal),
    )


def _get_actor_snapshot(
    principal: Principal,
) -> FeeOperationActorSnapshot:
    return FeeOperationActorSnapshot(
        user_id=principal.user_id,
        name=(
            principal.full_name
            if principal.full_name and principal.full_name.strip()
            else principal.username
        ),
        username=principal.username,
        role=principal.effective_role,
    )
