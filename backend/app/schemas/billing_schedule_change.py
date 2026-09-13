from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.billing_change_plan import BillingChangePlan, Interval


class BillingSchedulePreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    anchor_date: date
    expected_version: int = Field(ge=0)
    strategy: Literal[
        "KEEP_CURRENT",
        "REPLACE_CURRENT",
        "FROM_CYCLE",
        "CONTINUE_OLD_UNTIL_NEW",
    ]
    first_cycle: int | None = Field(default=None, ge=0, le=20000)
    apply_from_date: date | None = None
    replace_future_waivers: bool = False
    historical_cycles: list[int] = Field(default_factory=list, max_length=120)
    gap_policy: Literal["WAIVE"] = "WAIVE"
    custom_transition_amount: int | None = Field(default=None, ge=0, le=100_000_000)
    expected_pending_review_id: UUID | None = None
    reason: str = Field(default="", max_length=500)
    expected_context_token: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @field_validator("reason", mode="before")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        return " ".join(value.replace("\x00", "").split())

    @model_validator(mode="after")
    def check_cycle_selection(self):
        if self.first_cycle is not None and self.apply_from_date is not None:
            raise ValueError(
                "Chỉ chọn kỳ gợi ý hoặc ngày áp dụng khác, không chọn đồng thời"
            )
        if self.custom_transition_amount is not None:
            raise ValueError(
                "Luồng đổi mốc hiện tại miễn thu khoảng chuyển tiếp, không nhận số tiền riêng"
            )
        if (
            self.strategy == "FROM_CYCLE"
            and self.first_cycle is None
            and self.apply_from_date is None
        ):
            raise ValueError("Chỉ nhập kỳ bắt đầu khi chọn phương án chọn kỳ cụ thể")
        if len(set(self.historical_cycles)) != len(self.historical_cycles) or any(
            c < 0 for c in self.historical_cycles
        ):
            raise ValueError("Danh sách kỳ truy thu không hợp lệ")
        return self


class BillingScheduleApplyRequest(BillingSchedulePreviewRequest):
    reason: str = Field(min_length=3, max_length=500)
    request_id: UUID
    expected_preview_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


class ReplacedFeePreview(BaseModel):
    id: str
    coverage: Interval | None
    amount: int


class PendingBillingReview(BaseModel):
    id: UUID
    change_kind: str
    reason: str
    created_at: datetime
    anchor_date: date
    fees: list[ReplacedFeePreview] = Field(default_factory=list)


class BillingSchedulePreviewResponse(BaseModel):
    can_apply: bool
    preview_fingerprint: str
    current_anchor_date: date
    plan: BillingChangePlan
    replaced_fees: list[ReplacedFeePreview] = Field(default_factory=list)
    pending_review: PendingBillingReview | None = None


class HistoricalCycleItem(BaseModel):
    cycle_no: int
    coverage_start: date
    coverage_end: date
    base_due_date: date
    amount: int
    label: str


class CandidateCycleChoice(BaseModel):
    cycle_no: int
    due_date: date
    coverage_start: date
    coverage_end: date
    label: str
    description: str | None = None
    is_default: bool = False


class BillingScheduleOptionItem(BaseModel):
    id: str
    strategy: Literal[
        "KEEP_CURRENT",
        "REPLACE_CURRENT",
        "FROM_CYCLE",
        "CONTINUE_OLD_UNTIL_NEW",
        "UNCHANGED",
    ]
    label: str
    description: str
    is_recommended: bool = False
    is_allowed: bool = True
    disabled_reason: str | None = None
    requires_gap_policy: bool = False
    requires_historical_selection: bool = False
    suggested_first_cycle: int | None = None
    available_historical_cycles: list[HistoricalCycleItem] = Field(default_factory=list)
    has_more_historical_cycles: bool = False
    total_historical_cycles_count: int = 0
    historical_offset: int = 0
    historical_limit: int = 12
    next_historical_offset: int | None = None
    candidate_cycles: list[CandidateCycleChoice] = Field(default_factory=list)
    estimated_transition_amount: int | None = None
    gap_days: int | None = None
    gap_start: date | None = None
    gap_end: date | None = None
    actual_cycle_end: date | None = None
    new_due_date: date | None = None
    old_due_date: date | None = None
    next_due_date: date | None = None
    is_current_paid: bool = False


class DateClassification(BaseModel):
    time_direction: Literal["PAST", "TODAY", "FUTURE"]
    distance: Literal["NEAR", "FAR", "EXACT", "UNCHANGED"]
    anchor_relative: Literal["EARLIER", "LATER", "UNCHANGED"]
    case_code: Literal[
        "UNCHANGED",
        "UNSTARTED",
        "ACTIVE_NO_FEES",
        "NEAR_PAST",
        "FAR_PAST",
        "TODAY",
        "NEAR_FUTURE",
        "FAR_FUTURE",
        "BLOCKED",
    ]
    summary: str


class CycleBoundaryInfo(BaseModel):
    current_cycle_no: int
    current_cycle_start: date
    current_cycle_end: date
    prev_cycle_start: date | None = None
    prev_cycle_end: date | None = None
    next_cycle_start: date | None = None
    next_cycle_end: date | None = None
    billing_type: str
    cycle_weeks: int | None = None


class FinancialStateInfo(BaseModel):
    protected_through: date | None = None
    has_protected_fees: bool = False
    protected_count: int = 0
    mutable_count: int = 0
    unpaid_notified_count: int = 0
    active_fees_count: int = 0


class BillingScheduleOptionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    anchor_date: date
    expected_version: int = Field(ge=0)
    replace_future_waivers: bool = False
    historical_offset: int = Field(default=0, ge=0)
    historical_limit: int = Field(default=12, ge=1, le=100)
    historical_from_date: date | None = None
    historical_to_date: date | None = None


class BillingScheduleOptionsResponse(BaseModel):
    replaceable_waived_intervals: list[Interval] = Field(default_factory=list)
    pending_review: PendingBillingReview | None = None
    business_date: date
    classification: DateClassification
    current_anchor_date: date | None
    new_anchor_date: date
    expected_version: int
    cycle_info: CycleBoundaryInfo | None = None
    financial_state: FinancialStateInfo
    options: list[BillingScheduleOptionItem]
    recommended_option_id: str | None = None
    is_blocked: bool = False
    blocked_reason: str | None = None
    context_token: str


class FeeDueDatePreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    due_date: date
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason", mode="before")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        return " ".join(value.replace("\x00", "").split())


class FeeDueDateApplyRequest(FeeDueDatePreviewRequest):
    request_id: UUID
    expected_preview_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
