from types import SimpleNamespace
import pytest

from app.core.config import settings
from app.services import payment_readiness_service


class _Scalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _Scalars(self._rows)


class _Db:
    def __init__(self, provider, accounts, webhook_id):
        self._scalar_values = [provider, webhook_id]
        self._accounts = accounts

    async def scalar(self, _query):
        return self._scalar_values.pop(0)

    async def execute(self, _query):
        return _Rows(self._accounts)


def _provider():
    return SimpleNamespace(
        status="connected",
        collection_partner_code="TPRO",
        partner_code=None,
    )


def _account():
    return SimpleNamespace(id="account-1", bank_code="VCB")


@pytest.mark.asyncio
async def test_readiness_fails_closed_when_auto_post_is_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "payment_provider", "pay2s")
    monkeypatch.setattr(settings, "payment_qr_enabled", True)
    monkeypatch.setattr(settings, "pay2s_ipn_url", "https://example.test/pay2s/ipn")
    monkeypatch.setattr(settings, "payment_webhook_ingress_enabled", True)
    monkeypatch.setattr(settings, "payment_auto_post_enabled", False)

    readiness = await payment_readiness_service.get_pay2s_readiness(
        _Db(_provider(), [_account()], "webhook-1")
    )

    assert readiness.qr_creation_ready is True
    assert readiness.automatic_recording_ready is False
    assert readiness.blocker == "auto_post_disabled"


@pytest.mark.asyncio
async def test_readiness_requires_workspace_provider_and_all_server_switches(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "payment_provider", "pay2s")
    monkeypatch.setattr(settings, "payment_qr_enabled", True)
    monkeypatch.setattr(settings, "pay2s_ipn_url", "https://example.test/pay2s/ipn")
    monkeypatch.setattr(settings, "payment_webhook_ingress_enabled", True)
    monkeypatch.setattr(settings, "payment_auto_post_enabled", True)

    readiness = await payment_readiness_service.get_pay2s_readiness(
        _Db(_provider(), [_account()], "webhook-1")
    )

    assert readiness.receiving_account_connected is True
    assert readiness.collection_link_configured is True
    assert readiness.transaction_webhook_configured is True
    assert readiness.qr_creation_ready is True
    assert readiness.automatic_recording_ready is True
    assert readiness.blocker is None
