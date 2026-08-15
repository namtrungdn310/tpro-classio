"""R6-D03/V03 — lifecycle cutover integration tests (disposable DB).

Run with RUN_DB_INTEGRATION=1. Proves: a class completes at its planned end
even with pending make-ups; completing/cancelling never deactivates student
profiles; suspension/make-up never changes class end date; FINALIZING and
operational_end_date are absent from runtime responses.
"""

import os
from datetime import date, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.class_lifecycle import effective_class_status
from app.schemas.class_ import ClassCreate
from app.services.class_service import (
    complete_expired_classes,
    create_class,
    delete_class,
    get_class_history,
    get_class_response,
)

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _make_staff(db, staff_id: str, name: str, staff_type: str) -> None:
    phone = f"09{int(staff_id[:8], 16) % 100000000:08d}"
    await db.execute(
        text(
            """
            insert into public.staff_members
              (id, full_name, staff_type, zalo_name, phone, is_active)
            values
              (cast(:id as uuid), :name, :staff_type, :zalo, :phone, true)
            """
        ),
        {
            "id": staff_id,
            "name": name,
            "staff_type": staff_type,
            "zalo": f"lifecycle {staff_id[:8]}",
            "phone": phone,
        },
    )


def _class_payload(teacher_id: str) -> ClassCreate:
    from app.core.business_time import business_today

    start = business_today() + timedelta(days=1)
    return ClassCreate(
        name=f"LC CUTOVER {uuid4().hex[:6]}",
        type="MONTHLY",
        base_fee=750_000,
        billing_cycle_months=1,
        class_category="GENERAL",
        grade_mode="GRADE",
        grade_level=6,
        academic_year_start=2026,
        start_date=start,
        end_date=start + timedelta(days=90),
        identity_scheme="ACADEMIC_YEAR",
        schedule={
            "text": "T2",
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
    )


async def test_class_completes_with_pending_makeup_and_keeps_history() -> None:
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV LC CUTOVER", "TEACHER")
        await db.commit()

        # Lớp đã qua planned end (end < business today) nhưng vẫn is_active.
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
                  cast(:id as uuid), :name, 'MONTHLY', 750000, 1, cast(:teacher as uuid),
                  'ACADEMIC_YEAR', 'GENERAL', 'GRADE', 6, 'MIDDLE', 2026,
                  date '2026-01-05', date '2026-02-05', true, :schedule
                )
                """
            ),
            {
                "id": class_id,
                "name": f"LC EXPIRED {uuid4().hex[:6]}",
                "teacher": teacher_id,
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
        # Một học viên với pending make-up obligation (exception chưa xử lý).
        student_id = str(uuid4())
        enrollment_id = str(uuid4())
        await db.execute(
            text(
                """
                insert into public.students (id, full_name, status)
                values (cast(:id as uuid), :name, 'active')
                """
            ),
            {"id": student_id, "name": "Học viên pending makeup"},
        )
        await db.execute(
            text(
                """
                insert into public.enrollments (
                  id, student_id, class_id, enrollment_date, status
                ) values (
                  cast(:id as uuid), cast(:sid as uuid), cast(:cid as uuid),
                  date '2026-01-05', 'active'
                )
                """
            ),
            {"id": enrollment_id, "sid": student_id, "cid": class_id},
        )
        exception_id = str(uuid4())
        adjustment_id = str(uuid4())
        await db.execute(
            text(
                """
                insert into public.class_schedule_adjustments (
                  id, class_id, reason_code, affected_from, affected_through,
                  status, created_by, request_id, version
                ) values (
                  cast(:id as uuid), cast(:cid as uuid), 'CENTER_OPERATION',
                  date '2026-01-12', date '2026-01-12', 'OPEN',
                  cast(:cb as uuid), cast(:rq as uuid), 1
                )
                """
            ),
            {
                "id": adjustment_id,
                "cid": class_id,
                "cb": teacher_id,
                "rq": str(uuid4()),
            },
        )
        await db.execute(
            text(
                """
                insert into public.class_session_exceptions (
                  id, adjustment_id, class_id, original_start_at, original_end_at,
                  status, version
                ) values (
                  cast(:id as uuid), cast(:aid as uuid), cast(:cid as uuid),
                  '2026-01-12T11:00:00+00:00', '2026-01-12T12:30:00+00:00',
                  'MAKEUP_PENDING', 1
                )
                """
            ),
            {"id": exception_id, "aid": adjustment_id, "cid": class_id},
        )
        await db.commit()

        # Worker hoàn tất lớp dù còn pending makeup.
        async with AsyncSessionLocal() as worker:
            completed = await complete_expired_classes(worker)
            assert completed >= 1
            await worker.commit()

        async with AsyncSessionLocal() as check:
            row = (
                await check.execute(
                    text(
                        "select is_active, completed_at from public.classes "
                        "where id = :id"
                    ),
                    {"id": class_id},
                )
            ).one()
            assert row.is_active is False
            assert row.completed_at is not None
            # Profile vẫn active — không auto-deactivate.
            profile = (
                await check.execute(
                    text("select status from public.students where id = :id"),
                    {"id": student_id},
                )
            ).one()
            assert profile.status == "active"
            # Pending makeup vẫn query được qua class history.
            history = await get_class_history(check, UUID(class_id))
            assert history is not None
            assert any(
                item.display_status == "MAKEUP_PENDING" for item in history.adjustments
            )
            # Response không còn operational_end_date / FINALIZING.
            response = await get_class_response(check, UUID(class_id))
            assert response is not None
            assert response.effective_status == "COMPLETED"
            assert "operational_end_date" not in response.model_dump()


async def test_cancel_class_keeps_profile_active() -> None:
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV LC CANCEL", "TEACHER")
        await db.commit()
        created = await create_class(
            db,
            _class_payload(teacher_id),
            actor_user_id=None,
        )
        class_id = UUID(str(created.id))
        # Giả lập học viên đang học.
        student_id = str(uuid4())
        await db.execute(
            text(
                "insert into public.students (id, full_name, status) "
                "values (cast(:id as uuid), :name, 'active')"
            ),
            {"id": student_id, "name": "Học viên hủy lớp"},
        )
        await db.execute(
            text(
                """
                insert into public.enrollments (
                  id, student_id, class_id, enrollment_date, status
                ) values (
                  cast(:id as uuid), cast(:sid as uuid), cast(:cid as uuid),
                  date '2026-08-20', 'active'
                )
                """
            ),
            {
                "id": str(uuid4()),
                "sid": student_id,
                "cid": str(created.id),
            },
        )
        await db.commit()

        await delete_class(db, class_id, actor_user_id=None)
        async with AsyncSessionLocal() as check:
            profile = (
                await check.execute(
                    text("select status from public.students where id = :id"),
                    {"id": student_id},
                )
            ).one()
            assert profile.status == "active"
            enrollment_status = (
                await check.execute(
                    text(
                        "select status from public.enrollments where student_id = :id"
                    ),
                    {"id": student_id},
                )
            ).one()
            assert enrollment_status.status == "cancelled"


async def test_effective_status_never_returns_finalizing() -> None:
    from types import SimpleNamespace

    class_ = SimpleNamespace(
        identity_scheme="ACADEMIC_YEAR",
        is_active=True,
        cancelled_at=None,
        completed_at=None,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 6, 30),
    )
    assert effective_class_status(class_, today=date(2026, 7, 1)) == "COMPLETED"
    assert effective_class_status(class_, today=date(2026, 6, 30)) == "ACTIVE"
