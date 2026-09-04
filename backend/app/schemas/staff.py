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
    assignment_role: StaffType | None = None
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
    assignment_role: StaffType | None = None
    effective_from: date
    effective_to: date | None
    version: int


class StaffPayrollSettlementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    request_id: UUID
    method: Literal["bank_transfer", "cash"]
    settlement_account_id: UUID | None = None
    reference: str | None = Field(default=None, max_length=120)
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_settlement_account(self) -> "StaffPayrollSettlementCreate":
        if self.method == "bank_transfer" and self.settlement_account_id is None:
            raise ValueError("Hãy chọn tài khoản ngân hàng dùng để tất toán")
        if self.method == "cash" and self.settlement_account_id is not None:
            raise ValueError("Tất toán tiền mặt không cần tài khoản ngân hàng")
        return self


class StaffPayrollSettlementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    total_amount: int
    cutoff_at: datetime
    method: str
    settlement_account_id: UUID | None
    settlement_bank_code: str | None
    settlement_bank_name: str | None
    settlement_account_number: str | None
    settlement_account_name: str | None
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


class StaffAttendanceHistoryItem(BaseModel):
    attendance_id: UUID
    class_name: str | None = None
    role: str
    occurrence_start_at: datetime
    occurrence_end_at: datetime
    kind: str
    checkin_at: datetime
    rate_amount: int
    rate_version: int
    reversed_at: datetime | None = None
    reversal_reason: str | None = None


class StaffAttendanceHistoryResponse(BaseModel):
    staff_id: UUID
    items: list[StaffAttendanceHistoryItem]


class StaffBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str = Field(min_length=1, max_length=255)
    # Deprecated compatibility field. Roles are selected per class.
    staff_type: StaffType | None = None
    zalo_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=320)
    checkin_window_after_hours: int = Field(default=24, ge=1, le=720)
    is_active: bool = True

    @field_validator("zalo_name")
    @classmethod
    def normalize_zalo_name(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if not value:
            return None
        return _normalize_and_validate_email(value)

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
    email: str | None = Field(default=None, max_length=320)
    checkin_window_after_hours: int | None = Field(default=None, ge=1, le=720)
    is_active: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_null_for_required_columns(cls, value: object) -> object:
        if isinstance(value, dict):
            required_columns = {"full_name", "is_active"}
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

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if not value:
            return None
        return _normalize_and_validate_email(value)


class StaffClassResponse(BaseModel):
    id: UUID
    name: str
    is_active: bool
    role: StaffType | None = None


class StaffResponse(StaffBase):
    id: UUID
    current_rate: int | None = None
    attendance_account_status: Literal[
        "connected", "disabled", "invited", "expired", "not_connected"
    ] = "not_connected"
    assigned_classes: list[StaffClassResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TeacherOptionResponse(BaseModel):
    id: UUID
    full_name: str
    staff_type: Literal["TEACHER", "ASSISTANT"] | None = None
    email: str | None = None


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


_EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


def _normalize_and_validate_email(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    if len(normalized) > 320:
        raise ValueError("Email nhân sự không được vượt quá 320 ký tự")
    if not _EMAIL_PATTERN.fullmatch(normalized):
        raise ValueError("Email nhân sự không hợp lệ")
    return normalized
