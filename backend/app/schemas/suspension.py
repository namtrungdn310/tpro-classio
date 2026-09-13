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
    student_name: str | None = None
    target_coverage_start: date | None = None
    old_due_date: date | None = None
    new_due_date: date | None = None
    pending_days: int = 0


class SuspensionPreviewResponse(BaseModel):
    class_id: UUID
    suspended_from: date
    resume_on: date
    credit_days: int
    member_summary: list[SuspensionMemberSummary]
    target_cycle_count: int
    protected_case_count: int
    fingerprint: str = ""
    adjustment_id: UUID | None = None
    occurrence_count: int = 0
    blocked_reasons: list[str] = Field(default_factory=list)


class SuspensionCreateRequest(SuspensionPreviewRequest):
    model_config = ConfigDict(extra="forbid")

    reason_code: ReasonCode = "CENTER_OPERATION"
    reason_note: str | None = Field(default=None, max_length=500)
    request_id: UUID = Field(default_factory=uuid4)
    expected_fingerprint: str | None = Field(default=None, min_length=64, max_length=64)


class ClassSuspensionChangeDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resume_on: date
    cancel: bool = False
    reason: str = Field(min_length=1, max_length=500)


class ClassSuspensionChangeApply(ClassSuspensionChangeDraft):
    request_id: UUID
    expected_fingerprint: str = Field(min_length=64, max_length=64)


class ClassSuspensionChangePreview(BaseModel):
    adjustment_id: UUID
    previous_resume_on: date
    resume_on: date
    cancel: bool
    restore_count: int
    suspend_count: int
    member_summary: list[SuspensionMemberSummary]
    fingerprint: str
    blocked_reasons: list[str] = Field(default_factory=list)
