from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.principal import Principal, require_teacher_self
from app.schemas.attendance import (
    AttendanceCheckInRequest,
    AttendanceCheckInResponse,
    AttendanceTodayResponse,
)
from app.services.attendance_service import check_in, get_teacher_today

router = APIRouter(tags=["attendance"])


@router.get("/me/today", response_model=AttendanceTodayResponse)
async def teacher_today_route(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_teacher_self),
) -> AttendanceTodayResponse:
    return await get_teacher_today(db, principal)


@router.post(
    "/me/occurrences/{occurrence_id}/check-in",
    response_model=AttendanceCheckInResponse,
)
async def check_in_route(
    occurrence_id: UUID,
    payload: AttendanceCheckInRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_teacher_self),
) -> AttendanceCheckInResponse:
    return await check_in(db, principal, occurrence_id, payload)
