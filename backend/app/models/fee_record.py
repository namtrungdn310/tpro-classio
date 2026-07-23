from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    SmallInteger,
    Text,
    Index,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class FeeRecord(Base):
    __tablename__ = "fee_records"
    __table_args__ = (
        Index(
            "ux_fee_records_enrollment_period",
            "enrollment_id",
            "period",
            unique=True,
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    enrollment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("enrollments.id", ondelete="CASCADE"),
        nullable=False,
    )
    period: Mapped[str] = mapped_column(Text, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date)
    enrollment_date_snapshot: Mapped[date | None] = mapped_column(Date)
    student_name_snapshot: Mapped[str | None] = mapped_column(Text)
    class_name_snapshot: Mapped[str | None] = mapped_column(Text)
    class_type_snapshot: Mapped[str | None] = mapped_column(
        ENUM("MONTHLY", "COURSE", name="class_type", create_type=False)
    )
    billing_cycle_months_snapshot: Mapped[int | None] = mapped_column(SmallInteger)
    base_amount: Mapped[Decimal] = mapped_column(Numeric(12, 0), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 0), nullable=False, default=0
    )
    discount_reason: Mapped[str | None] = mapped_column(Text)
    final_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 0),
        Computed("base_amount - discount_amount", persisted=True),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        ENUM("UNPAID", "PAID", name="fee_status", create_type=False),
        nullable=False,
        default="UNPAID",
    )
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notification_channel: Mapped[str | None] = mapped_column(Text)
    notification_message: Mapped[str | None] = mapped_column(Text)
    paid_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 0))
    paid_date: Mapped[date | None] = mapped_column(Date)
    refunded_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 0), nullable=False, default=0
    )
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    enrollment = relationship("Enrollment", back_populates="fee_records")
    payments = relationship(
        "Payment",
        back_populates="fee_record",
        passive_deletes="all",
    )
