from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ClassType = Literal["MONTHLY", "COURSE"]
ClassDay = Literal[
    "Thứ 2",
    "Thứ 3",
    "Thứ 4",
    "Thứ 5",
    "Thứ 6",
    "Thứ 7",
    "Chủ Nhật",
]
COURSE_BILLING_MONTHS = {2, 3, 6, 12}


class ClassScheduleSlot(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    day: ClassDay
    start: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")

    @model_validator(mode="after")
    def validate_time_range(self) -> "ClassScheduleSlot":
        if self.start >= self.end:
            raise ValueError("Giờ kết thúc phải sau giờ bắt đầu")
        return self


class ClassSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    text: str = Field(default="", max_length=1000)
    slots: list[ClassScheduleSlot] = Field(default_factory=list, max_length=28)

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
    start_date: date | None,
    end_date: date | None,
) -> None:
    if class_type == "MONTHLY" and billing_cycle_months != 1:
        raise ValueError("Lớp theo tháng phải có chu kỳ thu một tháng")
    if class_type == "COURSE" and billing_cycle_months not in COURSE_BILLING_MONTHS:
        raise ValueError("Thời lượng gói chỉ hỗ trợ 8, 12, 24 hoặc 48 tuần")
    if start_date is not None and end_date is not None and end_date < start_date:
        raise ValueError("Ngày kết thúc phải bằng hoặc sau ngày bắt đầu")


class ClassBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120)
    type: ClassType
    base_fee: int = Field(ge=0, le=999_999_999_999)
    billing_cycle_months: int = Field(default=1, ge=1, le=24)
    start_date: date | None = None
    end_date: date | None = None
    schedule: ClassSchedule | None = None
    teacher_id: UUID | None = None
    teacher_ids: list[UUID] = Field(default_factory=list, max_length=10)

    @field_validator("teacher_ids")
    @classmethod
    def deduplicate_teacher_ids(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))


class ClassCreate(ClassBase):
    @model_validator(mode="after")
    def validate_create_configuration(self) -> "ClassCreate":
        if not self.teacher_ids and self.teacher_id is None:
            raise ValueError("Vui lòng chọn ít nhất một giáo viên")
        if self.schedule is None or (
            not self.schedule.slots and not self.schedule.text.strip()
        ):
            raise ValueError("Vui lòng chọn lịch học")
        validate_class_configuration(
            class_type=self.type,
            billing_cycle_months=self.billing_cycle_months,
            start_date=self.start_date,
            end_date=self.end_date,
        )
        return self


class ClassUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    type: ClassType | None = None
    base_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    billing_cycle_months: int | None = Field(default=None, ge=1, le=24)
    start_date: date | None = None
    end_date: date | None = None
    schedule: ClassSchedule | None = None
    teacher_id: UUID | None = None
    teacher_ids: list[UUID] | None = Field(default=None, max_length=10)
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

    @model_validator(mode="after")
    def validate_explicit_teacher_selection(self) -> "ClassUpdate":
        if "teacher_ids" in self.model_fields_set and not self.teacher_ids:
            if "teacher_id" not in self.model_fields_set or self.teacher_id is None:
                raise ValueError("Vui lòng chọn ít nhất một giáo viên")
        return self


class ClassResponse(ClassBase):
    id: UUID
    is_active: bool
    student_count: int
    teacher_name: str | None = None
    teacher_names: list[str] = Field(default_factory=list)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
