from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.business_time import business_today
from app.core.contact import validate_complete_contact_pair
from app.core.phone import is_valid_vietnam_mobile_phone, normalize_vietnam_phone
from app.schemas.enrollment import MAX_SELECTED_SLOTS

StudentStatus = Literal["active", "inactive", "archived"]
StudentListState = Literal["UNASSIGNED", "CURRENT", "STOPPED"]
StudentIdentityMatchStrength = Literal["strong", "possible"]
StudentHiddenField = Literal[
    "birth_date",
    "school",
    "enrollment_date",
    "custom_fee",
    "student_contact",
    "parent_contact",
    "notes",
]


def _deduplicate_hidden_fields(
    value: list[StudentHiddenField],
) -> list[StudentHiddenField]:
    return list(dict.fromkeys(value))


def validate_complete_contact_pairs(
    *,
    student_zalo: str | None,
    student_phone: str | None,
    parent_zalo: str | None,
    parent_phone: str | None,
) -> None:
    validate_complete_contact_pair(
        zalo_name=student_zalo,
        phone=student_phone,
        owner="học viên",
    )
    validate_complete_contact_pair(
        zalo_name=parent_zalo,
        phone=parent_phone,
        owner="phụ huynh",
    )


class StudentCreate(BaseModel):
    # R6: write payloads forbid unknown fields — a client-supplied
    # `student_code` must fail with 422, never be silently ignored. Profile
    # creation is class-optional; enrollment is a separate command.
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    full_name: str = Field(min_length=1, max_length=120)
    class_id: UUID | None = None
    # None deliberately inherits the class fee; this field is an override.
    custom_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    enrollment_date: date | None = None
    selected_slot_ids: list[UUID] | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_SELECTED_SLOTS,
    )
    birth_date: date
    school: str = Field(min_length=1, max_length=160)
    parent_name: str | None = Field(default=None, max_length=120)
    parent_phone: str = Field(min_length=1, max_length=32)
    parent_zalo: str = Field(min_length=1, max_length=100)
    student_zalo: str | None = Field(default=None, max_length=100)
    student_phone: str | None = Field(default=None, max_length=32)
    notes: str | None = Field(default=None, max_length=1000)
    hidden_fields: list[StudentHiddenField] = Field(default_factory=list, max_length=7)

    @field_validator("hidden_fields")
    @classmethod
    def normalize_hidden_fields(
        cls,
        value: list[StudentHiddenField],
    ) -> list[StudentHiddenField]:
        return _deduplicate_hidden_fields(value)

    @field_validator("selected_slot_ids")
    @classmethod
    def deduplicate_selected_slots(
        cls,
        value: list[UUID] | None,
    ) -> list[UUID] | None:
        if value is not None and len(value) != len(set(value)):
            raise ValueError("Danh sách buổi học không được trùng lặp")
        return value

    @field_validator("birth_date")
    @classmethod
    def validate_birth_date(cls, value: date | None) -> date | None:
        if value is not None and (value < date(1900, 1, 1) or value > business_today()):
            raise ValueError("Ngày sinh không hợp lệ")
        return value

    @field_validator("parent_phone")
    @classmethod
    def validate_parent_phone(cls, value: str | None) -> str | None:
        normalized = normalize_vietnam_phone(value)
        if normalized is None:
            return None

        if not is_valid_vietnam_mobile_phone(normalized):
            raise ValueError("SĐT phụ huynh phải là số di động Việt Nam hợp lệ")

        return normalized

    @field_validator("student_phone")
    @classmethod
    def validate_student_phone(cls, value: str | None) -> str | None:
        normalized = normalize_vietnam_phone(value)
        if normalized is None:
            return None

        if not is_valid_vietnam_mobile_phone(normalized):
            raise ValueError("SĐT học sinh phải là số di động Việt Nam hợp lệ")

        return normalized

    @model_validator(mode="after")
    def validate_contact_pairs(self) -> "StudentCreate":
        validate_complete_contact_pairs(
            student_zalo=self.student_zalo,
            student_phone=self.student_phone,
            parent_zalo=self.parent_zalo,
            parent_phone=self.parent_phone,
        )
        return self


class StudentDuplicateResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["create_new"]
    candidate_ids: list[UUID] = Field(min_length=1, max_length=5)

    @field_validator("candidate_ids")
    @classmethod
    def deduplicate_candidate_ids(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("Danh sách hồ sơ đã kiểm tra không được trùng lặp")
        return value


class StudentCreateCommand(StudentCreate):
    duplicate_resolution: StudentDuplicateResolution | None = None


class StudentReactivationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    student: StudentCreate
    expected_updated_at: datetime


class StudentPreviousClass(BaseModel):
    name: str
    enrollment_date: date | None


class StudentIdentityCandidate(BaseModel):
    id: UUID
    student_code: str
    status: StudentStatus
    list_state: StudentListState
    full_name: str
    birth_date: date | None
    school: str | None
    masked_parent_phone: str | None
    masked_student_phone: str | None
    previous_classes: list[StudentPreviousClass]
    updated_at: datetime
    match_strength: StudentIdentityMatchStrength
    match_reason: str
    already_in_target_class: bool


class StudentIdentityConflict(BaseModel):
    code: Literal[
        "STUDENT_IDENTITY_CONFLICT",
        "STUDENT_IDENTITY_CONFLICT_CHANGED",
    ] = "STUDENT_IDENTITY_CONFLICT"
    message: str = "Có thể học viên này đã có hồ sơ trong hệ thống"
    target_class_id: UUID | None = None
    candidates: list[StudentIdentityCandidate] = Field(min_length=1, max_length=5)


class StudentUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    birth_date: date | None = None
    school: str | None = Field(default=None, max_length=160)
    parent_name: str | None = Field(default=None, max_length=120)
    parent_phone: str | None = Field(default=None, max_length=32)
    parent_zalo: str | None = Field(default=None, max_length=100)
    student_zalo: str | None = Field(default=None, max_length=100)
    student_phone: str | None = Field(default=None, max_length=32)
    notes: str | None = Field(default=None, max_length=1000)
    hidden_fields: list[StudentHiddenField] | None = Field(default=None, max_length=7)

    @field_validator("hidden_fields")
    @classmethod
    def normalize_hidden_fields(
        cls,
        value: list[StudentHiddenField] | None,
    ) -> list[StudentHiddenField] | None:
        if value is None:
            raise ValueError("Danh sách trường ẩn phải là một mảng")
        return _deduplicate_hidden_fields(value)

    @field_validator("birth_date")
    @classmethod
    def validate_birth_date(cls, value: date | None) -> date | None:
        if value is not None and (value < date(1900, 1, 1) or value > business_today()):
            raise ValueError("Ngày sinh không hợp lệ")
        return value

    @field_validator("parent_phone")
    @classmethod
    def validate_parent_phone(cls, value: str | None) -> str | None:
        normalized = normalize_vietnam_phone(value)
        if normalized is None:
            return None

        if not is_valid_vietnam_mobile_phone(normalized):
            raise ValueError("SĐT phụ huynh phải là số di động Việt Nam hợp lệ")

        return normalized

    @field_validator("student_phone")
    @classmethod
    def validate_student_phone(cls, value: str | None) -> str | None:
        normalized = normalize_vietnam_phone(value)
        if normalized is None:
            return None

        if not is_valid_vietnam_mobile_phone(normalized):
            raise ValueError("SĐT học sinh phải là số di động Việt Nam hợp lệ")

        return normalized

    @model_validator(mode="after")
    def validate_contact_pairs_when_both_fields_are_supplied(self) -> "StudentUpdate":
        supplied_fields = self.model_fields_set
        student_pair_supplied = {"student_zalo", "student_phone"}.issubset(
            supplied_fields
        )
        parent_pair_supplied = {"parent_zalo", "parent_phone"}.issubset(supplied_fields)

        if student_pair_supplied or parent_pair_supplied:
            validate_complete_contact_pairs(
                student_zalo=self.student_zalo if student_pair_supplied else None,
                student_phone=self.student_phone if student_pair_supplied else None,
                parent_zalo=self.parent_zalo if parent_pair_supplied else None,
                parent_phone=self.parent_phone if parent_pair_supplied else None,
            )
        return self


class StudentClassInfo(BaseModel):
    id: UUID
    name: str


class StudentEnrollmentInfo(BaseModel):
    id: UUID
    class_id: UUID
    class_name: str
    class_category: Literal["GENERAL", "SPECIALIZED", "IELTS", "CUSTOM"] | None = None
    class_grade_mode: Literal["GRADE", "NONE"] | None = None
    class_grade_level: int | None = None
    class_start_date: date | None = None
    class_end_date: date | None = None
    custom_fee: int | None
    effective_fee: int
    enrollment_date: date | None
    status: Literal["active", "dropped", "completed", "cancelled"]
    selected_slot_ids: list[UUID] = Field(default_factory=list)


class StudentLastEnrollmentInfo(BaseModel):
    class_id: UUID
    class_name: str
    status: Literal["active", "dropped", "completed", "cancelled"]
    enrollment_date: date | None
    ended_at: datetime | None
    end_reason: str | None


class StudentResponse(BaseModel):
    id: UUID
    student_code: str
    full_name: str
    birth_date: date | None
    school: str | None
    parent_name: str | None
    parent_phone: str | None
    parent_zalo: str | None
    student_zalo: str | None
    student_phone: str | None
    notes: str | None
    hidden_fields: list[StudentHiddenField]
    status: StudentStatus
    list_state: StudentListState = "UNASSIGNED"
    archived_at: datetime | None = None
    archived_reason: str | None = None
    classes: list[StudentClassInfo]
    active_enrollments: list[StudentEnrollmentInfo]
    last_enrollment: StudentLastEnrollmentInfo | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class StudentListPageResponse(BaseModel):
    items: list[StudentResponse]
    next_cursor: UUID | None = None
    has_more: bool = False


class StudentScopeSummary(BaseModel):
    unassigned: int = Field(ge=0)
    current: int = Field(ge=0)
    stopped: int = Field(ge=0)


class StudentArchiveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=500)


class StudentRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=500)


class StudentEnrollmentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enrollment_id: UUID
    custom_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    enrollment_date: date | None = None
    # ``None`` means the caller is not changing the schedule.  An explicit
    # list must contain at least one slot; an empty list must never be
    # interpreted as "restore every session".
    selected_slot_ids: list[UUID] | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_SELECTED_SLOTS,
    )


class StudentEnrollmentTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    class_id: UUID
    custom_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    enrollment_date: date | None = None
    # New memberships also require an explicit non-empty selection whenever
    # the field is supplied.  Omitting it keeps the legacy/default behaviour.
    selected_slot_ids: list[UUID] | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_SELECTED_SLOTS,
    )


class StudentMembershipCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    expected_updated_at: datetime
    profile: StudentUpdate
    enrollment_updates: list[StudentEnrollmentPatch] = Field(
        default_factory=list, max_length=20
    )
    targets: list[StudentEnrollmentTarget] = Field(default_factory=list, max_length=20)
    mode: Literal["supplement", "transfer"] = "supplement"
    source_enrollment_id: UUID | None = None

    @model_validator(mode="after")
    def validate_transfer_source(self) -> "StudentMembershipCommand":
        if self.mode == "transfer" and self.source_enrollment_id is None:
            raise ValueError("Chuyển lớp phải chỉ định lớp nguồn")
        return self
