"""SQLAlchemy models for the service-credit ledger (migration 063)."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EnrollmentServiceCreditEvent(Base):
    __tablename__ = "enrollment_service_credit_events"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    enrollment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("enrollments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("classes.id", ondelete="RESTRICT"),
        nullable=False,
    )
    adjustment_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_schedule_adjustments.id", ondelete="RESTRICT"),
    )
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    overlap_start: Mapped[date] = mapped_column(Date, nullable=False)
    overlap_end: Mapped[date] = mapped_column(Date, nullable=False)
    credit_days: Mapped[int] = mapped_column(Integer, nullable=False)
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    reason_snapshot: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    allocations = relationship(
        "ServiceCreditAllocation",
        back_populates="event",
        lazy="selectin",
    )


class ServiceCreditAllocation(Base):
    __tablename__ = "service_credit_allocations"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    credit_event_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("enrollment_service_credit_events.id", ondelete="RESTRICT"),
        nullable=False,
    )
    fee_record_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("fee_records.id", ondelete="RESTRICT"),
        nullable=False,
    )
    allocated_days: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    event = relationship(
        "EnrollmentServiceCreditEvent",
        back_populates="allocations",
    )
