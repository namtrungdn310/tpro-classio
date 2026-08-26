from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class WorkspacePaymentAccount(WorkspaceScoped, Base):
    __tablename__ = "workspace_payment_accounts"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    label: Mapped[str] = mapped_column(Text, nullable=False)
    bank_code: Mapped[str] = mapped_column(Text, nullable=False)
    bank_name: Mapped[str] = mapped_column(Text, nullable=False)
    account_number: Mapped[str] = mapped_column(Text, nullable=False)
    account_name: Mapped[str] = mapped_column(Text, nullable=False)
    qr_source_url: Mapped[str | None] = mapped_column(Text)
    qr_object_path: Mapped[str | None] = mapped_column(Text)
    provider_account_id: Mapped[str | None] = mapped_column(Text)
    provider_bank_id: Mapped[str | None] = mapped_column(Text)
    va_number: Mapped[str | None] = mapped_column(Text)
    provider_status: Mapped[str] = mapped_column(
        Text, nullable=False, default="manual", server_default=text("'manual'")
    )
    provider_metadata: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    updated_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WorkspacePaymentProvider(WorkspaceScoped, Base):
    __tablename__ = "workspace_payment_providers"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False, default="pay2s")
    connection_mode: Mapped[str] = mapped_column(
        Text, nullable=False, default="byo", server_default=text("'byo'")
    )
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="not_configured",
        server_default=text("'not_configured'"),
    )
    plan: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="unconfirmed",
        server_default=text("'unconfirmed'"),
    )
    merchant_id: Mapped[str | None] = mapped_column(Text)
    api_key_ciphertext: Mapped[str | None] = mapped_column(Text)
    webhook_secret_ciphertext: Mapped[str | None] = mapped_column(Text)
    access_key_ciphertext: Mapped[str | None] = mapped_column(Text)
    secret_key_ciphertext: Mapped[str | None] = mapped_column(Text)
    bearer_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    bearer_token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    partner_code: Mapped[str | None] = mapped_column(Text)
    collection_partner_code: Mapped[str | None] = mapped_column(Text)
    webhook_url: Mapped[str | None] = mapped_column(Text)
    last_error: Mapped[str | None] = mapped_column(Text)
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    updated_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WorkspacePaymentWebhook(WorkspaceScoped, Base):
    __tablename__ = "workspace_payment_webhooks"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    provider_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspace_payment_providers.id", ondelete="CASCADE"),
        nullable=False,
    )
    bank_account_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspace_payment_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider_webhook_id: Mapped[str | None] = mapped_column(Text)
    webhook_type: Mapped[str] = mapped_column(
        Text, nullable=False, default="IN", server_default=text("'IN'")
    )
    webhook_url: Mapped[str] = mapped_column(Text, nullable=False)
    webhook_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    webhook_token_hash: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="pending", server_default=text("'pending'")
    )
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
