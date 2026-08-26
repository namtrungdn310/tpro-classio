"""Single source of truth for Pay2S payment readiness.

The Banking and Fees screens must not infer readiness from a provider badge or
from a transaction webhook alone. Collection Link creation and automatic fee
posting have distinct server-side prerequisites; this helper keeps both screens
consistent without exposing credentials.
"""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.banking import (
    WorkspacePaymentAccount,
    WorkspacePaymentProvider,
    WorkspacePaymentWebhook,
)
from app.services.pay2s_catalog import is_pay2s_payment_bank

Pay2SReadinessBlocker = Literal[
    "provider_disabled",
    "qr_disabled",
    "provider_not_verified",
    "receiving_account_missing",
    "partner_code_missing",
    "ipn_url_missing",
    "webhook_ingress_disabled",
    "auto_post_disabled",
]


@dataclass(frozen=True)
class Pay2SReadiness:
    provider_verified: bool
    receiving_account_connected: bool
    collection_link_configured: bool
    transaction_webhook_configured: bool
    qr_creation_ready: bool
    automatic_recording_ready: bool
    blocker: Pay2SReadinessBlocker | None


async def get_pay2s_readiness(db: AsyncSession) -> Pay2SReadiness:
    provider = await db.scalar(
        select(WorkspacePaymentProvider).where(
            WorkspacePaymentProvider.provider == "pay2s"
        )
    )
    provider_verified = bool(provider and provider.status == "connected")

    account_result = await db.execute(
        select(WorkspacePaymentAccount).where(
            WorkspacePaymentAccount.is_active.is_(True),
            WorkspacePaymentAccount.provider_bank_id.is_not(None),
            WorkspacePaymentAccount.provider_account_id.is_not(None),
            WorkspacePaymentAccount.provider_status.notin_(
                ("manual", "disabled", "error")
            ),
        )
    )
    pay2s_accounts = [
        account
        for account in account_result.scalars().all()
        if is_pay2s_payment_bank(account.bank_code)
    ]
    receiving_account_connected = bool(pay2s_accounts)
    partner_code_configured = bool(
        provider and (provider.collection_partner_code or provider.partner_code)
    )
    ipn_url_configured = bool(settings.pay2s_ipn_url.strip())
    collection_link_configured = bool(partner_code_configured and ipn_url_configured)

    account_ids = [account.id for account in pay2s_accounts]
    transaction_webhook_configured = False
    if account_ids:
        transaction_webhook_configured = bool(
            await db.scalar(
                select(WorkspacePaymentWebhook.id)
                .where(
                    WorkspacePaymentWebhook.bank_account_id.in_(account_ids),
                    WorkspacePaymentWebhook.status == "active",
                )
                .limit(1)
            )
        )

    provider_enabled = settings.payment_provider.casefold() == "pay2s"
    qr_creation_ready = bool(
        provider_enabled
        and settings.payment_qr_enabled
        and provider_verified
        and receiving_account_connected
        and collection_link_configured
    )
    automatic_recording_ready = bool(
        qr_creation_ready
        and settings.payment_webhook_ingress_enabled
        and settings.payment_auto_post_enabled
    )

    blocker: Pay2SReadinessBlocker | None = None
    if not provider_enabled:
        blocker = "provider_disabled"
    elif not settings.payment_qr_enabled:
        blocker = "qr_disabled"
    elif not provider_verified:
        blocker = "provider_not_verified"
    elif not receiving_account_connected:
        blocker = "receiving_account_missing"
    elif not partner_code_configured:
        blocker = "partner_code_missing"
    elif not ipn_url_configured:
        blocker = "ipn_url_missing"
    elif not settings.payment_webhook_ingress_enabled:
        blocker = "webhook_ingress_disabled"
    elif not settings.payment_auto_post_enabled:
        blocker = "auto_post_disabled"

    return Pay2SReadiness(
        provider_verified=provider_verified,
        receiving_account_connected=receiving_account_connected,
        collection_link_configured=collection_link_configured,
        transaction_webhook_configured=transaction_webhook_configured,
        qr_creation_ready=qr_creation_ready,
        automatic_recording_ready=automatic_recording_ready,
        blocker=blocker,
    )
