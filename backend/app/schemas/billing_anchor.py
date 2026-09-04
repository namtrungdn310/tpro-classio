from datetime import date, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


class BillingAnchorChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enrollment_date: date
    reason: str = Field(min_length=3, max_length=500)
    request_id: UUID = Field(default_factory=uuid4)
    expected_version: int | None = Field(default=None, ge=0)

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_reason(cls, value: object) -> object:
        if isinstance(value, str):
            return " ".join(value.replace("\x00", "").split())
        return value


class BillingAnchorImpactResponse(BaseModel):
    enrollment_id: UUID
    previous_date: date
    next_date: date
    next_due_date: date
    coverage_start: date
    coverage_end: date
    superseded_fee_count: int = Field(ge=0)
    protected_fee_count: int = Field(ge=0)
    skipped_cycle_count: int = Field(ge=0)
    review_id: UUID | None = None


class BillingReviewFeeResponse(BaseModel):
    id: UUID
    due_date: date | None
    coverage_start: date | None
    coverage_end: date | None
    amount: int
    status: str
    cancellable: bool
    blocked_reason: str | None = None
    is_final_cycle: bool = False


class BillingReviewResponse(BaseModel):
    id: UUID
    enrollment_id: UUID
    student_id: UUID
    student_name: str
    student_code: str | None = None
    class_id: UUID
    class_name: str
    change_kind: Literal["ENROLLMENT_DATE_CHANGE", "PACKAGE_DURATION_CHANGE"]
    class_billing_cycle_revision_id: UUID | None = None
    previous_date: date | None
    next_date: date
    previous_weeks: int | None = None
    next_weeks: int | None = None
    next_due_date: date
    state: Literal["PENDING", "CONFIRMED", "SUPERSEDED"]
    reason: str
    created_at: datetime
    fees: list[BillingReviewFeeResponse] = Field(default_factory=list)


class BillingReviewListResponse(BaseModel):
    reviews: list[BillingReviewResponse]
    pending_count: int = Field(ge=0)


class BillingReviewResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["CONFIRM", "WAIVE_CHARGE"]
    fee_record_ids: list[UUID] = Field(default_factory=list, max_length=20)
    reason: str | None = Field(default=None, min_length=3, max_length=500)
    request_id: UUID = Field(default_factory=uuid4)

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_resolution_reason(cls, value: object) -> object:
        if isinstance(value, str):
            return " ".join(value.replace("\x00", "").split())
        return value
