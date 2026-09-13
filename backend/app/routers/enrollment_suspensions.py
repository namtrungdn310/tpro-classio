from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.schemas.enrollment_suspension import (
    EnrollmentSuspensionDraft,
    EnrollmentSuspensionApply,
    EnrollmentSuspensionPreview,
    EnrollmentSuspensionList,
)
from app.services.enrollment_suspension_service import (
    prepare_individual_suspension,
    apply_individual_suspension,
    list_individual_suspensions,
)

router = APIRouter(tags=["suspensions"])


@router.post(
    "/{enrollment_id}/suspensions/preview", response_model=EnrollmentSuspensionPreview
)
async def preview(
    enrollment_id: UUID,
    payload: EnrollmentSuspensionDraft,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
):
    result, *_ = await prepare_individual_suspension(db, enrollment_id, payload)
    return result


@router.post("/{enrollment_id}/suspensions", response_model=EnrollmentSuspensionPreview)
async def apply(
    enrollment_id: UUID,
    payload: EnrollmentSuspensionApply,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
):
    return await apply_individual_suspension(
        db, enrollment_id, payload, actor_id=principal.user_id
    )


@router.get("/{enrollment_id}/suspensions", response_model=EnrollmentSuspensionList)
async def listing(
    enrollment_id: UUID,
    year: int | None = Query(None, ge=1900, le=9998),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
):
    return await list_individual_suspensions(
        db, enrollment_id, year=year, offset=offset, limit=limit
    )
