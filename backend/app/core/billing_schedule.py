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


def first_monthly_cycle_on_or_after(anchor: date, floor: date) -> int:
    """Return the first monthly anchor ordinal whose due date is >= floor."""

    if anchor >= floor:
        return 0
    months = max(0, (floor.year - anchor.year) * 12 + floor.month - anchor.month)
    if add_months_clamped(anchor, months) < floor:
        months += 1
    return months


def course_cycle_containing(anchor: date, weeks: int, reference: date) -> int:
    """Return the package ordinal containing reference, without backfilling."""

    if anchor >= reference:
        return 0
    package_days = max(int(weeks), 1) * 7
    return max(0, (reference - anchor).days // package_days)


def first_course_cycle_on_or_after(anchor: date, weeks: int, floor: date) -> int:
    """Return the first package ordinal whose coverage starts >= floor."""

    if anchor >= floor:
        return 0
    package_days = max(int(weeks), 1) * 7
    elapsed = (floor - anchor).days
    return max(0, (elapsed + package_days - 1) // package_days)


def first_actionable_cycle(
    anchor: date,
    billing_type: str,
    cycle_weeks: int | None,
    *,
    today: date,
    protected_through: date | None = None,
) -> int:
    """Select one post-edit cycle without materialising historical debt.

    Monthly tuition follows the next calendar anchor requested by the product.
    A package is different: when there is no protected overlap, the package
    already in progress is actionable (and can be shown as overdue).  Once an
    immutable old charge covers service, the new schedule starts at the first
    package boundary on or after that protected coverage.
    """

    if billing_type == COURSE:
        weeks = max(int(cycle_weeks or 1), 1)
        if protected_through is not None and protected_through > today:
            return first_course_cycle_on_or_after(anchor, weeks, protected_through)
        return course_cycle_containing(anchor, weeks, today)
    floor = max(today, protected_through) if protected_through else today
    return first_monthly_cycle_on_or_after(anchor, floor)
