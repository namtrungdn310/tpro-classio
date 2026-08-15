from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ClassLifecycleEvent(Base):
    """Append-only audit evidence for business lifecycle changes of a class."""

    __tablename__ = "class_lifecycle_events"

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
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    previous_end_date: Mapped[date | None] = mapped_column(Date)
    next_end_date: Mapped[date | None] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(Text)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    request_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
