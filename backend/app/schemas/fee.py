from datetime import date, datetime
from typing import Any, Literal
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
PaymentRequestShareChannel = Literal[
    "zalo_manual", "copy_message", "download_qr", "share_link", "other"
]
FeeUnpayTargetState = Literal["UNNOTIFIED", "NOTIFIED_UNPAID"]
FeeRefundState = Literal["NONE", "PARTIAL", "FULL"]
FeePaymentEntryType = Literal[
    "payment", "payment_reversal", "refund", "refund_reversal"
]


class PaymentRequestItemResponse(BaseModel):
    fee_record_id: UUID
    enrollment_id: UUID
    student_code: str
    class_name: str
    cycle_no: int
    base_due_date: date | None
    adjusted_due_date: date | None
    expected_amount: int = Field(gt=0)


class PaymentRequestResponse(BaseModel):
    id: UUID
    request_id: UUID
    payment_reference: str
    status: Literal["OPEN", "EXPIRED", "REVOKED", "PAID", "FAILED", "REVIEW"]
    provider: str
    currency: str
    expected_amount: int = Field(gt=0)
    early_payment: bool
    expires_at: datetime | None
    sent_at: datetime | None
    sent_channel: PaymentRequestShareChannel | None = None
    send_count: int = Field(ge=0)
    created_at: datetime
    settlement_account_id: UUID | None = None
    # This is a provider-neutral payload. It is not presented as a successful
    # bank QR until the configured adapter supplies account/QR data.
    qr_payload: dict[str, Any] | None = None
    items: list[PaymentRequestItemResponse] = Field(min_length=1)


class PaymentRequestListResponse(BaseModel):
    """Persisted payment requests for the management payment workspace."""

    requests: list[PaymentRequestResponse]


class FeePaymentRequestCreate(BaseModel):
    record_ids: list[UUID] = Field(min_length=1, max_length=20)
    request_id: UUID = Field(default_factory=uuid4)

    @field_validator("record_ids")
    @classmethod
    def reject_duplicate_records(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("Danh sách học phí không được chứa khoản trùng lặp")
        return value


class PaymentRequestShareRequest(BaseModel):
    channel: PaymentRequestShareChannel
    idempotency_key: UUID = Field(default_factory=uuid4)


class PaymentRequestRevokeRequest(BaseModel):
    reason: str = Field(
        default="Admin hủy yêu cầu thanh toán", min_length=3, max_length=240
    )

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_reason(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.replace("\x00", "").split())


class PaymentRequestShareResponse(PaymentRequestResponse):
    shared_at: datetime
    shared_channel: PaymentRequestShareChannel


class FeePaymentCapabilitiesResponse(BaseModel):
    """Feature state exposed to the management UI without leaking secrets."""

    early_payment_enabled: bool = True
    qr_creation_enabled: bool
    pay2s_qr_ready: bool = False
    automatic_recording_ready: bool = False
    pay2s_blocker: str | None = None
    early_window_days: int = Field(ge=1, le=180)


class FeeRecordResponse(BaseModel):
    id: UUID
    enrollment_id: UUID
    student_id: UUID
    student_code: str | None = None
    student_status: Literal["active", "inactive", "archived"] | None = None
    student_name: str
    class_id: UUID
    class_name: str
    class_type: str
    billing_cycle_months: int
    billing_cycle_weeks: int | None = None
    student_phone: str | None
    student_zalo: str | None
    student_contact_hidden: bool
    parent_phone: str | None
    parent_zalo: str | None
    parent_contact_hidden: bool
    period: str
    enrollment_date: date | None
    due_date: date | None
    cycle_no: int | None = None
    base_due_date: date | None = None
    adjusted_due_date: date | None = None
    coverage_start: date | None = None
    coverage_end: date | None = None
    origin: str | None = None
    requires_review: bool = False
    billing_review_id: UUID | None = None
    is_final_cycle: bool = False
    final_cycle_reason: str | None = None
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
    active: "FeeMessageTemplateValues"
    defaults: "FeeMessageTemplateValues"
    is_customized: bool
    version: int = Field(ge=0, le=2_147_483_647)
    updated_at: datetime | None


class FeeMessageTemplateValues(BaseModel):
    payment_reminder_template: str
    payment_received_template: str


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
        return value.replace("\r\n", "\n").replace("\r", "\n")

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


class FeeMessageTemplatesReset(BaseModel):
    version: int = Field(ge=0, le=2_147_483_647)


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
    message: str | None = Field(default=None, min_length=1, max_length=2000)
    channel: FeeNotificationChannel = "zalo_manual"
    draft_revision: int | None = Field(default=None, ge=1)
    source_fingerprint: str | None = Field(default=None, min_length=64, max_length=64)

    @field_validator("message", mode="before")
    @classmethod
    def normalize_message(cls, value: object) -> object:
        if value is None or not isinstance(value, str):
            return value
        return normalize_fee_notification_message(value)

    @model_validator(mode="after")
    def validate_message_source(self) -> "FeeBatchNotifyRequest":
        has_draft = (
            self.draft_revision is not None or self.source_fingerprint is not None
        )
        if has_draft and (
            self.draft_revision is None or self.source_fingerprint is None
        ):
            raise ValueError("Thông tin bản nháp chưa đầy đủ")
        if not has_draft and self.message is None:
            raise ValueError("Nội dung thông báo không được để trống")
        return self


class FeeMessageDraftReadRequest(FeeBatchRequest):
    kind: Literal["reminder", "received"]


class FeeMessageDraftResponse(BaseModel):
    student_id: UUID
    period: str
    kind: Literal["reminder", "received"]
    message: str
    source_fingerprint: str
    revision: int = Field(ge=1)
    is_customized: bool
    is_stale: bool = False


class FeeMessageDraftSaveRequest(FeeMessageDraftReadRequest):
    message: str = Field(min_length=1, max_length=2000)
    expected_revision: int = Field(ge=0)
    source_fingerprint: str = Field(min_length=64, max_length=64)

    @field_validator("message", mode="before")
    @classmethod
    def normalize_message(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return normalize_fee_notification_message(value)


class FeeBatchPayRequest(FeeBatchRequest):
    payment_method: FeePaymentMethod = "bank_transfer"
    settlement_account_id: UUID | None = None


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
    settlement_account_id: UUID | None = None
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

    @model_validator(mode="after")
    def validate_settlement_account(self) -> "FeeBatchRefundRequest":
        if self.refund_method == "bank_transfer" and self.settlement_account_id is None:
            raise ValueError("Hoàn phí bằng chuyển khoản phải chọn tài khoản ngân hàng")
        if self.refund_method == "cash" and self.settlement_account_id is not None:
            raise ValueError("Hoàn phí bằng tiền mặt không chọn tài khoản ngân hàng")
        return self


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
    payment_origin: Literal["manual", "manual_early", "pay2s"] = "manual"
    settlement_account_id: UUID | None = None
    settlement_bank_name: str | None = None
    settlement_account_number: str | None = None
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
