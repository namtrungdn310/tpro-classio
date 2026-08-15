"""SQLAlchemy model for enrollment slot selections (migration 062)."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EnrollmentSlotSelection(Base):
    """Effective-dated (enrollment, slot) selection; drives occurrence/makeup
    eligibility only — never fee amounts."""

    __tablename__ = "enrollment_slot_selections"

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
    slot_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_schedule_slots.id", ondelete="RESTRICT"),
        nullable=False,
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_until: Mapped[date | None] = mapped_column(Date)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    enrollment = relationship("Enrollment", back_populates="slot_selections")
