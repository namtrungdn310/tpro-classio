from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    owner_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("auth.users.id", ondelete="SET NULL"),
        unique=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False, default="TPRO English")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
