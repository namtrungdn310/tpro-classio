"""Pure calendar-helper tests (class duration is not billing-bound)."""

from datetime import date

import pytest

from app.core.class_dates import add_months_eom_clamped


@pytest.mark.parametrize(
    ("value", "months", "expected"),
    [
        (date(2026, 8, 13), 1, date(2026, 9, 13)),
        (date(2026, 8, 13), 2, date(2026, 10, 13)),
        (date(2027, 1, 31), 1, date(2027, 2, 28)),
        (date(2028, 2, 29), 1, date(2028, 3, 31)),
        (date(2024, 1, 31), 1, date(2024, 2, 29)),
        (date(2026, 8, 31), 1, date(2026, 9, 30)),
    ],
)
def test_add_months_eom_clamped(
    value: date,
    months: int,
    expected: date,
) -> None:
    assert add_months_eom_clamped(value, months) == expected
