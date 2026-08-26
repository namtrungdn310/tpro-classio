"""Pydantic contracts for the class postponement / make-up flow (migration 053).

Error contract: stable machine codes in `MakeupErrorCode`; responses include
`billing_impact: "NONE"` explicitly. No PII (contacts/private notes) ever
travels through these models.
"""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

ReasonCode = Literal["TEACHER_UNAVAILABLE", "CENTER_OPERATION", "OTHER"]
ExceptionStatus = Literal[
    "MAKEUP_PENDING",
    "MAKEUP_SCHEDULED",
    "MAKEUP_COMPLETED",
    "RESTORED",
    "CANCELLED",
]
DerivedStatus = Literal[
    "MAKEUP_PENDING",
    "MAKEUP_SCHEDULED",
    "MAKEUP_COMPLETED",
    "RESTORED",
    "CANCELLED",
]
OccurrenceKind = Literal["REGULAR", "POSTPONED", "MAKEUP"]
AdjustmentStatus = Literal["OPEN", "CLOSED"]

BILLING_IMPACT_NONE = "NONE"

MAX_BATCH_OCCURRENCES = 10
MAX_ADJUSTMENT_NOTE_LENGTH = 500
MAX_RANGE_DAYS = 120

MakeupErrorCode = Literal[
    "CLASS_VERSION_CONFLICT",
    "OCCURRENCE_NOT_FOUND",
    "OCCURRENCE_ALREADY_ADJUSTED",
    "INVALID_TRANSITION",
    "MAKEUP_DURATION_MISMATCH",
    "STAFF_SCHEDULE_CONFLICT",
    "CLASS_SCHEDULE_CONFLICT",
    "MAKEUP_NOT_FINISHED",
    "UNRESOLVED_MAKEUPS",
    "RESTORE_NOT_ALLOWED",
    "STAFF_INACTIVE",
    "REQUEST_ALREADY_PROCESSED",
]


class MakeupDomainError(ValueError):
    """Stable machine-code domain error; never leaks SQL/stack details."""

    def __init__(self, code: MakeupErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


class StaffSnapshotResponse(BaseModel):
    staff_id: UUID
    role: Literal["TEACHER", "ASSISTANT"]
    display_name: str
    source_slot_key: str


class EligibleStudentSummary(BaseModel):
    student_id: UUID
    student_name: str
    enrolled_at: date | None = None


class ConflictDetail(BaseModel):
    code: MakeupErrorCode
    message: str
    class_id: UUID | None = None
    class_name: str | None = None
    staff_ids: list[UUID] = Field(default_factory=list)
    day: str | None = None
    start: str | None = None
    end: str | None = None


class OccurrenceResponse(BaseModel):
    key: str
    kind: OccurrenceKind
    original_start_at: datetime
    original_end_at: datetime
    source_slot_key: str
    teacher_ids: list[UUID] = Field(default_factory=list)
    assistant_ids: list[UUID] = Field(default_factory=list)
    exception_id: UUID | None = None
    status: DerivedStatus | None = None
    replacement_start_at: datetime | None = None
    replacement_end_at: datetime | None = None
    adjustable: bool = False
    already_adjusted: bool = False
    passed: bool = False


class ClassOccurrenceListResponse(BaseModel):
    class_id: UUID
    occurrences: list[OccurrenceResponse] = Field(default_factory=list)


class ClassScheduleAdjustmentResponse(BaseModel):
    id: UUID
    class_id: UUID
    reason_code: ReasonCode
    reason_note: str | None = None
    affected_from: date
    affected_through: date
    status: AdjustmentStatus
    created_by: UUID
    request_id: UUID
    version: int
    created_at: datetime
    updated_at: datetime


class ClassSessionExceptionResponse(BaseModel):
    id: UUID
    adjustment_id: UUID
    class_id: UUID
    original_start_at: datetime
    original_end_at: datetime
    original_timezone: str
    status: ExceptionStatus
    display_status: DerivedStatus
    replacement_start_at: datetime | None = None
    replacement_end_at: datetime | None = None
    completed_at: datetime | None = None
    restored_at: datetime | None = None
    version: int
    staff: list[StaffSnapshotResponse] = Field(default_factory=list)
    eligible_student_count: int = 0
    billing_impact: Literal["NONE"] = BILLING_IMPACT_NONE
    created_at: datetime
    updated_at: datetime


class ClassAdjustmentListResponse(BaseModel):
    adjustments: list[ClassScheduleAdjustmentResponse] = Field(default_factory=list)
    exceptions: list[ClassSessionExceptionResponse] = Field(default_factory=list)


class PostponementPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_date: date
    to_date: date

    @model_validator(mode="after")
    def validate_range(self) -> "PostponementPreviewRequest":
        if self.to_date < self.from_date:
            raise ValueError("Ngày kết thúc phải sau ngày bắt đầu")
        if (self.to_date - self.from_date).days > MAX_RANGE_DAYS:
            raise ValueError(f"Khoảng ngày không được vượt quá {MAX_RANGE_DAYS} ngày")
        return self


class PostponementOccurrenceOption(BaseModel):
    key: str
    original_start_at: datetime
    original_end_at: datetime
    source_slot_key: str
    teacher_ids: list[UUID] = Field(default_factory=list)
    assistant_ids: list[UUID] = Field(default_factory=list)
    adjustable: bool = False
    already_adjusted: bool = False
    passed: bool = False


class PostponementPreviewResponse(BaseModel):
    class_id: UUID
    occurrences: list[PostponementOccurrenceOption] = Field(default_factory=list)
    billing_impact: Literal["NONE"] = BILLING_IMPACT_NONE


class PostponementCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    original_start_at: list[datetime] = Field(
        min_length=1, max_length=MAX_BATCH_OCCURRENCES
    )
    reason_code: ReasonCode
    reason_note: str | None = Field(default=None, max_length=MAX_ADJUSTMENT_NOTE_LENGTH)
    schedule_now: bool = False
    request_id: UUID
    retrospective: bool = False

    @model_validator(mode="after")
    def validate_reason_note(self) -> "PostponementCreateRequest":
        note = self.reason_note
        if note is not None:
            note = note.strip()
            if any(ord(char) < 32 and char not in "\t\n" for char in note):
                raise ValueError("Ghi chú chứa ký tự không hợp lệ")
            if len(note) > MAX_ADJUSTMENT_NOTE_LENGTH:
                raise ValueError(
                    f"Ghi chú không được vượt quá {MAX_ADJUSTMENT_NOTE_LENGTH} ký tự"
                )
        if self.retrospective and self.reason_code != "OTHER":
            raise ValueError("Ghi nhận buổi đã hoãn yêu cầu mã lý do OTHER và ghi chú")
        if self.retrospective and not (self.reason_note or "").strip():
            raise ValueError("Ghi nhận buổi đã hoãn yêu cầu ghi chú lý do")
        return self


class PostponementCreateResponse(BaseModel):
    adjustment: ClassScheduleAdjustmentResponse
    exceptions: list[ClassSessionExceptionResponse] = Field(default_factory=list)
    billing_impact: Literal["NONE"] = BILLING_IMPACT_NONE


class MakeupSchedulePreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    replacement_start_at: datetime


class MakeupSchedulePreviewResponse(BaseModel):
    exception_id: UUID
    original_start_at: datetime
    original_end_at: datetime
    duration_minutes: int
    replacement_start_at: datetime
    replacement_end_at: datetime
    staff: list[StaffSnapshotResponse] = Field(default_factory=list)
    eligible_student_count: int = 0
    conflicts: list[ConflictDetail] = Field(default_factory=list)
    staff_inactive: list[StaffSnapshotResponse] = Field(default_factory=list)
    can_schedule: bool = False
    billing_impact: Literal["NONE"] = BILLING_IMPACT_NONE


class MakeupScheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    replacement_start_at: datetime
    request_id: UUID
    expected_version: int = Field(ge=1)


class MakeupUnscheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    expected_version: int = Field(ge=1)


class MakeupCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    expected_version: int = Field(ge=1)


class RestoreOriginalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    expected_version: int = Field(ge=1)


class ExceptionCommandResponse(BaseModel):
    exception: ClassSessionExceptionResponse
    effective_status: str
    billing_impact: Literal["NONE"] = BILLING_IMPACT_NONE
