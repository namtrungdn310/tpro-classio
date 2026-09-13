from datetime import date, timedelta
from itertools import combinations

import pytest

from app.core.suspension_days import (
    PauseInterval,
    preserved_intervals,
    preservation_change,
    union_intervals,
)


def interval(start, end):
    base = date(2026, 9, 1)
    return PauseInterval(base + timedelta(days=start), base + timedelta(days=end))


def test_resume_day_is_not_a_day_off():
    assert interval(9, 16).days == 7
    assert union_intervals([interval(0, 7), interval(7, 10)]) == (interval(0, 10),)


def test_overlap_cancel_does_not_reverse_other_source_entitlement():
    individual, whole_class = interval(0, 9), interval(4, 14)
    assert sum(i.days for i in union_intervals([individual, whole_class])) == 14
    change = preservation_change([individual, whole_class], [whole_class])
    assert change.delta_days == -4
    assert change.reversed == (interval(0, 4),)
    assert preservation_change([whole_class], []).delta_days == -10


def test_membership_and_waiver_are_clipped_before_granting_days():
    result = preserved_intervals(
        [interval(0, 10), interval(3, 14)],
        admitted_on=interval(2, 12).start,
        ended_on=interval(2, 12).end,
        waived=[interval(5, 8)],
    )
    assert result == (interval(2, 5), interval(8, 12))
    assert preserved_intervals([interval(0, 10)], admitted_on=None) == ()


def test_union_matches_daily_oracle_exhaustively():
    ranges = [interval(a, b) for a in range(5) for b in range(a + 1, 7)]
    for pauses in combinations(ranges, 3):
        expected = {p.start + timedelta(days=i) for p in pauses for i in range(p.days)}
        actual = union_intervals(pauses)
        assert sum(p.days for p in actual) == len(expected)
        assert union_intervals(reversed(pauses)) == actual
        delta = preservation_change(actual, pauses[:2])
        assert sum(p.days for p in actual) + delta.delta_days == sum(
            p.days for p in union_intervals(pauses[:2])
        )


@pytest.mark.parametrize("start,end", [(1, 1), (2, 1)])
def test_rejects_empty_or_reversed_range(start, end):
    with pytest.raises(ValueError):
        interval(start, end)
