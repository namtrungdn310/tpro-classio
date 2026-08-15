from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.schemas.staff import (
    StaffCreate,
    StaffCompensationRateCreate,
    StaffCompensationRateResponse,
    StaffPayrollSettlementCreate,
    StaffPayrollSettlementReversalCreate,
    StaffPayrollSettlementReversalResponse,
    StaffPayrollSettlementResponse,
    StaffPayrollSummaryResponse,
    StaffResponse,
    StaffType,
    StaffUpdate,
    TeacherOptionResponse,
)
from app.services.staff_service import (
    StaffConflictError,
    archive_staff_member,
    create_staff_member,
    get_active_teacher_options,
    get_staff_members,
    get_staff_response,
    update_staff_member,
)
from app.services.payroll_service import (
    create_staff_compensation_rate,
    get_staff_payroll_summary,
    reverse_staff_payroll_settlement,
    settle_staff_payroll,
)

router = APIRouter(tags=["staff"])


@router.get("/{id}/payroll", response_model=StaffPayrollSummaryResponse)
async def get_staff_payroll_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StaffPayrollSummaryResponse:
    return await get_staff_payroll_summary(db, id)


@router.post("/{id}/compensation-rates", response_model=StaffCompensationRateResponse)
async def create_staff_compensation_rate_route(
    id: UUID,
    payload: StaffCompensationRateCreate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StaffCompensationRateResponse:
    return await create_staff_compensation_rate(
        db, id, payload, actor_user_id=principal.user_id
    )


@router.post("/{id}/payroll/settlements", response_model=StaffPayrollSettlementResponse)
async def settle_staff_payroll_route(
    id: UUID,
    payload: StaffPayrollSettlementCreate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StaffPayrollSettlementResponse:
    return await settle_staff_payroll(db, id, payload, actor_user_id=principal.user_id)


@router.post(
    "/{id}/payroll/settlements/{settlement_id}/reversal",
    response_model=StaffPayrollSettlementReversalResponse,
)
async def reverse_staff_payroll_settlement_route(
    id: UUID,
    settlement_id: UUID,
    payload: StaffPayrollSettlementReversalCreate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StaffPayrollSettlementReversalResponse:
    return await reverse_staff_payroll_settlement(
        db,
        id,
        settlement_id,
        payload,
        actor_user_id=principal.user_id,
    )


@router.get("/teacher-options", response_model=list[TeacherOptionResponse])
async def list_active_teacher_options(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> list[TeacherOptionResponse]:
    return await get_active_teacher_options(db)


@router.get("", response_model=list[StaffResponse])
async def list_staff_members(
    staff_type: StaffType | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> list[StaffResponse]:
    return await get_staff_members(
        db,
        staff_type=staff_type,
        is_active=is_active,
        include_sensitive=True,
    )


@router.post("", response_model=StaffResponse)
async def create_staff_member_route(
    payload: StaffCreate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StaffResponse:
    try:
        staff = await create_staff_member(db, payload)
    except StaffConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    created = await get_staff_response(
        db,
        UUID(str(staff.id)),
        include_sensitive=True,
    )
    if created is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy nhân sự",
        )
    return created


@router.patch("/{id}", response_model=StaffResponse)
async def update_staff_member_route(
    id: UUID,
    payload: StaffUpdate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StaffResponse:
    try:
        staff = await update_staff_member(db, id, payload)
    except StaffConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    if staff is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy nhân sự",
        )

    updated = await get_staff_response(db, id, include_sensitive=True)
    if updated is not None:
        return updated
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Không tìm thấy nhân sự",
    )


@router.delete("/{id}")
async def delete_staff_member_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> dict[str, str]:
    try:
        staff = await archive_staff_member(db, id)
    except StaffConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    if staff is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy nhân sự",
        )

    return {"message": "Đã ngừng hoạt động nhân sự"}
