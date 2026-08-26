from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class FeeMessageTemplate(WorkspaceScoped, Base):
    __tablename__ = "fee_message_templates"
    __table_args__ = (
        CheckConstraint("id >= 1", name="fee_message_templates_id_check"),
        CheckConstraint("version >= 1", name="fee_message_templates_version_check"),
    )

    # ``workspace_id`` is the tenant-scoped primary key.  ``id`` remains a
    # small display/version identifier for backward-compatible API payloads.
    workspace_id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    id: Mapped[int] = mapped_column(Integer, default=1)
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
