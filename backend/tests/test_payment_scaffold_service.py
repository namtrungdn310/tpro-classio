import re
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.payment_scaffold_service import (
    REFERENCE_PATTERN,
    generate_payment_reference,
    to_payment_request_response,
)


def test_payment_reference_is_non_pii_and_student_scoped() -> None:
    reference = generate_payment_reference("TP123456789")

    assert REFERENCE_PATTERN.fullmatch(reference)
    assert reference.startswith("TP123456789P")
    assert len(reference) == 20
    assert not re.search(r"[^A-Z0-9]", reference)


def test_payment_reference_has_unique_random_suffix() -> None:
    references = {generate_payment_reference("TP123456789") for _ in range(32)}

    assert len(references) == 32


class _ScalarRows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Result:
    def __init__(self, *, rows=None, scalar=None):
        self._rows = rows or []
        self._scalar = scalar

    def scalars(self):
        return _ScalarRows(self._rows)

    def scalar_one_or_none(self):
        return self._scalar


class _Db:
    def __init__(self, item, account):
        self._results = [_Result(rows=[item])]
        self._account = account

    async def execute(self, _query):
        return self._results.pop(0)

    async def scalar(self, _query):
        return self._account


class _ItemsOnlyDb:
    def __init__(self, item):
        self._results = [_Result(rows=[item])]

    async def execute(self, _query):
        return self._results.pop(0)


@pytest.mark.asyncio
async def test_uploaded_manual_qr_is_exposed_through_private_proxy() -> None:
    fee_id = uuid4()
    enrollment_id = uuid4()
    request_id = uuid4()
    account_id = uuid4()
    item = SimpleNamespace(
        fee_record_id=fee_id,
        enrollment_id=enrollment_id,
        student_code_snapshot="TP123456789",
        class_name_snapshot="Lớp thử nghiệm",
        cycle_no=1,
        base_due_date=None,
        adjusted_due_date=None,
        expected_amount=750000,
    )
    account = SimpleNamespace(
        id=account_id,
        label="Tài khoản chính",
        bank_name="Vietcombank",
        account_number="1234567890",
        account_name="TPRO ENGLISH",
        qr_object_path="banking/test/qr.webp",
        qr_source_url=None,
    )
    request = SimpleNamespace(
        id=uuid4(),
        request_id=request_id,
        payment_reference="TP123456789PABCDEFGH",
        status="OPEN",
        provider="manual",
        settlement_account_id=account_id,
        currency="VND",
        expected_amount=750000,
        early_payment=False,
        expires_at=None,
        sent_at=None,
        sent_channel=None,
        send_count=0,
        created_at=datetime.now(timezone.utc),
        provider_metadata={},
    )

    response = await to_payment_request_response(_Db(item, account), request)

    assert response.qr_payload is not None
    assert response.qr_payload["manual_qr_url"].startswith(
        f"/api/proxy/banking/accounts/{account_id}/qr?v="
    )
    assert response.qr_payload["receiving_account"] == {
        "id": str(account_id),
        "label": "Tài khoản chính",
        "bank_name": "Vietcombank",
        "account_number": "1234567890",
        "account_name": "TPRO ENGLISH",
    }


@pytest.mark.asyncio
async def test_pay2s_request_never_mixes_in_a_manual_qr() -> None:
    item = SimpleNamespace(
        fee_record_id=uuid4(),
        enrollment_id=uuid4(),
        student_code_snapshot="TP123456789",
        class_name_snapshot="Lớp thử nghiệm",
        cycle_no=1,
        base_due_date=None,
        adjusted_due_date=None,
        expected_amount=750000,
    )
    request = SimpleNamespace(
        id=uuid4(),
        request_id=uuid4(),
        payment_reference="TP123456789PABCDEFGH",
        status="OPEN",
        provider="pay2s",
        settlement_account_id=uuid4(),
        currency="VND",
        expected_amount=750000,
        early_payment=False,
        expires_at=None,
        sent_at=None,
        sent_channel=None,
        send_count=0,
        created_at=datetime.now(timezone.utc),
        provider_metadata={
            "collection_link": {
                "payment_url": "https://payment.pay2s.vn/example",
                "qr_list": ["https://payment.pay2s.vn/example.png"],
            }
        },
    )

    response = await to_payment_request_response(_ItemsOnlyDb(item), request)

    assert response.qr_payload is not None
    assert response.qr_payload["payment_url"].startswith("https://payment.pay2s.vn/")
    assert "manual_qr_url" not in response.qr_payload
