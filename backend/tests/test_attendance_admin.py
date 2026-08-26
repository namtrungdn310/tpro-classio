"""Admin/dev manual attendance: clock in against a real session and undo a
wrong check-in with an append-only compensating REVERSAL (never deletes)."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.business_time import BUSINESS_TIMEZONE
from app.services.attendance_service import manual_check_in, reverse_attendance


def _occurrence():
    return SimpleNamespace(
        class_id="class-1",
        original_start_at=datetime.now(BUSINESS_TIMEZONE) - timedelta(hours=2),
        original_end_at=datetime.now(BUSINESS_TIMEZONE) - timedelta(minutes=30),
        slot_id="slot-1",
        kind="REGULAR",
        staff_role="TEACHER",
    )


def _staff(active: bool = True):
    return SimpleNamespace(id="staff-1", is_active=active)


def _entry(staff_id: str = "staff-1"):
    return SimpleNamespace(
        id=str(uuid4()),
        staff_id=staff_id,
        occurrence_class_id="class-1",
        occurrence_slot_id="slot-1",
        occurrence_start_at=datetime.now(BUSINESS_TIMEZONE) - timedelta(hours=2),
        occurrence_end_at=datetime.now(BUSINESS_TIMEZONE) - timedelta(minutes=30),
        occurrence_kind="REGULAR",
        staff_role="TEACHER",
        scheduled_start_at=datetime.now(BUSINESS_TIMEZONE) - timedelta(hours=2),
        checkin_at=datetime.now(timezone.utc),
        rate_amount=100000,
        rate_version=1,
        request_id=str(uuid4()),
        reversed_at=None,
        reversed_by=None,
        reversal_reason=None,
    )


def _make_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.get.side_effect = lambda model, id_: (
        _staff() if model.__name__ == "StaffMember" else _entry()
    )
    db.execute.return_value = SimpleNamespace(
        scalar_one_or_none=lambda: SimpleNamespace(rate_amount=100000, version=1)
    )
    return db


@pytest.mark.asyncio
async def test_manual_check_in_creates_earning_entry() -> None:
    db = _make_db()
    db.scalar.side_effect = [
        None,
        None,
        _entry(),
    ]  # request lookup, existing occurrence, refresh
    with patch(
        "app.services.attendance_occurrence_service.resolve_occurrence_for_staff",
        new=AsyncMock(return_value=_occurrence()),
    ):
        response = await manual_check_in(
            db,
            uuid4(),
            SimpleNamespace(
                occurrence_id=uuid4(), request_id=uuid4(), reason="quên chấm"
            ),
            actor_user_id="u1",
        )
    assert response.status == "CHECKED_IN"
    assert response.rate_amount == 100000
    ledger_added = [call.args[0] for call in db.add.call_args_list]
    assert any(getattr(item, "entry_type", None) == "EARNING" for item in ledger_added)


@pytest.mark.asyncio
async def test_manual_check_in_rejects_inactive_staff() -> None:
    db = _make_db()
    db.get.side_effect = lambda model, id_: _staff(active=False)
    with pytest.raises(HTTPException) as exc:
        await manual_check_in(
            db,
            uuid4(),
            SimpleNamespace(occurrence_id=uuid4(), request_id=uuid4(), reason=None),
            actor_user_id="u1",
        )
    assert "không tìm thấy nhân sự" in str(
        exc.value.detail
    ).lower() or "Nhân sự" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_manual_check_in_rejects_already_clocked_session() -> None:
    db = _make_db()
    db.scalar.side_effect = [
        None,
        _entry(),
    ]  # request lookup None, existing occurrence found
    with patch(
        "app.services.attendance_occurrence_service.resolve_occurrence_for_staff",
        new=AsyncMock(return_value=_occurrence()),
    ):
        with pytest.raises(HTTPException) as exc:
            await manual_check_in(
                db,
                uuid4(),
                SimpleNamespace(occurrence_id=uuid4(), request_id=uuid4(), reason=None),
                actor_user_id="u1",
            )
    assert "đã được chấm công" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_reverse_attendance_writes_compensating_reversal() -> None:
    db = _make_db()
    earning = SimpleNamespace(id=str(uuid4()), staff_id="staff-1")
    db.scalar.return_value = None  # allocated check returns None (not settled)
    # Reverse path: db.get(StaffMember) then db.get(StaffAttendanceEntry)
    db.get.side_effect = lambda model, id_: (
        _staff() if model.__name__ == "StaffMember" else _entry()
    )
    with patch(
        "app.services.attendance_service.manual_check_in",  # noqa: B018
    ):
        pass

    entry = _entry()
    db.get.side_effect = lambda model, id_: entry
    # Override scalar sequence for reversal: replay lookup -> None, earning ->
    # earning, allocated-in-settlement -> None.
    db.scalar.side_effect = [None, earning, None]

    staff_id = uuid4()
    entry.staff_id = str(staff_id)
    response = await reverse_attendance(
        db,
        staff_id,
        uuid4(),
        SimpleNamespace(request_id=uuid4(), reason="chấm nhầm"),
        actor_user_id="u2",
    )
    assert response.attendance_id is not None
    ledger_added = [call.args[0] for call in db.add.call_args_list]
    reversal = next(
        (
            item
            for item in ledger_added
            if getattr(item, "entry_type", None) == "REVERSAL"
        ),
        None,
    )
    assert reversal is not None
    assert reversal.amount == -100000
    assert reversal.related_entry_id == earning.id
    # Original entry must be marked reversed (mutated object persists in test).
    assert entry.reversed_at is not None
    assert entry.reversal_reason == "chấm nhầm"
