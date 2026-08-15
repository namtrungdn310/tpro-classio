from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class StudentLifecycleEvent(Base):
    __tablename__ = "student_lifecycle_events"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    student_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("students.id", ondelete="RESTRICT"),
        nullable=False,
    )
    class_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("classes.id", ondelete="RESTRICT"),
    )
    enrollment_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("enrollments.id", ondelete="RESTRICT"),
    )
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    previous_status: Mapped[str | None] = mapped_column(Text)
    next_status: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
