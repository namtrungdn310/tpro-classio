from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.schemas.dashboard import DashboardOverviewResponse
from app.services.dashboard_service import get_dashboard_overview

router = APIRouter(tags=["dashboard"])


@router.get("/overview", response_model=DashboardOverviewResponse)
async def overview(
    db: AsyncSession = Depends(get_db),
    _current_user: dict[str, str | bool | None] = Depends(get_current_user),
) -> DashboardOverviewResponse:
    return await get_dashboard_overview(db)
