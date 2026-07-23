from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class FeeOperation(Base):
    """Immutable business event shown by the read-only fee report."""

    __tablename__ = "fee_operations"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    sequence_no: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), nullable=False
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    origin: Mapped[str] = mapped_column(Text, nullable=False, default="application")
    request_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    period: Mapped[str | None] = mapped_column(Text)
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    actor_name_snapshot: Mapped[str | None] = mapped_column(Text)
    actor_username_snapshot: Mapped[str | None] = mapped_column(Text)
    actor_role_snapshot: Mapped[str | None] = mapped_column(Text)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 0), nullable=False, default=0
    )
    schema_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)

    items = relationship(
        "FeeOperationItem",
        back_populates="operation",
        order_by="FeeOperationItem.ordinal",
        lazy="raise",
        passive_deletes="all",
    )


class FeeOperationItem(Base):
    __tablename__ = "fee_operation_items"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    operation_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("fee_operations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    ordinal: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    fee_record_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    enrollment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    student_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    student_name_snapshot: Mapped[str | None] = mapped_column(Text)
    class_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    class_name_snapshot: Mapped[str | None] = mapped_column(Text)
    period: Mapped[str | None] = mapped_column(Text)
    state_before: Mapped[str | None] = mapped_column(Text)
    state_after: Mapped[str | None] = mapped_column(Text)
    amount_before: Mapped[Decimal | None] = mapped_column(Numeric(12, 0))
    amount_after: Mapped[Decimal | None] = mapped_column(Numeric(12, 0))
    amount_delta: Mapped[Decimal] = mapped_column(
        Numeric(12, 0), nullable=False, default=0
    )
    due_date_before: Mapped[date | None] = mapped_column(Date)
    due_date_after: Mapped[date | None] = mapped_column(Date)
    payment_method: Mapped[str | None] = mapped_column(Text)
    notification_channel: Mapped[str | None] = mapped_column(Text)
    message_snapshot: Mapped[str | None] = mapped_column(Text)
    reason_snapshot: Mapped[str | None] = mapped_column(Text)
    payment_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("payments.id", ondelete="RESTRICT")
    )
    related_payment_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("payments.id", ondelete="RESTRICT")
    )

    operation = relationship("FeeOperation", back_populates="items")
