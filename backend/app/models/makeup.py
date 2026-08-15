"""SQLAlchemy models for dated class schedule adjustments (migration 053).

One cohesive module keeps the make-up feature boundary small: header batch,
per-original exception, staff/student snapshots and the append-only audit
event ledger. Foreign keys preserve auditability (RESTRICT) while account
deletion can anonymize the actor (SET NULL on events).
"""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ClassScheduleAdjustment(Base):
    """Header/lô hoãn: reason + phạm vi ngày + idempotency request_id."""

    __tablename__ = "class_schedule_adjustments"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("classes.id", ondelete="RESTRICT"),
        nullable=False,
    )
    reason_code: Mapped[str] = mapped_column(Text, nullable=False)
    reason_note: Mapped[str | None] = mapped_column(Text)
    affected_from: Mapped[date] = mapped_column(Date, nullable=False)
    affected_through: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="OPEN")
    created_by: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
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

    class_ = relationship("Class", back_populates="schedule_adjustments")
    exceptions = relationship(
        "ClassSessionException",
        back_populates="adjustment",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ClassSessionException(Base):
    """Một dated exception của đúng một original occurrence.

    Status: MAKEUP_PENDING / MAKEUP_SCHEDULED / MAKEUP_COMPLETED / RESTORED /
    CANCELLED. Các constraint DB bảo vệ duration, after-original, state shape
    và tối đa một active exception cho (class_id, original_start_at).
    """

    __tablename__ = "class_session_exceptions"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    adjustment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_schedule_adjustments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("classes.id", ondelete="RESTRICT"),
        nullable=False,
    )
    original_start_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    original_end_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    original_timezone: Mapped[str] = mapped_column(
        Text, nullable=False, default="Asia/Ho_Chi_Minh"
    )
    # R6-D07: stable relational slot identity (canonical occurrence source).
    source_slot_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_schedule_slots.id", ondelete="RESTRICT"),
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, default="MAKEUP_PENDING")
    replacement_start_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    replacement_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    restored_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
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

    adjustment = relationship("ClassScheduleAdjustment", back_populates="exceptions")
    class_ = relationship("Class", back_populates="session_exceptions")
    staff_snapshots = relationship(
        "ClassSessionStaffSnapshot",
        back_populates="exception",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    student_snapshots = relationship(
        "ClassSessionStudentSnapshot",
        back_populates="exception",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ClassSessionStaffSnapshot(Base):
    """Snapshot staff của ORIGINAL slot (teacher + assistant) tại thời điểm hoãn."""

    __tablename__ = "class_session_staff_snapshots"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    exception_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_session_exceptions.id", ondelete="CASCADE"),
        nullable=False,
    )
    staff_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="RESTRICT"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)
    display_name_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    source_slot_key: Mapped[str] = mapped_column(Text, nullable=False)
    source_slot_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_schedule_slots.id", ondelete="RESTRICT"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    exception = relationship("ClassSessionException", back_populates="staff_snapshots")


class ClassSessionStudentSnapshot(Base):
    """Snapshot eligibility học viên theo membership tại ngày original.

    Chỉ lưu trường entitlement/display — không contact/private note.
    """

    __tablename__ = "class_session_student_snapshots"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    exception_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_session_exceptions.id", ondelete="CASCADE"),
        nullable=False,
    )
    student_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("students.id", ondelete="RESTRICT"),
        nullable=False,
    )
    enrollment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("enrollments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    student_name_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    enrolled_at_snapshot: Mapped[date | None] = mapped_column(Date)
    enrollment_end_snapshot: Mapped[date | None] = mapped_column(Date)
    eligibility_status: Mapped[str] = mapped_column(
        Text, nullable=False, default="ELIGIBLE"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    exception = relationship(
        "ClassSessionException", back_populates="student_snapshots"
    )


class ClassScheduleAdjustmentEvent(Base):
    """Append-only audit ledger của mọi command make-up."""

    __tablename__ = "class_schedule_adjustment_events"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    exception_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_session_exceptions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    old_payload: Mapped[dict | None] = mapped_column(JSONB)
    new_payload: Mapped[dict | None] = mapped_column(JSONB)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
