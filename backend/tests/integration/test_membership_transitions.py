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


async def _make_independent_membership(db):
    today = business_today()
    class_id = await _make_class(
        db, name=f"INDEPENDENT {uuid4().hex[:6]}", start=today - timedelta(days=90)
    )
    student = Student(full_name=f"Independent {uuid4().hex[:6]}", status="active")
    db.add(student)
    await db.commit()
    enrollment = await create_enrollment(
        db,
        EnrollmentCreate(
            student_id=UUID(student.id),
            class_id=UUID(class_id),
            enrollment_date=today + timedelta(days=10),
        ),
    )
    return enrollment, class_id, student.id


async def _financial_snapshot(db, enrollment_id):
    return await db.scalar(
        text("""
        select jsonb_build_object(
          'fees', (select jsonb_agg(to_jsonb(f) order by f.id) from fee_records f where f.enrollment_id = cast(:id as uuid)),
          'revisions', (select jsonb_agg(to_jsonb(r) order by r.id) from billing_anchor_revisions r where r.enrollment_id = cast(:id as uuid)),
          'requests', (select jsonb_agg(to_jsonb(p) order by p.id) from payment_requests p where p.enrollment_id = cast(:id as uuid))
        )
    """),
        {"id": str(enrollment_id)},
    )


async def test_independent_admission_edit_preserves_every_financial_row(monkeypatch):
    from app.core.config import settings
    from app.schemas.enrollment import EnrollmentUpdate
    from app.services.enrollment_service import update_enrollment

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment, _, _ = await _make_independent_membership(db)
        before = await _financial_snapshot(db, enrollment.id)
        result = await update_enrollment(
            db,
            enrollment.id,
            EnrollmentUpdate(
                contract_version=4,
                enrollment_date=business_today() - timedelta(days=30),
                expected_admission_version=0,
            ),
        )
        assert result.admission_version == 1
        assert await _financial_snapshot(db, enrollment.id) == before


async def test_independent_class_date_moves_only_confirmed_admission(monkeypatch):
    from app.core.config import settings
    from app.models.class_ import Class
    from app.schemas.class_ import ClassStartDatePreviewRequest, ClassStartDateUpdate
    from app.services.class_service import (
        preview_class_start_date,
        update_class_start_date,
    )

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment, class_id, _ = await _make_independent_membership(db)
        before = await _financial_snapshot(db, enrollment.id)
        class_ = await db.get(Class, class_id)
        args = dict(
            contract_version=2,
            start_date=business_today() + timedelta(days=12),
            expected_version=class_.version,
            admission_dates={enrollment.id: business_today() + timedelta(days=12)},
        )
        preview = await preview_class_start_date(
            db, UUID(class_id), ClassStartDatePreviewRequest(**args)
        )
        assert preview.can_apply
        for impact in preview.affected_enrollments:
            assert {
                "student_id",
                "student_name",
                "protected_fee_count",
                "mutable_fee_count",
                "decisions",
            } <= impact.keys()
        command = ClassStartDateUpdate(
            **args,
            request_id=uuid4(),
            reason="Dời ngày mở lớp",
            expected_fingerprint=preview.preview_fingerprint,
        )
        await update_class_start_date(db, UUID(class_id), command, actor_user_id=None)
        assert await _financial_snapshot(db, enrollment.id) == before
        await update_class_start_date(db, UUID(class_id), command, actor_user_id=None)
        assert await _financial_snapshot(db, enrollment.id) == before


async def test_explicit_billing_plan_applies_exactly_once_and_keeps_admission(
    monkeypatch,
):
    from app.core.config import settings
    from app.schemas.billing_schedule_change import (
        BillingSchedulePreviewRequest,
        BillingScheduleApplyRequest,
    )
    from app.services.billing_schedule_change_service import (
        preview_billing_schedule,
        apply_billing_schedule,
    )

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment, _, _ = await _make_independent_membership(db)
        args = dict(
            anchor_date=business_today() + timedelta(days=15),
            expected_version=0,
            strategy="KEEP_CURRENT",
            gap_policy="WAIVE",
            reason="Miễn năm ngày chuyển tiếp",
        )
        preview = await preview_billing_schedule(
            db, enrollment.id, BillingSchedulePreviewRequest(**args)
        )
        assert preview.can_apply
        assert len(preview.plan.supersede_ids) == 1
        assert len(preview.plan.waived_intervals) == 1
        command = BillingScheduleApplyRequest(
            **args,
            request_id=uuid4(),
            expected_preview_fingerprint=preview.preview_fingerprint,
        )
        await apply_billing_schedule(db, enrollment.id, command, actor_user_id=None)
        after = await _financial_snapshot(db, enrollment.id)
        assert len(after["fees"]) == 2
        assert len(after["revisions"]) == 2
        await apply_billing_schedule(db, enrollment.id, command, actor_user_id=None)
        assert await _financial_snapshot(db, enrollment.id) == after
        refreshed = await db.get(Enrollment, str(enrollment.id))
        await db.refresh(refreshed, ["class_"])
        assert refreshed.enrollment_date == enrollment.enrollment_date
        assert refreshed.admission_version == 0

        # The worker and final-cycle path must honour the confirmed generation
        # floor, including an explicitly waived bridge before that floor.
        from app.services.fee_cycle_service import (
            ensure_enrollment_cycles,
            ensure_final_cycle_for_stop,
        )

        skipped_final = await ensure_final_cycle_for_stop(
            db, refreshed, stopped_on=business_today() + timedelta(days=13)
        )
        assert skipped_final is None
        generated = await ensure_enrollment_cycles(
            db, refreshed, up_to=business_today() + timedelta(days=50)
        )
        assert generated
        assert all(
            record.coverage_start >= preview.plan.charges[0].coverage.end
            for record in generated
        )
        await db.rollback()


async def test_one_off_due_change_leaves_billing_anchor_and_coverage_unchanged(
    monkeypatch,
):
    from app.core.config import settings
    from app.schemas.billing_schedule_change import (
        FeeDueDatePreviewRequest,
        FeeDueDateApplyRequest,
    )
    from app.services.fee_due_date_service import (
        preview_fee_due_date,
        apply_fee_due_date,
    )

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment, _, _ = await _make_independent_membership(db)
        before = await _financial_snapshot(db, enrollment.id)
        fee_id = UUID(before["fees"][0]["id"])
        args = dict(
            due_date=business_today() + timedelta(days=20),
            reason="Gia hạn cho phụ huynh",
        )
        preview = await preview_fee_due_date(
            db, fee_id, FeeDueDatePreviewRequest(**args)
        )
        command = FeeDueDateApplyRequest(
            **args,
            request_id=uuid4(),
            expected_preview_fingerprint=preview["preview_fingerprint"],
        )
        await apply_fee_due_date(db, fee_id, command, actor_user_id=None)
        after = await _financial_snapshot(db, enrollment.id)
        assert after["revisions"] == before["revisions"]
        for field in (
            "coverage_start",
            "coverage_end",
            "base_due_date",
            "due_date",
            "base_amount",
        ):
            assert after["fees"][0][field] == before["fees"][0][field]
        assert after["fees"][0]["collection_due_offset_days"] == 10
        from app.routers.students import read_billing_schedule

        schedule = await read_billing_schedule(enrollment.id, db=db, principal=None)
        assert schedule["history"][0]["kind"] == "FEE_DUE_DATE_CHANGE"
        await apply_fee_due_date(db, fee_id, command, actor_user_id=None)
        assert await _financial_snapshot(db, enrollment.id) == after


async def test_final_cycle_never_resurrects_a_cancelled_obligation(monkeypatch):
    from datetime import datetime, timezone
    from app.core.config import settings
    from app.models.fee_record import FeeRecord
    from app.services.fee_cycle_service import ensure_final_cycle_for_stop

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment, _, _ = await _make_independent_membership(db)
        record = await db.scalar(
            select(FeeRecord).where(FeeRecord.enrollment_id == str(enrollment.id))
        )
        record.status = "VOID"
        record.voided_at = datetime.now(timezone.utc)
        await db.commit()
        baseline = await _financial_snapshot(db, enrollment.id)
        membership = await db.get(Enrollment, str(enrollment.id))
        await db.refresh(membership, ["class_"])
        result = await ensure_final_cycle_for_stop(
            db, membership, stopped_on=business_today() + timedelta(days=20)
        )
        assert result is None
        assert await _financial_snapshot(db, enrollment.id) == baseline


async def test_billing_preview_is_invalidated_when_fee_was_notified(monkeypatch):
    from datetime import datetime, timezone
    from app.core.config import settings
    from app.models.fee_record import FeeRecord
    from app.schemas.billing_schedule_change import (
        BillingSchedulePreviewRequest,
        BillingScheduleApplyRequest,
    )
    from app.services.billing_schedule_change_service import (
        preview_billing_schedule,
        apply_billing_schedule,
    )

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment, _, _ = await _make_independent_membership(db)
        args = dict(
            anchor_date=business_today() + timedelta(days=15),
            expected_version=0,
            strategy="KEEP_CURRENT",
            gap_policy="WAIVE",
            reason="Kiểm tra dữ liệu vừa thông báo",
        )
        preview = await preview_billing_schedule(
            db, enrollment.id, BillingSchedulePreviewRequest(**args)
        )
        record = await db.scalar(
            select(FeeRecord).where(FeeRecord.enrollment_id == str(enrollment.id))
        )
        record.notified_at = datetime.now(timezone.utc)
        record.notification_channel = "zalo_manual"
        record.notification_message = "Thông báo học phí kiểm thử"
        record.student_name_snapshot = "Independent test student"
        await db.commit()
        baseline = await _financial_snapshot(db, enrollment.id)
        with pytest.raises(HTTPException) as caught:
            await apply_billing_schedule(
                db,
                enrollment.id,
                BillingScheduleApplyRequest(
                    **args,
                    request_id=uuid4(),
                    expected_preview_fingerprint=preview.preview_fingerprint,
                ),
                actor_user_id=None,
            )
        assert caught.value.status_code == 409
        assert await _financial_snapshot(db, enrollment.id) == baseline


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


async def test_future_multi_transfer_uses_earliest_boundary_and_is_exactly_once() -> (
    None
):
    today = business_today()
    transfer_on = today + timedelta(days=10)
    later_start = today + timedelta(days=20)
    async with AsyncSessionLocal() as db:
        source_class = await _make_class(
            db, name=f"SOURCE {uuid4().hex[:6]}", start=today - timedelta(days=90)
        )
        early_target_class = await _make_class(
            db, name=f"TARGET EARLY {uuid4().hex[:6]}", start=today - timedelta(days=30)
        )
        later_target_class = await _make_class(
            db, name=f"TARGET LATER {uuid4().hex[:6]}", start=today - timedelta(days=30)
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
        targets = [
            # Deliberately send the later class first: source closure must not
            # depend on selection/payload order.
            StudentEnrollmentTarget(
                class_id=UUID(later_target_class),
                enrollment_date=later_start,
            ),
            StudentEnrollmentTarget(
                class_id=UUID(early_target_class),
                enrollment_date=transfer_on,
            ),
        ]
        preview_request = StudentMembershipPreviewRequest(
            expected_updated_at=student.updated_at,
            mode="transfer",
            source_enrollment_id=source.id,
            collect_source_final_cycle=False,
            targets=targets,
        )
        preview = await preview_student_membership(
            db, UUID(student_id), preview_request
        )
        assert preview is not None
        assert preview.source is not None
        assert preview.source.ends_on == transfer_on
        due_by_class = {
            str(target.class_id): target.first_due_date for target in preview.targets
        }
        assert due_by_class[early_target_class] == transfer_on
        assert due_by_class[later_target_class] == later_start

        request_id = uuid4()
        command = StudentMembershipCommand(
            request_id=request_id,
            contract_version=2,
            expected_preview_fingerprint=preview.preview_fingerprint,
            expected_updated_at=student.updated_at,
            profile=StudentUpdate(),
            mode="transfer",
            source_enrollment_id=source.id,
            collect_source_final_cycle=False,
            targets=targets,
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
        assert state_by_class[early_target_class] == "SCHEDULED"
        assert state_by_class[later_target_class] == "SCHEDULED"

        source_row = await db.get(Enrollment, str(source.id))
        target_rows = list(
            (
                await db.scalars(
                    select(Enrollment).where(
                        Enrollment.student_id == student_id,
                        Enrollment.class_id.in_(
                            (early_target_class, later_target_class)
                        ),
                    )
                )
            )
        )
        target_by_class = {row.class_id: row for row in target_rows}
        assert source_row is not None
        assert set(target_by_class) == {early_target_class, later_target_class}
        assert source_row.status == "dropped"
        assert source_row.ended_on == transfer_on
        assert (
            await db.scalar(
                text(
                    "select collect_source_final_cycle "
                    "from public.student_membership_commands "
                    "where request_id = :request_id"
                ),
                {"request_id": str(request_id)},
            )
            is False
        )
        assert target_by_class[early_target_class].status == "active"
        assert target_by_class[early_target_class].enrollment_date == transfer_on
        assert target_by_class[later_target_class].status == "active"
        assert target_by_class[later_target_class].enrollment_date == later_start
        for target_row in target_rows:
            assert (
                await db.scalar(
                    select(BillingAnchorRevision.state).where(
                        BillingAnchorRevision.enrollment_id == target_row.id
                    )
                )
                == "CONFIRMED"
            )

        replay = await apply_student_membership_command(
            db, UUID(student_id), command, actor_user_id=None
        )
        assert replay is not None
        assert (
            await db.scalar(
                text(
                    "select count(*) from public.student_membership_commands "
                    "where request_id = :request_id"
                ),
                {"request_id": str(request_id)},
            )
            == 1
        )
        assert (
            await db.scalar(
                text(
                    "select count(*) from public.student_membership_command_items item "
                    "join public.student_membership_commands command on command.id = item.command_id "
                    "where command.request_id = :request_id"
                ),
                {"request_id": str(request_id)},
            )
            == 2
        )

        changed = command.model_copy(
            update={
                "targets": [
                    targets[0].model_copy(update={"custom_fee": 700000}),
                    targets[1],
                ]
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
