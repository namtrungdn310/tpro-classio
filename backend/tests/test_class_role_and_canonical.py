from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models.class_ import Class
from app.models.staff import StaffMember
from app.schemas.class_ import ClassSchedule, ClassScheduleSlot
from app.services.class_service import (
    _get_class_teacher_ids,
    normalize_schedule_assignments,
)
from app.services.class_conflict_service import (
    _slot_effective_assistant_ids,
    _slot_effective_teacher_ids,
)


class QueryResult:
    def __init__(
        self, rows: list[object] | None = None, scalars: list[object] | None = None
    ) -> None:
        self._rows = rows or []
        self._scalars = scalars or []

    def scalars(self) -> "QueryResult":
        return self

    def all(self) -> list[object]:
        return self._scalars if self._scalars else self._rows


def make_class() -> Class:
    return Class(
        id=str(uuid4()),
        name="6C1",
        type="MONTHLY",
        base_fee=750_000,
        billing_cycle_months=1,
        teacher_id=str(uuid4()),
    )


@pytest.mark.asyncio
async def test_get_class_teacher_ids_filters_staff_role() -> None:
    teacher_id = str(uuid4())
    db = AsyncMock()
    db.execute.return_value = QueryResult(scalars=[teacher_id])

    teacher_ids = await _get_class_teacher_ids(db, make_class())

    # Vai trò thuộc liên kết lớp, không còn thuộc hồ sơ nhân sự.
    query = str(db.execute.await_args.args[0])
    assert "class_teachers.role" in query
    assert "staff_type" not in query
    assert teacher_ids == [teacher_id]


@pytest.mark.asyncio
async def test_get_class_teacher_ids_falls_back_to_legacy_teacher_column() -> None:
    class_ = make_class()
    db = AsyncMock()
    db.execute.return_value = QueryResult(scalars=[])

    teacher_ids = await _get_class_teacher_ids(db, class_)

    assert teacher_ids == [class_.teacher_id]


def test_slot_effective_teacher_uses_explicit_when_present() -> None:
    slot = ClassScheduleSlot(
        day="Thứ 2",
        start="18:00",
        end="19:30",
        teacher_ids=[uuid4(), uuid4()],
    )
    pool = [str(uuid4())]
    assert _slot_effective_teacher_ids(slot, pool) == [
        str(teacher_id) for teacher_id in slot.teacher_ids
    ]


def test_slot_effective_teacher_does_not_bleed_class_pool_when_empty() -> None:
    slot = ClassScheduleSlot(day="Thứ 2", start="18:00", end="19:30")
    pool = [str(uuid4())]
    assert _slot_effective_teacher_ids(slot, pool) == []


def test_slot_effective_assistant_never_falls_back() -> None:
    empty_slot = ClassScheduleSlot(day="Thứ 2", start="18:00", end="19:30")
    explicit_slot = ClassScheduleSlot(
        day="Thứ 2",
        start="18:00",
        end="19:30",
        assistant_ids=[uuid4()],
    )
    assert _slot_effective_assistant_ids(empty_slot) == []
    assert _slot_effective_assistant_ids(explicit_slot) == [
        str(assistant_id) for assistant_id in explicit_slot.assistant_ids
    ]


def test_normalize_requires_explicit_teacher_and_keeps_empty_assistant() -> None:
    teacher_id = str(uuid4())
    assistant_id = str(uuid4())
    schedule = ClassSchedule(
        text="Thứ 2 (18:00-19:30)",
        slots=[
            # Mỗi buổi phải có assignment giáo viên riêng.
            ClassScheduleSlot(
                day="Thứ 2",
                start="18:00",
                end="19:30",
                teacher_ids=[teacher_id],
            ),
            ClassScheduleSlot(
                day="Thứ 4",
                start="19:00",
                end="20:30",
                teacher_ids=[teacher_id],
                assistant_ids=[assistant_id],
            ),
        ],
    )

    canonical = normalize_schedule_assignments(
        schedule,
        teacher_ids=[teacher_id],
        assistant_ids=[assistant_id],
    )

    assert canonical is not None
    first, second = canonical.slots
    assert [str(staff_id) for staff_id in first.teacher_ids] == [teacher_id]
    assert first.assistant_ids == []
    assert [str(staff_id) for staff_id in second.teacher_ids] == [teacher_id]
    assert [str(staff_id) for staff_id in second.assistant_ids] == [assistant_id]
    # day/start/end/text không đổi.
    assert canonical.text == schedule.text
    assert first.day == "Thứ 2" and first.start == "18:00" and first.end == "19:30"


def test_normalize_keeps_unstaffed_slot_for_later_assignment() -> None:
    schedule = ClassSchedule(
        slots=[ClassScheduleSlot(day="Thứ 2", start="18:00", end="19:30")]
    )
    canonical = normalize_schedule_assignments(
        schedule,
        teacher_ids=[str(uuid4())],
        assistant_ids=[],
    )

    assert canonical is not None
    assert canonical.slots[0].teacher_ids == []


def test_normalize_dedupes_ids_in_stable_order() -> None:
    teacher_a = str(uuid4())
    teacher_b = str(uuid4())
    schedule = ClassSchedule(
        slots=[
            ClassScheduleSlot(
                day="Thứ 2",
                start="18:00",
                end="19:30",
                teacher_ids=[teacher_b, teacher_a, teacher_b],
            )
        ]
    )

    canonical = normalize_schedule_assignments(
        schedule,
        teacher_ids=[teacher_a, teacher_b],
        assistant_ids=[],
    )

    assert [str(staff_id) for staff_id in canonical.slots[0].teacher_ids] == [
        teacher_b,
        teacher_a,
    ]


def test_normalize_rejects_slot_teacher_outside_class_pool() -> None:
    schedule = ClassSchedule(
        slots=[
            ClassScheduleSlot(
                day="Thứ 2",
                start="18:00",
                end="19:30",
                teacher_ids=[uuid4()],
            )
        ]
    )

    with pytest.raises(ValueError, match="Giáo viên của từng buổi"):
        normalize_schedule_assignments(
            schedule,
            teacher_ids=[str(uuid4())],
            assistant_ids=[],
        )


def test_normalize_rejects_slot_assistant_outside_class_pool() -> None:
    schedule = ClassSchedule(
        slots=[
            ClassScheduleSlot(
                day="Thứ 2",
                start="18:00",
                end="19:30",
                assistant_ids=[uuid4()],
            )
        ]
    )

    with pytest.raises(ValueError, match="Trợ giảng của từng buổi"):
        normalize_schedule_assignments(
            schedule,
            teacher_ids=[str(uuid4())],
            assistant_ids=[str(uuid4())],
        )


def test_normalize_accepts_slot_without_any_staff() -> None:
    schedule = ClassSchedule(
        slots=[ClassScheduleSlot(day="Thứ 2", start="18:00", end="19:30")]
    )

    canonical = normalize_schedule_assignments(
        schedule, teacher_ids=[], assistant_ids=[]
    )

    assert canonical is not None
    assert canonical.slots[0].teacher_ids == []
    assert canonical.slots[0].assistant_ids == []


def test_class_schema_rejects_teacher_assistant_overlap() -> None:
    from app.schemas.class_ import ClassCreate

    teacher_id = uuid4()
    with pytest.raises(ValidationError, match="vừa là giáo viên vừa là trợ giảng"):
        ClassCreate(
            name="6C1",
            type="MONTHLY",
            base_fee=750_000,
            billing_cycle_months=1,
            class_category="GENERAL",
            grade_mode="GRADE",
            grade_level=6,
            academic_year_start=2026,
            start_date="2026-09-01",
            end_date="2027-05-31",
            identity_scheme="ACADEMIC_YEAR",
            schedule={
                "text": "Thứ 2 (18:00-19:30)",
                "slots": [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                        "assistant_ids": [teacher_id],
                    }
                ],
            },
            teacher_ids=[teacher_id],
            assistant_ids=[teacher_id],
        )


@pytest.mark.asyncio
async def test_sync_class_teachers_does_not_touch_assistant_links() -> None:
    """Sửa teacher không được xóa/reinsert assistant link và không phát sinh
    audit giả cho assistant."""
    from app.services.class_service import _sync_class_teachers

    teacher = StaffMember(
        id=str(uuid4()),
        full_name="Cô Hạnh",
        staff_type="TEACHER",
        is_active=True,
    )
    db = AsyncMock()
    db.execute.side_effect = [
        QueryResult(scalars=[teacher]),
        QueryResult(
            rows=[
                # SQL đã lọc TEACHER nên assistant link không xuất hiện.
                (type("Link", (), {"teacher_id": teacher.id})(), "Cô Hạnh"),
            ]
        ),
    ]

    class_ = make_class()
    class_.teacher_id = teacher.id
    await _sync_class_teachers(db, class_, [teacher.id], actor_user_id=str(uuid4()))

    # Query link hiện tại lọc vai trò ngay trên liên kết lớp.
    query = str(db.execute.await_args_list[1].args[0])
    assert "class_teachers.role" in query
    assert "staff_type" not in query
    assert "FOR UPDATE" in query
    # Teacher không đổi → không xóa/thêm link → không audit event giả.
    assert not any(
        "ClassTeacherEvent" in str(call) for call in db.add.call_args_list if call.args
    )
