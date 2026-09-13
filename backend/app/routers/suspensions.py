from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.schemas.suspension import (
    SuspensionCreateRequest,
    SuspensionPreviewRequest,
    SuspensionPreviewResponse,
    ClassSuspensionChangeDraft,
    ClassSuspensionChangeApply,
    ClassSuspensionChangePreview,
)
from app.services.suspension_service import (
    create_suspension,
    preview_suspension,
)

router = APIRouter(tags=["suspensions"])


@router.get("/{class_id}/suspensions")
async def list_class_suspensions_route(
    class_id: UUID,
    year: int = Query(..., ge=1900, le=9998),
    offset: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
):
    from app.services.class_suspension_lifecycle_service import list_class_suspensions

    return await list_class_suspensions(
        db, class_id, year=year, offset=offset, limit=limit
    )


@router.post(
    "/{class_id}/suspensions/{adjustment_id}/preview",
    response_model=ClassSuspensionChangePreview,
)
async def preview_class_suspension_change_route(
    class_id: UUID,
    adjustment_id: UUID,
    payload: ClassSuspensionChangeDraft,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
):
    from app.services.class_suspension_lifecycle_service import (
        prepare_class_suspension_change,
    )

    result, *_ = await prepare_class_suspension_change(
        db, class_id, adjustment_id, payload
    )
    return result


@router.post(
    "/{class_id}/suspensions/{adjustment_id}",
    response_model=ClassSuspensionChangePreview,
)
async def apply_class_suspension_change_route(
    class_id: UUID,
    adjustment_id: UUID,
    payload: ClassSuspensionChangeApply,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
):
    from app.services.class_suspension_lifecycle_service import (
        apply_class_suspension_change,
    )

    return await apply_class_suspension_change(
        db, class_id, adjustment_id, payload, actor_id=principal.user_id
    )


@router.post(
    "/{class_id}/suspensions/preview", response_model=SuspensionPreviewResponse
)
async def preview_suspension_route(
    class_id: UUID,
    payload: SuspensionPreviewRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> SuspensionPreviewResponse:
    return await preview_suspension(db, class_id, payload)


@router.post("/{class_id}/suspensions", response_model=SuspensionPreviewResponse)
async def create_suspension_route(
    class_id: UUID,
    payload: SuspensionCreateRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> SuspensionPreviewResponse:
    if payload.expected_fingerprint is None:
        raise HTTPException(
            422, "Vui lòng xem tác động của lần hoãn trước khi xác nhận"
        )
    return await create_suspension(
        db,
        class_id,
        payload,
        actor_user_id=principal.user_id,
    )
