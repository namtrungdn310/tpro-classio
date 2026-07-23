from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class FeeMessageTemplate(Base):
    __tablename__ = "fee_message_templates"
    __table_args__ = (
        CheckConstraint("id = 1", name="fee_message_templates_singleton_check"),
        CheckConstraint("version >= 1", name="fee_message_templates_version_check"),
    )

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)
    payment_reminder_template: Mapped[str] = mapped_column(Text, nullable=False)
    payment_received_template: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
