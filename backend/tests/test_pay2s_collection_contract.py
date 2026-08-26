import hashlib
import hmac
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services.pay2s_catalog import PAY2S_PAYMENT_BANKS, is_pay2s_payment_bank
from app.services.pay2s_service import (
    _collection_redirect_url,
    _collection_ipn_canonical,
    _collection_ipn_signature_is_valid,
    _match_open_request,
    _payment_references_in_content,
)


def test_collection_redirect_requires_a_public_https_url(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.pay2s_service.settings.pay2s_redirect_url",
        "http://localhost:3000/fees",
    )
    with pytest.raises(HTTPException, match="HTTPS công khai"):
        _collection_redirect_url()

    monkeypatch.setattr(
        "app.services.pay2s_service.settings.pay2s_redirect_url",
        "https://payments.example.test/webhooks/pay2s/return",
    )
    assert (
        _collection_redirect_url()
        == "https://payments.example.test/webhooks/pay2s/return"
    )


def test_pay2s_catalog_is_a_small_provider_allow_list() -> None:
    assert {bank.code for bank in PAY2S_PAYMENT_BANKS} == {
        "VCB",
        "CTG",
        "TCB",
        "BIDV",
        "ACB",
        "MBB",
        "TPB",
    }
    assert is_pay2s_payment_bank("vcb")
    assert not is_pay2s_payment_bank("VIB")


def test_collection_ipn_signature_uses_the_documented_named_fields() -> None:
    access_key = "a-test-collection-access-key"
    secret = "a-test-collection-secret"
    payload = {
        "amount": 750000,
        "extraData": "",
        "message": "Thành công",
        "orderId": "a7e9f2e4-7ba6-4d6a-9a0e-2f77ff9d2d03",
        "orderInfo": "TP000000001PABCDEFGH",
        "orderType": "pay2s",
        "partnerCode": "TPRO",
        "payType": "bank_transfer",
        "requestId": "a7e9f2e4-7ba6-4d6a-9a0e-2f77ff9d2d03",
        "responseTime": "1780000000000",
        "resultCode": 0,
        "transId": "PAY2S-123",
    }
    payload["m2signature"] = hmac.new(
        secret.encode(),
        _collection_ipn_canonical(payload, access_key).encode(),
        hashlib.sha256,
    ).hexdigest()

    assert _collection_ipn_canonical(payload, access_key).startswith(
        f"accessKey={access_key}&amount=750000"
    )
    assert _collection_ipn_signature_is_valid(payload, access_key, secret)
    assert not _collection_ipn_signature_is_valid(payload, "wrong-access-key", secret)
    payload["amount"] = 1
    assert not _collection_ipn_signature_is_valid(payload, access_key, secret)


@pytest.mark.asyncio
async def test_transaction_match_requires_the_qr_receiving_account() -> None:
    account_id = uuid4()
    account = SimpleNamespace(id=account_id)
    wrong_account_request = SimpleNamespace(
        payment_reference="TP000000001PABCDEFGH",
        expected_amount=750_000,
        settlement_account_id=uuid4(),
    )
    right_account_request = SimpleNamespace(
        payment_reference="TP000000001PABCDEFGH",
        expected_amount=750_000,
        settlement_account_id=account_id,
    )
    scalar_result = SimpleNamespace(all=lambda: [right_account_request])
    db = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: scalar_result))
    )

    matched = await _match_open_request(
        db,
        account=account,
        content="TP000000001PABCDEFGH",
        amount=750_000,
    )
    provider_wrapped_content = await _match_open_request(
        db,
        account=account,
        content=(
            "VIETCOMBANK:0123456789:TP000000001PABCDEFGH#SP#020097040508261632032026"
        ),
        amount=750_000,
    )

    assert matched is right_account_request
    assert provider_wrapped_content is right_account_request

    no_match_db = SimpleNamespace(
        execute=AsyncMock(
            return_value=SimpleNamespace(
                scalars=lambda: SimpleNamespace(all=lambda: [])
            )
        )
    )
    assert (
        await _match_open_request(
            no_match_db,
            account=SimpleNamespace(id=wrong_account_request.settlement_account_id),
            content="TP000000001PABCDEFGH",
            amount=750_000,
        )
        is None
    )


def test_payment_reference_extraction_requires_a_complete_bounded_token() -> None:
    reference = "TP000000001PABCDEFGH"

    assert _payment_references_in_content(reference) == (reference,)
    assert _payment_references_in_content(
        f"VIETCOMBANK:0123456789:{reference}#SP#123"
    ) == (reference,)
    assert _payment_references_in_content(f"X{reference}") == ()
    assert _payment_references_in_content(f"{reference}9") == ()
    assert _payment_references_in_content("CHUYEN KHOAN KHONG CO MA") == ()


@pytest.mark.asyncio
async def test_transaction_match_rejects_more_than_one_reference() -> None:
    db = SimpleNamespace(execute=AsyncMock())

    matched = await _match_open_request(
        db,
        account=SimpleNamespace(id=uuid4()),
        content="TP000000001PABCDEFGH TP000000002PABCDEFGH",
        amount=750_000,
    )

    assert matched is None
    db.execute.assert_not_awaited()
