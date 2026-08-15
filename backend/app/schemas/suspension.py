from datetime import date
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

ReasonCode = Literal["TEACHER_UNAVAILABLE", "CENTER_OPERATION", "OTHER"]


class SuspensionPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suspended_from: date
    resume_on: date


class SuspensionMemberSummary(BaseModel):
    enrollment_id: UUID
    overlap_days: int


class SuspensionPreviewResponse(BaseModel):
    class_id: UUID
    suspended_from: date
    resume_on: date
    credit_days: int
    member_summary: list[SuspensionMemberSummary]
    target_cycle_count: int
    protected_case_count: int


class SuspensionCreateRequest(SuspensionPreviewRequest):
    model_config = ConfigDict(extra="forbid")

    reason_code: ReasonCode = "CENTER_OPERATION"
    reason_note: str | None = Field(default=None, max_length=500)
    request_id: UUID = Field(default_factory=uuid4)
