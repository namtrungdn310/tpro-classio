from calendar import monthrange
from datetime import date, timedelta
from typing import Any

from app.core.business_time import business_today


def get_billing_period_key(value: date | None = None) -> str:
    reference = value or business_today()
    return reference.strftime("%Y-%m")


def get_course_weeks(billing_cycle_months: int | None) -> int:
    months = int(billing_cycle_months or 3)
    return max(months, 1) * 4


def get_enrollment_fee_amount(enrollment: Any) -> int:
    if enrollment.custom_fee is not None:
        return int(enrollment.custom_fee)

    class_ = getattr(enrollment, "class_", None)
    if class_ is None:
        return 0

    return int(class_.base_fee)


def get_enrollment_due_date_in_month(
    enrollment: Any,
    reference_date: date | None = None,
) -> date | None:
    class_ = getattr(enrollment, "class_", None)
    enrollment_date = getattr(enrollment, "enrollment_date", None)
    if class_ is None or enrollment_date is None:
        return None

    reference = reference_date or business_today()
    month_start = date(reference.year, reference.month, 1)
    month_end = date(
        reference.year,
        reference.month,
        monthrange(reference.year, reference.month)[1],
    )

    if class_.type == "COURSE":
        due_date = _get_course_due_date_in_month(
            enrollment_date,
            get_course_weeks(class_.billing_cycle_months),
            month_start,
            month_end,
        )
    else:
        due_date = _get_monthly_due_date_in_month(enrollment_date, month_start)

    if due_date is None:
        return None

    class_start_date = getattr(class_, "start_date", None)
    class_end_date = getattr(class_, "end_date", None)
    if class_start_date is not None and due_date < class_start_date:
        return None
    if class_end_date is not None and due_date > class_end_date:
        return None
    return due_date


def is_enrollment_due_in_month(
    enrollment: Any,
    reference_date: date | None = None,
) -> bool:
    return get_enrollment_due_date_in_month(enrollment, reference_date) is not None


def _get_monthly_due_date_in_month(
    enrollment_date: date,
    month_start: date,
) -> date | None:
    first_due_date = add_months_clamped(enrollment_date, 1)
    due_date = date(
        month_start.year,
        month_start.month,
        min(
            enrollment_date.day,
            monthrange(month_start.year, month_start.month)[1],
        ),
    )

    if due_date < first_due_date:
        return None

    return due_date


def _get_course_due_date_in_month(
    enrollment_date: date,
    weeks: int,
    month_start: date,
    month_end: date,
) -> date | None:
    cycle_days = weeks * 7
    first_due_date = enrollment_date + timedelta(days=cycle_days)
    if month_end < first_due_date:
        return None

    if first_due_date >= month_start:
        return first_due_date

    days_after_first_due = (month_start - first_due_date).days
    cycles_to_month = (days_after_first_due + cycle_days - 1) // cycle_days
    due_date = first_due_date + timedelta(days=cycles_to_month * cycle_days)

    if due_date > month_end:
        return None

    return due_date


def add_months_clamped(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    year = month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)
