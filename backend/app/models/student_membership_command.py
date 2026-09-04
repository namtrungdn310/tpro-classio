from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class StudentMembershipCommandRecord(WorkspaceScoped, Base):
    """Durable idempotency and audit record for one membership mutation."""

    __tablename__ = "student_membership_commands"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "request_id",
            name="student_membership_commands_request_unique",
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    payload_hash: Mapped[str] = mapped_column(Text, nullable=False)
    preview_fingerprint: Mapped[str | None] = mapped_column(Text)
    student_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("students.id", ondelete="RESTRICT"), nullable=False
    )
    source_enrollment_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("enrollments.id", ondelete="RESTRICT")
    )
    mode: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False, default="PENDING")
    target_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    items = relationship(
        "StudentMembershipCommandItem",
        back_populates="command",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class StudentMembershipCommandItem(WorkspaceScoped, Base):
    __tablename__ = "student_membership_command_items"
    __table_args__ = (
        UniqueConstraint(
            "command_id",
            "class_id",
            name="student_membership_command_items_class_unique",
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    command_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("student_membership_commands.id", ondelete="CASCADE"),
        nullable=False,
    )
    class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("classes.id", ondelete="RESTRICT"), nullable=False
    )
    enrollment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("enrollments.id", ondelete="RESTRICT"), nullable=False
    )
    requested_start: Mapped[date | None] = mapped_column(Date)
    resolved_start: Mapped[date] = mapped_column(Date, nullable=False)
    custom_fee_snapshot: Mapped[int | None] = mapped_column(Numeric(12, 0))
    selected_slot_ids: Mapped[list[str] | None] = mapped_column(ARRAY(UUID(as_uuid=False)))

    command = relationship("StudentMembershipCommandRecord", back_populates="items")
