from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_admin
from app.schemas.class_ import ClassCreate, ClassResponse, ClassUpdate, ClassType
from app.services.class_service import (
    create_class,
    archive_class,
    get_class_response,
    get_classes,
    update_class,
)

router = APIRouter(tags=["classes"])


@router.get("", response_model=list[ClassResponse])
async def list_classes(
    search: str | None = Query(default=None, max_length=120),
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
    try:
        class_ = await create_class(db, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    created = await get_class_response(db, UUID(str(class_.id)))
    if created is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    return created


@router.patch("/{id}", response_model=ClassResponse)
async def update_class_route(
    id: UUID,
    payload: ClassUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> ClassResponse:
    try:
        class_ = await update_class(db, id, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )

    updated = await get_class_response(db, id)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    return updated


@router.delete("/{id}")
async def archive_class_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> dict[str, str]:
    class_ = await archive_class(db, id)
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )

    return {"message": "Đã ngừng hoạt động lớp học"}
