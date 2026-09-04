from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class StartDateChangeCommandRecord(WorkspaceScoped, Base):
    """Durable audit and idempotency record for class or student start date changes."""

    __tablename__ = "start_date_change_commands"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "request_id",
            name="start_date_change_commands_request_unique",
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    subject_type: Mapped[str] = mapped_column(Text, nullable=False)
    class_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("classes.id", ondelete="RESTRICT")
    )
    student_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("students.id", ondelete="RESTRICT")
    )
    old_date: Mapped[date] = mapped_column(Date, nullable=False)
    new_date: Mapped[date] = mapped_column(Date, nullable=False)
    payload_hash: Mapped[str] = mapped_column(Text, nullable=False)
    preview_fingerprint: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(Text, nullable=False, default="PENDING")
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    items = relationship(
        "StartDateChangeCommandItem",
        back_populates="command",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class StartDateChangeCommandItem(WorkspaceScoped, Base):
    """Per-enrollment resolution item for start date change command."""

    __tablename__ = "start_date_change_command_items"
    __table_args__ = (
        UniqueConstraint(
            "command_id",
            "enrollment_id",
            name="start_date_change_command_items_unique",
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    command_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("start_date_change_commands.id", ondelete="CASCADE"),
        nullable=False,
    )
    enrollment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("enrollments.id", ondelete="RESTRICT"), nullable=False
    )
    old_enrollment_date: Mapped[date] = mapped_column(Date, nullable=False)
    new_enrollment_date: Mapped[date] = mapped_column(Date, nullable=False)
    decision_code: Mapped[str] = mapped_column(Text, nullable=False)
    previous_billing_revision_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("billing_anchor_revisions.id", ondelete="RESTRICT")
    )
    next_billing_revision_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("billing_anchor_revisions.id", ondelete="RESTRICT")
    )
    first_anchor_cycle_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    selected_historical_cycles: Mapped[list[int] | None] = mapped_column(ARRAY(Integer))
    protected_fee_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    superseded_fee_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_cycle_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_fee_record_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("fee_records.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    command = relationship("StartDateChangeCommandRecord", back_populates="items")
