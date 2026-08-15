from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


FeeOperationAction = Literal[
    "notify",
    "unnotify",
    "payment",
    "payment_reversal",
    "refund",
    "refund_reversal",
    "sync",
    "template_update",
]

FeePaidPaymentMethod = Literal["bank_transfer", "cash"]
FeePaidRefundState = Literal["NONE", "PARTIAL", "FULL", "REVERSED"]
FeePaidTimelineEvent = Literal[
    "payment",
    "refund",
    "refund_reversal",
    "payment_reversal",
]


class FeeOperationItemResponse(BaseModel):
    id: UUID
    ordinal: int
    fee_record_id: UUID | None
    enrollment_id: UUID | None
    student_id: UUID | None
    student_name: str | None
    class_id: UUID | None
    class_name: str | None
    period: str | None
    state_before: str | None
    state_after: str | None
    amount_before: int | None
    amount_after: int | None
    amount_delta: int
    due_date_before: date | None
    due_date_after: date | None
    payment_method: str | None
    notification_channel: str | None
    message: str | None
    reason: str | None
    payment_id: UUID | None
    related_payment_id: UUID | None


class FeeOperationResponse(BaseModel):
    id: UUID
    sequence_no: int
    action: FeeOperationAction
    origin: str
    request_id: UUID | None
    period: str | None
    business_date: date
    occurred_at: datetime
    actor_user_id: UUID | None
    actor_name: str | None
    actor_username: str | None
    actor_role: str | None
    item_count: int
    total_amount: int
    items: list[FeeOperationItemResponse]


class FeeOperationSummaryResponse(BaseModel):
    operation_count: int = Field(ge=0)
    affected_item_count: int = Field(ge=0)
    financial_net_change: int


class FeeOperationListResponse(BaseModel):
    operations: list[FeeOperationResponse]
    next_cursor: str | None
    summary: FeeOperationSummaryResponse
    history_complete_from: datetime | None


class FeePaidReceiptSummaryResponse(BaseModel):
    """One effective student receipt, grouped across all classes paid together."""

    receipt_id: str
    payment_operation_id: UUID
    student_id: UUID | None
    student_name: str
    period: str | None
    paid_date: date
    paid_at: datetime
    payment_method: FeePaidPaymentMethod
    gross_amount: int = Field(ge=0)
    refunded_amount: int = Field(ge=0)
    net_amount: int = Field(ge=0)
    refund_state: FeePaidRefundState
    class_count: int = Field(ge=1)
    class_names: list[str]
    actor_name: str | None
    actor_username: str | None
    actor_role: str | None


class FeePaidReportSummaryResponse(BaseModel):
    gross_amount: int = Field(ge=0)
    refunded_amount: int = Field(ge=0)
    net_amount: int = Field(ge=0)
    receipt_count: int = Field(ge=0)
    student_count: int = Field(ge=0)
    bank_transfer_net_amount: int = Field(ge=0)
    cash_net_amount: int = Field(ge=0)


class FeePaidReceiptListResponse(BaseModel):
    receipts: list[FeePaidReceiptSummaryResponse]
    next_cursor: str | None
    summary: FeePaidReportSummaryResponse


class FeePaidAllocationResponse(BaseModel):
    fee_record_id: UUID | None
    enrollment_id: UUID | None
    class_id: UUID | None
    class_name: str
    period: str
    gross_amount: int = Field(ge=0)
    refunded_amount: int = Field(ge=0)
    net_amount: int = Field(ge=0)


class FeePaidTimelineEntryResponse(BaseModel):
    id: UUID
    event: FeePaidTimelineEvent
    business_date: date
    occurred_at: datetime
    amount_delta: int
    payment_method: FeePaidPaymentMethod
    actor_name: str | None
    actor_username: str | None
    actor_role: str | None
    reason: str | None


class FeePaidReceiptDetailResponse(FeePaidReceiptSummaryResponse):
    allocations: list[FeePaidAllocationResponse]
    timeline: list[FeePaidTimelineEntryResponse]
