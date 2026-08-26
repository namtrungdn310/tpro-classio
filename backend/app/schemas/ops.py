from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class OpsWorkspaceSummary(BaseModel):
    id: UUID
    name: str
    owner_user_id: UUID | None
    admin_count: int = Field(ge=0)
    active_admin_count: int = Field(ge=0)
    open_request_count: int = Field(ge=0)
    review_request_count: int = Field(ge=0)
    quarantined_count: int = Field(ge=0)
    provider_status: str
    provider_last_error: str | None
    last_received_at: datetime | None


class OpsIncident(BaseModel):
    incident_id: str
    severity: Literal["low", "medium", "high", "critical"]
    title: str
    summary: str


class OpsOverviewResponse(BaseModel):
    generated_at: datetime
    status: Literal["operational", "degraded"]
    workspaces: list[OpsWorkspaceSummary]
    incidents: list[OpsIncident]


class OpsDisablePay2SRequest(BaseModel):
    reason: str = Field(min_length=8, max_length=500)


class OpsActionResponse(BaseModel):
    applied: bool
