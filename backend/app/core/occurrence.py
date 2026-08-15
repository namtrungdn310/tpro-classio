"""Pure weekly-occurrence expansion and exception overlay for class sessions.

This module has no database access. It turns the recurring weekly template
(`classes.schedule.slots`) into concrete dated occurrences inside a bounded
range, applies dated exceptions (postponement/make-up) and returns normalized
occurrences with a stable identity. Timezone handling is explicit:
`Asia/Ho_Chi_Minh` (centre timezone) at the boundary, UTC for persistence.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from app.core.business_time import BUSINESS_TIMEZONE

OccurrenceKind = Literal["REGULAR", "POSTPONED", "MAKEUP"]

WEEKDAY_TO_INDEX: dict[str, int] = {
    "Thứ 2": 0,
    "Thứ 3": 1,
    "Thứ 4": 2,
    "Thứ 5": 3,
    "Thứ 6": 4,
    "Thứ 7": 5,
    "Chủ Nhật": 6,
}
INDEX_TO_WEEKDAY: dict[int, str] = {
    index: day for day, index in WEEKDAY_TO_INDEX.items()
}

# Half-open interval semantics: a session ending at 15:00 does not conflict
# with one starting at 15:00.


def slot_key(day: str, start: str, end: str) -> str:
    """Stable identity of a weekly slot: 'Thứ 2|18:00|19:30'."""
    return f"{day}|{start}|{end}"


def local_occurrence_start(day: date, slot_start: str, tz: ZoneInfo) -> datetime:
    hour, minute = (int(part) for part in slot_start.split(":"))
    local = datetime.combine(day, time(hour, minute), tzinfo=tz)
    return local


def _parse_slot_time(value: str) -> tuple[int, int]:
    hour, minute = (int(part) for part in value.split(":"))
    return hour, minute


def slot_duration_minutes(start: str, end: str) -> int:
    start_hour, start_minute = _parse_slot_time(start)
    end_hour, end_minute = _parse_slot_time(end)
    return (end_hour * 60 + end_minute) - (start_hour * 60 + start_minute)


@dataclass
class Occurrence:
    """One dated class session in the effective calendar.

    key: stable identity = f"{class_id}:{original_start_at.isoformat()}" (UTC).
    Canonical schedule identity (R6-D07) = source_slot_id + local occurrence
    date + slot version; `source_slot_key` stays as a legacy compatibility key
    until D19.
    """

    class_id: str
    key: str
    kind: OccurrenceKind
    original_start_at: datetime
    original_end_at: datetime
    source_slot_key: str
    source_slot_id: str | None = None
    slot_version: int | None = None
    teacher_ids: list[str] = field(default_factory=list)
    assistant_ids: list[str] = field(default_factory=list)
    exception_id: str | None = None
    status: str | None = None  # persisted exception status or None for REGULAR
    replacement_start_at: datetime | None = None
    replacement_end_at: datetime | None = None


def occurrence_key(class_id: str, original_start_at: datetime) -> str:
    normalized = original_start_at.astimezone(timezone.utc)
    return f"{class_id}:{normalized.isoformat()}"


def expand_weekly_occurrences(
    *,
    class_id: str,
    schedule: dict | None,
    start_date: date | None,
    end_date: date | None,
    range_start: datetime,
    range_end: datetime,
    tz: ZoneInfo = BUSINESS_TIMEZONE,
) -> list[Occurrence]:
    """Expand recurring weekly slots into concrete occurrences.

    Only slots whose local date lies inside [range_start, range_end) AND inside
    the class date range (inclusive on both ends, matching the existing
    ACTIVE/COMPLETED boundary convention) are produced. Never pre-materializes
    future sessions beyond the requested window.
    """
    if not schedule:
        return []
    slots = schedule.get("slots") or []
    occurrences: list[Occurrence] = []
    local_range_start = range_start.astimezone(tz).date()
    local_range_end = range_end.astimezone(tz).date()

    earliest = start_date or local_range_start
    latest = end_date or local_range_end
    first_date = max(local_range_start, earliest)
    last_date = min(local_range_end, latest)
    if first_date > last_date:
        return []

    utc = timezone.utc
    for slot in slots:
        if not isinstance(slot, dict) or "day" not in slot:
            continue
        weekday = WEEKDAY_TO_INDEX.get(slot.get("day", ""))
        if weekday is None:
            continue
        offset = (weekday - first_date.weekday()) % 7
        cursor = first_date + timedelta(days=offset)
        while cursor <= last_date:
            start_at = local_occurrence_start(cursor, slot["start"], tz).astimezone(utc)
            end_at = local_occurrence_start(cursor, slot["end"], tz).astimezone(utc)
            if start_at >= range_end or end_at <= range_start:
                cursor += timedelta(days=7)
                continue
            teacher_ids = [
                str(teacher_id) for teacher_id in (slot.get("teacher_ids") or [])
            ]
            assistant_ids = [
                str(assistant_id) for assistant_id in (slot.get("assistant_ids") or [])
            ]
            occurrences.append(
                Occurrence(
                    class_id=class_id,
                    key=occurrence_key(class_id, start_at),
                    kind="REGULAR",
                    original_start_at=start_at,
                    original_end_at=end_at,
                    source_slot_key=slot_key(slot["day"], slot["start"], slot["end"]),
                    source_slot_id=(
                        str(slot["slot_id"]) if slot.get("slot_id") else None
                    ),
                    slot_version=(
                        int(slot["version"])
                        if slot.get("version") is not None
                        else None
                    ),
                    teacher_ids=teacher_ids,
                    assistant_ids=assistant_ids,
                )
            )
            cursor += timedelta(days=7)
    occurrences.sort(key=lambda item: (item.original_start_at, item.key))
    return occurrences


def _interval_overlaps(
    first_start: datetime,
    first_end: datetime,
    second_start: datetime,
    second_end: datetime,
) -> bool:
    return first_start < second_end and second_start < first_end


def apply_exceptions(
    regular: list[Occurrence],
    exceptions: list[dict],
    *,
    class_id: str,
    utc: timezone = timezone.utc,
) -> list[Occurrence]:
    """Overlay dated exceptions onto expanded regular occurrences.

    - An exception with status != RESTORED suppresses its original occurrence.
    - A scheduled/completed exception contributes exactly one MAKEUP occurrence
      at its replacement interval.
    - RESTORED leaves the original visible and adds no make-up.
    - Pending exceptions create no calendar slot.
    - Input and output are sorted deterministically by (start, key).
    """
    suppressed_originals: set[str] = set()
    makeups: list[Occurrence] = []
    for raw in exceptions:
        exception_id = str(raw.get("id"))
        status = raw.get("status")
        original_start = raw.get("original_start_at")
        original_end = raw.get("original_end_at")
        if original_start is None or original_end is None:
            continue
        original_start = original_start.astimezone(utc)
        original_end = original_end.astimezone(utc)
        key = occurrence_key(class_id, original_start)
        if status != "RESTORED":
            suppressed_originals.add(key)
        replacement_start = raw.get("replacement_start_at")
        replacement_end = raw.get("replacement_end_at")
        if replacement_start is not None and replacement_end is not None:
            replacement_start = replacement_start.astimezone(utc)
            replacement_end = replacement_end.astimezone(utc)
            makeups.append(
                Occurrence(
                    class_id=class_id,
                    key=occurrence_key(class_id, replacement_start),
                    kind="MAKEUP",
                    original_start_at=replacement_start,
                    original_end_at=replacement_end,
                    source_slot_key=str(raw.get("source_slot_key") or ""),
                    source_slot_id=(
                        str(raw.get("source_slot_id"))
                        if raw.get("source_slot_id")
                        else None
                    ),
                    slot_version=(
                        int(raw["slot_version"])
                        if raw.get("slot_version") is not None
                        else None
                    ),
                    teacher_ids=[
                        str(item.get("staff_id"))
                        for item in (raw.get("staff_snapshots") or [])
                        if item.get("role") == "TEACHER"
                    ],
                    assistant_ids=[
                        str(item.get("staff_id"))
                        for item in (raw.get("staff_snapshots") or [])
                        if item.get("role") == "ASSISTANT"
                    ],
                    exception_id=exception_id,
                    status=str(status),
                    replacement_start_at=replacement_start,
                    replacement_end_at=replacement_end,
                )
            )
    result = [
        item for item in regular if item.key not in suppressed_originals
    ] + makeups
    result.sort(key=lambda item: (item.original_start_at, item.key))
    return result


def overlaps_with_any(
    candidate_start: datetime,
    candidate_end: datetime,
    intervals: list[tuple[datetime, datetime]],
) -> bool:
    return any(
        _interval_overlaps(candidate_start, candidate_end, start, end)
        for start, end in intervals
    )


def utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()
