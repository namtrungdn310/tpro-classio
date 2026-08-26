from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.models.banking import WorkspacePaymentWebhook
from app.services.banking_service import create_pay2s_webhook


@pytest.mark.asyncio
async def test_webhook_creation_reads_back_token_and_remote_id() -> None:
    provider = SimpleNamespace(
        id=str(uuid4()),
        webhook_url="https://example.trycloudflare.com/webhooks/pay2s",
        last_error=None,
    )
    account = SimpleNamespace(id=str(uuid4()), provider_bank_id="4438")
    remote = {
        "id": 2767,
        "user_bank_id": 4438,
        "status": "1",
        "type": "IN",
        "webhook_url": provider.webhook_url,
        "token": "webhook-token",
    }
    client = SimpleNamespace(
        list_webhooks=AsyncMock(side_effect=[[], [remote]]),
        create_webhook=AsyncMock(
            return_value={"status": True, "message": "Webhook đã được thêm."}
        ),
        update_webhook=AsyncMock(),
    )
    db = SimpleNamespace(
        scalar=AsyncMock(side_effect=[provider, account, None]),
        add=MagicMock(),
        flush=AsyncMock(),
    )

    def assign_server_id(value) -> None:
        if isinstance(value, WorkspacePaymentWebhook):
            value.id = str(uuid4())

    db.add.side_effect = assign_server_id

    with (
        patch(
            "app.services.banking_service.get_pay2s_client",
            new=AsyncMock(return_value=(client, "bearer-token")),
        ),
        patch(
            "app.services.banking_service.encrypt_credential",
            return_value="encrypted-token",
        ),
        patch(
            "app.services.banking_service.keyed_secret_hash",
            return_value="token-hash",
        ),
    ):
        result = await create_pay2s_webhook(db, account.id, actor_id=str(uuid4()))

    assert client.list_webhooks.await_count == 2
    assert result.provider_webhook_id == "2767"
    assert result.status == "active"
    stored = db.add.call_args.args[0]
    assert stored.webhook_token_ciphertext == "encrypted-token"
    assert stored.webhook_token_hash == "token-hash"
