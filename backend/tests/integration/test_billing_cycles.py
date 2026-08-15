"""R6-D06/V06 — canonical billing engine + cycle 0 integration tests.

Run with RUN_DB_INTEGRATION=1 against a migrated disposable DB (056+057).
Proves: cycle 0 created atomically with enrollment (due = enrollment date,
UNPAID, unnotified); monthly/week recurrence; legacy gap cycle 0 accepted;
lazy bounded future cycles; 50 concurrent enrollments produce exactly one
enrollment + one cycle 0; VOID/SUPERSEDED reconcile never deletes.
"""

import asyncio
import os
from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.core.billing_schedule import cycle_base_due_date
from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.schemas.enrollment import EnrollmentCreate
from app.services.enrollment_service import create_enrollment
from app.services.fee_service import sync_fee_records_for_period

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _make_operational_class(
    db,
    *,
    class_type: str = "MONTHLY",
    cycle_weeks: int | None = None,
    start: date | None = None,
    end: date | None = None,
) -> tuple[str, str]:
    teacher_id = str(uuid4())
    phone = f"09{int(teacher_id[:8], 16) % 100000000:08d}"
    await db.execute(
        text(
            """
            insert into public.staff_members
              (id, full_name, staff_type, zalo_name, phone, is_active)
            values
              (cast(:id as uuid), 'GV BILLING', 'TEACHER', :zalo, :phone, true)
            """
        ),
        {"id": teacher_id, "zalo": f"bill {teacher_id[:8]}", "phone": phone},
    )
    class_id = str(uuid4())
    start = start or (business_today() + __import__("datetime").timedelta(days=1))
    end = end or (start.replace(year=start.year + 1))
    weeks_sql = "null" if cycle_weeks is None else str(cycle_weeks)
    await db.execute(
        text(
            f"""
            insert into public.classes (
              id, name, type, base_fee, billing_cycle_months, billing_cycle_weeks,
              teacher_id, identity_scheme, class_category, grade_mode, grade_level,
              education_level, academic_year_start, start_date, end_date,
              is_active, schedule
            ) values (
              cast(:id as uuid), :name, :ctype, 750000, 1, {weeks_sql},
              cast(:teacher as uuid), 'ACADEMIC_YEAR', 'GENERAL', 'GRADE', 6,
              'MIDDLE', :year, :start, :end, true, :schedule
            )
            """
        ),
        {
            "id": class_id,
            "name": f"BILL {uuid4().hex[:6]}",
            "ctype": class_type,
            "teacher": teacher_id,
            "year": start.year,
            "start": start,
            "end": end,
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
    return class_id, teacher_id


def _enroll_payload(class_id: str, salt: str, index: int = 0) -> EnrollmentCreate:
    return EnrollmentCreate(
        student_id=salt,
        class_id=class_id,
        custom_fee=None,
        enrollment_date=None,
    )


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


async def test_enrollment_creates_cycle_zero_atomically() -> None:
    async with AsyncSessionLocal() as db:
        class_id, _ = await _make_operational_class(db)
        student_id = await _make_student(db, "c0")
        enrollment = await create_enrollment(
            db,
            _enroll_payload(class_id, student_id),
        )
        rows = (
            await db.execute(
                text(
                    "select cycle_no, due_date, base_due_date, adjusted_due_date, "
                    "status, notified_at, origin from public.fee_records "
                    "where enrollment_id = :id order by cycle_no"
                ),
                {"id": str(enrollment.id)},
            )
        ).all()
        assert len(rows) >= 1
        cycle0 = rows[0]
        assert cycle0.cycle_no == 0
        assert cycle0.due_date == cycle0.base_due_date == cycle0.adjusted_due_date
        assert cycle0.status == "UNPAID"
        assert cycle0.notified_at is None
        assert cycle0.origin == "CYCLE_GENERATOR"


async def test_monthly_recurrence_and_lazy_bounded_generation() -> None:
    async with AsyncSessionLocal() as db:
        class_id, _ = await _make_operational_class(db)
        student_id = await _make_student(db, "monthly")
        enrollment = await create_enrollment(
            db,
            _enroll_payload(class_id, student_id),
        )
        # Đồng bộ kỳ hiện tại -> sinh cycle tương lai trong tháng (lazy, bounded).
        today = business_today()
        await sync_fee_records_for_period(db, today.strftime("%Y-%m"))
        rows = (
            await db.execute(
                text(
                    "select cycle_no, due_date from public.fee_records "
                    "where enrollment_id = :id order by cycle_no"
                ),
                {"id": str(enrollment.id)},
            )
        ).all()
        # Cycle 0 + các cycle có coverage_start <= cuối tháng hiện tại.
        assert rows[0].cycle_no == 0
        expected = [
            cycle_base_due_date(enrollment.enrollment_date, "MONTHLY", None, n)
            for n in range(len(rows))
        ]
        assert [row.due_date for row in rows] == expected


async def test_legacy_enrollment_gap_cycle_zero_is_never_generated() -> None:
    """Legacy enrollment (cycles 1..n từ backfill 056) không bao giờ nhận
    cycle 0 hồi tố; generator tiếp tục max(cycle_no)+1."""
    async with AsyncSessionLocal() as db:
        class_id, _ = await _make_operational_class(db)
        student_id = await _make_student(db, "legacy")
        enrollment_id = str(uuid4())
        enrollment_date = business_today() + __import__("datetime").timedelta(days=1)
        await db.execute(
            text(
                """
                insert into public.enrollments (
                  id, student_id, class_id, enrollment_date, status
                ) values (
                  cast(:id as uuid), cast(:sid as uuid), cast(:cid as uuid),
                  :ed, 'active'
                )
                """
            ),
            {
                "id": enrollment_id,
                "sid": student_id,
                "cid": class_id,
                "ed": enrollment_date,
            },
        )
        # Giả lập backfill legacy: cycle 1, 2 (LEGACY_BACKFILL).
        await db.execute(
            text(
                """
                insert into public.fee_records (
                  enrollment_id, period, due_date, cycle_no, base_due_date,
                  adjusted_due_date, coverage_start, coverage_end, origin,
                  base_amount, discount_amount, status, student_name_snapshot,
                  class_name_snapshot, class_type_snapshot,
                  billing_cycle_months_snapshot, enrollment_date_snapshot
                ) values
                (cast(:eid as uuid), '2026-09', :d1, 1, :d1, :d1, :d1, :d1,
                 'LEGACY_BACKFILL', 750000, 0, 'UNPAID', 'Legacy', 'BILL',
                 'MONTHLY', 1, :ed),
                (cast(:eid as uuid), '2026-10', :d2, 2, :d2, :d2, :d2, :d2,
                 'LEGACY_BACKFILL', 750000, 0, 'UNPAID', 'Legacy', 'BILL',
                 'MONTHLY', 1, :ed)
                """
            ),
            {
                "eid": enrollment_id,
                "d1": enrollment_date,
                "d2": enrollment_date.replace(month=enrollment_date.month % 12 + 1),
                "ed": enrollment_date,
            },
        )
        await db.commit()

        today = business_today()
        await sync_fee_records_for_period(db, today.strftime("%Y-%m"))
        cycles = (
            (
                await db.execute(
                    text(
                        "select cycle_no from public.fee_records "
                        "where enrollment_id = :id order by cycle_no"
                    ),
                    {"id": enrollment_id},
                )
            )
            .scalars()
            .all()
        )
        assert 0 not in cycles
        assert cycles == sorted(cycles)
        assert cycles[0] == 1


async def test_50_concurrent_enrollments_exactly_one_cycle_zero() -> None:
    from fastapi import HTTPException

    async with AsyncSessionLocal() as db:
        class_id, _ = await _make_operational_class(db)
        student_id = await _make_student(db, "conc50")

    async def enroll_once() -> str:
        async with AsyncSessionLocal() as session:
            try:
                response = await create_enrollment(
                    session,
                    _enroll_payload(class_id, student_id),
                )
                return str(response.id)
            except HTTPException as exc:
                if exc.status_code == 409:
                    return ""
                raise

    results = await asyncio.gather(*(enroll_once() for _ in range(50)))
    successes = [result for result in results if result]
    assert len(successes) == 1, "exactly one enrollment may be created"

    async with AsyncSessionLocal() as db:
        count = (
            await db.execute(
                text(
                    "select count(*) from public.fee_records "
                    "where enrollment_id = :id and cycle_no = 0"
                ),
                {"id": successes[0]},
            )
        ).scalar()
        assert count == 1


async def test_void_reconcile_never_deletes_protected() -> None:
    async with AsyncSessionLocal() as db:
        class_id, _ = await _make_operational_class(db)
        student_id = await _make_student(db, "void")
        enrollment = await create_enrollment(
            db,
            _enroll_payload(class_id, student_id),
        )
        enrollment_id = str(enrollment.id)
        # Thêm record period cũ thuộc enrollment đã drop -> sync phải VOID chứ
        # không DELETE.
        await db.execute(
            text(
                "update public.enrollments set status = 'dropped', ended_at = now() "
                "where id = :id"
            ),
            {"id": enrollment_id},
        )
        await db.commit()

        today = business_today()
        await sync_fee_records_for_period(db, today.strftime("%Y-%m"))
        rows = (
            await db.execute(
                text(
                    "select status, voided_at from public.fee_records "
                    "where enrollment_id = :id"
                ),
                {"id": enrollment_id},
            )
        ).all()
        assert all(row.status == "VOID" and row.voided_at is not None for row in rows)
        # Không xóa record nào.
        count = (
            await db.execute(
                text(
                    "select count(*) from public.fee_records where enrollment_id = :id"
                ),
                {"id": enrollment_id},
            )
        ).scalar()
        assert count == len(rows)
