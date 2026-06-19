from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_admin
from app.schemas.class_ import ClassCreate, ClassResponse, ClassUpdate, ClassType
from app.services.class_service import (
    create_class,
    get_classes,
    soft_delete_class,
    update_class,
)

router = APIRouter(tags=["classes"])


@router.get("", response_model=list[ClassResponse])
async def list_classes(
    search: str | None = Query(default=None),
    type: ClassType | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(get_current_user),
) -> list[ClassResponse]:
    return await get_classes(db, search=search, type=type, is_active=is_active)


@router.post("", response_model=ClassResponse)
async def create_class_route(
    payload: ClassCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> ClassResponse:
    class_ = await create_class(db, payload)
    return ClassResponse(
        id=class_.id,
        name=class_.name,
        type=class_.type,
        base_fee=int(class_.base_fee),
        billing_cycle_months=class_.billing_cycle_months,
        start_date=class_.start_date,
        end_date=class_.end_date,
        schedule=class_.schedule,
        is_active=class_.is_active,
        student_count=0,
        created_at=class_.created_at,
    )


@router.patch("/{id}", response_model=ClassResponse)
async def update_class_route(
    id: UUID,
    payload: ClassUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> ClassResponse:
    class_ = await update_class(db, id, payload)
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )

    return ClassResponse(
        id=class_.id,
        name=class_.name,
        type=class_.type,
        base_fee=int(class_.base_fee),
        billing_cycle_months=class_.billing_cycle_months,
        start_date=class_.start_date,
        end_date=class_.end_date,
        schedule=class_.schedule,
        is_active=class_.is_active,
        student_count=0,
        created_at=class_.created_at,
    )


@router.delete("/{id}")
async def delete_class_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> dict[str, str]:
    class_ = await soft_delete_class(db, id)
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )

    return {"message": "Đã xoá lớp học"}
