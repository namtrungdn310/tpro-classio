"""Pure occurrence-engine tests: expansion, boundaries, overlay, properties."""

from datetime import date, datetime, timezone

import pytest

from app.core.business_time import BUSINESS_TIMEZONE
from app.core.occurrence import (
    apply_exceptions,
    expand_weekly_occurrences,
    occurrence_key,
)

MONDAY_2026_09_07 = datetime(2026, 9, 7, 18, 0, tzinfo=BUSINESS_TIMEZONE)
RANGE_START = datetime(2026, 9, 1, tzinfo=BUSINESS_TIMEZONE)
RANGE_END = datetime(2026, 10, 1, tzinfo=BUSINESS_TIMEZONE)

SCHEDULE_TWO_SLOTS = {
    "text": "Thứ 2 (18:00-19:30); Thứ 4 (19:00-20:30)",
    "slots": [
        {
            "day": "Thứ 2",
            "start": "18:00",
            "end": "19:30",
            "teacher_ids": ["t-1"],
            "assistant_ids": ["a-1"],
        },
        {
            "day": "Thứ 4",
            "start": "19:00",
            "end": "20:30",
            "teacher_ids": ["t-2"],
            "assistant_ids": [],
        },
    ],
}


def _expand(**overrides):
    values = {
        "class_id": "c-1",
        "schedule": SCHEDULE_TWO_SLOTS,
        "start_date": date(2026, 9, 1),
        "end_date": date(2026, 12, 31),
        "range_start": RANGE_START,
        "range_end": RANGE_END,
    }
    values.update(overrides)
    return expand_weekly_occurrences(**values)


def test_expands_only_bounded_range() -> None:
    occurrences = _expand(
        range_start=datetime(2026, 9, 7, tzinfo=BUSINESS_TIMEZONE),
        range_end=datetime(2026, 9, 14, tzinfo=BUSINESS_TIMEZONE),
    )
    # 2026-09-07 (Thứ 2) + 2026-09-09 (Thứ 4): đúng 2 buổi trong tuần.
    assert len(occurrences) == 2
    assert all(
        item.original_start_at < datetime(2026, 9, 14, tzinfo=BUSINESS_TIMEZONE)
        for item in occurrences
    )


def test_respects_class_start_and_end_applicability() -> None:
    occurrences = _expand(
        start_date=date(2026, 9, 7),
        end_date=date(2026, 9, 9),
        range_start=datetime(2026, 8, 1, tzinfo=BUSINESS_TIMEZONE),
        range_end=datetime(2026, 10, 1, tzinfo=BUSINESS_TIMEZONE),
    )
    # Chỉ Thứ 2 07/09 và Thứ 4 09/09 nằm trong [07/09, 09/09].
    assert len(occurrences) == 2
    assert {item.original_start_at.date() for item in occurrences} == {
        date(2026, 9, 7),
        date(2026, 9, 9),
    }


def test_occurrence_exactly_on_planned_end_date_is_included() -> None:
    # 2026-09-07 là Thứ 2; 2026-09-09 là Thứ 4.
    occurrences = _expand(
        start_date=date(2026, 9, 7),
        end_date=date(2026, 9, 7),
        range_start=datetime(2026, 9, 1, tzinfo=BUSINESS_TIMEZONE),
        range_end=datetime(2026, 9, 8, tzinfo=BUSINESS_TIMEZONE),
    )
    assert len(occurrences) == 1
    assert occurrences[0].original_start_at.date() == date(2026, 9, 7)


def test_stable_occurrence_key_from_class_id_and_utc_start() -> None:
    first = _expand()[0]
    key = occurrence_key("c-1", first.original_start_at)
    assert key.startswith("c-1:")
    # Cùng original UTC -> cùng key.
    assert (
        occurrence_key("c-1", first.original_start_at.astimezone(timezone.utc)) == key
    )
    # Khác class -> khác key.
    assert occurrence_key("c-2", first.original_start_at) != key


def test_half_open_boundaries_adjacent_slots_do_not_overlap() -> None:
    # 13:30-15:00 và 15:00-16:30 không conflict (start == other end).
    schedule = {
        "text": "adjacent",
        "slots": [
            {
                "day": "Thứ 2",
                "start": "13:30",
                "end": "15:00",
                "teacher_ids": ["t-1"],
                "assistant_ids": [],
            }
        ],
    }
    occurrences = expand_weekly_occurrences(
        class_id="c-1",
        schedule=schedule,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        range_start=datetime(2026, 9, 1, tzinfo=BUSINESS_TIMEZONE),
        range_end=datetime(2026, 10, 1, tzinfo=BUSINESS_TIMEZONE),
    )
    first = occurrences[0]
    assert first.original_end_at - first.original_start_at == (
        datetime(2026, 9, 7, 15, 0, tzinfo=BUSINESS_TIMEZONE)
        - datetime(2026, 9, 7, 13, 30, tzinfo=BUSINESS_TIMEZONE)
    )
    # 15:00 == end -> không overlap với slot 15:00-16:30 (property: start < other_end).
    assert not (
        first.original_start_at < datetime(2026, 9, 7, 16, 30, tzinfo=BUSINESS_TIMEZONE)
        and datetime(2026, 9, 7, 15, 0, tzinfo=BUSINESS_TIMEZONE)
        < first.original_end_at
    )


def test_utc_local_round_trip() -> None:
    occurrence = next(item for item in _expand() if item.original_start_at.hour == 11)
    local = occurrence.original_start_at.astimezone(BUSINESS_TIMEZONE)
    assert local.hour == 18 and local.minute == 0
    assert local.weekday() == 0  # Thứ 2
    assert occurrence.original_start_at.tzinfo is not None


def test_overlay_suppresses_original_and_adds_makeup_once() -> None:
    regular = _expand()
    original = next(
        item for item in regular if item.original_start_at.date() == date(2026, 9, 7)
    )
    makeup_start = datetime(2026, 9, 11, 18, 0, tzinfo=BUSINESS_TIMEZONE)
    exceptions = [
        {
            "id": "e-1",
            "status": "MAKEUP_SCHEDULED",
            "original_start_at": original.original_start_at,
            "original_end_at": original.original_end_at,
            "replacement_start_at": makeup_start,
            "replacement_end_at": makeup_start
            + (original.original_end_at - original.original_start_at),
            "staff_snapshots": [
                {"staff_id": "t-1", "role": "TEACHER"},
                {"staff_id": "a-1", "role": "ASSISTANT"},
            ],
        }
    ]
    effective = apply_exceptions(regular, exceptions, class_id="c-1")
    kinds = [item.kind for item in effective]
    assert kinds.count("MAKEUP") == 1
    # Original Thứ 2 07/09 bị suppress.
    assert not any(
        item.original_start_at.date() == date(2026, 9, 7) and item.kind == "REGULAR"
        for item in effective
    )
    makeup = next(item for item in effective if item.kind == "MAKEUP")
    assert makeup.teacher_ids == ["t-1"]
    assert makeup.assistant_ids == ["a-1"]
    # Áp dụng overlay hai lần lên CÙNG regular input -> kết quả giống hệt
    # (deterministic, không nhân đôi).
    first_pass = apply_exceptions(regular, exceptions, class_id="c-1")
    second_pass = apply_exceptions(regular, exceptions, class_id="c-1")
    assert [item.key for item in first_pass] == [item.key for item in second_pass]
    assert sum(1 for item in second_pass if item.kind == "MAKEUP") == 1


def test_overlay_pending_creates_no_calendar_slot() -> None:
    regular = _expand()
    original = next(
        item for item in regular if item.original_start_at.date() == date(2026, 9, 7)
    )
    exceptions = [
        {
            "id": "e-2",
            "status": "MAKEUP_PENDING",
            "original_start_at": original.original_start_at,
            "original_end_at": original.original_end_at,
            "replacement_start_at": None,
            "replacement_end_at": None,
            "staff_snapshots": [],
        }
    ]
    effective = apply_exceptions(regular, exceptions, class_id="c-1")
    assert not any(
        item.original_start_at.date() == date(2026, 9, 7) for item in effective
    )


def test_overlay_restored_keeps_original_visible() -> None:
    regular = _expand()
    original = next(
        item for item in regular if item.original_start_at.date() == date(2026, 9, 7)
    )
    exceptions = [
        {
            "id": "e-3",
            "status": "RESTORED",
            "original_start_at": original.original_start_at,
            "original_end_at": original.original_end_at,
            "replacement_start_at": None,
            "replacement_end_at": None,
            "staff_snapshots": [],
        }
    ]
    effective = apply_exceptions(regular, exceptions, class_id="c-1")
    assert any(
        item.original_start_at.date() == date(2026, 9, 7) and item.kind == "REGULAR"
        for item in effective
    )


def test_overlay_completed_makeup_remains_in_output() -> None:
    regular = _expand()
    original = next(
        item for item in regular if item.original_start_at.date() == date(2026, 9, 7)
    )
    makeup_start = datetime(2026, 9, 11, 18, 0, tzinfo=BUSINESS_TIMEZONE)
    exceptions = [
        {
            "id": "e-4",
            "status": "MAKEUP_COMPLETED",
            "original_start_at": original.original_start_at,
            "original_end_at": original.original_end_at,
            "replacement_start_at": makeup_start,
            "replacement_end_at": makeup_start
            + (original.original_end_at - original.original_start_at),
            "staff_snapshots": [],
        }
    ]
    effective = apply_exceptions(regular, exceptions, class_id="c-1")
    completed = next(item for item in effective if item.kind == "MAKEUP")
    assert completed.status == "MAKEUP_COMPLETED"


def test_output_sorted_deterministically() -> None:
    occurrences = _expand()
    keys = [item.key for item in occurrences]
    assert keys == sorted(keys)
    assert len({item.key for item in occurrences}) == len(occurrences)


@pytest.mark.parametrize(
    "slot_start,slot_end", [("18:00", "19:30"), ("07:00", "08:30"), ("20:30", "22:00")]
)
def test_every_occurrence_has_start_before_end(slot_start: str, slot_end: str) -> None:
    schedule = {
        "text": "t",
        "slots": [
            {
                "day": "Thứ 3",
                "start": slot_start,
                "end": slot_end,
                "teacher_ids": ["t-1"],
                "assistant_ids": [],
            }
        ],
    }
    occurrences = expand_weekly_occurrences(
        class_id="c-1",
        schedule=schedule,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        range_start=datetime(2026, 9, 1, tzinfo=BUSINESS_TIMEZONE),
        range_end=datetime(2026, 10, 1, tzinfo=BUSINESS_TIMEZONE),
    )
    assert occurrences
    for item in occurrences:
        assert item.original_start_at < item.original_end_at


def test_no_occurrence_outside_class_range() -> None:
    occurrences = _expand(
        start_date=date(2026, 10, 5),
        end_date=date(2026, 10, 11),
        range_start=datetime(2026, 9, 1, tzinfo=BUSINESS_TIMEZONE),
        range_end=datetime(2026, 11, 1, tzinfo=BUSINESS_TIMEZONE),
    )
    assert occurrences
    assert all(
        date(2026, 10, 5)
        <= item.original_start_at.astimezone(BUSINESS_TIMEZONE).date()
        <= date(2026, 10, 11)
        for item in occurrences
    )
