"""Check-in window (R8-D13): only from the exact session start, for a
per-staff number of hours (default 24), never before the session begins."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.core.business_time import BUSINESS_TIMEZONE
from app.services.attendance_service import check_in


def _occurrence(start_at):
    return SimpleNamespace(
        class_id="class-1",
        original_start_at=start_at,
        original_end_at=start_at + timedelta(minutes=90),
        slot_id="slot-1",
        kind="REGULAR",
        staff_role="TEACHER",
    )


def _entry(rate_amount: int = 100000, start_at=None):
    return SimpleNamespace(
        id=str(uuid4()),
        staff_id="staff-1",
        checkin_at=datetime.now(timezone.utc),
        rate_amount=rate_amount,
        occurrence_start_at=start_at,
        status="CHECKED_IN",
    )


def _rate():
    return SimpleNamespace(rate_amount=100000, version=1)


def _make_db(staff_window: int | None, start_at, *, resolver_result) -> AsyncMock:
    db = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.get.return_value = (
        SimpleNamespace(checkin_window_after_hours=staff_window, id="staff-1")
        if staff_window is not None
        else None
    )
    # scalar calls: request_id lookup (None), existing occurrence lookup (None),
    # then the refreshed entry after commit.
    db.scalar.side_effect = [None, None, _entry(start_at=start_at)]
    db.execute.return_value = SimpleNamespace(scalar_one_or_none=lambda: _rate())
    return db


async def _run_check_in(db, start_at, occurrence=None):
    resolved = occurrence or _occurrence(start_at)
    with patch(
        "app.services.attendance_occurrence_service.resolve_occurrence_for_staff",
        new=AsyncMock(return_value=resolved),
    ):
        return await check_in(
            db,
            SimpleNamespace(staff_id="staff-1", user_id="u1"),
            "00000000-0000-0000-0000-000000000001",
            SimpleNamespace(request_id="00000000-0000-0000-0000-000000000002"),
        )


@pytest.mark.asyncio
async def test_checkin_before_session_start_is_rejected() -> None:
    from fastapi import HTTPException

    start_at = datetime.now(BUSINESS_TIMEZONE) + timedelta(minutes=5)
    db = _make_db(24, start_at, resolver_result=None)
    with pytest.raises(HTTPException) as exc:
        await _run_check_in(db, start_at)
    assert "Chưa đến giờ bắt đầu" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_checkin_within_default_window_succeeds() -> None:
    start_at = datetime.now(BUSINESS_TIMEZONE) - timedelta(minutes=10)
    db = _make_db(24, start_at, resolver_result=None)
    response = await _run_check_in(db, start_at)
    assert response.rate_amount == 100000
    assert response.status == "CHECKED_IN"


@pytest.mark.asyncio
async def test_checkin_after_default_window_is_rejected() -> None:
    from fastapi import HTTPException

    start_at = datetime.now(BUSINESS_TIMEZONE) - timedelta(hours=25)
    db = _make_db(24, start_at, resolver_result=None)
    with pytest.raises(HTTPException) as exc:
        await _run_check_in(db, start_at)
    assert "quá hạn" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_checkin_uses_custom_per_staff_window() -> None:
    from fastapi import HTTPException

    # Staff allows a 2-hour window; 3 hours later is already expired.
    start_at = datetime.now(BUSINESS_TIMEZONE) - timedelta(hours=3)
    db = _make_db(2, start_at, resolver_result=None)
    with pytest.raises(HTTPException) as exc:
        await _run_check_in(db, start_at)
    assert "quá hạn" in str(exc.value.detail)

    # A 2-hour window still accepts a check-in at +1 hour.
    start_at_ok = datetime.now(BUSINESS_TIMEZONE) - timedelta(hours=1)
    db_ok = _make_db(2, start_at_ok, resolver_result=None)
    response = await _run_check_in(db_ok, start_at_ok)
    assert response.status == "CHECKED_IN"
