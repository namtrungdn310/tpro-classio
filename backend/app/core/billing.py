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
    class_end_date = getattr(class_, "stopped_on", None)
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
    max_anchor_cycle = -1
    attributes = getattr(enrollment, "__dict__", None)
    current_revision = (
        attributes.get("current_billing_revision")
        if attributes is not None
        else getattr(enrollment, "current_billing_revision", None)
    )
    current_revision_id = getattr(enrollment, "current_billing_revision_id", None)
    cumulative_deferral_days = 0
    for record in getattr(enrollment, "fee_records", None) or []:
        if getattr(record, "status", None) == "SUPERSEDED":
            continue
        cycle_no = getattr(record, "cycle_no", None)
        if cycle_no is not None:
            max_cycle = max(max_cycle, int(cycle_no))
        if (
            current_revision_id
            and getattr(record, "billing_revision_id", None) == current_revision_id
            and getattr(record, "anchor_cycle_no", None) is not None
        ):
            max_anchor_cycle = max(
                max_anchor_cycle, int(getattr(record, "anchor_cycle_no"))
            )
        base_due_date = getattr(record, "base_due_date", None)
        adjusted_due_date = getattr(record, "adjusted_due_date", None)
        if (
            base_due_date is not None
            and adjusted_due_date is not None
            and getattr(record, "status", None) != "VOID"
        ):
            cumulative_deferral_days = max(
                cumulative_deferral_days,
                max(
                    0,
                    (adjusted_due_date - base_due_date).days
                    - int(getattr(record, "collection_due_offset_days", 0) or 0),
                ),
            )
        if getattr(record, "status", None) != "UNPAID":
            continue
        # ``adjusted_due_date`` is the user-visible effective due date.  Keep
        # ``due_date`` as the immutable/base projection for compatibility with
        # historical rows, but never let a suspension credit disappear from
        # dashboard/class summaries by reading the base column first.
        due_date = adjusted_due_date or getattr(record, "due_date", None)
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
    enrollment_date = (
        current_revision.anchor_date
        if current_revision is not None
        else enrollment.enrollment_date
    )
    billing_type = (
        current_revision.billing_type_snapshot
        if current_revision is not None
        else class_.type
    )
    cycle_weeks = (
        max(
            int(
                current_revision.billing_cycle_weeks_snapshot
                if current_revision is not None
                else class_.billing_cycle_weeks or 1
            ),
            1,
        )
        if billing_type == "COURSE"
        else None
    )
    schedule_cycle = (
        max_anchor_cycle + 1 if current_revision is not None else next_cycle
    )
    if current_revision is not None:
        schedule_cycle = max(
            schedule_cycle,
            int(getattr(current_revision, "first_anchor_cycle_no", 0) or 0),
        )
    coverage_start, _ = cycle_coverage_interval(
        enrollment_date, billing_type, cycle_weeks, schedule_cycle
    )
    stop_date = min(
        [
            d
            for d in (
                getattr(class_, "stopped_on", None),
                getattr(enrollment, "ended_on", None),
            )
            if isinstance(d, date)
        ],
        default=None,
    )
    if (
        cycle_exists(coverage_start, stop_date)
        and getattr(current_revision, "state", None) != "PENDING"
    ):
        next_due = cycle_base_due_date(
            enrollment_date, billing_type, cycle_weeks, schedule_cycle
        )
        windows = getattr(enrollment, "billing_deferral_windows", None)
        if isinstance(windows, list):
            cumulative_deferral_days = max(
                0,
                sum(days for effective, days in windows if effective <= coverage_start),
            )
        if cumulative_deferral_days:
            next_due = next_due + timedelta(days=cumulative_deferral_days)
        if next_due < reference:
            overdue_dates.append(next_due)
        else:
            upcoming_dates.append(next_due)

    # A future new anchor does not suppress the explicitly retained old cadence.
    segments = getattr(current_revision, "scheduled_segments", None)
    if (
        isinstance(segments, list)
        and getattr(current_revision, "state", None) != "PENDING"
    ):
        from app.core.billing_change_plan import Interval, uncovered_intervals
        from app.services.billing_segment_service import segment_spans

        covered = tuple(
            Interval(r.coverage_start, r.coverage_end)
            for r in getattr(enrollment, "fee_records", [])
            if getattr(r, "status", None) != "SUPERSEDED"
            and isinstance(getattr(r, "coverage_start", None), date)
            and isinstance(getattr(r, "coverage_end", None), date)
        )
        covered += tuple(
            Interval(date.fromisoformat(s["start"]), date.fromisoformat(s["end"]))
            for s in (getattr(current_revision, "waived_intervals", None) or [])
        )
        for segment in segments:
            for span in segment_spans(segment, date.max):
                gaps = uncovered_intervals(span, covered)
                if not gaps:
                    continue
                candidate = gaps[0].start
                if stop_date and candidate >= stop_date:
                    break
                windows = getattr(enrollment, "billing_deferral_windows", None)
                shift = (
                    sum(days for effective, days in windows if effective <= candidate)
                    if isinstance(windows, list)
                    else cumulative_deferral_days
                )
                candidate += timedelta(days=max(0, shift))
                (overdue_dates if candidate < reference else upcoming_dates).append(
                    candidate
                )
                break

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
