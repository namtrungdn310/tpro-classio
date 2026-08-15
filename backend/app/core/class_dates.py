"""Pure calendar helpers shared by class and billing domains.

Class lifecycle dates are independent from the fee cadence.  The only class
date invariant is enforced by the class schema: ``end_date > start_date``.
The helper in this module remains useful for billing-cycle arithmetic, but it
must never be used to impose a minimum class duration.
"""

from calendar import monthrange
from datetime import date


def is_last_day_of_month(value: date) -> bool:
    return value.day == monthrange(value.year, value.month)[1]


def add_months_eom_clamped(value: date, months: int) -> date:
    """Add whole calendar months preserving the source day, clamped to the
    target month length. When the source day is the last day of its month the
    result snaps to the target month's last day (EOM-preserving) so a month-end
    start always lands on a month-end boundary."""
    month_index = value.year * 12 + value.month - 1 + months
    year = month_index // 12
    month = month_index % 12 + 1
    days_in_target = monthrange(year, month)[1]
    if is_last_day_of_month(value):
        return date(year, month, days_in_target)
    return date(year, month, min(value.day, days_in_target))
