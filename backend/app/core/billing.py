from calendar import monthrange
from datetime import date, timedelta
from typing import Any

from app.core.business_time import business_today


def get_billing_period_key(value: date | None = None) -> str:
    reference = value or business_today()
    return reference.strftime("%Y-%m")


def get_course_weeks(
    billing_cycle_months: int | None = None,
    *,
    billing_cycle_weeks: int | None = None,
) -> int:
    """Resolve the exact package length while retaining legacy snapshot support."""

    if billing_cycle_weeks is not None:
        return max(int(billing_cycle_weeks), 1)
    months = int(billing_cycle_months or 3)
    return max(months, 1) * 4


def get_class_course_weeks(class_: Any) -> int:
    return get_course_weeks(
        getattr(class_, "billing_cycle_months", None),
        billing_cycle_weeks=getattr(class_, "billing_cycle_weeks", None),
    )


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
            get_class_course_weeks(class_),
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


NEXT_FEE_DUE_OVERDUE = "OVERDUE"
NEXT_FEE_DUE_UPCOMING = "UPCOMING"
NEXT_FEE_DUE_NONE = "NONE"


def get_enrollment_next_fee_due(
    enrollment: Any,
    reference_date: date | None = None,
) -> tuple[date, str] | None:
    """Kỳ thu gần nhất của một ghi danh đang hoạt động.

    R6: dựa trên cycle records (`cycle_no`) + schedule anchor; kỳ thiếu được
    suy từ lịch canonical (bounded bởi `coverage_start < class.end_date`),
    không quét period. Ưu tiên khoản UNPAID quá hạn gần nhất; nếu không có thì
    kỳ sắp tới gần nhất.
    """

    if getattr(enrollment, "status", None) != "active":
        return None
    class_ = getattr(enrollment, "class_", None)
    if class_ is None or getattr(enrollment, "enrollment_date", None) is None:
        return None

    reference = reference_date or business_today()
    overdue_dates: list[date] = []
    upcoming_dates: list[date] = []
    max_cycle = -1
    for record in getattr(enrollment, "fee_records", None) or []:
        cycle_no = getattr(record, "cycle_no", None)
        if cycle_no is not None:
            max_cycle = max(max_cycle, int(cycle_no))
        if getattr(record, "status", None) != "UNPAID":
            continue
        due_date = getattr(record, "due_date", None)
        if due_date is None:
            continue
        if due_date < reference:
            overdue_dates.append(due_date)
        else:
            upcoming_dates.append(due_date)

    # Kỳ kế tiếp chưa materialize: suy từ anchor canonical.
    from app.core.billing_schedule import (
        cycle_base_due_date,
        cycle_coverage_interval,
        cycle_exists,
    )

    next_due = None
    next_cycle = max_cycle + 1
    enrollment_date = enrollment.enrollment_date
    billing_type = class_.type
    cycle_weeks = (
        max(int(class_.billing_cycle_weeks or 1), 1)
        if class_.type == "COURSE"
        else None
    )
    coverage_start, _ = cycle_coverage_interval(
        enrollment_date, billing_type, cycle_weeks, next_cycle
    )
    if cycle_exists(coverage_start, class_.end_date):
        next_due = cycle_base_due_date(
            enrollment_date, billing_type, cycle_weeks, next_cycle
        )
        if next_due < reference:
            overdue_dates.append(next_due)
        else:
            upcoming_dates.append(next_due)

    if overdue_dates:
        return max(overdue_dates), NEXT_FEE_DUE_OVERDUE
    if upcoming_dates:
        return min(upcoming_dates), NEXT_FEE_DUE_UPCOMING
    return None


def get_class_next_fee_due(
    class_: Any,
    enrollments: Any,
    reference_date: date | None = None,
) -> tuple[date | None, str]:
    """Tổng hợp kỳ thu gần nhất của lớp, không kèm thông tin cá nhân học viên."""

    reference = reference_date or business_today()
    overdue_dates: list[date] = []
    upcoming_dates: list[date] = []
    for enrollment in enrollments or []:
        if getattr(enrollment, "status", None) != "active":
            continue
        if getattr(enrollment, "class_", None) is None:
            enrollment.class_ = class_
        next_due = get_enrollment_next_fee_due(enrollment, reference)
        if next_due is None:
            continue
        due_date, state = next_due
        if state == NEXT_FEE_DUE_OVERDUE:
            overdue_dates.append(due_date)
        else:
            upcoming_dates.append(due_date)

    if overdue_dates:
        return max(overdue_dates), NEXT_FEE_DUE_OVERDUE
    if upcoming_dates:
        return min(upcoming_dates), NEXT_FEE_DUE_UPCOMING
    return None, NEXT_FEE_DUE_NONE


def add_months_clamped(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    year = month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)
