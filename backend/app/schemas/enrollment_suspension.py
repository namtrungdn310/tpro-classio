from datetime import date, datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class EnrollmentSuspensionDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    suspension_id: UUID | None = None
    action: Literal["SAVE", "CANCEL"] = "SAVE"
    suspended_from: date
    resume_on: date
    # A reason documents the saved decision, not the read-only calculation.
    reason: str = Field(default="", max_length=500)


class EnrollmentSuspensionApply(EnrollmentSuspensionDraft):
    reason: str = Field(min_length=1, max_length=500)
    request_id: UUID
    expected_fingerprint: str = Field(min_length=64, max_length=64)


class EnrollmentSuspensionPreview(BaseModel):
    enrollment_id: UUID
    suspension_id: UUID | None = None
    student_name: str
    class_name: str
    suspended_from: date
    resume_on: date
    calendar_days: int
    previous_preserved_days: int
    preserved_days: int
    delta_days: int
    overlap_or_waived_days: int
    target_coverage_start: date | None
    old_due_date: date | None
    new_due_date: date | None
    pending_days: int
    protected_count: int
    late_report: bool
    fingerprint: str
    warnings: list[str] = Field(default_factory=list)


class EnrollmentSuspensionRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    enrollment_id: UUID
    suspended_from: date
    resume_on: date
    status: Literal["ACTIVE", "CANCELLED"]
    version: int
    reason: str
    updated_at: datetime


class EnrollmentSuspensionList(BaseModel):
    items: list[EnrollmentSuspensionRow]
    total: int
    pending_days: int
