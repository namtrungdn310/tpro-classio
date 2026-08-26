from datetime import date, datetime
from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    SmallInteger,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class PaymentRequest(WorkspaceScoped, Base):
    __tablename__ = "payment_requests"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    request_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        nullable=False,
        unique=True,
        server_default=text("gen_random_uuid()"),
    )
    fee_record_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("fee_records.id", ondelete="RESTRICT"),
        nullable=False,
    )
    enrollment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("enrollments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    student_code_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    payment_reference: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    expected_amount: Mapped[int] = mapped_column(Numeric(12, 0), nullable=False)
    currency: Mapped[str] = mapped_column(Text, nullable=False, default="VND")
    status: Mapped[str] = mapped_column(Text, nullable=False, default="OPEN")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider: Mapped[str] = mapped_column(Text, nullable=False, default="pay2s_v1")
    provider_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    settlement_account_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspace_payment_accounts.id", ondelete="SET NULL"),
    )
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_channel: Mapped[str | None] = mapped_column(Text)
    send_count: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=0, server_default=text("0")
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    early_payment: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class PaymentRequestItem(WorkspaceScoped, Base):
    """Immutable snapshot of one fee obligation included in a payment request."""

    __tablename__ = "payment_request_items"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    payment_request_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("payment_requests.id", ondelete="RESTRICT"),
        nullable=False,
    )
    fee_record_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("fee_records.id", ondelete="RESTRICT"),
        nullable=False,
    )
    enrollment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("enrollments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    student_code_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    class_name_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    cycle_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    base_due_date: Mapped[date | None] = mapped_column(Date)
    adjusted_due_date: Mapped[date | None] = mapped_column(Date)
    expected_amount: Mapped[int] = mapped_column(Numeric(12, 0), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PaymentRequestEvent(WorkspaceScoped, Base):
    __tablename__ = "payment_request_events"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    payment_request_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("payment_requests.id", ondelete="RESTRICT"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    old_status: Mapped[str | None] = mapped_column(Text)
    new_status: Mapped[str | None] = mapped_column(Text)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    idempotency_key: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), unique=True
    )
    event_metadata: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
