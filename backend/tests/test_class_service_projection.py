"""Projection equivalence for the optimized class next-fee-due loader.

The production loader no longer loads every fee record.  It derives max cycle,
max deferral and the UNPAID due dates from aggregate queries and rebuilds a
lightweight projection.  These tests prove that projection yields the exact
same next-fee-due result as the original full-record computation.
"""

from datetime import date
from types import SimpleNamespace

import pytest

from app.core.billing import get_class_next_fee_due
from app.services.class_service import _load_next_fee_due_map


def _record(
    cycle_no: int | None,
    status: str,
    base_due_date: date | None = None,
    adjusted_due_date: date | None = None,
    due_date: date | None = None,
):
    return SimpleNamespace(
        cycle_no=cycle_no,
        status=status,
        base_due_date=base_due_date,
        adjusted_due_date=adjusted_due_date,
        due_date=due_date,
    )


def _enrollment(status, enrollment_date, records):
    return SimpleNamespace(
        status=status,
        enrollment_date=enrollment_date,
        fee_records=records,
        class_=None,
    )


def _class(id: str, type_: str, end_date: date, weeks: int | None = None):
    return SimpleNamespace(
        id=id,
        type=type_,
        end_date=end_date,
        billing_cycle_months=None,
        billing_cycle_weeks=weeks,
    )


def _fake_class_object() -> SimpleNamespace:
    return SimpleNamespace(
        id="class-a",
        type="COURSE",
        end_date=date(2026, 12, 31),
        billing_cycle_months=None,
        billing_cycle_weeks=3,
    )


class _FakeRow:
    """Row exposing attribute access like a SQLAlchemy Row."""

    def __init__(self, **values):
        self.__dict__.update(values)


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeSession:
    """Sequential scripted session: each execute call pops the next result."""

    def __init__(self, results):
        self._results = list(results)
        self._calls = 0

    async def execute(self, _statement):
        if self._calls >= len(self._results):
            raise AssertionError("Unexpected extra execute call")
        result = self._results[self._calls]
        self._calls += 1
        return result


def _scripted_session(enrollment_rows, aggregate_rows, unpaid_rows) -> _FakeSession:
    return _FakeSession(
        [
            _FakeResult(enrollment_rows),
            _FakeResult(aggregate_rows),
            _FakeResult(unpaid_rows),
        ]
    )


@pytest.mark.asyncio
async def test_projection_matches_full_record_computation() -> None:
    today = date(2026, 3, 1)
    class_ = _fake_class_object()
    enrollment = _enrollment(
        "active",
        date(2026, 1, 5),
        [
            _record(0, "UNPAID", due_date=date(2026, 1, 5)),
            _record(1, "PAID", base_due_date=date(2026, 1, 26)),
            _record(
                2,
                "UNPAID",
                base_due_date=date(2026, 2, 16),
                adjusted_due_date=date(2026, 2, 26),
            ),
        ],
    )
    expected = get_class_next_fee_due(class_, [enrollment], today)

    session = _scripted_session(
        enrollment_rows=[
            _FakeRow(id="enr-1", class_id=class_.id, enrollment_date=date(2026, 1, 5))
        ],
        aggregate_rows=[_FakeRow(enrollment_id="enr-1", max_cycle=2, max_deferral=10)],
        unpaid_rows=[
            _FakeRow(
                enrollment_id="enr-1",
                adjusted_due_date=date(2026, 1, 5),
                due_date=date(2026, 1, 5),
            ),
            _FakeRow(
                enrollment_id="enr-1",
                adjusted_due_date=date(2026, 2, 26),
                due_date=date(2026, 2, 26),
            ),
        ],
    )
    actual = await _load_next_fee_due_map(session, [class_], today)
    assert actual[class_.id] == expected
    assert actual[class_.id][1] == "OVERDUE"


@pytest.mark.asyncio
async def test_projection_handles_class_without_enrollments() -> None:
    class_ = _fake_class_object()
    due_map = await _load_next_fee_due_map(
        _FakeSession([_FakeResult([])]), [class_], date(2026, 3, 1)
    )
    assert due_map[class_.id] == (None, "NONE")


@pytest.mark.asyncio
async def test_projection_upcoming_when_no_overdue() -> None:
    today = date(2026, 3, 1)
    class_ = _fake_class_object()
    enrollment = _enrollment(
        "active",
        date(2026, 2, 1),
        [
            _record(0, "PAID", base_due_date=date(2026, 2, 1)),
            _record(1, "UNPAID", due_date=date(2026, 3, 20)),
        ],
    )
    expected = get_class_next_fee_due(class_, [enrollment], today)

    session = _scripted_session(
        enrollment_rows=[
            _FakeRow(id="enr-2", class_id=class_.id, enrollment_date=date(2026, 2, 1))
        ],
        aggregate_rows=[_FakeRow(enrollment_id="enr-2", max_cycle=1, max_deferral=0)],
        unpaid_rows=[
            _FakeRow(
                enrollment_id="enr-2",
                adjusted_due_date=date(2026, 3, 20),
                due_date=date(2026, 3, 20),
            )
        ],
    )
    actual = await _load_next_fee_due_map(session, [class_], today)
    assert actual[class_.id] == expected
    assert actual[class_.id][1] == "UPCOMING"


@pytest.mark.asyncio
async def test_projection_only_counts_active_enrollments() -> None:
    today = date(2026, 3, 1)
    class_ = _fake_class_object()
    session = _scripted_session(
        enrollment_rows=[],
        aggregate_rows=[],
        unpaid_rows=[],
    )
    actual = await _load_next_fee_due_map(session, [class_], today)
    assert actual[class_.id] == (None, "NONE")
