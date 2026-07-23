from datetime import date
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.models.staff import StaffMember
from app.services.class_service import (
    _date_ranges_overlap,
    _validate_teacher_schedule_availability,
)


class QueryResult:
    def __init__(
        self, *, scalars: list[object] | None = None, rows: list[tuple] | None = None
    ) -> None:
        self._scalars = scalars or []
        self._rows = rows or []

    def scalars(self) -> "QueryResult":
        return self

    def all(self) -> list[object] | list[tuple]:
        return self._scalars if self._scalars else self._rows


def make_teacher() -> StaffMember:
    return StaffMember(
        id=str(uuid4()),
        full_name="Cô Hạnh",
        staff_type="TEACHER",
        is_active=True,
    )


@pytest.mark.asyncio
async def test_rejects_schedule_overlap_for_the_same_teacher() -> None:
    teacher = make_teacher()
    db = AsyncMock()
    db.execute.side_effect = [
        QueryResult(scalars=[teacher]),
        QueryResult(
            rows=[
                (
                    "6C1",
                    {
                        "text": "Thứ 2 (18:00-19:30)",
                        "slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}],
                    },
                    teacher.id,
                    None,
                    None,
                )
            ]
        ),
    ]

    with pytest.raises(ValueError, match="Cô Hạnh đã có lịch lớp 6C1"):
        await _validate_teacher_schedule_availability(
            db,
            class_id=str(uuid4()),
            teacher_ids=[teacher.id],
            schedule={
                "text": "Thứ 2 (19:00-20:30)",
                "slots": [{"day": "Thứ 2", "start": "19:00", "end": "20:30"}],
            },
        )


@pytest.mark.asyncio
async def test_accepts_adjacent_schedule_for_the_same_teacher() -> None:
    teacher = make_teacher()
    db = AsyncMock()
    db.execute.side_effect = [
        QueryResult(scalars=[teacher]),
        QueryResult(
            rows=[
                (
                    "6C1",
                    {"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
                    teacher.id,
                    None,
                    None,
                )
            ]
        ),
    ]

    await _validate_teacher_schedule_availability(
        db,
        class_id=str(uuid4()),
        teacher_ids=[teacher.id],
        schedule={"slots": [{"day": "Thứ 2", "start": "19:30", "end": "21:00"}]},
    )


@pytest.mark.asyncio
async def test_rejects_inactive_or_missing_teacher_before_schedule_check() -> None:
    db = AsyncMock()
    db.execute.return_value = QueryResult(scalars=[])

    with pytest.raises(ValueError, match="không hợp lệ hoặc đã ngừng hoạt động"):
        await _validate_teacher_schedule_availability(
            db,
            class_id=str(uuid4()),
            teacher_ids=[str(uuid4())],
            schedule=None,
        )


@pytest.mark.parametrize(
    ("first_start", "first_end", "second_start", "second_end", "expected"),
    [
        (None, None, None, None, True),
        (date(2026, 1, 1), date(2026, 1, 31), date(2026, 1, 15), None, True),
        (
            date(2026, 1, 1),
            date(2026, 1, 31),
            date(2026, 1, 31),
            date(2026, 2, 28),
            True,
        ),
        (
            date(2026, 1, 1),
            date(2026, 1, 31),
            date(2026, 2, 1),
            date(2026, 2, 28),
            False,
        ),
        (None, date(2026, 1, 31), date(2026, 2, 1), None, False),
        (date(2026, 2, 1), None, None, date(2026, 1, 31), False),
    ],
)
def test_date_range_overlap_handles_inclusive_and_open_ranges(
    first_start: date | None,
    first_end: date | None,
    second_start: date | None,
    second_end: date | None,
    expected: bool,
) -> None:
    assert (
        _date_ranges_overlap(first_start, first_end, second_start, second_end)
        is expected
    )


@pytest.mark.asyncio
async def test_accepts_same_weekly_slot_when_class_date_ranges_do_not_overlap() -> None:
    teacher = make_teacher()
    db = AsyncMock()
    db.execute.side_effect = [
        QueryResult(scalars=[teacher]),
        QueryResult(
            rows=[
                (
                    "6C1",
                    {"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
                    teacher.id,
                    date(2026, 1, 1),
                    date(2026, 3, 31),
                )
            ]
        ),
    ]

    await _validate_teacher_schedule_availability(
        db,
        class_id=str(uuid4()),
        teacher_ids=[teacher.id],
        schedule={"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
        start_date=date(2026, 4, 1),
        end_date=date(2026, 6, 30),
    )


@pytest.mark.asyncio
async def test_rejects_same_weekly_slot_when_date_ranges_share_boundary_day() -> None:
    teacher = make_teacher()
    db = AsyncMock()
    db.execute.side_effect = [
        QueryResult(scalars=[teacher]),
        QueryResult(
            rows=[
                (
                    "6C1",
                    {"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
                    teacher.id,
                    date(2026, 1, 1),
                    date(2026, 3, 31),
                )
            ]
        ),
    ]

    with pytest.raises(ValueError, match="Cô Hạnh đã có lịch lớp 6C1"):
        await _validate_teacher_schedule_availability(
            db,
            class_id=str(uuid4()),
            teacher_ids=[teacher.id],
            schedule={"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
            start_date=date(2026, 3, 31),
            end_date=date(2026, 6, 30),
        )


@pytest.mark.asyncio
async def test_rejects_malformed_stored_schedule_with_clear_class_context() -> None:
    teacher = make_teacher()
    db = AsyncMock()
    db.execute.side_effect = [
        QueryResult(scalars=[teacher]),
        QueryResult(
            rows=[
                (
                    "6C1",
                    {"slots": [{"day": "Thứ 2", "start": "sai", "end": "19:30"}]},
                    teacher.id,
                    date(2026, 1, 1),
                    None,
                )
            ]
        ),
    ]

    with pytest.raises(
        ValueError,
        match="Lịch học đã lưu của lớp 6C1 không hợp lệ",
    ):
        await _validate_teacher_schedule_availability(
            db,
            class_id=str(uuid4()),
            teacher_ids=[teacher.id],
            schedule={"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
            start_date=date(2026, 2, 1),
            end_date=None,
        )


@pytest.mark.asyncio
async def test_accepts_class_without_a_stored_schedule() -> None:
    teacher = make_teacher()
    db = AsyncMock()
    db.execute.side_effect = [
        QueryResult(scalars=[teacher]),
        QueryResult(
            rows=[
                (
                    "6C1",
                    None,
                    teacher.id,
                    None,
                    None,
                )
            ]
        ),
    ]

    await _validate_teacher_schedule_availability(
        db,
        class_id=str(uuid4()),
        teacher_ids=[teacher.id],
        schedule={"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
        start_date=None,
        end_date=None,
    )
