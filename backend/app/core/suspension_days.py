"""Calendar-day service preservation, independent of payment/calendar storage.

All intervals are half-open. Recompute the union when a pause changes: undoing
one source's original grant is wrong when another source still covers the day.
No daily rows or per-centre policy engine is needed.
"""

from dataclasses import dataclass
from datetime import date
from collections.abc import Iterable


@dataclass(frozen=True, order=True)
class PauseInterval:
    start: date
    end: date

    def __post_init__(self):
        if self.end <= self.start:
            raise ValueError("Ngày học lại phải sau ngày bắt đầu nghỉ")

    @property
    def days(self) -> int:
        return (self.end - self.start).days


def union_intervals(intervals: Iterable[PauseInterval]) -> tuple[PauseInterval, ...]:
    merged: list[PauseInterval] = []
    for interval in sorted(intervals):
        if merged and interval.start <= merged[-1].end:
            merged[-1] = PauseInterval(
                merged[-1].start, max(merged[-1].end, interval.end)
            )
        else:
            merged.append(interval)
    return tuple(merged)


def subtract_intervals(
    intervals: Iterable[PauseInterval],
    excluded: Iterable[PauseInterval],
) -> tuple[PauseInterval, ...]:
    exclusions = union_intervals(excluded)
    result: list[PauseInterval] = []
    for interval in union_intervals(intervals):
        cursor = interval.start
        for exclusion in exclusions:
            if exclusion.end <= cursor:
                continue
            if exclusion.start >= interval.end:
                break
            if exclusion.start > cursor:
                result.append(PauseInterval(cursor, exclusion.start))
            cursor = max(cursor, exclusion.end)
            if cursor >= interval.end:
                break
        if cursor < interval.end:
            result.append(PauseInterval(cursor, interval.end))
    return tuple(result)


def preserved_intervals(
    pauses: Iterable[PauseInterval],
    *,
    admitted_on: date | None,
    ended_on: date | None = None,
    waived: Iterable[PauseInterval] = (),
) -> tuple[PauseInterval, ...]:
    """Do not preserve non-membership days or grant a second benefit for a waiver.

    ``ended_on`` is the enrollment's exclusive service end (already capped by
    class stop at the call boundary). Existing confirmed waiver rows stay intact.
    """
    if admitted_on is None:
        return ()
    clipped = []
    for pause in pauses:
        start, end = (
            max(pause.start, admitted_on),
            min(pause.end, ended_on or pause.end),
        )
        if start < end:
            clipped.append(PauseInterval(start, end))
    return subtract_intervals(clipped, waived)


@dataclass(frozen=True)
class PreservationChange:
    granted: tuple[PauseInterval, ...]
    reversed: tuple[PauseInterval, ...]

    @property
    def delta_days(self) -> int:
        return sum(i.days for i in self.granted) - sum(i.days for i in self.reversed)


def preservation_change(
    before: Iterable[PauseInterval],
    after: Iterable[PauseInterval],
) -> PreservationChange:
    old, new = union_intervals(before), union_intervals(after)
    return PreservationChange(
        subtract_intervals(new, old), subtract_intervals(old, new)
    )
