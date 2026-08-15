"""R6-D04/V04 — student-code DB-authoritative integration tests (disposable DB).

Run with RUN_DB_INTEGRATION=1. Proves: DB issues codes on insert (trigger),
100 parallel creates produce 100 distinct valid codes, registry reservations
match one-to-one, codes are immutable and caller-supplied codes are rejected.
"""

import asyncio
import os
from datetime import date
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.student_code import validate_code
from app.schemas.student import StudentCreate, StudentUpdate
from app.services.student_service import create_student

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _make_staff_and_class(db) -> str:
    teacher_id = str(uuid4())
    phone = f"09{int(teacher_id[:8], 16) % 100000000:08d}"
    await db.execute(
        text(
            """
            insert into public.staff_members
              (id, full_name, staff_type, zalo_name, phone, is_active)
            values
              (cast(:id as uuid), 'GV CODE', 'TEACHER', :zalo, :phone, true)
            """
        ),
        {"id": teacher_id, "zalo": f"code {teacher_id[:8]}", "phone": phone},
    )
    class_id = str(uuid4())
    await db.execute(
        text(
            """
            insert into public.classes (
              id, name, type, base_fee, billing_cycle_months, teacher_id,
              identity_scheme, class_category, grade_mode, grade_level,
              education_level, academic_year_start, start_date, end_date,
              is_active, schedule
            ) values (
              cast(:id as uuid), :name, 'MONTHLY', 750000, 1,
              cast(:teacher as uuid), 'ACADEMIC_YEAR', 'GENERAL', 'GRADE', 6,
              'MIDDLE', 2026, :start, :end, true, :schedule
            )
            """
        ),
        {
            "id": class_id,
            "name": f"CODE CLASS {uuid4().hex[:6]}",
            "teacher": teacher_id,
            "start": date(2026, 8, 20),
            "end": date(2027, 5, 31),
            "schedule": (
                '{"text": "T2", "slots": [{"day": "Thứ 2", "start": "18:00", '
                '"end": "19:30", "teacher_ids": ["'
                + teacher_id
                + '"], "assistant_ids": []}]}'
            ),
        },
    )
    await db.execute(
        text(
            "insert into public.class_teachers (class_id, teacher_id) "
            "values (cast(:c as uuid), cast(:t as uuid))"
        ),
        {"c": class_id, "t": teacher_id},
    )
    await db.commit()
    return class_id


def _payload(class_id: str, index: int, salt: str) -> StudentCreate:
    return StudentCreate(
        full_name=f"Học viên mã {salt}{index:04d}",
        class_id=class_id,
        enrollment_date=date(2026, 8, 25),
        birth_date=date(2014, 1, 1),
        school="TH Nguyễn Du",
        parent_phone=f"09{salt}{index:04d}"[:10],
        parent_zalo=f"parent {salt}{index}",
        student_phone=None,
        student_zalo=None,
        notes=None,
        hidden_fields=[],
    )


async def test_create_returns_db_issued_code() -> None:
    async with AsyncSessionLocal() as db:
        class_id = await _make_staff_and_class(db)
        response = await create_student(db, _payload(class_id, 1, "111111"))
        assert response.student_code is not None
        code = validate_code(response.student_code)
        assert code == response.student_code
        # Registry có đúng reservation 1-1.
        row = (
            await db.execute(
                text(
                    "select code from public.student_code_registry "
                    "where issued_student_id = :sid"
                ),
                {"sid": str(response.id)},
            )
        ).one()
        assert row.code == code


async def test_client_supplied_student_code_rejected_422() -> None:
    class_id = str(uuid4())
    with pytest.raises(ValidationError) as exc_info:
        StudentCreate(
            full_name="Học viên gửi mã",
            class_id=class_id,
            enrollment_date=date(2026, 8, 25),
            birth_date=date(2014, 1, 1),
            school="TH Nguyễn Du",
            parent_phone="0912000001",
            parent_zalo="parent x",
            student_code="TP000000018",
        )
    assert "student_code" in str(exc_info.value)
    # StudentUpdate cũng forbid.
    with pytest.raises(ValidationError) as exc_info:
        StudentUpdate(full_name="Đổi tên", student_code="TP123456782")
    assert "student_code" in str(exc_info.value)


async def test_100_parallel_creates_yield_100_distinct_valid_codes() -> None:
    async with AsyncSessionLocal() as db:
        class_id = await _make_staff_and_class(db)
    salt = str(uuid4().int % 1000000)

    async def create_one(index: int) -> str:
        async with AsyncSessionLocal() as session:
            response = await create_student(session, _payload(class_id, index, salt))
            return response.student_code or ""

    codes = await asyncio.gather(*(create_one(i) for i in range(100)))
    valid_codes = {validate_code(code) for code in codes}
    assert len(valid_codes) == 100, "all 100 codes must be distinct and valid"
    assert all(code.startswith("TP") for code in valid_codes)

    async with AsyncSessionLocal() as db:
        count = (
            await db.execute(
                text(
                    "select count(*) from public.student_code_registry r "
                    "join public.students s on s.id = r.issued_student_id "
                    "where s.student_code = r.code "
                    "and s.full_name like :pattern"
                ),
                {"pattern": f"Học viên mã {salt}%"},
            )
        ).scalar()
        assert count == 100


async def test_code_immutable_and_registry_append_only() -> None:
    async with AsyncSessionLocal() as db:
        class_id = await _make_staff_and_class(db)
        response = await create_student(db, _payload(class_id, 2, "222222"))
        student_id = str(response.id)
        original_code = response.student_code

        with pytest.raises(Exception):
            await db.execute(
                text(
                    "update public.students set student_code = 'TP123456782' where id = :id"
                ),
                {"id": student_id},
            )
        await db.rollback()
        with pytest.raises(Exception):
            await db.execute(
                text("delete from public.student_code_registry"),
            )
        await db.rollback()

        row = (
            await db.execute(
                text("select student_code from public.students where id = :id"),
                {"id": student_id},
            )
        ).one()
        assert row.student_code == original_code
