from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_admin, require_owner
from app.schemas.staff import (
    StaffCreate,
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

router = APIRouter(tags=["staff"])


@router.get("/teacher-options", response_model=list[TeacherOptionResponse])
async def list_active_teacher_options(
    db: AsyncSession = Depends(get_db),
    _current_user: dict[str, str | bool | None] = Depends(require_admin),
) -> list[TeacherOptionResponse]:
    return await get_active_teacher_options(db)


@router.get("", response_model=list[StaffResponse])
async def list_staff_members(
    staff_type: StaffType | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | bool | None] = Depends(get_current_user),
) -> list[StaffResponse]:
    include_sensitive = bool(current_user.get("is_owner")) or (
        current_user.get("role") == "admin"
    )
    return await get_staff_members(
        db,
        staff_type=staff_type,
        is_active=is_active,
        include_sensitive=include_sensitive,
    )


@router.post("", response_model=StaffResponse)
async def create_staff_member_route(
    payload: StaffCreate,
    db: AsyncSession = Depends(get_db),
    _current_user: dict[str, str | bool | None] = Depends(require_owner),
) -> StaffResponse:
    try:
        staff = await create_staff_member(db, payload)
    except StaffConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
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
    _current_user: dict[str, str | bool | None] = Depends(require_owner),
) -> StaffResponse:
    try:
        staff = await update_staff_member(db, id, payload)
    except StaffConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
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
    _current_user: dict[str, str | bool | None] = Depends(require_owner),
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
