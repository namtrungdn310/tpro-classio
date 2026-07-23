from datetime import datetime
from sqlalchemy import ARRAY, DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AuthFlowSession(Base):
    __tablename__ = "auth_flow_sessions"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "flow_type", name="auth_flow_sessions_user_type_unique"
        ),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    session_token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    invitation_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("account_invitations.id", ondelete="SET NULL"),
    )
    flow_type: Mapped[str] = mapped_column(Text, nullable=False)
    completed_steps: Mapped[list] = mapped_column(
        ARRAY(Text), nullable=False, default=list
    )
    aal: Mapped[str] = mapped_column(Text, nullable=False, default="aal1")
    supabase_access_token_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    supabase_refresh_token_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    oauth_state_hash: Mapped[str | None] = mapped_column(Text)
    oauth_nonce_ciphertext: Mapped[str | None] = mapped_column(Text)
    oauth_pkce_verifier_ciphertext: Mapped[str | None] = mapped_column(Text)
    oauth_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    oauth_consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recovery_codes_ciphertext: Mapped[str | None] = mapped_column(Text)
    recovery_codes_retrieved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    recovery_codes_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
