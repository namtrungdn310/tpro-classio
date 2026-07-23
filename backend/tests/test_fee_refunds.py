from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.payment import Payment
from app.models.student import Student
from app.schemas.fee import FeeBatchRefundRequest
from app.services.fee_service import _to_response, refund_fee_records


TODAY = date(2026, 7, 16)


@pytest.fixture(autouse=True)
def isolate_fee_operation_ledger():
    with patch(
        "app.services.fee_service.append_fee_operation",
        new=AsyncMock(),
    ):
        yield


def make_paid_record(*, paid: int = 750_000, refunded: int = 0) -> FeeRecord:
    class_ = Class(
        id=str(uuid4()),
        name="6C1",
        type="MONTHLY",
        base_fee=Decimal(paid),
        billing_cycle_months=1,
        is_active=True,
    )
    student = Student(
        id=str(uuid4()),
        full_name="Nguyễn Minh An",
        hidden_fields=[],
        status="active",
    )
    enrollment = Enrollment(
        id=str(uuid4()),
        student_id=student.id,
        class_id=class_.id,
        enrollment_date=date(2026, 6, 5),
        status="active",
    )
    enrollment.class_ = class_
    enrollment.student = student
    record = FeeRecord(
        id=str(uuid4()),
        enrollment_id=enrollment.id,
        period="2026-07",
        due_date=date(2026, 7, 5),
        base_amount=Decimal(paid),
        discount_amount=Decimal(0),
        status="PAID",
        notified_at=datetime(2026, 7, 5, tzinfo=timezone.utc),
        notification_channel="zalo_manual",
        notification_message="Thông báo học phí",
        paid_amount=Decimal(paid),
        paid_date=date(2026, 7, 10),
        refunded_amount=Decimal(refunded),
    )
    record.final_amount = Decimal(paid)
    record.enrollment = enrollment
    return record


def make_db() -> SimpleNamespace:
    return SimpleNamespace(
        add=Mock(),
        commit=AsyncMock(),
        flush=AsyncMock(),
        rollback=AsyncMock(),
        execute=AsyncMock(),
    )


def make_payload(record: FeeRecord, *, amount: int = 250_000):
    return FeeBatchRefundRequest(
        request_id=uuid4(),
        items=[{"record_id": record.id, "amount": amount}],
        refund_method="bank_transfer",
        reason="Học viên dừng khóa học sớm",
    )


def test_refund_schema_rejects_zero_and_duplicate_records() -> None:
    record_id = uuid4()
    with pytest.raises(ValidationError):
        FeeBatchRefundRequest(
            request_id=uuid4(),
            items=[{"record_id": record_id, "amount": 0}],
            reason="Dừng học",
        )

    with pytest.raises(ValidationError) as exc_info:
        FeeBatchRefundRequest(
            request_id=uuid4(),
            items=[
                {"record_id": record_id, "amount": 100_000},
                {"record_id": record_id, "amount": 50_000},
            ],
            reason="Dừng học",
        )
    assert "chỉ được hoàn một lần" in str(exc_info.value)


def test_refund_schema_allows_an_omitted_reason() -> None:
    payload = FeeBatchRefundRequest(
        request_id=uuid4(),
        items=[{"record_id": uuid4(), "amount": 100_000}],
    )

    assert payload.reason == ""


@pytest.mark.asyncio
async def test_partial_refund_appends_a_negative_idempotent_ledger_entry() -> None:
    record = make_paid_record(refunded=100_000)
    payload = make_payload(record, amount=250_000)
    payment_id = str(uuid4())
    actor_id = str(uuid4())
    db = make_db()

    async def assign_server_defaults() -> None:
        entry = db.add.call_args.args[0]
        entry.id = str(uuid4())
        entry.created_at = datetime(2026, 7, 16, 3, 30, tzinfo=timezone.utc)

    db.flush.side_effect = assign_server_defaults

    async def return_refreshed(*_args, **_kwargs):
        record.refunded_amount = Decimal(350_000)
        return [record]

    with (
        patch("app.services.fee_service._lock_refund_request", new=AsyncMock()),
        patch(
            "app.services.fee_service._get_refund_entries",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service._get_payment_ledger_states",
            new=AsyncMock(
                return_value={
                    record.id: SimpleNamespace(
                        has_entries=True,
                        net_amount=650_000,
                        payment_id=payment_id,
                        payment_method="bank_transfer",
                    )
                }
            ),
        ),
        patch(
            "app.services.fee_service._get_fee_records_by_ids",
            new=AsyncMock(side_effect=return_refreshed),
        ),
        patch("app.services.fee_service.business_today", return_value=TODAY),
    ):
        response = await refund_fee_records(db, payload, actor_id=actor_id)

    entry = db.add.call_args.args[0]
    assert isinstance(entry, Payment)
    assert int(entry.amount) == -250_000
    assert entry.entry_type == "refund"
    assert entry.related_payment_id == payment_id
    assert entry.idempotency_key == str(payload.request_id)
    assert entry.created_by == actor_id
    assert response.receipt.total_amount == 250_000
    assert str(response.receipt.items[0].transaction_id) == entry.id
    assert response.records[0].refunded_amount == 350_000
    assert response.records[0].net_collected_amount == 400_000
    assert response.records[0].refund_state == "PARTIAL"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_refund_rejects_amount_over_the_remaining_paid_balance() -> None:
    record = make_paid_record(refunded=700_000)
    payload = make_payload(record, amount=50_001)
    db = make_db()

    with (
        patch("app.services.fee_service._lock_refund_request", new=AsyncMock()),
        patch(
            "app.services.fee_service._get_refund_entries",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service._get_payment_ledger_states",
            new=AsyncMock(
                return_value={
                    record.id: SimpleNamespace(
                        has_entries=True,
                        net_amount=50_000,
                        payment_id=str(uuid4()),
                    )
                }
            ),
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await refund_fee_records(db, payload, actor_id=str(uuid4()))

    assert exc_info.value.status_code == 409
    assert "vượt quá" in exc_info.value.detail
    db.add.assert_not_called()
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()


def test_response_keeps_paid_status_and_derives_full_refund_values() -> None:
    record = make_paid_record(refunded=750_000)
    response = _to_response(record)

    assert response.status == "PAID"
    assert response.notification_state == "PAID"
    assert response.refund_state == "FULL"
    assert response.refundable_amount == 0
    assert response.net_collected_amount == 0
