import os
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.models.billing_anchor_revision import BillingAnchorRevision
from app.models.enrollment import Enrollment
from app.models.student import Student
from app.schemas.enrollment import EnrollmentCreate
from app.schemas.student import (
    StudentEnrollmentTarget,
    StudentMembershipCommand,
    StudentMembershipPreviewRequest,
    StudentUpdate,
)
from app.services.enrollment_service import create_enrollment
from app.services.membership_preview_service import preview_student_membership
from app.services.student_service import apply_student_membership_command

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _make_class(db, *, name: str, start) -> str:
    teacher_id = str(uuid4())
    phone = f"09{int(teacher_id[:8], 16) % 100000000:08d}"
    await db.execute(
        text(
            "insert into public.staff_members "
            "(id, full_name, staff_type, zalo_name, phone, is_active) "
            "values (cast(:id as uuid), :name, 'TEACHER', :zalo, :phone, true)"
        ),
        {
            "id": teacher_id,
            "name": f"GV {name}",
            "zalo": f"gv-{teacher_id[:8]}",
            "phone": phone,
        },
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
              cast(:id as uuid), :name, 'MONTHLY', 750000, 1, cast(:teacher as uuid),
              'ACADEMIC_YEAR', 'GENERAL', 'GRADE', 6,
              'MIDDLE', :year, :start, :end, true,
              '{"text":"Chưa xếp lịch","slots":[]}'::jsonb
            )
            """
        ),
        {
            "id": class_id,
            "name": name,
            "teacher": teacher_id,
            "year": start.year,
            "start": start,
            "end": start.replace(year=start.year + 1),
        },
    )
    await db.execute(
        text(
            "insert into public.class_teachers (class_id, teacher_id) "
            "values (cast(:class_id as uuid), cast(:teacher_id as uuid))"
        ),
        {"class_id": class_id, "teacher_id": teacher_id},
    )
    await db.commit()
    return class_id


async def test_future_transfer_uses_effective_boundary_and_is_exactly_once() -> None:
    today = business_today()
    transfer_on = today + timedelta(days=10)
    async with AsyncSessionLocal() as db:
        source_class = await _make_class(
            db, name=f"SOURCE {uuid4().hex[:6]}", start=today - timedelta(days=90)
        )
        target_class = await _make_class(
            db, name=f"TARGET {uuid4().hex[:6]}", start=today - timedelta(days=30)
        )
        student_id = str(uuid4())
        await db.execute(
            text(
                "insert into public.students (id, full_name, status) "
                "values (cast(:id as uuid), 'Học viên chuyển tương lai', 'active')"
            ),
            {"id": student_id},
        )
        await db.commit()
        source = await create_enrollment(
            db,
            EnrollmentCreate(
                student_id=UUID(student_id),
                class_id=UUID(source_class),
                enrollment_date=today - timedelta(days=60),
            ),
        )
        student = await db.get(Student, student_id)
        assert student is not None
        target = StudentEnrollmentTarget(
            class_id=UUID(target_class),
            enrollment_date=transfer_on,
        )
        preview_request = StudentMembershipPreviewRequest(
            expected_updated_at=student.updated_at,
            mode="transfer",
            source_enrollment_id=source.id,
            targets=[target],
        )
        preview = await preview_student_membership(
            db, UUID(student_id), preview_request
        )
        assert preview is not None
        assert preview.source is not None
        assert preview.source.ends_on == transfer_on
        assert preview.targets[0].first_due_date == transfer_on

        request_id = uuid4()
        command = StudentMembershipCommand(
            request_id=request_id,
            contract_version=2,
            expected_preview_fingerprint=preview.preview_fingerprint,
            expected_updated_at=student.updated_at,
            profile=StudentUpdate(),
            mode="transfer",
            source_enrollment_id=source.id,
            targets=[target],
        )
        result = await apply_student_membership_command(
            db, UUID(student_id), command, actor_user_id=None
        )
        assert result is not None
        state_by_class = {
            str(item.class_id): item.effective_state
            for item in result.active_enrollments
        }
        assert state_by_class[source_class] == "CURRENT"
        assert state_by_class[target_class] == "SCHEDULED"

        source_row = await db.get(Enrollment, str(source.id))
        target_row = await db.scalar(
            select(Enrollment).where(
                Enrollment.student_id == student_id,
                Enrollment.class_id == target_class,
            )
        )
        assert source_row is not None and target_row is not None
        assert source_row.status == "dropped"
        assert source_row.ended_on == transfer_on
        assert target_row.status == "active"
        assert target_row.enrollment_date == transfer_on
        assert await db.scalar(
            select(BillingAnchorRevision.state).where(
                BillingAnchorRevision.enrollment_id == target_row.id
            )
        ) == "CONFIRMED"

        replay = await apply_student_membership_command(
            db, UUID(student_id), command, actor_user_id=None
        )
        assert replay is not None
        assert await db.scalar(
            text(
                "select count(*) from public.student_membership_commands "
                "where request_id = :request_id"
            ),
            {"request_id": str(request_id)},
        ) == 1
        assert await db.scalar(
            text(
                "select count(*) from public.student_membership_command_items item "
                "join public.student_membership_commands command on command.id = item.command_id "
                "where command.request_id = :request_id"
            ),
            {"request_id": str(request_id)},
        ) == 1

        changed = command.model_copy(
            update={
                "targets": [target.model_copy(update={"custom_fee": 700000})]
            }
        )
        with pytest.raises(HTTPException) as mismatch:
            await apply_student_membership_command(
                db, UUID(student_id), changed, actor_user_id=None
            )
        assert mismatch.value.detail["code"] == "IDEMPOTENCY_PAYLOAD_MISMATCH"


async def test_backdated_initial_membership_creates_one_reviewable_charge() -> None:
    today = business_today()
    async with AsyncSessionLocal() as db:
        class_id = await _make_class(
            db, name=f"BACKDATE {uuid4().hex[:6]}", start=today - timedelta(days=500)
        )
        student_id = str(uuid4())
        await db.execute(
            text(
                "insert into public.students (id, full_name, status) "
                "values (cast(:id as uuid), 'Học viên ghi danh quá khứ', 'active')"
            ),
            {"id": student_id},
        )
        await db.commit()
        enrollment = await create_enrollment(
            db,
            EnrollmentCreate(
                student_id=UUID(student_id),
                class_id=UUID(class_id),
                enrollment_date=today - timedelta(days=400),
            ),
        )
        rows = (
            await db.execute(
                text(
                    "select cycle_no, anchor_cycle_no, review_required, due_date "
                    "from public.fee_records where enrollment_id = :id"
                ),
                {"id": str(enrollment.id)},
            )
        ).all()
        assert len(rows) == 1
        assert rows[0].cycle_no == 0
        assert rows[0].anchor_cycle_no > 0
        assert rows[0].review_required is True
        assert rows[0].due_date >= today
