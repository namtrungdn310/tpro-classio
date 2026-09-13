"""Authenticated callbacks survive revocation and are posted at most once."""

import json
from types import SimpleNamespace as N
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.services import pay2s_service as service


@pytest.mark.asyncio
@pytest.mark.parametrize("result_code", [0, "0"])
@pytest.mark.parametrize(
    "request_state,amount,duplicate,expected",
    [
        ("REVOKED", 900000, False, "payment_request_no_longer_open"),
        ("PAID", 900000, False, "payment_request_no_longer_open"),
        ("OPEN", 800000, False, "payment_snapshot_mismatch"),
        ("PAID", 900000, True, None),
        ("OPEN", 900000, False, None),
    ],
)
async def test_ipn_late_duplicate_or_matching(
    monkeypatch, request_state, amount, duplicate, expected, result_code
):
    request_id, fee_id, delivery_id = str(uuid4()), str(uuid4()), str(uuid4())
    request = N(
        id=str(uuid4()),
        request_id=request_id,
        fee_record_id=fee_id,
        status=request_state,
        expected_amount=900000,
        payment_reference="TPREFERENCE",
        settlement_account_id=str(uuid4()),
        provider_metadata={
            "collection_link": {"request_id": request_id, "order_info": "TPREFERENCE"}
        },
    )
    fee = N(
        status="UNPAID",
        review_required=False,
        paid_date=None,
        paid_amount=0,
        refunded_amount=0,
        payments=[],
        final_amount=900000,
    )
    provider = N(id=str(uuid4()))
    workspace = str(uuid4())
    scalar_returns = [provider, request, request, delivery_id if duplicate else None]
    if duplicate:
        scalar_returns.append(delivery_id)
    calls = []

    async def execute(statement, params=None):
        calls.append(str(statement))
        return N(
            mappings=lambda: N(
                all=lambda: [{"workspace_id": workspace, "provider_id": provider.id}]
            )
        )

    db = N(
        execute=execute,
        scalar=AsyncMock(side_effect=scalar_returns),
        scalars=AsyncMock(side_effect=[N(all=lambda: [fee_id]), N(all=lambda: [fee])]),
        commit=AsyncMock(),
        add=lambda record: None,
    )
    monkeypatch.setattr(service.settings, "payment_webhook_ingress_enabled", True)
    monkeypatch.setattr(service.settings, "payment_provider", "pay2s")
    monkeypatch.setattr(service.settings, "payment_auto_post_enabled", True)
    monkeypatch.setattr(
        service, "_provider_credentials", AsyncMock(return_value=("test", "test"))
    )
    monkeypatch.setattr(service, "_collection_ipn_signature_is_valid", lambda *_: True)
    insert = AsyncMock(return_value=delivery_id)
    queue = AsyncMock()
    post = AsyncMock()
    monkeypatch.setattr(service, "_insert_delivery", insert)
    monkeypatch.setattr(service, "_insert_posting_queue", queue)
    monkeypatch.setattr("app.services.fee_service.mark_fees_paid", post)
    body = json.dumps(
        {
            "partnerCode": "TEST",
            "requestId": request_id,
            "orderId": request_id,
            "transId": "test-transaction",
            "amount": amount,
            "orderInfo": "TPREFERENCE",
            "resultCode": result_code,
        }
    ).encode()
    assert await service.ingest_pay2s_collection_ipn(db, raw_body=body) == delivery_id
    if duplicate:
        insert.assert_not_awaited()
        queue.assert_not_awaited()
        post.assert_not_awaited()
        assert "provider_event_id" in str(db.scalar.call_args.args[0])
    elif expected:
        assert queue.call_args.kwargs["review_reason"] == expected
        assert queue.call_args.kwargs["queue_status"] == "REVIEW"
        post.assert_not_awaited()
    else:
        post.assert_awaited_once()
        assert queue.call_args.kwargs["queue_status"] == "POSTED"
    db.commit.assert_awaited_once()
    # Fee lock is acquired before the request lock (no request->fee inversion).
    assert "FOR UPDATE" in str(db.scalars.call_args_list[-1].args[0])
    assert "FOR UPDATE" not in str(db.scalar.call_args_list[1].args[0])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "request_state,fee_state,expected",
    [
        ("REVOKED", "UNPAID", "payment_request_no_longer_open"),
        ("OPEN", "SUPERSEDED", "fee_obligation_changed"),
        ("OPEN", "UNPAID", None),
    ],
)
async def test_partner_feed_rechecks_after_fee_lock(
    monkeypatch, request_state, fee_state, expected
):
    request = N(
        id=str(uuid4()), request_id=str(uuid4()), status=request_state, expires_at=None
    )
    account = N(id=str(uuid4()), bank_name="Test bank", account_number="0000000000")
    workspace = str(uuid4())
    fee_id, delivery_id = str(uuid4()), str(uuid4())
    fee = N(
        status=fee_state,
        review_required=False,
        paid_date=None,
        paid_amount=0,
        refunded_amount=0,
        payments=[],
        final_amount=900000,
    )

    async def execute(statement, params=None):
        if "payment_request_items" in str(statement):
            return N(scalars=lambda: N(all=lambda: [N(fee_record_id=fee_id)]))
        return N(
            mappings=lambda: N(
                first=lambda: dict(
                    id=str(uuid4()),
                    workspace_id=workspace,
                    provider_id=str(uuid4()),
                    bank_account_id=account.id,
                )
            )
        )

    db = N(
        execute=execute,
        scalar=AsyncMock(side_effect=[account, N(status="active"), None, request]),
        scalars=AsyncMock(return_value=N(all=lambda: [fee])),
        add=lambda row: None,
        commit=AsyncMock(),
    )
    for flag, value in (
        ("payment_webhook_ingress_enabled", True),
        ("payment_provider", "pay2s"),
        ("payment_auto_post_enabled", True),
    ):
        monkeypatch.setattr(service.settings, flag, value)
    monkeypatch.setattr(service, "_transaction_belongs_to_account", lambda *_: True)
    monkeypatch.setattr(service, "_match_open_request", AsyncMock(return_value=request))
    monkeypatch.setattr(
        service, "_insert_delivery", AsyncMock(return_value=delivery_id)
    )
    queue, post = AsyncMock(), AsyncMock()
    monkeypatch.setattr(service, "_insert_posting_queue", queue)
    monkeypatch.setattr("app.services.fee_service.mark_fees_paid", post)
    payload = {
        "transactions": [
            {
                "id": "txn",
                "transactionNumber": "txn",
                "transferType": "IN",
                "transferAmount": 900000,
                "content": "TPREFERENCE",
            }
        ]
    }
    assert (
        await service.ingest_pay2s_webhook(
            db, raw_body=json.dumps(payload).encode(), authorization="Bearer test-token"
        )
        == delivery_id
    )
    assert queue.call_args.kwargs["review_reason"] == expected
    assert queue.call_args.kwargs["queue_status"] == (
        "REVIEW" if expected else "POSTED"
    )
    if expected:
        post.assert_not_awaited()
    else:
        post.assert_awaited_once()
    assert "FOR UPDATE" in str(db.scalars.call_args.args[0])
    assert "FOR UPDATE" in str(db.scalar.call_args.args[0])
