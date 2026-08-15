from datetime import date, datetime
import re
from typing import Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.core.contact import validate_complete_contact_pair
from app.core.phone import is_valid_vietnam_mobile_phone, normalize_vietnam_phone

StaffType = Literal["TEACHER", "ASSISTANT"]


class StaffCompensationRateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rate_amount: int = Field(gt=0, le=999_999_999)
    effective_from: date
    effective_to: date | None = None
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_interval(self) -> "StaffCompensationRateCreate":
        if self.effective_to is not None and self.effective_to <= self.effective_from:
            raise ValueError("Ngày kết thúc hiệu lực phải sau ngày bắt đầu")
        return self


class StaffCompensationRateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    rate_amount: int
    effective_from: date
    effective_to: date | None
    version: int


class StaffPayrollSettlementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    request_id: UUID
    method: Literal["bank_transfer", "cash"]
    reference: str | None = Field(default=None, max_length=120)
    reason: str | None = Field(default=None, max_length=500)


class StaffPayrollSettlementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    total_amount: int
    cutoff_at: datetime
    method: str
    reference: str | None
    created_at: datetime
    reversed_at: datetime | None = None


class StaffPayrollSettlementReversalCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    request_id: UUID
    reason: str = Field(min_length=1, max_length=500)


class StaffPayrollSettlementReversalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    settlement_id: UUID
    staff_id: UUID
    request_id: UUID
    reason: str
    created_at: datetime


class StaffPayrollSummaryResponse(BaseModel):
    staff_id: UUID
    balance: int
    rates: list[StaffCompensationRateResponse]
    settlements: list[StaffPayrollSettlementResponse]


class StaffBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str = Field(min_length=1, max_length=255)
    staff_type: StaffType
    zalo_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=32)
    is_active: bool = True

    @field_validator("zalo_name")
    @classmethod
    def normalize_zalo_name(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def validate_contact_pair(self) -> "StaffBase":
        validate_complete_contact_pair(
            zalo_name=self.zalo_name,
            phone=self.phone,
            owner="nhân sự",
        )
        return self


class StaffCreate(StaffBase):
    zalo_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=1, max_length=32)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        return _normalize_and_validate_phone(value)


class StaffUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    staff_type: StaffType | None = None
    zalo_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=32)
    is_active: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_null_for_required_columns(cls, value: object) -> object:
        if isinstance(value, dict):
            required_columns = {"full_name", "staff_type", "is_active"}
            null_fields = sorted(
                field
                for field in required_columns
                if field in value and value[field] is None
            )
            if null_fields:
                raise ValueError(f"Không được để trống: {', '.join(null_fields)}")
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        return _normalize_and_validate_phone(value)

    @field_validator("zalo_name")
    @classmethod
    def normalize_zalo_name(cls, value: str | None) -> str | None:
        return value or None


class StaffClassResponse(BaseModel):
    id: UUID
    name: str
    is_active: bool


class StaffResponse(StaffBase):
    id: UUID
    assigned_classes: list[StaffClassResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TeacherOptionResponse(BaseModel):
    id: UUID
    full_name: str
    staff_type: Literal["TEACHER", "ASSISTANT"]


def _normalize_and_validate_phone(value: str | None) -> str | None:
    if (
        value is not None
        and value.strip()
        and not re.fullmatch(
            r"[0-9+().\s-]+",
            value,
        )
    ):
        raise ValueError("SĐT nhân sự chứa ký tự không hợp lệ")
    normalized = normalize_vietnam_phone(value)
    if normalized is None:
        return None
    if not is_valid_vietnam_mobile_phone(normalized):
        raise ValueError("SĐT nhân sự phải là số di động Việt Nam hợp lệ")
    return normalized
