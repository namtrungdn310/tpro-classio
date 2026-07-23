from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.schemas.report import FeeOperationListResponse, FeeOperationResponse
from app.services.report_service import get_fee_operation, get_fee_operations

router = APIRouter(tags=["reports"])


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
    current_user: dict[str, str | bool | None] = Depends(get_current_user),
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
    current_user: dict[str, str | bool | None] = Depends(get_current_user),
) -> FeeOperationResponse:
    operation = await get_fee_operation(db, operation_id)
    if operation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy hoạt động học phí",
        )
    return operation
