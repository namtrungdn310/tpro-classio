from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest

from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.student import Student
from app.services.fee_reconciliation import reconcile_fee_record_for_period
from app.services.fee_service import build_zalo_fee_message, mark_fee_paid


def make_enrollment(
    *, enrollment_date: date, class_type: str = "MONTHLY", cycle_months: int = 1
) -> Enrollment:
    class_ = Class(
        id=str(uuid4()),
        name="6C1",
        type=class_type,
        base_fee=Decimal("750000"),
        billing_cycle_months=cycle_months,
        is_active=True,
    )
    enrollment = Enrollment(
        id=str(uuid4()),
        student_id=str(uuid4()),
        class_id=class_.id,
        enrollment_date=enrollment_date,
        status="active",
    )
    enrollment.class_ = class_
    return enrollment


@pytest.mark.asyncio
async def test_reconcile_creates_overdue_fee_in_current_period() -> None:
    enrollment = make_enrollment(enrollment_date=date(2026, 6, 5))
    db = SimpleNamespace(add=Mock(), delete=AsyncMock(), scalar=AsyncMock())

    changed = await reconcile_fee_record_for_period(
        db,
        enrollment,
        "2026-07",
        date(2026, 7, 14),
        existing_record=None,
    )

    assert changed is True
    created = db.add.call_args.args[0]
    assert created.due_date == date(2026, 7, 5)
    assert created.enrollment_date_snapshot == date(2026, 6, 5)
    db.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_reconcile_updates_only_unnotified_unpaid_snapshot() -> None:
    enrollment = make_enrollment(enrollment_date=date(2026, 6, 20))
    record = FeeRecord(
        id=str(uuid4()),
        enrollment_id=enrollment.id,
        period="2026-07",
        due_date=date(2026, 7, 5),
        enrollment_date_snapshot=date(2026, 6, 5),
        base_amount=Decimal("700000"),
        discount_amount=Decimal("0"),
        status="UNPAID",
    )
    db = SimpleNamespace(add=Mock(), delete=AsyncMock(), scalar=AsyncMock())

    changed = await reconcile_fee_record_for_period(
        db,
        enrollment,
        "2026-07",
        date(2026, 7, 14),
        existing_record=record,
    )

    assert changed is True
    assert record.due_date == date(2026, 7, 20)
    assert record.enrollment_date_snapshot == date(2026, 6, 20)
    assert int(record.base_amount) == 750000


@pytest.mark.asyncio
async def test_reconcile_preserves_notified_record_when_schedule_moves() -> None:
    enrollment = make_enrollment(enrollment_date=date(2026, 7, 20))
    original_due_date = date(2026, 7, 5)
    record = FeeRecord(
        id=str(uuid4()),
        enrollment_id=enrollment.id,
        period="2026-07",
        due_date=original_due_date,
        enrollment_date_snapshot=date(2026, 6, 5),
        base_amount=Decimal("750000"),
        discount_amount=Decimal("0"),
        status="UNPAID",
        notified_at=datetime(2026, 7, 3, tzinfo=timezone.utc),
    )
    db = SimpleNamespace(add=Mock(), delete=AsyncMock(), scalar=AsyncMock())

    changed = await reconcile_fee_record_for_period(
        db,
        enrollment,
        "2026-07",
        date(2026, 7, 14),
        existing_record=record,
    )

    assert changed is False
    assert record.due_date == original_due_date
    db.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_reconcile_deletes_only_unprotected_non_due_record() -> None:
    enrollment = make_enrollment(enrollment_date=date(2026, 7, 20))
    record = FeeRecord(
        id=str(uuid4()),
        enrollment_id=enrollment.id,
        period="2026-07",
        due_date=date(2026, 7, 5),
        enrollment_date_snapshot=date(2026, 6, 5),
        base_amount=Decimal("750000"),
        discount_amount=Decimal("0"),
        status="UNPAID",
    )
    db = SimpleNamespace(add=Mock(), delete=AsyncMock(), scalar=AsyncMock())

    changed = await reconcile_fee_record_for_period(
        db,
        enrollment,
        "2026-07",
        date(2026, 7, 14),
        existing_record=record,
    )

    assert changed is True
    db.delete.assert_awaited_once_with(record)


@pytest.mark.asyncio
async def test_reconcile_removes_draft_when_class_is_archived() -> None:
    enrollment = make_enrollment(enrollment_date=date(2026, 6, 5))
    enrollment.class_.is_active = False
    record = FeeRecord(
        id=str(uuid4()),
        enrollment_id=enrollment.id,
        period="2026-07",
        due_date=date(2026, 7, 5),
        enrollment_date_snapshot=date(2026, 6, 5),
        base_amount=Decimal("750000"),
        discount_amount=Decimal("0"),
        status="UNPAID",
    )
    db = SimpleNamespace(add=Mock(), delete=AsyncMock(), scalar=AsyncMock())

    changed = await reconcile_fee_record_for_period(
        db,
        enrollment,
        "2026-07",
        date(2026, 7, 14),
        existing_record=record,
    )

    assert changed is True
    db.delete.assert_awaited_once_with(record)


def test_zalo_message_uses_immutable_due_date_snapshot() -> None:
    enrollment = make_enrollment(enrollment_date=date(2026, 6, 20))
    enrollment.student = Student(
        id=enrollment.student_id,
        full_name="Nguyễn Minh An",
        status="active",
    )
    record = FeeRecord(
        id=str(uuid4()),
        enrollment_id=enrollment.id,
        period="2026-07",
        due_date=date(2026, 7, 5),
        enrollment_date_snapshot=date(2026, 6, 5),
        base_amount=Decimal("750000"),
        discount_amount=Decimal("0"),
        status="UNPAID",
    )
    record.final_amount = Decimal("750000")
    record.enrollment = enrollment

    message = build_zalo_fee_message(record)

    assert message.startswith("TPRO English")
    assert "05/07/2026" in message
    assert "20/07/2026" not in message


@pytest.mark.asyncio
async def test_mark_paid_is_idempotent() -> None:
    enrollment = make_enrollment(enrollment_date=date(2026, 6, 5))
    enrollment.student = Student(
        id=enrollment.student_id,
        full_name="Nguyễn Minh An",
        status="active",
    )
    original_paid_date = date(2026, 7, 7)
    record = FeeRecord(
        id=str(uuid4()),
        enrollment_id=enrollment.id,
        period="2026-07",
        due_date=date(2026, 7, 5),
        enrollment_date_snapshot=date(2026, 6, 5),
        base_amount=Decimal("750000"),
        discount_amount=Decimal("0"),
        status="PAID",
        notified_at=datetime(2026, 7, 3, tzinfo=timezone.utc),
        paid_amount=Decimal("750000"),
        paid_date=original_paid_date,
    )
    record.final_amount = Decimal("750000")
    record.enrollment = enrollment
    db = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())

    with patch(
        "app.services.fee_service._load_locked_fee_records",
        new=AsyncMock(return_value=[record]),
    ):
        response = await mark_fee_paid(db, uuid4())

    assert response is not None
    assert response.paid_date == original_paid_date
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()
