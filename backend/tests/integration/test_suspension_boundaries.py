"""Cross-flow safety gates on disposable PostgreSQL, with real command replay."""

import os
from datetime import timedelta
from uuid import UUID, uuid4
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.billing_anchor_revision import BillingAnchorRevision
from app.models.fee_record import FeeRecord
from app.models.enrollment import Enrollment
from app.schemas.billing_schedule_change import (
    BillingScheduleOptionsRequest,
    BillingSchedulePreviewRequest,
    BillingScheduleApplyRequest,
)
from app.services.billing_schedule_change_service import (
    analyze_billing_schedule_options,
    preview_billing_schedule,
    apply_billing_schedule,
    load_billing_context,
)
from app.services.suspension_report_service import read_suspension_history
from app.services.admission_date_service import validate_admission_date_change
from app.services.enrollment_service import close_enrollment_financial_projection
from tests.integration.test_enrollment_suspensions import individual
from tests.integration.test_suspension_command_contract import setup_case

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1", reason="disposable DB only"
    ),
]


@pytest.fixture(autouse=True)
def dates_enabled(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_waiver_after_pause_reconciles_days_and_preview_matches_apply(kind):
    async with AsyncSessionLocal() as db:
        _, eid, dates = await setup_case(db, kind)
        first, _ = await individual(db, eid, dates.suspended_from, dates.resume_on)
        enrollment, _, _ = await load_billing_context(db, UUID(eid))
        # Move collection well beyond the whole first renewal and the pause.
        anchor = dates.resume_on + timedelta(days=100)
        options = await analyze_billing_schedule_options(
            db,
            UUID(eid),
            BillingScheduleOptionsRequest(anchor_date=anchor, expected_version=0),
        )
        candidates = [
            o for o in options.options if o.is_allowed and o.strategy != "UNCHANGED"
        ]
        chosen = None
        for option in candidates:
            draft = BillingSchedulePreviewRequest(
                anchor_date=anchor,
                expected_version=0,
                strategy=option.strategy,
                first_cycle=option.suggested_first_cycle
                if option.strategy == "FROM_CYCLE"
                else None,
                reason="Đổi mốc và đối chiếu bảo lưu",
                expected_context_token=options.context_token,
            )
            preview = await preview_billing_schedule(db, UUID(eid), draft)
            if preview.plan.suspension_adjustment:
                chosen = (draft, preview)
                break
        # If current coverage is kept, place a later pause into the actual gap
        # so the test exercises waiver reconciliation, not an unrelated no-op.
        if chosen is None:
            future_start = first.target_coverage_start + timedelta(days=45)
            await individual(db, eid, future_start, future_start + timedelta(days=10))
            options = await analyze_billing_schedule_options(
                db,
                UUID(eid),
                BillingScheduleOptionsRequest(anchor_date=anchor, expected_version=0),
            )
            for option in [
                o for o in options.options if o.is_allowed and o.strategy != "UNCHANGED"
            ]:
                draft = BillingSchedulePreviewRequest(
                    anchor_date=anchor,
                    expected_version=0,
                    strategy=option.strategy,
                    first_cycle=option.suggested_first_cycle
                    if option.strategy == "FROM_CYCLE"
                    else None,
                    reason="Đổi mốc và đối chiếu bảo lưu",
                    expected_context_token=options.context_token,
                )
                preview = await preview_billing_schedule(db, UUID(eid), draft)
                if preview.plan.suspension_adjustment:
                    chosen = (draft, preview)
                    break
        assert chosen is not None, "fixture must cross an explicit waived interval"
        draft, preview = chosen
        assert preview.plan.suspension_adjustment["delta_days"] < 0
        command = BillingScheduleApplyRequest(
            **draft.model_dump(),
            request_id=uuid4(),
            expected_preview_fingerprint=preview.preview_fingerprint,
        )
        result = await apply_billing_schedule(
            db, UUID(eid), command, actor_user_id=None
        )
        assert result == preview
        assert (
            await apply_billing_schedule(db, UUID(eid), command, actor_user_id=None)
            == result
        )
        records = (
            await db.scalars(
                select(FeeRecord).where(
                    FeeRecord.enrollment_id == eid, FeeRecord.status == "UNPAID"
                )
            )
        ).all()
        for charge in preview.plan.charges:
            record = next(
                r
                for r in records
                if r.coverage_start == charge.coverage.start
                and r.coverage_end == charge.coverage.end
            )
            assert record.adjusted_due_date == charge.due_date
        report = await read_suspension_history(db, UUID(eid))
        assert report["reconciliation_days"] == 0
        assert (
            report["ledger_days"]
            == preview.plan.suspension_adjustment["preserved_days"]
        )


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_pending_pause_can_be_cancelled_without_materializing_fees(kind):
    async with AsyncSessionLocal() as db:
        _, eid, dates = await setup_case(db, kind)
        member = await db.get(Enrollment, eid)
        revision = await db.get(
            BillingAnchorRevision, member.current_billing_revision_id
        )
        pending = BillingAnchorRevision(
            enrollment_id=eid,
            sequence_no=1,
            previous_anchor_date=revision.anchor_date,
            anchor_date=revision.anchor_date,
            effective_on=revision.effective_on,
            generation_floor=revision.generation_floor,
            first_anchor_cycle_no=revision.first_anchor_cycle_no,
            next_due_date=revision.next_due_date,
            state="PENDING",
            reason="Chờ xác nhận lịch thu",
            request_id=str(uuid4()),
            change_kind="ENROLLMENT_DATE_CHANGE",
            billing_type_snapshot=kind,
            billing_cycle_months_snapshot=1,
            billing_cycle_weeks_snapshot=revision.billing_cycle_weeks_snapshot,
        )
        db.add(pending)
        await db.flush()
        member.current_billing_revision_id, member.billing_anchor_version = (
            pending.id,
            1,
        )
        await db.commit()
        pause, _ = await individual(db, eid, dates.suspended_from, dates.resume_on)
        assert pause.pending_days == 10
        cancelled, _ = await individual(
            db,
            eid,
            dates.suspended_from,
            dates.resume_on,
            sid=pause.suspension_id,
            action="CANCEL",
        )
        assert cancelled.pending_days == -10
        report = await read_suspension_history(db, UUID(eid))
        assert (
            report["pending_days"]
            == report["ledger_days"]
            == report["preserved_days"]
            == 0
        )


async def test_academic_boundary_is_guarded_and_close_keeps_compensation_in_old_membership():
    async with AsyncSessionLocal() as db:
        _, eid, dates = await setup_case(db)
        await individual(db, eid, dates.suspended_from, dates.resume_on)
        enrollment, _, _ = await load_billing_context(db, UUID(eid), lock=True)
        with pytest.raises(HTTPException) as err:
            await validate_admission_date_change(
                db,
                enrollment,
                next_date=dates.suspended_from + timedelta(days=2),
                expected_version=0,
            )
        assert err.value.detail["code"] == "ADMISSION_SUSPENSION_REVIEW_REQUIRED"
        close_on = dates.suspended_from + timedelta(days=3)
        await close_enrollment_financial_projection(
            db,
            enrollment,
            close_on=close_on,
            actor_user_id=None,
            reason="Chuyển lớp kiểm thử",
        )
        enrollment.ended_on, enrollment.status = close_on, "dropped"
        await db.commit()
        report = await read_suspension_history(db, UUID(eid))
        assert report["ledger_days"] == report["preserved_days"] == 3
        assert report["pending_days"] == -7
        assert report["membership_closed"]
        assert report["reconciliation_days"] == 0
        assert report["total"] == 2
        await close_enrollment_financial_projection(
            db, enrollment, close_on=close_on, actor_user_id=None, reason="Gọi lại"
        )
        await db.commit()
        assert (await read_suspension_history(db, UUID(eid)))["total"] == 2


async def test_class_source_member_correction_never_leaks_into_another_members_report():
    from app.schemas.enrollment import EnrollmentCreate
    from app.schemas.suspension import SuspensionCreateRequest
    from app.services.enrollment_service import create_enrollment
    from app.services.suspension_service import create_suspension, preview_suspension
    from tests.integration.test_enrollment_selections import _make_student

    async with AsyncSessionLocal() as db:
        cid, eid, dates = await setup_case(db)
        sid = await _make_student(db, uuid4().hex)
        other = await create_enrollment(
            db, EnrollmentCreate(class_id=UUID(cid), student_id=UUID(sid))
        )
        other_id = str(other.id)
        preview = await preview_suspension(db, UUID(cid), dates)
        await create_suspension(
            db,
            UUID(cid),
            SuspensionCreateRequest(
                **dates.model_dump(),
                request_id=uuid4(),
                expected_fingerprint=preview.fingerprint,
            ),
        )
        enrollment, _, _ = await load_billing_context(db, UUID(eid), lock=True)
        close_on = dates.suspended_from + timedelta(days=3)
        await close_enrollment_financial_projection(
            db,
            enrollment,
            close_on=close_on,
            actor_user_id=None,
            reason="Chỉ học viên A rời lớp",
        )
        enrollment.status, enrollment.ended_on = "dropped", close_on
        await db.commit()
        own_report = await read_suspension_history(db, UUID(eid), year=0)
        other_report = await read_suspension_history(db, UUID(other_id), year=0)
        assert own_report["total"] == 2
        assert any(item["delta_days"] == -7 for item in own_report["items"])
        assert other_report["total"] == len(other_report["items"]) == 1
        assert other_report["items"][0]["delta_days"] == 10
        assert other_report["ledger_days"] == other_report["preserved_days"] == 10
        assert other_report["reconciliation_days"] == 0


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_very_distant_pause_is_pending_without_generating_years_of_fees(kind):
    async with AsyncSessionLocal() as db:
        _, eid, dates = await setup_case(db, kind)
        before = (
            await db.scalars(select(FeeRecord.id).where(FeeRecord.enrollment_id == eid))
        ).all()
        start = dates.suspended_from + timedelta(days=365 * 20)
        result, _ = await individual(db, eid, start, start + timedelta(days=10))
        assert result.pending_days == 10 and result.target_coverage_start is None
        assert (
            await db.scalars(select(FeeRecord.id).where(FeeRecord.enrollment_id == eid))
        ).all() == before
        cancelled, _ = await individual(
            db,
            eid,
            start,
            start + timedelta(days=10),
            sid=result.suspension_id,
            action="CANCEL",
        )
        assert cancelled.pending_days == -10
        assert (await read_suspension_history(db, UUID(eid)))["pending_days"] == 0


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
@pytest.mark.parametrize("sent", [False, True])
async def test_pause_correction_revokes_unsent_qr_but_preserves_sent_request(
    kind, sent
):
    from datetime import datetime, timezone
    from app.models.payment_request import PaymentRequest
    from app.services.payment_scaffold_service import generate_payment_reference

    async with AsyncSessionLocal() as db:
        _, eid, dates = await setup_case(db, kind)
        first, _ = await individual(db, eid, dates.suspended_from, dates.resume_on)
        member, records, _ = await load_billing_context(db, UUID(eid))
        target = next(
            r for r in records if r.coverage_start == first.target_coverage_start
        )
        fid, old_due = target.id, target.adjusted_due_date
        request = PaymentRequest(
            fee_record_id=fid,
            enrollment_id=eid,
            student_code_snapshot=member.student.student_code,
            payment_reference=generate_payment_reference(member.student.student_code),
            expected_amount=target.final_amount,
            sent_at=datetime.now(timezone.utc) if sent else None,
        )
        db.add(request)
        await db.commit()
        request_id = request.id
        result, _ = await individual(
            db,
            eid,
            dates.suspended_from,
            dates.resume_on + timedelta(days=3),
            sid=first.suspension_id,
        )
        await db.refresh(target)
        await db.refresh(request)
        if sent:
            assert (
                target.notified_at is None
            )  # protection comes from QR, not this shortcut
            assert target.adjusted_due_date == old_due
            assert request.status == "OPEN" and request.revoked_at is None
            assert result.protected_count >= 1
            assert result.target_coverage_start > first.target_coverage_start
        else:
            assert target.adjusted_due_date == old_due + timedelta(days=3)
            assert request.status == "REVOKED" and request.revoked_at is not None
        assert request.id == request_id
