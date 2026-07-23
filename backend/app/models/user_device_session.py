from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserDeviceSession(Base):
    __tablename__ = "user_device_sessions"
    __table_args__ = (
        UniqueConstraint("user_id", "device_type", name="uq_user_device_sessions_slot"),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    device_type: Mapped[str] = mapped_column(Text, nullable=False)
    device_id_hash: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    session_nonce: Mapped[str] = mapped_column(Text, nullable=False)
    supabase_session_id: Mapped[str | None] = mapped_column(Text)
    user_agent_hash: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    aal: Mapped[str] = mapped_column(
        Text, nullable=False, default="aal1", server_default="aal1"
    )
    mfa_factor_id: Mapped[str | None] = mapped_column(Text)
    mfa_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
