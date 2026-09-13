from datetime import date
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.models.staff import StaffMember
from app.services.class_conflict_service import (
    _load_overlapping_class_memberships,
    _validate_staff_schedule_availability,
)
from app.services.class_service import _date_ranges_overlap


class QueryResult:
    def __init__(
        self, *, scalars: list[object] | None = None, rows: list[tuple] | None = None
    ) -> None:
        self._scalars = scalars or []
        self._rows = rows or []

    def scalars(self) -> "QueryResult":
        return self

    def unique(self) -> "QueryResult":
        return self

    def all(self) -> list[object] | list[tuple]:
        return self._scalars if self._scalars else self._rows


class EmptyScalarResult:
    def scalar_one_or_none(self) -> None:
        return None

    def scalars(self):
        return self

    def unique(self):
        return self

    def all(self) -> list:
        return []


def make_staff(staff_type: str = "TEACHER", *, active: bool = True) -> StaffMember:
    return StaffMember(
        id=str(uuid4()),
        full_name="Cô Hạnh" if staff_type == "TEACHER" else "Cô Lan",
        staff_type=staff_type,
        is_active=active,
    )


def make_conflict_row(
    class_id: str,
    class_name: str,
    schedule: dict | None,
    member_id: str | None,
    start_date: date | None = None,
    end_date: date | None = None,
    member_role: str | None = "TEACHER",
    class_category: str | None = None,
    grade_level: int | None = None,
) -> tuple:
    return (
        class_id,
        class_name,
        class_category,
        grade_level,
        schedule,
        start_date,
        end_date,
        member_id,
        member_role,
    )


def make_membership_row(
    class_id: str, member_id: str, member_role: str = "TEACHER"
) -> tuple:
    return (class_id, member_id, member_role)


def availability_db(
    staff: list[StaffMember],
    rows: list[tuple],
    memberships: list[tuple] | None = None,
) -> AsyncMock:
    if memberships is None:
        memberships = [(row[0], row[7], row[8]) for row in rows if row[7] is not None]
    db = AsyncMock()
    # Merged membership flow: the class read already carries one row per member,
    # so no separate full-membership query exists anymore.
    real_results = [
        QueryResult(scalars=staff),
        QueryResult(rows=_expand_memberships(rows, memberships)),
    ]

    def side_effect(*args, **kwargs):
        if real_results:
            return real_results.pop(0)
        return EmptyScalarResult()

    db.execute.side_effect = side_effect
    db.scalar.return_value = None
    return db


def _expand_memberships(rows: list[tuple], memberships: list[tuple]) -> list[tuple]:
    """Simulate the LEFT JOIN membership: one class row per junction member."""
    by_class: dict[str, list[tuple]] = {}
    for membership in memberships:
        by_class.setdefault(membership[0], []).append(membership)
    expanded: list[tuple] = []
    for row in rows:
        class_id = row[0]
        class_members = by_class.get(class_id)
        if class_members:
            for _class_id, member_id, member_role in class_members:
                expanded.append((*row[:7], member_id, member_role))
        else:
            expanded.append((*row[:7], None, None))
    return expanded


def call_validator(
    db: AsyncMock,
    *,
    teacher_ids: list[str],
    assistant_ids: list[str] | None = None,
    schedule: dict | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> None:
    return _validate_staff_schedule_availability(
        db,
        class_id=str(uuid4()),
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids or [],
        schedule=schedule,
        start_date=start_date,
        end_date=end_date,
    )


@pytest.mark.asyncio
async def test_candidate_membership_merges_slot_staff_before_staff_filtering() -> None:
    """Legacy slot assignments must still select the occupied class.

    This protects selected-staff availability when class_teachers has not yet
    been repaired: filtering only by the junction would silently miss the
    conflict before the later membership merge can run.
    """
    assistant = make_staff("ASSISTANT")
    other_class_id = str(uuid4())
    db = AsyncMock()
    db.execute.side_effect = [
        QueryResult(
            rows=[
                make_conflict_row(
                    other_class_id,
                    "Lớp dữ liệu cũ",
                    {
                        "slots": [
                            {
                                "day": "Thứ 3",
                                "start": "18:00",
                                "end": "19:30",
                                "assistant_ids": [assistant.id],
                            }
                        ]
                    },
                    None,
                    member_role=None,
                )
            ]
        ),
        QueryResult(rows=[(other_class_id, assistant.id, "ASSISTANT")]),
    ]

    memberships = await _load_overlapping_class_memberships(
        db,
        class_id=str(uuid4()),
        requested_ids=[assistant.id],
    )

    assert memberships[other_class_id]["members"] == [(assistant.id, "ASSISTANT")]
    candidate_sql = str(db.execute.await_args_list[0].args[0])
    assert "UNION" in candidate_sql
    assert "class_teachers" in candidate_sql
    assert "class_schedule_slot_staff" in candidate_sql


@pytest.mark.asyncio
async def test_rejects_schedule_overlap_for_the_same_teacher() -> None:
    teacher = make_staff()
    other_class_id = str(uuid4())
    db = availability_db(
        [teacher],
        [
            make_conflict_row(
                other_class_id,
                "6C1",
                {
                    "text": "Thứ 2 (18:00-19:30)",
                    "slots": [
                        {
                            "day": "Thứ 2",
                            "start": "18:00",
                            "end": "19:30",
                            "teacher_ids": [teacher.id],
                        }
                    ],
                },
                teacher.id,
            )
        ],
    )

    with pytest.raises(ValueError, match="Cô Hạnh đã có lịch lớp 6C1"):
        await call_validator(
            db,
            teacher_ids=[teacher.id],
            schedule={
                "text": "Thứ 2 (19:00-20:30)",
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "19:00",
                        "end": "20:30",
                        "teacher_ids": [teacher.id],
                    }
                ],
            },
        )


@pytest.mark.asyncio
async def test_rejects_overlap_for_the_same_assistant() -> None:
    teacher = make_staff()
    assistant = make_staff("ASSISTANT")
    other_class_id = str(uuid4())
    db = availability_db(
        [teacher, assistant],
        [
            make_conflict_row(
                other_class_id,
                "IELTS 6.5",
                {
                    "slots": [
                        {
                            "day": "Thứ 3",
                            "start": "18:00",
                            "end": "19:30",
                            "assistant_ids": [assistant.id],
                        }
                    ]
                },
                assistant.id,
                member_role="ASSISTANT",
            )
        ],
    )

    with pytest.raises(ValueError, match="Cô Lan đã có lịch lớp IELTS 6.5"):
        await call_validator(
            db,
            teacher_ids=[teacher.id],
            assistant_ids=[assistant.id],
            schedule={
                "slots": [
                    {
                        "day": "Thứ 3",
                        "start": "19:00",
                        "end": "20:30",
                        "teacher_ids": [teacher.id],
                        "assistant_ids": [assistant.id],
                    }
                ]
            },
        )


@pytest.mark.asyncio
async def test_accepts_adjacent_schedule_for_the_same_teacher() -> None:
    teacher = make_staff()
    db = availability_db(
        [teacher],
        [
            make_conflict_row(
                str(uuid4()),
                "6C1",
                {
                    "slots": [
                        {
                            "day": "Thứ 2",
                            "start": "18:00",
                            "end": "19:30",
                            "teacher_ids": [teacher.id],
                        }
                    ]
                },
                teacher.id,
            )
        ],
    )

    await call_validator(
        db,
        teacher_ids=[teacher.id],
        schedule={"slots": [{"day": "Thứ 2", "start": "19:30", "end": "21:00"}]},
    )


@pytest.mark.asyncio
async def test_rejects_inactive_or_missing_teacher_before_schedule_check() -> None:
    db = AsyncMock()
    db.execute.return_value = QueryResult(scalars=[])

    with pytest.raises(ValueError, match="không hợp lệ hoặc đã ngừng hoạt động"):
        await call_validator(
            db,
            teacher_ids=[str(uuid4())],
            schedule=None,
        )


@pytest.mark.asyncio
async def test_rejects_inactive_assistant() -> None:
    inactive = make_staff("ASSISTANT", active=False)
    db = AsyncMock()
    db.execute.return_value = QueryResult(scalars=[inactive])

    with pytest.raises(ValueError, match="đã ngừng hoạt động"):
        await call_validator(
            db,
            teacher_ids=[str(uuid4())],
            assistant_ids=[inactive.id],
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
    teacher = make_staff()
    # SQL lọc date overlap trước khi trả row; mock trả 0 row cho lớp ngoài range.
    db = availability_db(
        [teacher],
        [
            make_conflict_row(
                str(uuid4()),
                "6C1",
                {
                    "slots": [
                        {
                            "day": "Thứ 2",
                            "start": "18:00",
                            "end": "19:30",
                            "teacher_ids": [teacher.id],
                        }
                    ]
                },
                teacher.id,
                date(2026, 1, 1),
                date(2026, 3, 31),
            )
        ],
    )
    db.execute.side_effect = [
        QueryResult(scalars=[teacher]),
        QueryResult(rows=[]),
        QueryResult(rows=[]),
    ]

    await call_validator(
        db,
        teacher_ids=[teacher.id],
        schedule={
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher.id],
                }
            ]
        },
        start_date=date(2026, 4, 1),
        end_date=date(2026, 6, 30),
    )

    # Date overlap được lọc ngay trong SQL (không tải toàn bộ active classes).
    query = db.execute.await_args_list[1].args[0]
    compiled = str(query)
    assert "stopped_on" in compiled
    assert "start_date" in compiled
    assert "IS NULL" in compiled


@pytest.mark.asyncio
async def test_rejects_same_weekly_slot_when_date_ranges_share_boundary_day() -> None:
    teacher = make_staff()
    # 2026-03-30 là Thứ 2 — boundary đúng weekday của slot → conflict.
    db = availability_db(
        [teacher],
        [
            make_conflict_row(
                str(uuid4()),
                "6C1",
                {
                    "slots": [
                        {
                            "day": "Thứ 2",
                            "start": "18:00",
                            "end": "19:30",
                            "teacher_ids": [teacher.id],
                        }
                    ]
                },
                teacher.id,
                date(2026, 1, 1),
                date(2026, 3, 30),
            )
        ],
    )

    with pytest.raises(ValueError, match="Cô Hạnh đã có lịch lớp 6C1"):
        await call_validator(
            db,
            teacher_ids=[teacher.id],
            schedule={
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher.id],
                    }
                ]
            },
            start_date=date(2026, 3, 30),
            end_date=date(2026, 6, 30),
        )


@pytest.mark.asyncio
async def test_accepts_overlap_on_boundary_day_with_wrong_weekday() -> None:
    teacher = make_staff()
    # 2026-03-31 là Thứ 3; slot Thứ 2 → giao chỉ 1 ngày không đúng weekday → hợp lệ.
    db = availability_db(
        [teacher],
        [
            make_conflict_row(
                str(uuid4()),
                "6C1",
                {
                    "slots": [
                        {
                            "day": "Thứ 2",
                            "start": "18:00",
                            "end": "19:30",
                            "teacher_ids": [teacher.id],
                        }
                    ]
                },
                teacher.id,
                date(2026, 1, 1),
                date(2026, 3, 31),
            )
        ],
    )

    await call_validator(
        db,
        teacher_ids=[teacher.id],
        schedule={
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher.id],
                }
            ]
        },
        start_date=date(2026, 3, 31),
        end_date=date(2026, 6, 30),
    )


@pytest.mark.asyncio
async def test_rejects_malformed_stored_schedule_with_clear_class_context() -> None:
    teacher = make_staff()
    db = availability_db(
        [teacher],
        [
            make_conflict_row(
                str(uuid4()),
                "6C1",
                {
                    "slots": [
                        {
                            "day": "Thứ 2",
                            "start": "sai",
                            "end": "19:30",
                            "teacher_ids": [teacher.id],
                        }
                    ]
                },
                teacher.id,
                date(2026, 1, 1),
                None,
            )
        ],
    )

    with pytest.raises(
        ValueError,
        match="Lịch học đã lưu của lớp 6C1 không hợp lệ",
    ):
        await call_validator(
            db,
            teacher_ids=[teacher.id],
            schedule={
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher.id],
                    }
                ]
            },
            start_date=date(2026, 2, 1),
            end_date=None,
        )


@pytest.mark.asyncio
async def test_accepts_class_without_a_stored_schedule() -> None:
    teacher = make_staff()
    db = availability_db(
        [teacher],
        [make_conflict_row(str(uuid4()), "6C1", None, teacher.id)],
    )

    await call_validator(
        db,
        teacher_ids=[teacher.id],
        schedule={
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher.id],
                }
            ]
        },
        start_date=None,
        end_date=None,
    )


@pytest.mark.asyncio
async def test_existing_slot_with_explicit_teacher_does_not_conflict_with_other_pool_member() -> (
    None
):
    """Lớp có 2 giáo viên nhưng slot gán rõ GV A: yêu cầu gán GV B cùng giờ
    không phải xung đột — không áp membership cấp lớp lên slot đã phân công."""
    teacher_a = make_staff()
    teacher_b = make_staff()
    other_class_id = str(uuid4())
    db = availability_db(
        [teacher_b],
        [
            make_conflict_row(
                other_class_id,
                "6A1",
                {
                    "slots": [
                        {
                            "day": "Thứ 2",
                            "start": "18:00",
                            "end": "19:30",
                            "teacher_ids": [teacher_a.id],
                        }
                    ]
                },
                teacher_a.id,
            ),
            make_conflict_row(
                other_class_id,
                "6A1",
                {
                    "slots": [
                        {
                            "day": "Thứ 2",
                            "start": "18:00",
                            "end": "19:30",
                            "teacher_ids": [teacher_a.id],
                        }
                    ]
                },
                teacher_b.id,
            ),
        ],
    )

    await call_validator(
        db,
        teacher_ids=[teacher_b.id],
        schedule={
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher_b.id],
                }
            ]
        },
    )


@pytest.mark.asyncio
async def test_legacy_existing_slot_without_assignment_does_not_bleed_class_pool() -> (
    None
):
    """Slot thiếu assignment không được suy đoán thành toàn bộ pool.

    Migrations 051/059 đã canonicalize dữ liệu thật; nếu một payload cũ lọt
    vào đây, fail-closed là an toàn hơn việc làm bận nhầm tất cả giáo viên.
    """
    teacher_a = make_staff()
    teacher_b = make_staff()
    other_class_id = str(uuid4())
    db = availability_db(
        [teacher_b],
        [
            make_conflict_row(
                other_class_id,
                "6A1",
                {"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
                teacher_a.id,
            ),
            make_conflict_row(
                other_class_id,
                "6A1",
                {"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
                teacher_b.id,
            ),
        ],
    )

    await call_validator(
        db,
        teacher_ids=[teacher_b.id],
        schedule={
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher_b.id],
                }
            ]
        },
    )


@pytest.mark.asyncio
async def test_requested_slot_without_teacher_assignment_is_not_treated_as_pool() -> (
    None
):
    """Payload thiếu teacher_ids không được tự gán toàn bộ giáo viên lớp."""
    teacher = make_staff()
    other_class_id = str(uuid4())
    db = availability_db(
        [teacher],
        [
            make_conflict_row(
                other_class_id,
                "6C1",
                {"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
                teacher.id,
            )
        ],
    )

    await call_validator(
        db,
        teacher_ids=[teacher.id],
        schedule={
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher.id],
                }
            ]
        },
    )


@pytest.mark.asyncio
async def test_completed_or_cancelled_classes_do_not_occupy_future_schedule() -> None:
    """Lớp completed/cancelled bị loại khỏi truy vấn (mock trả 0 row) nên
    không bao giờ chiếm lịch — contract của query membership."""
    teacher = make_staff()
    db = AsyncMock()
    db.execute.side_effect = [
        QueryResult(scalars=[teacher]),
        QueryResult(rows=[]),
        QueryResult(rows=[]),
    ]

    await call_validator(
        db,
        teacher_ids=[teacher.id],
        schedule={
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher.id],
                }
            ]
        },
    )


@pytest.mark.asyncio
async def test_staff_rows_are_locked_in_stable_id_order() -> None:
    teacher = make_staff()
    assistant = make_staff("ASSISTANT")
    db = AsyncMock()
    db.execute.side_effect = [
        QueryResult(scalars=[teacher, assistant]),
        QueryResult(rows=[]),
        QueryResult(rows=[]),
    ]

    await call_validator(
        db,
        teacher_ids=[teacher.id],
        assistant_ids=[assistant.id],
        schedule={
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher.id],
                }
            ]
        },
    )

    lock_query = db.execute.await_args_list[0].args[0]
    assert str(lock_query).startswith("SELECT")
    assert "FOR UPDATE" in str(lock_query)
