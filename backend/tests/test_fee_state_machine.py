from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.payment import Payment
from app.models.student import Student
from app.schemas.fee import FeeBatchRequest, FeeBatchUnpayRequest
from app.services.fee_service import (
    _to_response,
    mark_fees_notified,
    mark_fees_paid,
    mark_fees_unnotified,
    mark_fees_unpaid,
    sync_fee_records_for_period,
)


CURRENT_DAY = date(2026, 7, 15)


def make_fee_record(
    *,
    status: str = "UNPAID",
    notified_at: datetime | None = None,
    paid_amount: Decimal | None = None,
    paid_date: date | None = None,
    period: str = "2026-07",
    enrollment_date: date = date(2026, 6, 5),
    base_amount: Decimal = Decimal("750000"),
    custom_fee: Decimal | None = None,
    enrollment_status: str = "active",
    parent_phone: str | None = None,
    parent_zalo: str | None = None,
    student_phone: str | None = None,
    student_zalo: str | None = None,
    hidden_fields: list[str] | None = None,
) -> FeeRecord:
    class_ = Class(
        id=str(uuid4()),
        name="6C1",
        type="MONTHLY",
        base_fee=base_amount,
        billing_cycle_months=1,
        is_active=True,
    )
    student = Student(
        id=str(uuid4()),
        full_name="Nguyễn Minh An",
        parent_phone=parent_phone,
        parent_zalo=parent_zalo,
        student_phone=student_phone,
        student_zalo=student_zalo,
        hidden_fields=hidden_fields or [],
        status="active",
    )
    enrollment = Enrollment(
        id=str(uuid4()),
        student_id=student.id,
        class_id=class_.id,
        enrollment_date=enrollment_date,
        custom_fee=custom_fee,
        status=enrollment_status,
    )
    enrollment.class_ = class_
    enrollment.student = student

    record = FeeRecord(
        id=str(uuid4()),
        enrollment_id=enrollment.id,
        period=period,
        due_date=date(2026, 7, 5),
        enrollment_date_snapshot=date(2026, 6, 5),
        base_amount=base_amount,
        discount_amount=Decimal("0"),
        status=status,
        notified_at=notified_at,
        notification_channel="zalo_manual" if notified_at else None,
        notification_message="Thông báo học phí" if notified_at else None,
        paid_amount=paid_amount,
        paid_date=paid_date,
    )
    record.final_amount = base_amount
    record.enrollment = enrollment
    return record


def make_db() -> SimpleNamespace:
    empty_result = Mock()
    empty_result.all.return_value = []
    return SimpleNamespace(
        add=Mock(),
        delete=AsyncMock(),
        flush=AsyncMock(),
        commit=AsyncMock(),
        rollback=AsyncMock(),
        execute=AsyncMock(return_value=empty_result),
    )


@pytest.fixture(autouse=True)
def isolate_fee_operation_ledger():
    """State-machine tests assert fee mutations independently of audit storage."""

    with patch(
        "app.services.fee_service.append_fee_operation",
        new=AsyncMock(),
    ):
        yield


def test_batch_schema_rejects_duplicate_record_ids() -> None:
    record_id = uuid4()

    with pytest.raises(ValidationError) as exc_info:
        FeeBatchRequest(record_ids=[record_id, record_id])

    error = exc_info.value.errors()[0]
    assert error["loc"] == ("record_ids",)
    assert "không được chứa khoản trùng lặp" in error["msg"]


def test_unpay_schema_defaults_to_notified_and_accepts_unnotified() -> None:
    record_id = uuid4()

    assert (
        FeeBatchUnpayRequest(record_ids=[record_id]).target_notification_state
        == "NOTIFIED_UNPAID"
    )
    assert (
        FeeBatchUnpayRequest(
            record_ids=[record_id],
            target_notification_state="UNNOTIFIED",
        ).target_notification_state
        == "UNNOTIFIED"
    )


@pytest.mark.asyncio
async def test_batch_pay_accepts_unnotified_records_without_faking_notification() -> (
    None
):
    notified_at = datetime(2026, 7, 10, tzinfo=timezone.utc)
    notified_record = make_fee_record(notified_at=notified_at)
    unnotified_record = make_fee_record(notified_at=None)
    records = [notified_record, unnotified_record]
    actor_id = str(uuid4())
    db = make_db()

    with (
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=records),
        ),
        patch(
            "app.services.fee_service._get_fee_records_by_ids",
            new=AsyncMock(return_value=records),
        ),
        patch(
            "app.services.fee_service.business_today",
            return_value=CURRENT_DAY,
        ),
    ):
        response = await mark_fees_paid(
            db,
            [UUID(notified_record.id), UUID(unnotified_record.id)],
            actor_id=actor_id,
            payment_method="bank_transfer",
        )

    assert [record.status for record in records] == ["PAID", "PAID"]
    assert unnotified_record.notified_at is None
    assert unnotified_record.notification_channel is None
    assert unnotified_record.notification_message is None
    assert response.records[1].notification_state == "PAID"
    assert response.records[1].notified_at is None
    ledger_entries = [call.args[0] for call in db.add.call_args_list]
    assert len(ledger_entries) == 2
    assert all(isinstance(entry, Payment) for entry in ledger_entries)
    assert all(entry.created_by == actor_id for entry in ledger_entries)
    db.commit.assert_awaited_once()
    db.rollback.assert_not_awaited()


@pytest.mark.asyncio
async def test_batch_pay_commits_once_and_appends_two_ledger_entries() -> None:
    notified_at = datetime(2026, 7, 10, tzinfo=timezone.utc)
    first_record = make_fee_record(notified_at=notified_at)
    second_record = make_fee_record(
        notified_at=notified_at,
        base_amount=Decimal("900000"),
    )
    records = [first_record, second_record]
    actor_id = str(uuid4())
    db = make_db()

    with (
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=records),
        ),
        patch(
            "app.services.fee_service._get_fee_records_by_ids",
            new=AsyncMock(return_value=records),
        ),
        patch(
            "app.services.fee_service.business_today",
            return_value=CURRENT_DAY,
        ),
    ):
        response = await mark_fees_paid(
            db,
            [UUID(first_record.id), UUID(second_record.id)],
            actor_id=actor_id,
            payment_method="cash",
        )

    assert [record.status for record in records] == ["PAID", "PAID"]
    assert [record.paid_date for record in records] == [CURRENT_DAY, CURRENT_DAY]
    assert [int(record.paid_amount or 0) for record in records] == [750000, 900000]
    ledger_entries = [call.args[0] for call in db.add.call_args_list]
    assert len(ledger_entries) == 2
    assert all(isinstance(entry, Payment) for entry in ledger_entries)
    assert [int(entry.amount) for entry in ledger_entries] == [750000, 900000]
    assert all(entry.payment_date == CURRENT_DAY for entry in ledger_entries)
    assert all(entry.payment_method == "cash" for entry in ledger_entries)
    assert all(entry.created_by == actor_id for entry in ledger_entries)
    assert len(response.records) == 2
    assert response.deleted_ids == []
    db.commit.assert_awaited_once()
    db.rollback.assert_not_awaited()


@pytest.mark.asyncio
async def test_unpay_appends_negative_reversal_and_preserves_notification() -> None:
    notified_at = datetime(2026, 7, 10, tzinfo=timezone.utc)
    record = make_fee_record(
        status="PAID",
        notified_at=notified_at,
        paid_amount=Decimal("750000"),
        paid_date=date(2026, 7, 12),
    )
    actor_id = str(uuid4())
    db = make_db()

    with (
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service._get_fee_records_by_ids",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service.business_today",
            return_value=CURRENT_DAY,
        ),
        patch(
            "app.services.fee_service._get_payment_ledger_states",
            new=AsyncMock(
                return_value={
                    record.id: SimpleNamespace(
                        has_entries=True,
                        net_amount=750000,
                        payment_method="cash",
                    )
                }
            ),
        ),
    ):
        response = await mark_fees_unpaid(
            db,
            [UUID(record.id)],
            actor_id=actor_id,
        )

    assert record.status == "UNPAID"
    assert record.paid_amount is None
    assert record.paid_date is None
    assert record.notified_at is notified_at
    reversal = db.add.call_args.args[0]
    assert isinstance(reversal, Payment)
    assert int(reversal.amount) == -750000
    assert reversal.payment_method == "cash"
    assert reversal.created_by == actor_id
    assert response.records[0].notification_state == "NOTIFIED_UNPAID"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_unpay_cannot_invent_notification_for_a_direct_payment() -> None:
    record = make_fee_record(
        status="PAID",
        notified_at=None,
        paid_amount=Decimal("750000"),
        paid_date=date(2026, 7, 12),
    )
    db = make_db()

    with patch(
        "app.services.fee_service._load_locked_fee_records",
        new=AsyncMock(return_value=[record]),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await mark_fees_unpaid(
                db,
                [UUID(record.id)],
                target_notification_state="NOTIFIED_UNPAID",
            )

    assert exc_info.value.status_code == 409
    assert "chỉ có thể hoàn tác về trạng thái chưa báo" in exc_info.value.detail
    assert record.status == "PAID"
    assert record.notified_at is None
    db.add.assert_not_called()
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_direct_payment_can_be_reversed_to_unnotified_with_a_ledger_entry() -> (
    None
):
    record = make_fee_record(
        status="PAID",
        notified_at=None,
        paid_amount=Decimal("750000"),
        paid_date=date(2026, 7, 12),
    )
    actor_id = str(uuid4())
    payment_id = str(uuid4())
    db = make_db()

    with (
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service._get_fee_records_by_ids",
            new=AsyncMock(return_value=[record]),
        ),
        patch("app.services.fee_service.business_today", return_value=CURRENT_DAY),
        patch(
            "app.services.fee_service._get_payment_ledger_states",
            new=AsyncMock(
                return_value={
                    record.id: SimpleNamespace(
                        has_entries=True,
                        net_amount=750000,
                        payment_method="bank_transfer",
                        payment_id=payment_id,
                    )
                }
            ),
        ),
    ):
        response = await mark_fees_unpaid(
            db,
            [UUID(record.id)],
            actor_id=actor_id,
            target_notification_state="UNNOTIFIED",
        )

    assert record.status == "UNPAID"
    assert record.paid_amount is None
    assert record.paid_date is None
    assert record.notified_at is None
    assert record.notification_channel is None
    assert record.notification_message is None
    assert response.records[0].notification_state == "UNNOTIFIED"
    reversal = db.add.call_args.args[0]
    assert isinstance(reversal, Payment)
    assert reversal.entry_type == "payment_reversal"
    assert int(reversal.amount) == -750000
    assert reversal.payment_method == "bank_transfer"
    assert reversal.related_payment_id == payment_id
    assert reversal.created_by == actor_id
    db.commit.assert_awaited_once()
    db.rollback.assert_not_awaited()


@pytest.mark.asyncio
async def test_unpay_can_atomically_return_records_to_unnotified() -> None:
    record = make_fee_record(
        status="PAID",
        notified_at=datetime(2026, 7, 10, tzinfo=timezone.utc),
        paid_amount=Decimal("750000"),
        paid_date=date(2026, 7, 12),
    )
    record.notification_channel = "zalo_manual"
    record.notification_message = "Thông báo đã gửi"
    db = make_db()

    with (
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service._get_fee_records_by_ids",
            new=AsyncMock(return_value=[record]),
        ),
        patch("app.services.fee_service.business_today", return_value=CURRENT_DAY),
        patch(
            "app.services.fee_service._get_payment_ledger_states",
            new=AsyncMock(
                return_value={
                    record.id: SimpleNamespace(
                        has_entries=True,
                        net_amount=750000,
                        payment_method="cash",
                    )
                }
            ),
        ),
    ):
        response = await mark_fees_unpaid(
            db,
            [UUID(record.id)],
            target_notification_state="UNNOTIFIED",
        )

    assert record.status == "UNPAID"
    assert record.notified_at is None
    assert record.notification_channel is None
    assert record.notification_message is None
    assert response.records[0].notification_state == "UNNOTIFIED"
    reversal = db.add.call_args.args[0]
    assert "chuyển về chưa báo" in reversal.note
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_unpay_rejects_an_inconsistent_payment_ledger() -> None:
    notified_at = datetime(2026, 7, 10, tzinfo=timezone.utc)
    record = make_fee_record(
        status="PAID",
        notified_at=notified_at,
        paid_amount=Decimal("750000"),
        paid_date=date(2026, 7, 12),
    )
    db = make_db()

    with (
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
                        net_amount=500000,
                        payment_method="cash",
                    )
                }
            ),
        ),
        patch("app.services.fee_service.business_today", return_value=CURRENT_DAY),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await mark_fees_unpaid(db, [UUID(record.id)])

    assert exc_info.value.status_code == 409
    assert "đối soát" in exc_info.value.detail
    assert record.status == "PAID"
    db.add.assert_not_called()
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_unnotify_rejects_paid_record() -> None:
    notified_at = datetime(2026, 7, 10, tzinfo=timezone.utc)
    record = make_fee_record(
        status="PAID",
        notified_at=notified_at,
        paid_amount=Decimal("750000"),
        paid_date=date(2026, 7, 12),
    )
    db = make_db()

    with patch(
        "app.services.fee_service._load_locked_fee_records",
        new=AsyncMock(return_value=[record]),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await mark_fees_unnotified(db, [UUID(record.id)])

    assert exc_info.value.status_code == 409
    assert record.status == "PAID"
    assert record.notified_at is notified_at
    assert record.paid_amount == Decimal("750000")
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_unnotify_rejects_a_reversed_fee_with_payment_history() -> None:
    notified_at = datetime(2026, 7, 10, tzinfo=timezone.utc)
    record = make_fee_record(notified_at=notified_at)
    db = make_db()

    with (
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
                        net_amount=0,
                        payment_method="cash",
                    )
                }
            ),
        ),
        patch("app.services.fee_service.business_today", return_value=CURRENT_DAY),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await mark_fees_unnotified(db, [UUID(record.id)])

    assert exc_info.value.status_code == 409
    assert "lịch sử thanh toán" in exc_info.value.detail
    assert record.notified_at is notified_at
    db.delete.assert_not_awaited()
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_unnotify_current_period_recalculates_live_amount_and_due_date() -> None:
    notified_at = datetime(2026, 7, 10, tzinfo=timezone.utc)
    record = make_fee_record(
        notified_at=notified_at,
        enrollment_date=date(2026, 6, 20),
        base_amount=Decimal("750000"),
        custom_fee=Decimal("880000"),
    )
    db = make_db()

    with (
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service._get_fee_records_by_ids",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service.business_today",
            return_value=CURRENT_DAY,
        ),
    ):
        response = await mark_fees_unnotified(db, [UUID(record.id)])

    assert record.notified_at is None
    assert record.notification_channel is None
    assert record.notification_message is None
    assert int(record.base_amount) == 880000
    assert record.due_date == date(2026, 7, 20)
    assert record.enrollment_date_snapshot == date(2026, 6, 20)
    assert response.deleted_ids == []
    assert response.records[0].due_date == date(2026, 7, 20)
    db.delete.assert_not_awaited()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_unnotify_current_period_reports_deleted_non_chargeable_record() -> None:
    record = make_fee_record(
        notified_at=datetime(2026, 7, 10, tzinfo=timezone.utc),
        enrollment_status="dropped",
    )
    record_id = UUID(record.id)
    db = make_db()

    with (
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service.business_today",
            return_value=CURRENT_DAY,
        ),
    ):
        response = await mark_fees_unnotified(db, [record_id])

    db.delete.assert_awaited_once_with(record)
    assert response.records == []
    assert response.deleted_ids == [record_id]
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_sync_rejects_historical_period_without_touching_database() -> None:
    db = make_db()

    with patch(
        "app.services.fee_service.business_today",
        return_value=CURRENT_DAY,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await sync_fee_records_for_period(db, "2026-06")

    assert exc_info.value.status_code == 409
    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()
    db.rollback.assert_not_awaited()


def test_fee_response_redacts_complete_parent_contact_marked_hidden() -> None:
    record = make_fee_record(
        parent_phone="0912345678",
        parent_zalo="Mẹ An",
        hidden_fields=["parent_contact"],
    )

    response = _to_response(record)

    assert response.parent_contact_hidden is True
    assert response.parent_phone is None
    assert response.parent_zalo is None


def test_fee_response_returns_complete_student_contact() -> None:
    record = make_fee_record(
        student_phone="0912345678",
        student_zalo="Nguyễn Minh An",
    )

    response = _to_response(record)

    assert response.student_contact_hidden is False
    assert response.student_phone == "0912345678"
    assert response.student_zalo == "Nguyễn Minh An"


def test_fee_response_redacts_complete_student_contact_marked_hidden() -> None:
    record = make_fee_record(
        student_phone="0912345678",
        student_zalo="Nguyễn Minh An",
        hidden_fields=["student_contact"],
    )

    response = _to_response(record)

    assert response.student_contact_hidden is True
    assert response.student_phone is None
    assert response.student_zalo is None


@pytest.mark.parametrize(
    ("student_phone", "student_zalo"),
    [
        ("0912345678", None),
        (None, "Nguyễn Minh An"),
    ],
)
def test_fee_response_never_exposes_incomplete_student_contact_pair(
    student_phone: str | None,
    student_zalo: str | None,
) -> None:
    record = make_fee_record(
        student_phone=student_phone,
        student_zalo=student_zalo,
    )

    response = _to_response(record)

    assert response.student_contact_hidden is False
    assert response.student_phone is None
    assert response.student_zalo is None


@pytest.mark.parametrize(
    ("parent_phone", "parent_zalo"),
    [
        ("0912345678", None),
        (None, "Mẹ An"),
    ],
)
def test_fee_response_never_exposes_incomplete_parent_contact_pair(
    parent_phone: str | None,
    parent_zalo: str | None,
) -> None:
    record = make_fee_record(
        parent_phone=parent_phone,
        parent_zalo=parent_zalo,
    )

    response = _to_response(record)

    assert response.parent_contact_hidden is False
    assert response.parent_phone is None
    assert response.parent_zalo is None


def test_protected_fee_response_uses_frozen_business_identity() -> None:
    record = make_fee_record(
        notified_at=datetime(2026, 7, 10, tzinfo=timezone.utc),
    )
    record.student_name_snapshot = "Tên học viên lúc báo"
    record.class_name_snapshot = "Tên lớp lúc báo"
    record.class_type_snapshot = "COURSE"
    record.billing_cycle_months_snapshot = 3
    record.enrollment.student.full_name = "Tên học viên mới"
    record.enrollment.class_.name = "Tên lớp mới"
    record.enrollment.class_.type = "MONTHLY"
    record.enrollment.class_.billing_cycle_months = 1

    response = _to_response(record)

    assert response.student_name == "Tên học viên lúc báo"
    assert response.class_name == "Tên lớp lúc báo"
    assert response.class_type == "COURSE"
    assert response.billing_cycle_months == 3


def test_unnotified_fee_response_uses_current_business_identity() -> None:
    record = make_fee_record()
    record.student_name_snapshot = "Tên học viên cũ"
    record.class_name_snapshot = "Tên lớp cũ"
    record.enrollment.student.full_name = "Tên học viên hiện tại"
    record.enrollment.class_.name = "Tên lớp hiện tại"

    response = _to_response(record)

    assert response.student_name == "Tên học viên hiện tại"
    assert response.class_name == "Tên lớp hiện tại"


@pytest.mark.asyncio
async def test_notify_freezes_current_business_identity() -> None:
    record = make_fee_record()
    record.enrollment.student.full_name = "Nguyễn An hiện tại"
    record.enrollment.class_.name = "7C1 hiện tại"
    db = make_db()

    with (
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service._get_fee_records_by_ids",
            new=AsyncMock(return_value=[record]),
        ),
        patch("app.services.fee_service.business_today", return_value=CURRENT_DAY),
    ):
        response = await mark_fees_notified(
            db,
            [UUID(record.id)],
            message=None,
            channel="zalo_manual",
        )

    assert record.student_name_snapshot == "Nguyễn An hiện tại"
    assert record.class_name_snapshot == "7C1 hiện tại"
    assert record.class_type_snapshot == "MONTHLY"
    assert record.billing_cycle_months_snapshot == 1
    assert response.records[0].student_name == "Nguyễn An hiện tại"
    assert response.records[0].class_name == "7C1 hiện tại"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_notify_rejects_future_period_without_mutating_record() -> None:
    record = make_fee_record(period="2026-08")
    db = make_db()

    with (
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service.business_today",
            return_value=CURRENT_DAY,
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await mark_fees_notified(
                db,
                [UUID(record.id)],
                message=None,
                channel="zalo_manual",
            )

    assert exc_info.value.status_code == 409
    assert record.notified_at is None
    assert record.notification_channel is None
    assert record.notification_message is None
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_pay_rejects_future_period_without_appending_ledger() -> None:
    record = make_fee_record(
        period="2026-08",
        notified_at=datetime(2026, 7, 10, tzinfo=timezone.utc),
    )
    db = make_db()

    with (
        patch(
            "app.services.fee_service._load_locked_fee_records",
            new=AsyncMock(return_value=[record]),
        ),
        patch(
            "app.services.fee_service.business_today",
            return_value=CURRENT_DAY,
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await mark_fees_paid(
                db,
                [UUID(record.id)],
                actor_id=str(uuid4()),
                payment_method="cash",
            )

    assert exc_info.value.status_code == 409
    assert record.status == "UNPAID"
    assert record.paid_amount is None
    assert record.paid_date is None
    db.add.assert_not_called()
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()
