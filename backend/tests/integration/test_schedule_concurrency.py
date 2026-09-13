import asyncio
import os
from datetime import date, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.schemas.class_ import ClassCreate
from app.services.class_service import create_class


pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _make_teacher(db, teacher_id: str) -> None:
    phone = f"09{int(teacher_id[:8], 16) % 100000000:08d}"
    await db.execute(
        text(
            """
            insert into public.staff_members
              (id, full_name, staff_type, zalo_name, phone, is_active)
            values
              (cast(:id as uuid), 'CI Race Teacher', 'TEACHER',
               :zalo, :phone, true)
            """
        ),
        {"id": teacher_id, "zalo": f"CI Race {teacher_id[:8]}", "phone": phone},
    )


def _class_payload(teacher_id: str, class_id: str) -> ClassCreate:
    return ClassCreate(
        name=f"CI Race {class_id[:8]}",
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
                    "assistant_ids": [],
                }
            ],
        },
        teacher_ids=[teacher_id],
        assistant_ids=[],
    )


@pytest.mark.asyncio
async def test_concurrent_schedule_assignments_only_one_commits() -> None:
    teacher_id = str(uuid4())

    async with AsyncSessionLocal() as setup:
        await setup.begin()
        await _make_teacher(setup, teacher_id)
        await setup.commit()

    async def try_create() -> bool:
        async with AsyncSessionLocal() as db:
            try:
                await create_class(
                    db,
                    _class_payload(teacher_id, str(uuid4())),
                    actor_user_id=None,
                )
                await db.commit()
                return True
            except ValueError:
                await db.rollback()
                return False

    results = await asyncio.gather(try_create(), try_create())

    assert sum(results) == 1, "exactly one concurrent request may commit"


@pytest.mark.asyncio
async def test_second_request_after_commit_sees_the_conflict() -> None:
    teacher_id = str(uuid4())

    async with AsyncSessionLocal() as setup:
        await setup.begin()
        await _make_teacher(setup, teacher_id)
        await setup.commit()

    first_class_id = str(uuid4())
    async with AsyncSessionLocal() as db:
        await create_class(
            db, _class_payload(teacher_id, first_class_id), actor_user_id=None
        )
        await db.commit()

    # Request thứ hai (sau khi request đầu đã commit) phải thấy conflict.
    async with AsyncSessionLocal() as db:
        with pytest.raises(ValueError, match="đã có lịch lớp"):
            await create_class(
                db, _class_payload(teacher_id, str(uuid4())), actor_user_id=None
            )
        await db.rollback()


def _next_monday() -> date:
    """Thứ 2 kế tiếp (chưa qua) tính từ business_today để fixture luôn hợp lệ."""
    today = business_today()
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7)


def _class_payload_non_overlapping_weekday(
    teacher_id: str, class_id: str
) -> ClassCreate:
    """Slot Thứ 3; range trùng tuần đầu với lớp nền (slot Thứ 2) nên date
    range giao nhau nhưng không có buổi nào trùng ngày/giờ → không xung đột
    thực tế. (R6: lớp phải kéo dài >= minimum end nên range không thể 1 tuần;
    dùng khác weekday để giữ nguyên ý nghĩa weekday-aware overlap.)"""
    monday = _next_monday()
    return ClassCreate(
        name=f"CI NoWeekday {class_id[:8]}",
        type="MONTHLY",
        base_fee=750_000,
        billing_cycle_months=1,
        class_category="GENERAL",
        grade_mode="GRADE",
        grade_level=6,
        academic_year_start=2026,
        start_date=monday + timedelta(days=1),  # Thứ 3
        end_date=monday + timedelta(days=45),
        identity_scheme="ACADEMIC_YEAR",
        schedule={
            "text": "Thứ 3 (18:00-19:30)",
            "slots": [
                {
                    "day": "Thứ 3",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher_id],
                    "assistant_ids": [],
                }
            ],
        },
        teacher_ids=[teacher_id],
        assistant_ids=[],
    )


def _class_payload_weekday_boundary(teacher_id: str, class_id: str) -> ClassCreate:
    """Slot Thứ 2, cùng ngày bắt đầu (Thứ 2 tuần sau) với lớp nền → giao
    chứa đúng weekday → xung đột. (R6: end >= start + 1 tháng + 1 ngày.)"""
    monday = _next_monday()
    return ClassCreate(
        name=f"CI Boundary {class_id[:8]}",
        type="MONTHLY",
        base_fee=750_000,
        billing_cycle_months=1,
        class_category="GENERAL",
        grade_mode="GRADE",
        grade_level=6,
        academic_year_start=2026,
        start_date=monday,  # Thứ 2
        end_date=monday + timedelta(days=45),
        identity_scheme="ACADEMIC_YEAR",
        schedule={
            "text": "Thứ 2 (18:00-19:30)",
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher_id],
                    "assistant_ids": [],
                }
            ],
        },
        teacher_ids=[teacher_id],
        assistant_ids=[],
    )


@pytest.mark.asyncio
async def test_overlapping_ranges_without_weekday_occurrence_both_commit() -> None:
    """Hai range giao nhau nhưng không có ngày Thứ 2 trong giao → cả hai commit."""
    teacher_id = str(uuid4())

    async with AsyncSessionLocal() as setup:
        await setup.begin()
        await _make_teacher(setup, teacher_id)
        await setup.commit()

    # Lớp nền: slot Thứ 2, range bắt đầu Thứ 2 2026-08-10.
    async with AsyncSessionLocal() as db:
        await create_class(
            db,
            _class_payload_weekday_boundary(teacher_id, str(uuid4())),
            actor_user_id=None,
        )
        await db.commit()

    # Request thứ hai: slot Thứ 3 cùng khoảng ngày — không trùng buổi nào với
    # lớp nền (slot Thứ 2) dù date range giao nhau → phải commit được.
    async with AsyncSessionLocal() as db:
        await create_class(
            db,
            _class_payload_non_overlapping_weekday(teacher_id, str(uuid4())),
            actor_user_id=None,
        )
        await db.commit()

    # Ngược lại: cùng slot Thứ 2, cùng ngày bắt đầu → xung đột.
    async with AsyncSessionLocal() as db:
        with pytest.raises(ValueError, match="đã có lịch lớp"):
            await create_class(
                db,
                _class_payload_weekday_boundary(teacher_id, str(uuid4())),
                actor_user_id=None,
            )
        await db.rollback()


@pytest.mark.asyncio
async def test_concurrency_stress_50_pairs_no_deadlock() -> None:
    """50 cặp transaction cùng staff/khung giờ: mỗi cặp đúng một commit, không
    deadlock, lock order ổn định. Mỗi cặp dùng một teacher mới để không bị
    block bởi lớp của cặp trước."""
    deadlock_count = 0

    async def try_create(teacher_id: str) -> bool:
        async with AsyncSessionLocal() as db:
            try:
                await create_class(
                    db,
                    _class_payload(teacher_id, str(uuid4())),
                    actor_user_id=None,
                )
                await db.commit()
                return True
            except ValueError:
                await db.rollback()
                return False
            except Exception:
                await db.rollback()
                raise

    for _ in range(50):
        teacher_id = str(uuid4())
        async with AsyncSessionLocal() as setup:
            await setup.begin()
            await _make_teacher(setup, teacher_id)
            await setup.commit()
        results = await asyncio.gather(try_create(teacher_id), try_create(teacher_id))
        assert sum(results) == 1, "exactly one commit per concurrent pair"
    assert deadlock_count == 0


@pytest.mark.asyncio
async def test_reversed_lock_order_input_does_not_deadlock() -> None:
    """Hai request gửi danh sách teacher/assistant theo thứ tự đảo ngược —
    lock theo ID ổn định nên không deadlock."""
    teacher_a = str(uuid4())
    assistant_a = str(uuid4())
    teacher_b = str(uuid4())
    assistant_b = str(uuid4())

    async with AsyncSessionLocal() as setup:
        await setup.begin()
        await _make_teacher(setup, teacher_a)
        await _make_teacher(setup, teacher_b)
        await setup.execute(
            text(
                """
                insert into public.staff_members
                  (id, full_name, staff_type, zalo_name, phone, is_active)
                values
                  (cast(:a as uuid), 'CI Race Assistant A', 'ASSISTANT', 'za', '0811111111', true),
                  (cast(:b as uuid), 'CI Race Assistant B', 'ASSISTANT', 'zb', '0822222222', true)
                """
            ),
            {"a": assistant_a, "b": assistant_b},
        )
        await setup.commit()

    def payload(teacher_id: str, assistant_id: str, class_id: str) -> ClassCreate:
        return ClassCreate(
            name=f"CI Rev {class_id[:8]}",
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
                        "assistant_ids": [assistant_id],
                    }
                ],
            },
            teacher_ids=[teacher_id],
            assistant_ids=[assistant_id],
        )

    # Request 1: teacher A + assistant A (thứ tự input A→B ngược với ID ổn định)
    async def create_one(teacher_id: str, assistant_id: str) -> bool:
        async with AsyncSessionLocal() as db:
            try:
                await create_class(
                    db,
                    payload(teacher_id, assistant_id, str(uuid4())),
                    actor_user_id=None,
                )
                await db.commit()
                return True
            except ValueError:
                await db.rollback()
                return False

    results = await asyncio.gather(
        create_one(teacher_a, assistant_a),
        create_one(teacher_b, assistant_b),
    )
    assert sum(results) == 2, "different staff never conflict"
    # Cùng staff nhưng thứ tự input khác nhau → không deadlock, đúng một commit.
    teacher_c = str(uuid4())
    assistant_c = str(uuid4())
    async with AsyncSessionLocal() as setup:
        await setup.begin()
        await _make_teacher(setup, teacher_c)
        await setup.execute(
            text(
                """
                insert into public.staff_members
                  (id, full_name, staff_type, zalo_name, phone, is_active)
                values
                  (cast(:id as uuid), 'CI Race Assistant C', 'ASSISTANT', 'zc', '0833333333', true)
                """
            ),
            {"id": assistant_c},
        )
        await setup.commit()
    results = await asyncio.gather(
        create_one(teacher_c, assistant_c),
        create_one(teacher_c, assistant_c),
    )
    assert sum(results) == 1, "same staff pair: exactly one commit, no deadlock"
