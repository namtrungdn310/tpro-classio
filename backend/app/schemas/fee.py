from datetime import date, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.fee_messages import (
    normalize_fee_notification_message,
    validate_fee_message_template,
)

FeeStatus = Literal["UNPAID", "PAID"]
FeeNotificationState = Literal["UNNOTIFIED", "NOTIFIED_UNPAID", "PAID"]
FeeQueryState = Literal["UNNOTIFIED", "NOTIFIED_UNPAID", "PAID"]
FeeNotificationChannel = Literal["zalo_manual", "zalo_copy"]
FeePaymentMethod = Literal["bank_transfer", "cash"]
FeeUnpayTargetState = Literal["UNNOTIFIED", "NOTIFIED_UNPAID"]
FeeRefundState = Literal["NONE", "PARTIAL", "FULL"]
FeePaymentEntryType = Literal[
    "payment", "payment_reversal", "refund", "refund_reversal"
]


class FeeRecordResponse(BaseModel):
    id: UUID
    enrollment_id: UUID
    student_id: UUID
    student_name: str
    class_id: UUID
    class_name: str
    class_type: str
    billing_cycle_months: int
    student_phone: str | None
    student_zalo: str | None
    student_contact_hidden: bool
    parent_phone: str | None
    parent_zalo: str | None
    parent_contact_hidden: bool
    period: str
    enrollment_date: date | None
    due_date: date | None
    base_amount: int
    discount_amount: int
    final_amount: int
    status: FeeStatus
    paid_amount: int | None
    paid_date: date | None
    refunded_amount: int
    refundable_amount: int
    net_collected_amount: int
    refund_state: FeeRefundState
    notified_at: datetime | None
    notification_channel: str | None
    notification_message: str | None
    notification_state: FeeNotificationState


class FeeRecordListResponse(BaseModel):
    period: str
    records: list[FeeRecordResponse]


class FeePeriodListResponse(BaseModel):
    periods: list[str]


class FeeMessageTemplatesResponse(BaseModel):
    payment_reminder_template: str
    payment_received_template: str
    version: int = Field(ge=0, le=2_147_483_647)
    updated_at: datetime | None


class FeeMessageTemplatesUpdate(BaseModel):
    payment_reminder_template: str = Field(min_length=20, max_length=1400)
    payment_received_template: str = Field(min_length=20, max_length=1400)
    # The successful UPDATE increments this value inside a PostgreSQL int4.
    version: int = Field(ge=0, le=2_147_483_646)

    @field_validator(
        "payment_reminder_template",
        "payment_received_template",
        mode="before",
    )
    @classmethod
    def normalize_templates(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return value.replace("\r\n", "\n").replace("\r", "\n").strip()

    @model_validator(mode="after")
    def validate_templates(self) -> "FeeMessageTemplatesUpdate":
        self.payment_reminder_template = validate_fee_message_template(
            self.payment_reminder_template,
            allow_legacy_overdue_token=True,
        )
        self.payment_received_template = validate_fee_message_template(
            self.payment_received_template,
            allow_legacy_overdue_token=False,
        )
        return self


class FeeNotifyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    channel: FeeNotificationChannel = "zalo_manual"

    @field_validator("message", mode="before")
    @classmethod
    def normalize_message(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return normalize_fee_notification_message(value)


class FeeBatchRequest(BaseModel):
    record_ids: list[UUID] = Field(min_length=1, max_length=100)
    request_id: UUID = Field(default_factory=uuid4)

    @field_validator("record_ids")
    @classmethod
    def reject_duplicate_record_ids(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("Danh sách học phí không được chứa khoản trùng lặp")
        return value


class FeeBatchNotifyRequest(FeeBatchRequest):
    message: str = Field(min_length=1, max_length=2000)
    channel: FeeNotificationChannel = "zalo_manual"

    @field_validator("message", mode="before")
    @classmethod
    def normalize_message(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return normalize_fee_notification_message(value)


class FeeBatchPayRequest(FeeBatchRequest):
    payment_method: FeePaymentMethod = "bank_transfer"


class FeeBatchUnpayRequest(FeeBatchRequest):
    target_notification_state: FeeUnpayTargetState = "NOTIFIED_UNPAID"


class FeeBatchResponse(BaseModel):
    records: list[FeeRecordResponse]
    deleted_ids: list[UUID] = Field(default_factory=list)


class FeeRefundItem(BaseModel):
    record_id: UUID
    amount: int = Field(gt=0, le=999_999_999_999)


class FeeBatchRefundRequest(BaseModel):
    items: list[FeeRefundItem] = Field(min_length=1, max_length=100)
    reason: str = Field(default="", max_length=500)
    refund_method: FeePaymentMethod = "bank_transfer"
    request_id: UUID

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_reason(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.replace("\x00", "").split())

    @field_validator("items")
    @classmethod
    def reject_duplicate_records(
        cls, value: list[FeeRefundItem]
    ) -> list[FeeRefundItem]:
        record_ids = [item.record_id for item in value]
        if len(record_ids) != len(set(record_ids)):
            raise ValueError(
                "Mỗi khoản học phí chỉ được hoàn một lần trong một thao tác"
            )
        return value


class FeeRefundReceiptItem(BaseModel):
    transaction_id: UUID
    record_id: UUID
    amount: int
    created_at: datetime


class FeeRefundReceiptResponse(BaseModel):
    request_id: UUID
    refund_date: date
    refund_method: FeePaymentMethod
    reason: str
    total_amount: int
    items: list[FeeRefundReceiptItem]


class FeeRefundBatchResponse(FeeBatchResponse):
    receipt: FeeRefundReceiptResponse


class FeeRefundReversalRequest(BaseModel):
    refund_transaction_id: UUID
    reason: str = Field(min_length=3, max_length=500)
    request_id: UUID

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_reason(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.replace("\x00", "").split())


class FeeTransactionResponse(BaseModel):
    id: UUID
    entry_type: FeePaymentEntryType
    amount: int
    transaction_date: date
    payment_method: FeePaymentMethod
    note: str | None
    related_payment_id: UUID | None
    request_id: UUID | None
    created_by: UUID | None
    created_by_name: str | None
    created_at: datetime


class FeeTransactionListResponse(BaseModel):
    fee_record_id: UUID
    transactions: list[FeeTransactionResponse]


class FeeTransactionBatchResponse(BaseModel):
    histories: list[FeeTransactionListResponse]


class FeeRefundReversalResponse(FeeBatchResponse):
    transaction: FeeTransactionResponse
