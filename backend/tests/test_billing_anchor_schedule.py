from datetime import date

import pytest

from app.core.billing_schedule import (
    cycle_base_due_date,
    cycle_coverage_interval,
    first_actionable_cycle,
)


def test_monthly_far_past_anchor_uses_next_due_without_backfill() -> None:
    anchor = date(2025, 8, 1)
    cycle = first_actionable_cycle(
        anchor, "MONTHLY", None, today=date(2026, 8, 31)
    )
    assert cycle == 13
    assert cycle_base_due_date(anchor, "MONTHLY", None, cycle) == date(2026, 9, 1)


def test_four_week_package_uses_current_package_not_next_package() -> None:
    anchor = date(2026, 8, 1)
    cycle = first_actionable_cycle(
        anchor, "COURSE", 4, today=date(2026, 8, 31)
    )
    assert cycle == 1
    assert cycle_coverage_interval(anchor, "COURSE", 4, cycle) == (
        date(2026, 8, 29),
        date(2026, 9, 26),
    )


def test_package_skips_current_only_when_protected_history_overlaps() -> None:
    anchor = date(2026, 8, 1)
    cycle = first_actionable_cycle(
        anchor,
        "COURSE",
        4,
        today=date(2026, 8, 31),
        protected_through=date(2026, 9, 20),
    )
    assert cycle == 2
    assert cycle_base_due_date(anchor, "COURSE", 4, cycle) == date(2026, 9, 26)


@pytest.mark.parametrize(
    ("anchor", "today", "expected"),
    [
        (date(2026, 10, 15), date(2026, 8, 31), date(2026, 10, 15)),
        (date(2026, 8, 31), date(2026, 8, 31), date(2026, 8, 31)),
        (date(2024, 1, 31), date(2024, 2, 1), date(2024, 2, 29)),
    ],
)
def test_monthly_actionable_boundaries(
    anchor: date, today: date, expected: date
) -> None:
    cycle = first_actionable_cycle(anchor, "MONTHLY", None, today=today)
    assert cycle_base_due_date(anchor, "MONTHLY", None, cycle) == expected
