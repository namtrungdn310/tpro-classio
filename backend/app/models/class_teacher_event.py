from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ClassTeacherEvent(Base):
    """Append-only evidence of a teacher being assigned to or removed from a class."""

    __tablename__ = "class_teacher_events"

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
    teacher_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="RESTRICT"),
        nullable=False,
    )
    teacher_name_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    staff_type_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
