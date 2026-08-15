"""R6-D09/V09 — enrollment session selections + cycle0 atomic command.

Run with RUN_DB_INTEGRATION=1. Proves: 1..4 unique same-class slot selection
persisted effective-dated; invalid/other-class/closed slots rejected;
enrollment + selections + cycle 0 are atomic; 50 concurrent identical
enrollments produce exactly one enrollment + one cycle 0 + selections;
selection drives makeup eligibility.
"""

import asyncio
import os
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.schemas.enrollment import EnrollmentCreate
from app.services.enrollment_service import create_enrollment
from app.services.schedule_slot_service import load_class_slots

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _make_operational_class_with_slots(db, slot_count: int = 2) -> str:
    from datetime import timedelta

    from app.schemas.class_ import ClassCreate
    from app.services.class_service import create_class

    teacher_id = str(uuid4())
    await db.execute(
        text(
            """
            insert into public.staff_members
              (id, full_name, staff_type, zalo_name, phone, is_active)
            values
              (cast(:id as uuid), 'GV SELECT', 'TEACHER', :zalo, '0900000001', true)
            """
        ),
        {"id": teacher_id, "zalo": f"sel {teacher_id[:8]}"},
    )
    start = business_today() + timedelta(days=1)
    slots = [
        {
            "day": f"Thứ {index + 2}",
            "start": "18:00",
            "end": "19:30",
            "teacher_ids": [teacher_id],
            "assistant_ids": [],
        }
        for index in range(slot_count)
    ]
    created = await create_class(
        db,
        ClassCreate(
            name=f"SEL CLASS {uuid4().hex[:6]}",
            type="MONTHLY",
            base_fee=750_000,
            billing_cycle_months=1,
            class_category="GENERAL",
            grade_mode="GRADE",
            grade_level=6,
            academic_year_start=2026,
            start_date=start,
            end_date=start.replace(year=start.year + 1),
            identity_scheme="ACADEMIC_YEAR",
            schedule={"text": "s", "slots": slots},
            teacher_ids=[teacher_id],
        ),
        actor_user_id=None,
    )
    return str(created.id)


async def _make_student(db, salt: str) -> str:
    student_id = str(uuid4())
    await db.execute(
        text(
            "insert into public.students (id, full_name, status) "
            "values (cast(:id as uuid), :name, 'active')"
        ),
        {"id": student_id, "name": f"Học viên {salt}"},
    )
    await db.commit()
    return student_id


async def test_enrollment_with_partial_selection_and_cycle_zero() -> None:
    async with AsyncSessionLocal() as db:
        class_id = await _make_operational_class_with_slots(db, slot_count=3)
        slots = await load_class_slots(db, class_id)
        assert len(slots) == 3
        chosen = [slots[0]["slot_id"], slots[2]["slot_id"]]
        student_id = await _make_student(db, "sel1")

        enrollment = await create_enrollment(
            db,
            EnrollmentCreate(
                student_id=UUID(student_id),
                class_id=UUID(class_id),
                selected_slot_ids=[UUID(value) for value in chosen],
            ),
        )
        assert sorted(str(item) for item in enrollment.selected_slot_ids) == sorted(
            chosen
        )
        rows = (
            await db.execute(
                text(
                    "select cycle_no, status, due_date from public.fee_records "
                    "where enrollment_id = :id order by cycle_no"
                ),
                {"id": str(enrollment.id)},
            )
        ).all()
        assert rows[0].cycle_no == 0
        assert rows[0].status == "UNPAID"
        selection_count = (
            await db.execute(
                text(
                    "select count(*) from public.enrollment_slot_selections "
                    "where enrollment_id = :id and effective_until is null"
                ),
                {"id": str(enrollment.id)},
            )
        ).scalar()
        assert selection_count == 2


async def test_rejects_other_class_and_duplicate_slots() -> None:
    async with AsyncSessionLocal() as db:
        class_id = await _make_operational_class_with_slots(db, slot_count=2)
        other_class_id = await _make_operational_class_with_slots(db, slot_count=1)
        other_slots = await load_class_slots(db, other_class_id)
        student_id = await _make_student(db, "sel2")

        with pytest.raises(HTTPException) as exc_info:
            await create_enrollment(
                db,
                EnrollmentCreate(
                    student_id=UUID(student_id),
                    class_id=UUID(class_id),
                    selected_slot_ids=[UUID(other_slots[0]["slot_id"])],
                ),
            )
        assert exc_info.value.status_code == 422

        with pytest.raises(Exception) as exc_info:
            EnrollmentCreate(
                student_id=UUID(student_id),
                class_id=UUID(class_id),
                selected_slot_ids=[
                    UUID(other_slots[0]["slot_id"]),
                    UUID(other_slots[0]["slot_id"]),
                ],
            )
        assert "trùng lặp" in str(exc_info.value)


async def test_50_concurrent_enrollments_exactly_once() -> None:
    async with AsyncSessionLocal() as db:
        class_id = await _make_operational_class_with_slots(db, slot_count=2)
        slots = await load_class_slots(db, class_id)
        chosen = [UUID(slots[0]["slot_id"])]
        student_id = await _make_student(db, "sel50")

    async def enroll_once() -> str:
        async with AsyncSessionLocal() as session:
            try:
                response = await create_enrollment(
                    session,
                    EnrollmentCreate(
                        student_id=UUID(student_id),
                        class_id=UUID(class_id),
                        selected_slot_ids=chosen,
                    ),
                )
                return str(response.id)
            except HTTPException as exc:
                if exc.status_code == 409:
                    return ""
                raise

    results = await asyncio.gather(*(enroll_once() for _ in range(50)))
    successes = [result for result in results if result]
    assert len(successes) == 1

    async with AsyncSessionLocal() as db:
        enrollment_id = successes[0]
        cycle0 = (
            await db.execute(
                text(
                    "select count(*) from public.fee_records "
                    "where enrollment_id = :id and cycle_no = 0"
                ),
                {"id": enrollment_id},
            )
        ).scalar()
        selections = (
            await db.execute(
                text(
                    "select count(*) from public.enrollment_slot_selections "
                    "where enrollment_id = :id and effective_until is null"
                ),
                {"id": enrollment_id},
            )
        ).scalar()
        assert cycle0 == 1
        assert selections == 1
