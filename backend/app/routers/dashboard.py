from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.schemas.dashboard import DashboardOverviewResponse
from app.services.dashboard_service import get_dashboard_overview

router = APIRouter(tags=["dashboard"])


@router.get("/overview", response_model=DashboardOverviewResponse)
async def overview(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> DashboardOverviewResponse:
    return await get_dashboard_overview(db)
