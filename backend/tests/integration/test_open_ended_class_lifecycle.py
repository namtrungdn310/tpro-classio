"""Open-ended class lifecycle contract tests against a disposable database."""

import os
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.models.class_lifecycle_event import ClassLifecycleEvent
from app.schemas.class_ import (
    ClassCreate,
    ClassStartDatePreviewRequest,
    ClassStartDateUpdate,
    ClassStopPreviewRequest,
    ClassStopRequest,
)
from app.schemas.enrollment import EnrollmentCreate
from app.services.class_service import (
    create_class,
    preview_class_continuation,
    preview_class_start_date,
    preview_class_stop,
    stop_class,
    update_class_start_date,
)
from app.services.enrollment_service import create_enrollment

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _make_teacher(db, teacher_id: UUID) -> None:
    await db.execute(
        text(
            """
            insert into public.staff_members
              (id, full_name, staff_type, zalo_name, phone, is_active)
            values
              (cast(:id as uuid), :name, 'TEACHER', :zalo, :phone, true)
            """
        ),
        {
            "id": str(teacher_id),
            "name": f"GV OPEN {str(teacher_id)[:8]}",
            "zalo": f"open {str(teacher_id)[:8]}",
            "phone": f"09{teacher_id.int % 100_000_000:08d}",
        },
    )


async def _create_open_class(db, *, start_offset: int = 0):
    teacher_id = uuid4()
    await _make_teacher(db, teacher_id)
    await db.commit()
    start = business_today() + timedelta(days=start_offset)
    created = await create_class(
        db,
        ClassCreate(
            name=f"OPEN {uuid4().hex[:8]}",
            type="MONTHLY",
            base_fee=750_000,
            billing_cycle_months=1,
            start_date=start,
            identity_scheme="ACADEMIC_YEAR",
            class_category="GENERAL",
            grade_mode="GRADE",
            grade_level=6,
            academic_year_start=start.year,
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
        ),
    )
    return created


async def test_class_is_created_open_ended_with_a_past_start_date() -> None:
    async with AsyncSessionLocal() as db:
        created = await _create_open_class(db, start_offset=-90)
        assert created.start_date == business_today() - timedelta(days=90)
        assert created.end_date is None
        assert created.stopped_at is None


async def test_legacy_end_date_no_longer_blocks_a_new_enrollment() -> None:
    async with AsyncSessionLocal() as db:
        created = await _create_open_class(db, start_offset=-90)
        # Simulate a row created before the open-ended cutover. The retained
        # compatibility column must no longer be an enrollment boundary.
        await db.execute(
            text("update public.classes set end_date = :old_end where id = :id"),
            {
                "id": str(created.id),
                "old_end": business_today() - timedelta(days=30),
            },
        )
        student_id = uuid4()
        await db.execute(
            text(
                "insert into public.students (id, full_name, status) "
                "values (cast(:id as uuid), :name, 'active')"
            ),
            {"id": str(student_id), "name": "Học viên sau mốc cũ"},
        )
        await db.commit()

        enrollment = await create_enrollment(
            db,
            EnrollmentCreate(student_id=student_id, class_id=created.id),
        )
        assert enrollment.enrollment_date == business_today()
        assert enrollment.status == "active"


async def test_start_date_preview_fingerprint_and_audited_update() -> None:
    async with AsyncSessionLocal() as db:
        created = await _create_open_class(db, start_offset=-10)
        previous_start = created.start_date
        previous_version = created.version
        next_start = created.start_date - timedelta(days=20)
        preview = await preview_class_start_date(
            db,
            UUID(str(created.id)),
            ClassStartDatePreviewRequest(
                start_date=next_start,
                expected_version=created.version,
            ),
        )
        assert preview is not None
        assert preview.moves_earlier is True
        assert preview.creates_retroactive_fees is False

        with pytest.raises(ValueError, match="vừa được cập nhật"):
            await update_class_start_date(
                db,
                UUID(str(created.id)),
                ClassStartDateUpdate(
                    start_date=next_start,
                    reason="Điều chỉnh theo hồ sơ gốc",
                    expected_version=created.version,
                    expected_fingerprint="0" * 64,
                ),
                actor_user_id=None,
            )

        updated = await update_class_start_date(
            db,
            UUID(str(created.id)),
            ClassStartDateUpdate(
                start_date=next_start,
                reason="Điều chỉnh theo hồ sơ gốc",
                expected_version=created.version,
                expected_fingerprint=preview.preview_fingerprint,
            ),
            actor_user_id=None,
        )
        assert updated is not None
        assert updated.start_date == next_start
        assert updated.version == previous_version + 1
        event = await db.scalar(
            select(ClassLifecycleEvent).where(
                ClassLifecycleEvent.class_id == created.id,
                ClassLifecycleEvent.event_type == "start_date_changed",
            )
        )
        assert event is not None
        assert event.previous_start_date == previous_start
        assert event.next_start_date == next_start


async def test_stop_is_audited_and_idempotent() -> None:
    async with AsyncSessionLocal() as db:
        created = await _create_open_class(db, start_offset=-10)
        student_id = uuid4()
        await db.execute(
            text(
                "insert into public.students (id, full_name, status) "
                "values (cast(:id as uuid), :name, 'active')"
            ),
            {"id": str(student_id), "name": "Học viên chuyển tiếp"},
        )
        await db.commit()
        enrollment = await create_enrollment(
            db,
            EnrollmentCreate(student_id=student_id, class_id=created.id),
        )
        preview = await preview_class_stop(
            db,
            UUID(str(created.id)),
            ClassStopPreviewRequest(expected_version=created.version),
        )
        assert preview is not None
        request_id = uuid4()
        command = ClassStopRequest(
            reason="Ngừng theo quyết định vận hành",
            request_id=request_id,
            expected_version=created.version,
            expected_fingerprint=preview.preview_fingerprint,
        )
        stopped = await stop_class(
            db, UUID(str(created.id)), command, actor_user_id=None
        )
        assert stopped is not None
        assert stopped.is_active is False
        assert stopped.stopped_on == business_today()
        assert stopped.stopped_reason == command.reason

        enrollment_row = (
            await db.execute(
                text(
                    "select status, end_reason from public.enrollments where id = :id"
                ),
                {"id": str(enrollment.id)},
            )
        ).one()
        assert enrollment_row.status == "completed"
        assert enrollment_row.end_reason == "Lớp ngừng hoạt động"
        fee_rows = (
            await db.execute(
                text(
                    "select status, voided_at from public.fee_records "
                    "where enrollment_id = :id"
                ),
                {"id": str(enrollment.id)},
            )
        ).all()
        assert fee_rows
        assert all(row.status == "VOID" and row.voided_at for row in fee_rows)

        repeated = await stop_class(
            db, UUID(str(created.id)), command, actor_user_id=None
        )
        assert repeated is not None
        assert repeated.id == stopped.id
        event_count = len(
            (
                await db.scalars(
                    select(ClassLifecycleEvent).where(
                        ClassLifecycleEvent.class_id == created.id,
                        ClassLifecycleEvent.event_type == "stopped",
                        ClassLifecycleEvent.request_id == str(request_id),
                    )
                )
            ).all()
        )
        assert event_count == 1

        continuation = await preview_class_continuation(db, UUID(str(created.id)))
        assert continuation is not None
        assert [candidate.student_id for candidate in continuation.students] == [
            student_id
        ]

    # The database guard also protects non-API writers from reviving an active
    # membership in a terminal class.
    async with AsyncSessionLocal() as db:
        blocked_student_id = uuid4()
        await db.execute(
            text(
                "insert into public.students (id, full_name, status) "
                "values (cast(:id as uuid), :name, 'active')"
            ),
            {"id": str(blocked_student_id), "name": "Học viên bị chặn"},
        )
        await db.commit()
        with pytest.raises(DBAPIError, match="operational class"):
            await db.execute(
                text(
                    "insert into public.enrollments "
                    "(id, student_id, class_id, enrollment_date, status) values "
                    "(cast(:id as uuid), cast(:student as uuid), cast(:class_id as uuid), "
                    ":enrollment_date, 'active')"
                ),
                {
                    "id": str(uuid4()),
                    "student": str(blocked_student_id),
                    "class_id": str(created.id),
                    "enrollment_date": business_today(),
                },
            )
            await db.commit()
        await db.rollback()
