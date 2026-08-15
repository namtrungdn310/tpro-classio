"""Pure billing-schedule contract (R6 ADR-002, dev.md §7.2).

Canonical cycle identity: `(enrollment_id, cycle_no)` with cycle 0 created
inside the enrollment transaction (due = enrollment_date, UNPAID, unnotified).
Legacy enrollments have a deliberate cycle-0 gap; the generator NEVER
retro-charges cycle 0.

Rules:
- base due always derives from the enrollment anchor (add_months_clamped /
  weeks*7); adjusted due = base due + cumulative deferral days (never chained
  from a previously adjusted date, avoiding EOM drift).
- A cycle exists when `coverage_start < class.end_date` (half-open boundary);
  credit may push adjusted due past class end without losing coverage.
- `period` is a derived reporting bucket (YYYY-MM), never business identity.

No database access; SQL/TS must reproduce the same dates.
"""

from datetime import date, timedelta

MONTHLY = "MONTHLY"
COURSE = "COURSE"


def add_months_clamped(value: date, months: int) -> date:
    from calendar import monthrange

    month_index = value.year * 12 + value.month - 1 + months
    year = month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def cycle_base_due_date(
    enrollment_date: date,
    billing_type: str,
    cycle_weeks: int | None,
    cycle_no: int,
) -> date:
    """Base due date of cycle N, always derived from the enrollment anchor."""
    if cycle_no < 0:
        raise ValueError("cycle_no cannot be negative")
    if billing_type == COURSE:
        weeks = max(int(cycle_weeks or 1), 1)
        return enrollment_date + timedelta(days=weeks * 7 * cycle_no)
    return add_months_clamped(enrollment_date, cycle_no)


def cycle_coverage_interval(
    enrollment_date: date,
    billing_type: str,
    cycle_weeks: int | None,
    cycle_no: int,
) -> tuple[date, date]:
    """Half-open [coverage_start, coverage_end) for cycle N."""
    coverage_start = cycle_base_due_date(
        enrollment_date, billing_type, cycle_weeks, cycle_no
    )
    coverage_end = cycle_base_due_date(
        enrollment_date, billing_type, cycle_weeks, cycle_no + 1
    )
    return coverage_start, coverage_end


def cycle_exists(coverage_start: date, class_end_date: date | None) -> bool:
    """A cycle exists while its coverage starts before the class ends.

    `class.end_date` is inclusive on the UI; internally it is a half-open
    boundary, so a cycle starting on the end date itself does not exist.
    """
    if class_end_date is None:
        return True
    return coverage_start < class_end_date


def adjusted_due_after_deferral(base_due_date: date, deferral_days: int) -> date:
    return base_due_date + timedelta(days=max(0, deferral_days))


def period_key(due_date: date | None) -> str | None:
    """Reporting bucket (YYYY-MM) derived from the base due date."""
    if due_date is None:
        return None
    return due_date.strftime("%Y-%m")


def month_end(reference: date) -> date:
    from calendar import monthrange

    return date(
        reference.year, reference.month, monthrange(reference.year, reference.month)[1]
    )
