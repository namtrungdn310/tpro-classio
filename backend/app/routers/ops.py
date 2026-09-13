from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_dev
from app.schemas.ops import (
    OpsActionResponse,
    OpsDisablePay2SRequest,
    OpsOverviewResponse,
)

router = APIRouter(tags=["operations"])


@router.get("/overview", response_model=OpsOverviewResponse)
async def get_operations_overview(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_dev),
) -> OpsOverviewResponse:
    result = await db.execute(text("select ops.platform_overview()"))
    payload = result.scalar_one()
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Trung tâm vận hành chưa sẵn sàng.",
        )
    return OpsOverviewResponse.model_validate(payload)


@router.post(
    "/workspaces/{workspace_id}/pay2s/disable",
    response_model=OpsActionResponse,
)
async def disable_workspace_pay2s(
    workspace_id: UUID,
    payload: OpsDisablePay2SRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_dev),
) -> OpsActionResponse:
    result = await db.execute(
        text("select ops.disable_workspace_pay2s(:workspace_id, :actor_id, :reason)"),
        {
            "workspace_id": str(workspace_id),
            "actor_id": principal.user_id,
            "reason": payload.reason,
        },
    )
    applied = bool(result.scalar_one())
    await db.commit()
    return OpsActionResponse(applied=applied)
