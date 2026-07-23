from datetime import date
from types import SimpleNamespace

from app.core.billing import (
    add_months_clamped,
    get_course_weeks,
    get_enrollment_due_date_in_month,
)


def test_add_months_clamps_to_last_day_of_month() -> None:
    assert add_months_clamped(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months_clamped(date(2028, 1, 31), 1) == date(2028, 2, 29)


def test_monthly_fee_remains_due_after_due_date_has_passed() -> None:
    enrollment = SimpleNamespace(
        enrollment_date=date(2026, 6, 5),
        class_=SimpleNamespace(type="MONTHLY", billing_cycle_months=1),
    )

    assert get_enrollment_due_date_in_month(
        enrollment,
        date(2026, 7, 11),
    ) == date(2026, 7, 5)


def test_course_fee_uses_week_based_cycle() -> None:
    enrollment = SimpleNamespace(
        enrollment_date=date(2026, 1, 1),
        class_=SimpleNamespace(type="COURSE", billing_cycle_months=3),
    )

    assert get_enrollment_due_date_in_month(
        enrollment,
        date(2026, 3, 31),
    ) == date(2026, 3, 26)


def test_course_cycle_supports_every_valid_month_value() -> None:
    assert get_course_weeks(2) == 8
    assert get_course_weeks(3) == 12
    assert get_course_weeks(6) == 24
    assert get_course_weeks(12) == 48


def test_fee_is_not_due_outside_the_class_date_range() -> None:
    enrollment = SimpleNamespace(
        enrollment_date=date(2026, 6, 5),
        class_=SimpleNamespace(
            type="MONTHLY",
            billing_cycle_months=1,
            start_date=date(2026, 7, 10),
            end_date=date(2026, 8, 31),
        ),
    )

    assert get_enrollment_due_date_in_month(enrollment, date(2026, 7, 15)) is None
    assert get_enrollment_due_date_in_month(
        enrollment,
        date(2026, 8, 15),
    ) == date(2026, 8, 5)
    assert get_enrollment_due_date_in_month(enrollment, date(2026, 9, 15)) is None
