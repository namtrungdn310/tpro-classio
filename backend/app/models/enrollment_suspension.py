"""Current individual pause plus immutable command receipts (migration 129)."""

from datetime import date, datetime
from sqlalchemy import Date, DateTime, ForeignKey, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class EnrollmentSuspension(WorkspaceScoped, Base):
    __tablename__ = "enrollment_suspensions"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    enrollment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("enrollments.id", ondelete="RESTRICT")
    )
    suspended_from: Mapped[date] = mapped_column(Date)
    resume_on: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(Text, default="ACTIVE")
    version: Mapped[int] = mapped_column(Integer, default=1)
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SuspensionCommand(WorkspaceScoped, Base):
    __tablename__ = "suspension_commands"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    enrollment_suspension_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("enrollment_suspensions.id", ondelete="RESTRICT"),
    )
    class_adjustment_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_schedule_adjustments.id", ondelete="RESTRICT"),
    )
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False))
    actor_id: Mapped[str] = mapped_column(UUID(as_uuid=False))
    payload: Mapped[dict] = mapped_column(JSONB)
    result: Mapped[dict] = mapped_column(JSONB)
    before_snapshot: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
