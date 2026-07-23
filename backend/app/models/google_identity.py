from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AuthGoogleIdentity(Base):
    __tablename__ = "auth_google_identities"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    google_sub: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    google_email: Mapped[str] = mapped_column(Text, nullable=False)
    provider_refresh_token_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_object_path: Mapped[str | None] = mapped_column(Text)
    avatar_source_url: Mapped[str | None] = mapped_column(Text)
    avatar_synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
