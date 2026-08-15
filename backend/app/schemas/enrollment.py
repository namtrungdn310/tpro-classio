from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

EnrollmentStatus = Literal["active", "dropped", "completed", "cancelled"]

MAX_SELECTED_SLOTS = 4


class EnrollmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    student_id: UUID
    class_id: UUID
    custom_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    enrollment_date: date | None = None
    # R6: selected recurring sessions (stable slot UUIDs); khi bỏ trống,
    # server mặc định chọn toàn bộ slot đang hiệu lực của lớp.
    selected_slot_ids: list[UUID] | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_SELECTED_SLOTS,
    )

    @field_validator("selected_slot_ids")
    @classmethod
    def deduplicate_selected_slots(cls, value: list[UUID] | None) -> list[UUID] | None:
        if value is None:
            return None
        if len(value) != len(set(value)):
            raise ValueError("Danh sách buổi học không được trùng lặp")
        return value


class EnrollmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    custom_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    enrollment_date: date | None = None
    selected_slot_ids: list[UUID] | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_SELECTED_SLOTS,
    )

    @field_validator("selected_slot_ids")
    @classmethod
    def deduplicate_selected_slots(cls, value: list[UUID] | None) -> list[UUID] | None:
        if value is None:
            return None
        if len(value) != len(set(value)):
            raise ValueError("Danh sách buổi học không được trùng lặp")
        return value


class EnrollmentResponse(BaseModel):
    id: UUID
    student_id: UUID
    class_id: UUID
    custom_fee: int | None
    status: EnrollmentStatus
    enrollment_date: date | None
    selected_slot_ids: list[UUID] = Field(default_factory=list)
    class_name: str
    class_category: Literal["GENERAL", "SPECIALIZED", "IELTS", "CUSTOM"] | None = None
    class_grade_mode: Literal["GRADE", "NONE"] | None = None
    class_grade_level: int | None = None
    class_start_date: date | None = None
    class_end_date: date | None = None
    effective_fee: int
