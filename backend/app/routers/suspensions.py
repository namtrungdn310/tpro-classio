from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.schemas.suspension import (
    SuspensionCreateRequest,
    SuspensionPreviewRequest,
    SuspensionPreviewResponse,
)
from app.services.suspension_service import (
    create_suspension,
    preview_suspension,
)

router = APIRouter(tags=["suspensions"])


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
    return await create_suspension(
        db,
        class_id,
        payload,
        actor_user_id=principal.user_id,
    )
