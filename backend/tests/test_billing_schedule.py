"""R6-D06/V06 — pure billing-schedule contract (test.md §4)."""

from datetime import date

import pytest

from app.core.billing_schedule import (
    COURSE,
    MONTHLY,
    add_months_clamped,
    adjusted_due_after_deferral,
    cycle_base_due_date,
    cycle_coverage_interval,
    cycle_exists,
    month_end,
    period_key,
)


@pytest.mark.parametrize(
    ("enrollment_date", "cycle_no", "expected"),
    [
        (date(2026, 8, 14), 0, date(2026, 8, 14)),
        (date(2026, 8, 14), 1, date(2026, 9, 14)),
        (date(2026, 8, 14), 2, date(2026, 10, 14)),
        (date(2027, 1, 31), 1, date(2027, 2, 28)),
        (date(2027, 1, 31), 2, date(2027, 3, 31)),
        (date(2028, 1, 31), 1, date(2028, 2, 29)),
    ],
)
def test_monthly_cycle_base_due(
    enrollment_date: date, cycle_no: int, expected: date
) -> None:
    assert cycle_base_due_date(enrollment_date, MONTHLY, None, cycle_no) == expected


@pytest.mark.parametrize(
    ("enrollment_date", "weeks", "cycle_no", "expected"),
    [
        (date(2026, 8, 20), 3, 0, date(2026, 8, 20)),
        (date(2026, 8, 20), 3, 1, date(2026, 9, 10)),
        (date(2026, 8, 20), 3, 2, date(2026, 10, 1)),
        (date(2026, 12, 31), 1, 1, date(2027, 1, 7)),
    ],
)
def test_course_cycle_base_due(
    enrollment_date: date, weeks: int, cycle_no: int, expected: date
) -> None:
    assert cycle_base_due_date(enrollment_date, COURSE, weeks, cycle_no) == expected


def test_coverage_interval() -> None:
    start, end = cycle_coverage_interval(date(2026, 8, 14), MONTHLY, None, 1)
    assert (start, end) == (date(2026, 9, 14), date(2026, 10, 14))
    start, end = cycle_coverage_interval(date(2026, 8, 20), COURSE, 3, 1)
    assert (start, end) == (date(2026, 9, 10), date(2026, 10, 1))
    # Cycle 0 coverage bắt đầu ngay enrollment date.
    start, end = cycle_coverage_interval(date(2026, 8, 14), MONTHLY, None, 0)
    assert (start, end) == (date(2026, 8, 14), date(2026, 9, 14))


@pytest.mark.parametrize(
    ("coverage_start", "class_end", "expected"),
    [
        (date(2026, 9, 14), date(2026, 12, 31), True),
        (date(2026, 12, 31), date(2026, 12, 31), False),
        (date(2027, 1, 1), date(2026, 12, 31), False),
        (date(2026, 9, 14), None, True),
    ],
)
def test_cycle_exists(
    coverage_start: date, class_end: date | None, expected: bool
) -> None:
    assert cycle_exists(coverage_start, class_end) is expected


def test_credit_can_push_adjusted_due_past_class_end_without_losing_cycle() -> None:
    coverage_start = date(2026, 12, 1)
    class_end = date(2026, 12, 31)
    # Coverage hợp lệ (bắt đầu trước end) dù adjusted due vượt end.
    assert cycle_exists(coverage_start, class_end) is True
    adjusted = adjusted_due_after_deferral(date(2026, 12, 1), 20)
    assert adjusted == date(2026, 12, 21)


def test_adjusted_due_never_reduces_base() -> None:
    assert adjusted_due_after_deferral(date(2026, 9, 14), 0) == date(2026, 9, 14)
    assert adjusted_due_after_deferral(date(2026, 9, 14), -5) == date(2026, 9, 14)


def test_period_is_derived_bucket() -> None:
    assert period_key(date(2026, 9, 14)) == "2026-09"
    assert period_key(date(2026, 11, 30)) == "2026-11"
    assert period_key(None) is None


def test_add_months_clamped_and_month_end() -> None:
    assert add_months_clamped(date(2027, 1, 31), 1) == date(2027, 2, 28)
    assert add_months_clamped(date(2027, 1, 31), 2) == date(2027, 3, 31)
    assert month_end(date(2026, 2, 5)) == date(2026, 2, 28)
    assert month_end(date(2028, 2, 5)) == date(2028, 2, 29)
