"""Real PostgreSQL safety proofs; no real accounts, providers or production DB."""

import asyncio
import os
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.models.enrollment import Enrollment
from app.models.billing_anchor_revision import BillingAnchorRevision
from app.models.enrollment_service_credit_event import EnrollmentServiceCreditEvent
from app.models.fee_record import FeeRecord
from app.models.makeup import ClassScheduleAdjustment, ClassSessionException
from app.schemas.enrollment import EnrollmentCreate
from app.schemas.suspension import SuspensionCreateRequest, SuspensionPreviewRequest
from app.services.enrollment_service import create_enrollment
from app.services.suspension_service import create_suspension, preview_suspension
from tests.integration.test_enrollment_selections import (
    _make_operational_class_with_slots,
    _make_student,
)

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="disposable PostgreSQL only",
    ),
]


async def setup_case(db, kind="MONTHLY"):
    cid = await _make_operational_class_with_slots(db, slot_count=1, class_type=kind)
    sid = await _make_student(db, uuid4().hex)
    e = await create_enrollment(
        db, EnrollmentCreate(class_id=UUID(cid), student_id=UUID(sid))
    )
    start = e.enrollment_date + timedelta(days=3)
    return (
        cid,
        str(e.id),
        SuspensionPreviewRequest(
            suspended_from=start, resume_on=start + timedelta(days=10)
        ),
    )


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_preview_is_read_only_and_apply_preserves_snapshots_and_receipt(
    monkeypatch, kind
):
    async with AsyncSessionLocal() as db:
        cid, eid, draft = await setup_case(db, kind)
        before = await db.scalar(
            select(func.count())
            .select_from(FeeRecord)
            .where(FeeRecord.enrollment_id == eid)
        )
        preview = await preview_suspension(db, UUID(cid), draft)
        assert not preview.blocked_reasons
        assert before == await db.scalar(
            select(func.count())
            .select_from(FeeRecord)
            .where(FeeRecord.enrollment_id == eid)
        )
        command = SuspensionCreateRequest(
            **draft.model_dump(),
            request_id=uuid4(),
            expected_fingerprint=preview.fingerprint,
        )
        result = await create_suspension(db, UUID(cid), command)
        assert result.member_summary == preview.member_summary
        exceptions = (
            (
                await db.scalars(
                    select(ClassSessionException)
                    .where(
                        ClassSessionException.adjustment_id
                        == str(result.adjustment_id),
                    )
                    .options(
                        selectinload(ClassSessionException.staff_snapshots),
                        selectinload(ClassSessionException.student_snapshots),
                    )
                )
            )
            .unique()
            .all()
        )
        assert len(exceptions) == preview.occurrence_count > 0
        assert all(
            x.source_slot_id and x.staff_snapshots and x.student_snapshots
            for x in exceptions
        )
        target = preview.member_summary[0]
        actual = await db.scalar(
            select(FeeRecord).where(
                FeeRecord.enrollment_id == eid,
                FeeRecord.coverage_start == target.target_coverage_start,
            )
        )
        assert actual.adjusted_due_date == target.new_due_date
        monkeypatch.setattr(
            "app.services.suspension_service.business_today",
            lambda: draft.resume_on + timedelta(days=30),
        )
        replay = await create_suspension(db, UUID(cid), command)
        assert replay == result
        assert (
            await db.scalar(
                select(func.count())
                .select_from(EnrollmentServiceCreditEvent)
                .where(EnrollmentServiceCreditEvent.enrollment_id == eid)
            )
            == 1
        )
        with pytest.raises(HTTPException) as conflict:
            await create_suspension(
                db,
                UUID(cid),
                command.model_copy(
                    update={"resume_on": draft.resume_on + timedelta(days=1)}
                ),
            )
        assert conflict.value.status_code == 409


async def test_changed_fee_invalidates_preview_without_writing_pause():
    async with AsyncSessionLocal() as db:
        cid, eid, draft = await setup_case(db)
        preview = await preview_suspension(db, UUID(cid), draft)
        command = SuspensionCreateRequest(
            **draft.model_dump(),
            request_id=uuid4(),
            expected_fingerprint=preview.fingerprint,
        )
        fee = await db.scalar(select(FeeRecord).where(FeeRecord.enrollment_id == eid))
        fee.discount_amount = 1000
        fee.discount_reason = "Kiểm thử thay đổi đồng thời"
        await db.commit()
        with pytest.raises(HTTPException) as conflict:
            await create_suspension(db, UUID(cid), command)
        assert conflict.value.status_code == 409
        assert (
            await db.scalar(
                select(func.count())
                .select_from(ClassScheduleAdjustment)
                .where(ClassScheduleAdjustment.class_id == cid)
            )
            == 0
        )


async def test_two_same_requests_return_one_committed_receipt():
    async with AsyncSessionLocal() as db:
        cid, eid, draft = await setup_case(db)
        preview = await preview_suspension(db, UUID(cid), draft)
        command = SuspensionCreateRequest(
            **draft.model_dump(),
            request_id=uuid4(),
            expected_fingerprint=preview.fingerprint,
        )

    async def apply():
        async with AsyncSessionLocal() as session:
            return await create_suspension(session, UUID(cid), command)

    first, second = await asyncio.gather(apply(), apply())
    assert first == second
    async with AsyncSessionLocal() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(EnrollmentServiceCreditEvent)
                .where(EnrollmentServiceCreditEvent.enrollment_id == eid)
            )
            == 1
        )


async def test_pending_anchor_preserves_days_without_pretending_to_move_a_fee():
    async with AsyncSessionLocal() as db:
        cid, eid, draft = await setup_case(db)
        enrollment = await db.scalar(
            select(Enrollment)
            .where(Enrollment.id == eid)
            .options(selectinload(Enrollment.current_billing_revision))
        )
        old = enrollment.current_billing_revision
        pending = BillingAnchorRevision(
            enrollment_id=eid,
            sequence_no=1,
            previous_anchor_date=old.anchor_date,
            anchor_date=old.anchor_date,
            effective_on=old.effective_on,
            generation_floor=old.generation_floor,
            first_anchor_cycle_no=old.first_anchor_cycle_no,
            next_due_date=old.next_due_date,
            state="PENDING",
            reason="Lịch thu cần kiểm tra",
            request_id=str(uuid4()),
            change_kind="ENROLLMENT_DATE_CHANGE",
            billing_type_snapshot=old.billing_type_snapshot,
            billing_cycle_months_snapshot=1,
        )
        db.add(pending)
        await db.flush()
        enrollment.current_billing_revision_id = pending.id
        enrollment.billing_anchor_version = 1
        await db.commit()
        preview = await preview_suspension(db, UUID(cid), draft)
        assert preview.target_cycle_count == 0
        assert preview.member_summary[0].pending_days == 10
        assert preview.member_summary[0].new_due_date is None
