from datetime import date, datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field



class BillingDecisionCode(str, Enum):
    KEEP_EXISTING_SCHEDULE = "KEEP_EXISTING_SCHEDULE"
    KEEP_CURRENT_THEN_REANCHOR = "KEEP_CURRENT_THEN_REANCHOR"
    REANCHOR_CURRENT_CYCLE = "REANCHOR_CURRENT_CYCLE"
    REANCHOR_NEXT_BOUNDARY = "REANCHOR_NEXT_BOUNDARY"
    REANCHOR_CUSTOM_BOUNDARY = "REANCHOR_CUSTOM_BOUNDARY"


class BillingCycleOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cycle_no: int
    due_date: date
    coverage_start: date
    coverage_end: date
    amount: int
    label: str | None = None


class BillingDecisionOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision_code: BillingDecisionCode
    label: str
    description: str
    first_anchor_cycle_no: int
    due_date: date
    coverage_start: date
    coverage_end: date
    amount: int
    kept_fee_count: int = 0
    superseded_fee_count: int = 0
    skipped_cycle_count: int = 0
    protected_fee_count: int = 0
    revoked_payment_request_count: int = 0
    review_required: bool = False
    allowed: bool = True
    recommended: bool = False
    disabled_reason: str | None = None
    available_cycles: list[BillingCycleOption] = Field(default_factory=list)


class EnrollmentBillingImpact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enrollment_id: UUID
    student_id: UUID
    student_name: str
    class_id: UUID
    class_name: str
    old_enrollment_date: date
    new_enrollment_date: date
    must_change: bool = False
    decisions: list[BillingDecisionOption]
    recommended_decision: BillingDecisionCode
    protected_fee_count: int = 0
    mutable_fee_count: int = 0


class ClassStartDatePreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_date: date
    expected_version: int = Field(ge=1)
    default_decision: BillingDecisionCode | None = None
    enrollment_decisions: dict[UUID, BillingDecisionCode] | None = None
    class_patch: dict[str, object] | None = None


class ClassStartDatePreviewResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    can_apply: bool
    blocking_reason: str | None = None
    earliest_historical_activity_date: date | None = None
    previous_start_date: date
    next_start_date: date
    moves_earlier: bool
    version: int
    affected_enrollment_count: int
    blocking_history_count: int = 0
    protected_fee_record_count: int = 0
    affected_enrollments: list[EnrollmentBillingImpact] = Field(default_factory=list)
    preview_fingerprint: str
    expires_at: datetime


class ClassEnrollmentOverrideInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enrollment_id: UUID
    new_enrollment_date: date | None = None
    decision_code: BillingDecisionCode
    selected_historical_cycles: list[int] | None = None


class ClassStartDateApplyCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    start_date: date
    reason: str = Field(min_length=3, max_length=500)
    expected_version: int = Field(ge=1)
    expected_preview_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    default_decision: BillingDecisionCode = BillingDecisionCode.REANCHOR_NEXT_BOUNDARY
    enrollment_overrides: list[ClassEnrollmentOverrideInput] = Field(default_factory=list)
    class_patch: dict[str, object] | None = None
