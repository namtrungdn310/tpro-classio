from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.business_time import business_today
from app.core.contact import validate_complete_contact_pair
from app.core.phone import is_valid_vietnam_mobile_phone, normalize_vietnam_phone

StudentStatus = Literal["active", "inactive"]
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
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str = Field(min_length=1, max_length=120)
    class_id: UUID
    # None deliberately inherits the class fee; this field is an override.
    custom_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    enrollment_date: date
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


class StudentUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

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
    status: StudentStatus | None = None

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
    custom_fee: int | None
    effective_fee: int
    enrollment_date: date | None
    status: Literal["active", "dropped"]


class StudentResponse(BaseModel):
    id: UUID
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
    classes: list[StudentClassInfo]
    active_enrollments: list[StudentEnrollmentInfo]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ContactSuggestionResponse(BaseModel):
    phone: str
    zalo_name: str
