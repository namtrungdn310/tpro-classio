from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ClassType = Literal["MONTHLY", "COURSE"]
ClassIdentityScheme = Literal["LEGACY", "ACADEMIC_YEAR", "INTAKE"]
ClassCategory = Literal["GENERAL", "SPECIALIZED", "IELTS", "CUSTOM"]
ClassGradeMode = Literal["GRADE", "NONE"]
ClassEducationLevel = Literal["PRIMARY", "MIDDLE", "HIGH"]
ClassEffectiveStatus = Literal["LEGACY", "SCHEDULED", "ACTIVE", "STOPPED", "CANCELLED"]
ClassNextFeeDueState = Literal["OVERDUE", "UPCOMING", "NONE"]
ClassStaffingStatus = Literal["UNASSIGNED", "PARTIAL", "READY"]
ScheduleAvailabilityScope = Literal["selected_staff", "all_classes"]
ClassScope = Literal[
    "operational",
    "active",
    "enrollable",
    "assignable",
    "scheduled",
    "stopped",
    "completed",
    "cancelled",
]
ClassDay = Literal[
    "Thứ 2",
    "Thứ 3",
    "Thứ 4",
    "Thứ 5",
    "Thứ 6",
    "Thứ 7",
    "Chủ Nhật",
]
MAX_BILLING_CYCLE_WEEKS = 260


class ClassScheduleSlot(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    day: ClassDay
    start: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    teacher_ids: list[UUID] = Field(default_factory=list, max_length=10)
    assistant_ids: list[UUID] = Field(default_factory=list, max_length=10)
    # R6-D07: stable relational slot identity (read-only projection).
    id: UUID | None = None
    version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_time_range(self) -> "ClassScheduleSlot":
        if self.start >= self.end:
            raise ValueError("Giờ kết thúc phải sau giờ bắt đầu")
        start_hour, start_minute = map(int, self.start.split(":"))
        end_hour, end_minute = map(int, self.end.split(":"))
        start_total = start_hour * 60 + start_minute
        end_total = end_hour * 60 + end_minute
        if start_minute not in (0, 30) or end_minute not in (0, 30):
            raise ValueError("Khung giờ học phải theo mốc 30 phút")
        if start_total < 7 * 60 or end_total > 22 * 60:
            raise ValueError("Khung giờ học phải nằm trong khoảng 07:00 đến 22:00")
        if end_total - start_total < 60:
            raise ValueError("Mỗi buổi học phải kéo dài ít nhất 60 phút")
        return self


class ClassSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    text: str = Field(default="", max_length=1000)
    slots: list[ClassScheduleSlot] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def validate_non_overlapping_slots(self) -> "ClassSchedule":
        ordered_slots = sorted(
            self.slots,
            key=lambda slot: (slot.day, slot.start, slot.end),
        )
        for previous, current in zip(ordered_slots, ordered_slots[1:]):
            if previous.day == current.day and current.start < previous.end:
                raise ValueError("Các ca học trong cùng một ngày không được trùng nhau")
        return self


def validate_class_configuration(
    *,
    class_type: ClassType,
    billing_cycle_months: int,
    billing_cycle_weeks: int | None,
    start_date: date | None,
    end_date: date | None,
) -> None:
    if class_type == "MONTHLY" and billing_cycle_months != 1:
        raise ValueError("Lớp theo tháng phải có chu kỳ thu một tháng")
    if class_type == "MONTHLY" and billing_cycle_weeks is not None:
        raise ValueError("Lớp theo tháng không sử dụng thời lượng gói theo tuần")
    if class_type == "COURSE" and (
        billing_cycle_weeks is None or billing_cycle_weeks < 1
    ):
        raise ValueError("Thời lượng mỗi gói phải từ một tuần trở lên")
    if start_date is not None and end_date is not None and end_date <= start_date:
        raise ValueError("Ngày kết thúc phải sau ngày bắt đầu")


class ClassBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    type: ClassType
    base_fee: int = Field(ge=0, le=999_999_999_999)
    billing_cycle_months: int = Field(default=1, ge=1, le=24)
    billing_cycle_weeks: int | None = Field(
        default=None,
        ge=1,
        le=MAX_BILLING_CYCLE_WEEKS,
    )
    start_date: date | None = None
    end_date: date | None = None
    identity_scheme: ClassIdentityScheme = "LEGACY"
    class_category: ClassCategory | None = None
    grade_mode: ClassGradeMode | None = None
    program_name: str | None = Field(default=None, min_length=1, max_length=120)
    grade_level: int | None = Field(default=None, ge=1, le=12)
    academic_year_start: int | None = Field(default=None, ge=2000, le=2200)
    schedule: ClassSchedule | None = None
    teacher_id: UUID | None = None
    teacher_ids: list[UUID] = Field(default_factory=list, max_length=10)
    assistant_ids: list[UUID] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def reject_teacher_assistant_overlap(self) -> "ClassBase":
        teacher_set = set(self.teacher_ids)
        assistant_set = set(self.assistant_ids)
        overlap = teacher_set & assistant_set
        if overlap:
            raise ValueError("Một nhân sự không thể vừa là giáo viên vừa là trợ giảng")
        return self

    @field_validator("teacher_ids")
    @classmethod
    def deduplicate_teacher_ids(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))

    @field_validator("assistant_ids")
    @classmethod
    def deduplicate_assistant_ids(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))


class ClassCreate(ClassBase):
    class_category: ClassCategory
    source_class_id: UUID | None = None

    @model_validator(mode="after")
    def validate_create_configuration(self) -> "ClassCreate":
        if self.schedule is None or (
            not self.schedule.slots and not self.schedule.text.strip()
        ):
            raise ValueError("Vui lòng chọn lịch học")
        validate_class_configuration(
            class_type=self.type,
            billing_cycle_months=self.billing_cycle_months,
            billing_cycle_weeks=self.billing_cycle_weeks,
            start_date=self.start_date,
            end_date=self.end_date,
        )
        validate_class_identity(
            identity_scheme=self.identity_scheme,
            class_category=self.class_category,
            grade_mode=self.grade_mode,
            grade_level=self.grade_level,
            academic_year_start=self.academic_year_start,
            start_date=self.start_date,
            end_date=self.end_date,
            allow_legacy=False,
        )
        return self


class ClassUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    type: ClassType | None = None
    base_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    billing_cycle_months: int | None = Field(default=None, ge=1, le=24)
    billing_cycle_weeks: int | None = Field(
        default=None,
        ge=1,
        le=MAX_BILLING_CYCLE_WEEKS,
    )
    start_date: date | None = None
    end_date: date | None = None
    end_date_change_reason: str | None = Field(
        default=None,
        min_length=3,
        max_length=500,
    )
    expected_version: int | None = Field(default=None, ge=1)
    expected_fingerprint: str | None = Field(
        default=None,
        min_length=32,
        max_length=64,
    )
    identity_scheme: ClassIdentityScheme | None = None
    class_category: ClassCategory | None = None
    grade_mode: ClassGradeMode | None = None
    program_name: str | None = Field(default=None, min_length=1, max_length=120)
    grade_level: int | None = Field(default=None, ge=1, le=12)
    academic_year_start: int | None = Field(default=None, ge=2000, le=2200)
    schedule: ClassSchedule | None = None
    teacher_id: UUID | None = None
    teacher_ids: list[UUID] | None = Field(default=None, max_length=10)
    assistant_ids: list[UUID] | None = Field(default=None, max_length=10)
    is_active: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_null_for_required_columns(cls, value: object) -> object:
        if isinstance(value, dict):
            required_columns = {
                "name",
                "type",
                "base_fee",
                "billing_cycle_months",
                "is_active",
            }
            null_fields = sorted(
                field
                for field in required_columns
                if field in value and value[field] is None
            )
            if null_fields:
                raise ValueError(f"Không được để trống: {', '.join(null_fields)}")
        return value

    @field_validator("teacher_ids")
    @classmethod
    def deduplicate_optional_teacher_ids(
        cls,
        value: list[UUID] | None,
    ) -> list[UUID] | None:
        return None if value is None else list(dict.fromkeys(value))

    @field_validator("assistant_ids")
    @classmethod
    def deduplicate_optional_assistant_ids(
        cls,
        value: list[UUID] | None,
    ) -> list[UUID] | None:
        return None if value is None else list(dict.fromkeys(value))


class ClassEndDateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    end_date: date
    reason: str = Field(min_length=3, max_length=500)
    expected_version: int = Field(ge=1)
    expected_fingerprint: str = Field(min_length=32, max_length=64)


class ClassEndDatePreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    end_date: date
    expected_version: int = Field(ge=1)


class ClassEndDatePreviewResponse(BaseModel):
    previous_end_date: date
    next_end_date: date
    total_weeks: int | None
    package_count: int | None
    affected_student_count: int
    mutable_fee_record_count: int
    protected_fee_record_count: int
    version: int
    preview_fingerprint: str
    preview_expires_at: datetime


class ClassStartDatePreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_date: date
    expected_version: int = Field(ge=1)
    default_decision: str | None = None
    enrollment_decisions: dict[UUID, str] | None = None
    class_patch: "ClassUpdate | None" = None


class ClassStartDateUpdate(ClassStartDatePreviewRequest):
    reason: str = Field(min_length=3, max_length=500)
    expected_fingerprint: str = Field(min_length=32, max_length=64)
    request_id: UUID | None = None
    enrollment_overrides: list[dict[str, object]] = Field(default_factory=list)


class ClassStartDatePreviewResponse(BaseModel):
    previous_start_date: date
    next_start_date: date
    affected_enrollment_count: int
    protected_fee_record_count: int
    blocking_history_count: int
    moves_earlier: bool
    creates_retroactive_fees: Literal[False] = False
    version: int
    preview_fingerprint: str
    preview_expires_at: datetime
    can_apply: bool = True
    blocking_reason: str | None = None
    earliest_historical_activity_date: date | None = None
    affected_enrollments: list[dict[str, object]] = Field(default_factory=list)


class ClassBillingCyclePreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    billing_cycle_weeks: int = Field(ge=1, le=MAX_BILLING_CYCLE_WEEKS)
    expected_version: int = Field(ge=1)


class ClassBillingCycleUpdate(ClassBillingCyclePreviewRequest):
    reason: str = Field(min_length=3, max_length=500)
    request_id: UUID
    expected_fingerprint: str = Field(min_length=32, max_length=64)


class ClassBillingCycleStudentImpact(BaseModel):
    enrollment_id: UUID
    student_id: UUID
    student_name: str
    student_code: str | None = None
    transition_on: date
    previous_next_due_date: date
    next_due_date: date
    protected_fee_count: int = Field(ge=0)
    superseded_fee_count: int = Field(ge=0)


class ClassBillingCyclePreviewResponse(BaseModel):
    class_id: UUID
    previous_weeks: int = Field(ge=1, le=MAX_BILLING_CYCLE_WEEKS)
    next_weeks: int = Field(ge=1, le=MAX_BILLING_CYCLE_WEEKS)
    affected_enrollment_count: int = Field(ge=0)
    retained_current_cycle_count: int = Field(ge=0)
    superseded_fee_count: int = Field(ge=0)
    protected_fee_count: int = Field(ge=0)
    open_payment_request_count: int = Field(ge=0)
    pending_review_count: int = Field(ge=0)
    affected_periods: list[str] = Field(default_factory=list)
    students: list[ClassBillingCycleStudentImpact] = Field(default_factory=list)
    version: int = Field(ge=1)
    preview_fingerprint: str
    preview_expires_at: datetime


class ClassStopPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)


class ClassStopRequest(ClassStopPreviewRequest):
    reason: str = Field(min_length=3, max_length=500)
    request_id: UUID
    expected_fingerprint: str = Field(min_length=32, max_length=64)


class ClassStopPreviewResponse(BaseModel):
    stopped_on: date
    active_enrollment_count: int
    future_mutable_fee_record_count: int
    retained_fee_record_count: int
    unresolved_makeup_count: int
    final_fee_count: int = 0
    final_package_review_count: int = 0
    version: int
    preview_fingerprint: str
    preview_expires_at: datetime


class ScheduleAvailabilityRequest(BaseModel):
    """Yêu cầu lịch bận dành riêng cho form lớp — payload tối thiểu, không
    chứa thông tin liên hệ nhân sự."""

    model_config = ConfigDict(extra="forbid")

    class_id: UUID | None = None
    start_date: date
    end_date: date | None = None
    scope: ScheduleAvailabilityScope = "selected_staff"
    teacher_ids: list[UUID] = Field(default_factory=list, max_length=10)
    assistant_ids: list[UUID] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def validate_availability_request(self) -> "ScheduleAvailabilityRequest":
        if self.end_date is not None and self.end_date <= self.start_date:
            raise ValueError("Ngày kết thúc phải sau ngày bắt đầu")
        if (
            self.scope == "selected_staff"
            and not self.teacher_ids
            and not self.assistant_ids
        ):
            raise ValueError("Vui lòng chọn ít nhất một giáo viên hoặc trợ giảng")
        overlap = set(self.teacher_ids) & set(self.assistant_ids)
        if overlap:
            raise ValueError("Một nhân sự không thể vừa là giáo viên vừa là trợ giảng")
        return self


class ScheduleAvailabilityConflict(BaseModel):
    """Một occupied session = ĐÚNG MỘT canonical block. Giữ đồng thời busy ID
    của cả giáo viên lẫn trợ giảng để frontend không mất conflict khi merge."""

    class_id: UUID
    class_name: str
    class_category: ClassCategory | None = None
    grade_level: int | None = None
    day: ClassDay
    start: str
    end: str
    busy_teacher_ids: list[UUID] = Field(default_factory=list)
    busy_assistant_ids: list[UUID] = Field(default_factory=list)


class ScheduleAvailabilityResponse(BaseModel):
    conflicts: list[ScheduleAvailabilityConflict] = Field(default_factory=list)


class StaffAvailabilityPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    class_id: UUID | None = None
    expected_version: int | None = Field(default=None, ge=1)
    start_date: date
    end_date: date | None = None
    schedule: ClassSchedule
    candidate_staff_ids: list[UUID] = Field(min_length=1, max_length=100)

    @field_validator("candidate_staff_ids")
    @classmethod
    def deduplicate_candidates(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))

    @model_validator(mode="after")
    def validate_candidate_assignments(self) -> "StaffAvailabilityPreviewRequest":
        teacher_ids = {
            staff_id for slot in self.schedule.slots for staff_id in slot.teacher_ids
        }
        assistant_ids = {
            staff_id for slot in self.schedule.slots for staff_id in slot.assistant_ids
        }
        if teacher_ids & assistant_ids:
            raise ValueError(
                "Một nhân sự không thể vừa là giáo viên vừa là trợ giảng trong cùng lớp"
            )
        assigned_ids = teacher_ids | assistant_ids
        if set(self.candidate_staff_ids) != assigned_ids:
            raise ValueError(
                "Danh sách nhân sự cần kiểm tra phải khớp phân công trong lịch học"
            )
        return self


class StaffAvailabilityConflictResponse(BaseModel):
    class_id: UUID
    class_name: str
    day: ClassDay
    start: str
    end: str
    source: Literal["REGULAR", "MAKEUP"] = "REGULAR"


class StaffAvailabilityCandidateResponse(BaseModel):
    staff_id: UUID
    role: Literal["TEACHER", "ASSISTANT"]
    available: bool
    conflicts: list[StaffAvailabilityConflictResponse] = Field(default_factory=list)


class StaffAvailabilityPreviewResponse(BaseModel):
    can_apply: bool
    preview_fingerprint: str = Field(min_length=64, max_length=64)
    candidates: list[StaffAvailabilityCandidateResponse]


class ClassHistoryTeacherEvent(BaseModel):
    teacher_id: UUID
    teacher_name: str
    staff_type: Literal["TEACHER", "ASSISTANT"]
    event_type: Literal["assigned", "unassigned"]
    occurred_at: datetime


class ClassHistoryEnrollment(BaseModel):
    enrollment_id: UUID
    student_id: UUID
    student_name: str
    enrollment_date: date | None
    ended_on: date | None = None
    effective_state: Literal["SCHEDULED", "CURRENT", "ENDED", "CANCELLED"] = "ENDED"
    ended_at: datetime | None
    status: Literal["active", "dropped", "completed", "cancelled"]


class ClassHistoryEvent(BaseModel):
    event_type: str
    previous_end_date: date | None
    next_end_date: date | None
    previous_start_date: date | None = None
    next_start_date: date | None = None
    previous_billing_cycle_weeks: int | None = None
    next_billing_cycle_weeks: int | None = None
    reason: str | None
    occurred_at: datetime


class ClassHistoryAdjustment(BaseModel):
    """Dated make-up exception trong timeline 'Điều chỉnh buổi học' — tối
    thiểu, không chứa audit payload hay thông tin liên hệ."""

    adjustment_id: UUID
    reason_code: str
    reason_note: str | None = None
    original_start_at: datetime
    original_end_at: datetime
    status: str
    display_status: str
    replacement_start_at: datetime | None = None
    replacement_end_at: datetime | None = None
    completed_at: datetime | None = None
    restored_at: datetime | None = None
    version: int


class ClassHistorySlotTeacher(BaseModel):
    staff_id: UUID
    staff_name: str


class ClassHistoryScheduleSlot(BaseModel):
    slot_id: UUID
    day: ClassDay
    start: str
    end: str
    effective_from: date
    effective_until: date | None = None
    teachers: list[ClassHistorySlotTeacher] = Field(default_factory=list)


class ClassHistoryResponse(BaseModel):
    id: UUID
    name: str
    display_name: str
    primary_label: str
    secondary_label: str | None
    effective_status: ClassEffectiveStatus
    start_date: date | None
    end_date: date | None
    stopped_on: date | None = None
    stopped_at: datetime | None = None
    stopped_reason: str | None = None
    schedule: ClassSchedule | None
    schedule_slots: list[ClassHistoryScheduleSlot] = Field(default_factory=list)
    teachers: list[ClassHistoryTeacherEvent]
    enrollments: list[ClassHistoryEnrollment]
    lifecycle_events: list[ClassHistoryEvent]
    adjustments: list[ClassHistoryAdjustment] = Field(default_factory=list)


class ClassScopeSummary(BaseModel):
    """Small, non-PII counts used by the class lifecycle navigation."""

    operational: int = Field(ge=0)
    active: int = Field(ge=0)
    scheduled: int = Field(ge=0)
    stopped: int = Field(default=0, ge=0)
    completed: int = Field(ge=0)
    cancelled: int = Field(ge=0)


def validate_class_identity(
    *,
    identity_scheme: ClassIdentityScheme,
    class_category: ClassCategory | None = None,
    grade_mode: ClassGradeMode | None = None,
    grade_level: int | None,
    academic_year_start: int | None,
    start_date: date | None,
    end_date: date | None,
    allow_legacy: bool = False,
) -> None:
    if identity_scheme == "LEGACY":
        if allow_legacy:
            return
        raise ValueError("Vui lòng chọn loại lớp")
    if start_date is None:
        raise ValueError("Vui lòng chọn ngày bắt đầu")
    if class_category is None:
        raise ValueError("Vui lòng chọn loại lớp")
    expected_scheme = "INTAKE" if class_category == "IELTS" else "ACADEMIC_YEAR"
    if identity_scheme != expected_scheme:
        raise ValueError("Thông tin loại lớp không nhất quán")
    if class_category == "GENERAL":
        if grade_mode != "GRADE" or grade_level is None or academic_year_start is None:
            raise ValueError("Vui lòng chọn khối lớp và năm học")
        return
    if class_category == "SPECIALIZED":
        if academic_year_start is not None and not 2000 <= academic_year_start <= 2200:
            raise ValueError("Năm học không hợp lệ")
        if grade_mode == "GRADE" and grade_level is not None:
            return
        if grade_mode == "NONE" and grade_level is None:
            return
        raise ValueError("Vui lòng chọn khối lớp hoặc chọn Không")
    if class_category == "CUSTOM":
        if academic_year_start is not None and not 2000 <= academic_year_start <= 2200:
            raise ValueError("Năm học không hợp lệ")
        if grade_mode == "GRADE" and grade_level is not None:
            return
        if grade_mode == "NONE" and grade_level is None:
            return
        raise ValueError("Vui lòng chọn khối lớp hoặc chọn Không")
    if class_category == "IELTS":
        if (
            grade_mode != "NONE"
            or grade_level is not None
            or academic_year_start is not None
        ):
            raise ValueError("Lớp IELTS không sử dụng khối lớp và năm học")
        return
    raise ValueError("Loại lớp không hợp lệ")


def education_level_for_grade(grade_level: int) -> ClassEducationLevel:
    if 1 <= grade_level <= 5:
        return "PRIMARY"
    if 6 <= grade_level <= 9:
        return "MIDDLE"
    if 10 <= grade_level <= 12:
        return "HIGH"
    raise ValueError("Khối lớp không hợp lệ")


class ClassActiveSuspension(BaseModel):
    """Compact read-only status for an open suspension active today."""

    id: UUID
    suspended_from: date
    resume_on: date
    reason_code: str


class ClassStaffAssignmentResponse(BaseModel):
    staff_id: UUID
    full_name: str
    role: Literal["TEACHER", "ASSISTANT"]
    slot_ids: list[UUID] = Field(default_factory=list)


class ClassResponse(ClassBase):
    id: UUID
    is_active: bool
    student_count: int
    education_level: ClassEducationLevel | None = None
    teacher_name: str | None = None
    teacher_names: list[str] = Field(default_factory=list)
    assistant_ids: list[UUID] = Field(default_factory=list)
    assistant_names: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    version: int
    display_name: str
    primary_label: str
    secondary_label: str | None = None
    effective_status: ClassEffectiveStatus
    can_edit_end_date: bool = False
    can_edit_start_date: bool = False
    can_stop: bool = False
    can_edit: bool = False
    can_edit_billing_mode: bool = False
    can_edit_package_duration: bool = False
    can_cancel: bool = False
    can_view_history: bool = True
    next_fee_due_date: date | None = None
    next_fee_due_state: ClassNextFeeDueState = "NONE"
    cancelled_at: datetime | None = None
    stopped_on: date | None = None
    stopped_at: datetime | None = None
    stopped_reason: str | None = None
    unresolved_makeup_count: int = 0
    active_suspension: ClassActiveSuspension | None = None
    previous_class_id: UUID | None = None
    staff_assignments: list[ClassStaffAssignmentResponse] = Field(default_factory=list)
    staffing_status: ClassStaffingStatus = "UNASSIGNED"
    unassigned_slot_ids: list[UUID] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ClassBillingCycleUpdateResponse(BaseModel):
    revision_id: UUID
    previous_weeks: int
    next_weeks: int
    affected_enrollment_count: int = Field(ge=0)
    superseded_fee_count: int = Field(ge=0)
    protected_fee_count: int = Field(ge=0)
    revoked_payment_request_count: int = Field(ge=0)
    pending_review_count: int = Field(ge=0)
    affected_periods: list[str] = Field(default_factory=list)
    class_: ClassResponse


class ClassCopyTemplateResponse(BaseModel):
    name: str
    type: ClassType
    base_fee: int
    billing_cycle_months: int
    billing_cycle_weeks: int | None = None
    identity_scheme: ClassIdentityScheme = "INTAKE"
    class_category: ClassCategory | None = None
    grade_mode: ClassGradeMode | None = None
    program_name: str | None = None
    grade_level: int | None = None
    academic_year_start: int | None = None
    schedule: ClassSchedule | None = None
    teacher_ids: list[UUID] = Field(default_factory=list)
    assistant_ids: list[UUID] = Field(default_factory=list)
    source_class_id: UUID


class ClassContinuationSlotReference(BaseModel):
    """Stable client/server reference for a not-yet-created target slot."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    day: ClassDay
    start: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")

    @model_validator(mode="after")
    def validate_time_range(self) -> "ClassContinuationSlotReference":
        # Reuse the canonical class-slot rules (30-minute boundaries, centre
        # hours and minimum duration) without accepting staff/id fields here.
        ClassScheduleSlot(day=self.day, start=self.start, end=self.end)
        return self


class ClassContinuationStudentCandidate(BaseModel):
    student_id: UUID
    student_code: str | None = None
    full_name: str
    source_enrollment_id: UUID
    custom_fee: int | None = None
    selected_slot_count: int = Field(ge=0)
    selected_slots: list[ClassContinuationSlotReference] = Field(
        default_factory=list,
        max_length=4,
    )


class ClassContinuationPreviewResponse(BaseModel):
    source_class_id: UUID
    source_version: int = Field(ge=1)
    suggested_start_date: date
    suggested_end_date: date | None = None
    template: ClassCopyTemplateResponse
    students: list[ClassContinuationStudentCandidate]


class ClassContinuationStudentSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    student_id: UUID
    source_enrollment_id: UUID | None = None
    selected_slots: list[ClassContinuationSlotReference] | None = Field(
        default=None,
        min_length=1,
        max_length=4,
    )
    custom_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    partial_fee_reviewed: bool = False

    @field_validator("selected_slots")
    @classmethod
    def reject_duplicate_slots(
        cls,
        value: list[ClassContinuationSlotReference] | None,
    ) -> list[ClassContinuationSlotReference] | None:
        if value is None:
            return None
        keys = [(item.day, item.start, item.end) for item in value]
        if len(keys) != len(set(keys)):
            raise ValueError("Danh sách buổi học không được trùng lặp")
        return value


class ClassContinuationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    expected_source_version: int = Field(ge=1)
    class_data: ClassCreate
    students: list[ClassContinuationStudentSelection] = Field(
        default_factory=list,
        max_length=500,
    )
    preserve_custom_fees: bool = True
    preserve_slot_selections: bool = True

    @field_validator("students")
    @classmethod
    def reject_duplicate_students(
        cls,
        value: list[ClassContinuationStudentSelection],
    ) -> list[ClassContinuationStudentSelection]:
        student_ids = [item.student_id for item in value]
        if len(student_ids) != len(set(student_ids)):
            raise ValueError("Danh sách lớp kế tiếp không được trùng học viên")
        source_ids = [
            item.source_enrollment_id
            for item in value
            if item.source_enrollment_id is not None
        ]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("Một ghi danh cũ không thể được sử dụng nhiều lần")
        return value


class ClassContinuationCreateResponse(BaseModel):
    created_class: ClassResponse
    enrolled_student_count: int = Field(ge=0)
