from datetime import date
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.schemas.class_ import ScheduleAvailabilityRequest
from app.services.class_conflict_service import (
    ScheduleDataInvalidError,
    get_class_schedule_availability,
)


class QueryResult:
    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def all(self) -> list[tuple]:
        return self._rows

    def scalars(self):
        return self

    def unique(self):
        return self


class EmptyScalarResult:
    """Trả về rỗng cho mọi kiểu đọc relational (fallback JSON trong unit test)."""

    def scalar_one_or_none(self) -> None:
        return None

    def scalars(self):
        return self

    def unique(self):
        return self

    def all(self) -> list:
        return []


def make_row(
    class_id: str,
    class_name: str,
    schedule: dict | None,
    member_id: str,
    start_date: date | None = None,
    end_date: date | None = None,
    member_role: str = "TEACHER",
    class_category: str | None = "SPECIALIZED",
    grade_level: int | None = 6,
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


def make_membership_row(class_id: str, member_id: str, role: str) -> tuple:
    return (class_id, member_id, role)


def make_availability_db(
    rows: list[tuple], memberships: list[tuple] | None = None
) -> AsyncMock:
    """Merged membership flow: class rows already carry one row per member.

    The production query LEFT JOINs membership into the class read, so the
    mock returns the expanded rows for the first execute and empty relational
    slot results afterwards (fallback to the JSON schedule projection).
    """
    db = AsyncMock()
    expanded = _expand_memberships(rows, memberships)
    real_results = [QueryResult(expanded)]

    def side_effect(*args, **kwargs):
        if real_results:
            return real_results.pop(0)
        return EmptyScalarResult()

    db.execute.side_effect = side_effect
    db.scalar.return_value = None
    return db


def _expand_memberships(
    rows: list[tuple], memberships: list[tuple] | None
) -> list[tuple]:
    """Simulate LEFT JOIN: one class row per junction member, or a NULL member
    row when the class has no membership."""
    by_class: dict[str, list[tuple]] = {}
    for membership in memberships or []:
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


def _memberships_for(rows: list[tuple]) -> list[tuple]:
    memberships = []
    for row in rows:
        memberships.append(make_membership_row(row[0], row[7], row[8]))
    return memberships


@pytest.mark.asyncio
async def test_availability_returns_one_canonical_block_per_session() -> None:
    teacher_id = str(uuid4())
    other_teacher_id = str(uuid4())
    rows = [
        make_row(
            str(uuid4()),
            "6A1",
            {
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                    }
                ]
            },
            teacher_id,
        ),
        make_row(
            str(uuid4()),
            "6B1",
            {
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [other_teacher_id],
                    }
                ]
            },
            other_teacher_id,
        ),
    ]
    db = make_availability_db(rows, _memberships_for(rows))

    blocks = await get_class_schedule_availability(
        db,
        class_id=None,
        teacher_ids=[teacher_id],
        assistant_ids=[],
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
    )

    assert len(blocks) == 1
    assert blocks[0].class_name == "6A1"
    assert [str(staff_id) for staff_id in blocks[0].busy_teacher_ids] == [teacher_id]
    assert blocks[0].busy_assistant_ids == []
    assert blocks[0].class_category == "SPECIALIZED"
    assert blocks[0].grade_level == 6
    # Không có trường liên hệ trong response.
    payload = blocks[0].model_dump()
    assert "phone" not in payload
    assert "zalo" not in payload
    assert "email" not in payload


@pytest.mark.asyncio
async def test_availability_keeps_dual_role_busy_ids_in_one_block() -> None:
    teacher_id = str(uuid4())
    assistant_id = str(uuid4())
    class_id = str(uuid4())
    rows = [
        make_row(
            class_id,
            "6A1",
            {
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                        "assistant_ids": [assistant_id],
                    }
                ]
            },
            teacher_id,
        )
    ]
    db = make_availability_db(
        rows,
        [
            make_membership_row(class_id, teacher_id, "TEACHER"),
            make_membership_row(class_id, assistant_id, "ASSISTANT"),
        ],
    )

    blocks = await get_class_schedule_availability(
        db,
        class_id=None,
        teacher_ids=[teacher_id],
        assistant_ids=[assistant_id],
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
    )

    assert len(blocks) == 1
    assert [str(staff_id) for staff_id in blocks[0].busy_teacher_ids] == [teacher_id]
    assert [str(staff_id) for staff_id in blocks[0].busy_assistant_ids] == [
        assistant_id
    ]


@pytest.mark.asyncio
async def test_availability_reports_assistant_busy_ids_without_teacher_conflict() -> (
    None
):
    assistant_id = str(uuid4())
    teacher_id = str(uuid4())
    class_id = str(uuid4())
    rows = [
        make_row(
            class_id,
            "IELTS 6.5",
            {
                "slots": [
                    {
                        "day": "Thứ 4",
                        "start": "19:00",
                        "end": "20:30",
                        "teacher_ids": [teacher_id],
                        "assistant_ids": [assistant_id],
                    }
                ]
            },
            assistant_id,
            member_role="ASSISTANT",
        )
    ]
    db = make_availability_db(
        rows,
        [
            make_membership_row(class_id, teacher_id, "TEACHER"),
            make_membership_row(class_id, assistant_id, "ASSISTANT"),
        ],
    )

    blocks = await get_class_schedule_availability(
        db,
        class_id=None,
        teacher_ids=[],
        assistant_ids=[assistant_id],
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
    )

    assert len(blocks) == 1
    assert blocks[0].busy_teacher_ids == []
    assert [str(staff_id) for staff_id in blocks[0].busy_assistant_ids] == [
        assistant_id
    ]


@pytest.mark.asyncio
async def test_availability_skips_sessions_without_weekday_occurrence() -> None:
    teacher_id = str(uuid4())
    class_id = str(uuid4())
    rows = [
        make_row(
            class_id,
            "6A1",
            {
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                    }
                ]
            },
            teacher_id,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 31),
        )
    ]
    db = make_availability_db(rows, _memberships_for(rows))

    # Giao đúng 2026-03-31 (Thứ 3) — slot Thứ 2 không xảy ra trong giao.
    blocks = await get_class_schedule_availability(
        db,
        class_id=None,
        teacher_ids=[teacher_id],
        assistant_ids=[],
        start_date=date(2026, 3, 31),
        end_date=date(2026, 6, 30),
    )

    assert blocks == []


@pytest.mark.asyncio
async def test_availability_skips_completed_class_date_gap() -> None:
    teacher_id = str(uuid4())
    class_id = str(uuid4())
    rows = [
        make_row(
            class_id,
            "6A1",
            {
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                    }
                ]
            },
            teacher_id,
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
        )
    ]
    db = make_availability_db(rows, _memberships_for(rows))

    blocks = await get_class_schedule_availability(
        db,
        class_id=None,
        teacher_ids=[teacher_id],
        assistant_ids=[],
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
    )

    assert blocks == []


@pytest.mark.asyncio
async def test_availability_legacy_slot_does_not_bleed_class_pool() -> None:
    teacher_a = str(uuid4())
    teacher_b = str(uuid4())
    class_id = str(uuid4())
    rows = [
        make_row(
            class_id,
            "6A1",
            {"slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]},
            teacher_a,
        )
    ]
    db = make_availability_db(
        rows,
        [
            make_membership_row(class_id, teacher_a, "TEACHER"),
            make_membership_row(class_id, teacher_b, "TEACHER"),
        ],
    )

    blocks = await get_class_schedule_availability(
        db,
        class_id=None,
        teacher_ids=[teacher_b],
        assistant_ids=[],
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
    )

    # Slot thiếu assignment không được suy đoán thành toàn bộ GV cấp lớp.
    assert blocks == []


@pytest.mark.asyncio
async def test_availability_explicit_assignment_outside_junction_fails_closed() -> None:
    teacher_id = str(uuid4())
    class_id = str(uuid4())
    rows = [
        make_row(
            class_id,
            "6A1",
            {
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                    }
                ]
            },
            teacher_id,
        )
    ]
    # Full membership KHÔNG chứa teacher_id → explicit lệch junction → fail-closed.
    db = make_availability_db(rows, [])

    with pytest.raises(ScheduleDataInvalidError, match="không khớp danh sách"):
        await get_class_schedule_availability(
            db,
            class_id=None,
            teacher_ids=[teacher_id],
            assistant_ids=[],
            start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 31),
        )


@pytest.mark.asyncio
async def test_availability_wrong_role_membership_fails_closed() -> None:
    teacher_id = str(uuid4())
    class_id = str(uuid4())
    rows = [
        make_row(
            class_id,
            "6A1",
            {
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                    }
                ]
            },
            teacher_id,
        )
    ]
    # Membership hiện có role ASSISTANT trong khi slot explicit gọi nó là TEACHER.
    db = make_availability_db(
        rows,
        [make_membership_row(class_id, teacher_id, "ASSISTANT")],
    )

    with pytest.raises(ScheduleDataInvalidError, match="không khớp danh sách"):
        await get_class_schedule_availability(
            db,
            class_id=None,
            teacher_ids=[teacher_id],
            assistant_ids=[],
            start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 31),
        )


def test_availability_request_rejects_unknown_fields_and_invalid_payload() -> None:
    with pytest.raises(ValidationError):
        ScheduleAvailabilityRequest(
            start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 31),
            teacher_ids=[],
            assistant_ids=[],
            evil_field="x",
        )
    with pytest.raises(ValidationError, match="Ngày kết thúc phải sau ngày bắt đầu"):
        ScheduleAvailabilityRequest(
            start_date=date(2026, 3, 31),
            end_date=date(2026, 1, 1),
            teacher_ids=[uuid4()],
            assistant_ids=[],
        )
    with pytest.raises(ValidationError, match="ít nhất một giáo viên"):
        ScheduleAvailabilityRequest(
            start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 31),
            teacher_ids=[],
            assistant_ids=[],
        )


def test_availability_request_all_classes_allows_empty_staff_scope() -> None:
    payload = ScheduleAvailabilityRequest(
        scope="all_classes",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
        teacher_ids=[],
        assistant_ids=[],
    )
    assert payload.scope == "all_classes"


@pytest.mark.asyncio
async def test_all_classes_availability_returns_blocks_without_staff_filter() -> None:
    class_id = str(uuid4())
    teacher_id = str(uuid4())
    rows = [
        make_row(
            class_id,
            "6A1",
            {
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                    }
                ]
            },
            teacher_id,
        )
    ]
    db = make_availability_db(rows, _memberships_for(rows))
    result = await get_class_schedule_availability(
        db,
        class_id=None,
        teacher_ids=[],
        assistant_ids=[],
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
        scope="all_classes",
    )
    assert [(item.class_name, item.day, item.start, item.end) for item in result] == [
        ("6A1", "Thứ 2", "18:00", "19:30")
    ]
    assert result[0].busy_teacher_ids == [UUID(teacher_id)]
    # Broad class-centric reads must stay bounded: memberships + relational
    # slots + slot staff are loaded in bulk, not once per class.
    assert db.execute.await_count <= 4


@pytest.mark.asyncio
async def test_all_classes_availability_locks_unassigned_legacy_slot() -> None:
    """Class-centric hit testing must not treat a staff-less legacy slot as free."""
    class_id = str(uuid4())
    rows = [
        make_row(
            class_id,
            "Lớp chưa phân công",
            {
                "slots": [
                    {
                        "day": "Thứ 3",
                        "start": "09:00",
                        "end": "10:30",
                        "teacher_ids": [],
                        "assistant_ids": [],
                    }
                ]
            },
            None,  # outer join: the class has no staff junction row
        )
    ]
    result = await get_class_schedule_availability(
        make_availability_db(rows, []),
        class_id=None,
        teacher_ids=[],
        assistant_ids=[],
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
        scope="all_classes",
    )
    assert [(item.class_name, item.day, item.start, item.end) for item in result] == [
        ("Lớp chưa phân công", "Thứ 3", "09:00", "10:30")
    ]
    assert result[0].busy_teacher_ids == []
    assert result[0].busy_assistant_ids == []


def test_availability_route_is_management_gated() -> None:
    from app.core.dependencies import require_management
    from app.routers.classes import router

    route = next(
        route
        for route in router.routes
        if getattr(route, "path", "") == "/schedule-availability"
        and "POST" in getattr(route, "methods", set())
    )

    def _collect_calls(dependant) -> list:
        calls = [dependant.call]
        for sub in getattr(dependant, "dependencies", []):
            calls.extend(_collect_calls(sub))
        return calls

    calls = _collect_calls(route.dependant)
    assert any(call is require_management for call in calls)
