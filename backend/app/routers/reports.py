from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.schemas.report import (
    FeeOperationListResponse,
    FeeOperationResponse,
    FeePaidReceiptDetailResponse,
    FeePaidReceiptListResponse,
    PaymentReconciliationListResponse,
    PaymentReconciliationResolveRequest,
    PaymentReconciliationItemResponse,
)
from app.services.paid_report_service import (
    get_paid_fee_receipt,
    get_paid_fee_receipts,
)
from app.services.report_service import get_fee_operation, get_fee_operations
from app.services.payment_reconciliation_service import (
    list_payment_reconciliation,
    resolve_payment_reconciliation,
)

router = APIRouter(tags=["reports"])


@router.get("/fees/paid", response_model=FeePaidReceiptListResponse)
async def list_paid_fee_receipts(
    period: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    q: str | None = Query(default=None, min_length=1, max_length=100),
    date_from: date | None = None,
    date_to: date | None = None,
    payment_method: Literal["bank_transfer", "cash"] | None = None,
    payment_origin: Literal["manual", "manual_early", "pay2s"] | None = None,
    refund_state: Literal["NONE", "PARTIAL", "FULL", "REVERSED"] | None = None,
    cursor: str | None = Query(default=None, max_length=500),
    limit: int = Query(default=30, ge=10, le=100),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeePaidReceiptListResponse:
    return await get_paid_fee_receipts(
        db,
        period=period,
        query_text=q,
        date_from=date_from,
        date_to=date_to,
        payment_method=payment_method,
        payment_origin=payment_origin,
        refund_state=refund_state,
        cursor=cursor,
        limit=limit,
    )


@router.get("/fees/paid/{receipt_id}", response_model=FeePaidReceiptDetailResponse)
async def read_paid_fee_receipt(
    receipt_id: str = Path(min_length=20, max_length=500),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeePaidReceiptDetailResponse:
    receipt = await get_paid_fee_receipt(db, receipt_id)
    if receipt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy phiếu thu",
        )
    return receipt


@router.get("/fees/operations", response_model=FeeOperationListResponse)
async def list_fee_operations(
    action: Literal[
        "notify",
        "unnotify",
        "payment",
        "payment_reversal",
        "refund",
        "refund_reversal",
        "sync",
        "template_update",
    ]
    | None = None,
    period: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    q: str | None = Query(default=None, min_length=1, max_length=100),
    date_from: date | None = None,
    date_to: date | None = None,
    cursor: str | None = Query(default=None, max_length=300),
    limit: int = Query(default=30, ge=10, le=100),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeOperationListResponse:
    return await get_fee_operations(
        db,
        action=action,
        period=period,
        query_text=q,
        date_from=date_from,
        date_to=date_to,
        cursor=cursor,
        limit=limit,
    )


@router.get("/fees/operations/{operation_id}", response_model=FeeOperationResponse)
async def read_fee_operation(
    operation_id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> FeeOperationResponse:
    operation = await get_fee_operation(db, operation_id)
    if operation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy hoạt động học phí",
        )
    return operation


@router.get(
    "/fees/reconciliation",
    response_model=PaymentReconciliationListResponse,
)
async def list_fee_reconciliation(
    queue_status: Literal["PENDING", "PROCESSING", "POSTED", "REVIEW", "DEAD"] = Query(
        default="REVIEW", alias="status"
    ),
    limit: int = Query(default=100, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> PaymentReconciliationListResponse:
    return await list_payment_reconciliation(db, queue_status=queue_status, limit=limit)


@router.post(
    "/fees/reconciliation/{queue_id}/resolve",
    response_model=PaymentReconciliationItemResponse,
)
async def resolve_fee_reconciliation(
    queue_id: UUID,
    payload: PaymentReconciliationResolveRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> PaymentReconciliationItemResponse:
    try:
        response = await resolve_payment_reconciliation(
            db,
            queue_id=queue_id,
            payload=payload,
            actor_id=principal.user_id,
        )
        await db.commit()
        return response
    except HTTPException:
        await db.rollback()
        raise
