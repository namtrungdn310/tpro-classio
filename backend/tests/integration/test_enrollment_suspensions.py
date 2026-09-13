"""Disposable-only proofs of individual/class union and immutable corrections."""

import asyncio
import os
from datetime import timedelta
from uuid import UUID, uuid4
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from app.core.database import AsyncSessionLocal
from app.models.enrollment_service_credit_event import (
    EnrollmentServiceCreditEvent as Event,
)
from app.models.enrollment_suspension import EnrollmentSuspension, SuspensionCommand
from app.models.fee_record import FeeRecord
from app.models.makeup import ClassSessionException
from app.schemas.enrollment_suspension import (
    EnrollmentSuspensionDraft,
    EnrollmentSuspensionApply,
)
from app.schemas.suspension import SuspensionCreateRequest
from app.services.enrollment_suspension_service import (
    prepare_individual_suspension,
    apply_individual_suspension,
)
from app.services.suspension_service import create_suspension, preview_suspension
from app.services.credit_service import enrollment_total_deferral_days
from tests.integration.test_suspension_command_contract import setup_case

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1", reason="disposable PostgreSQL only"
    ),
]


@pytest.fixture(autouse=True)
def independent_dates_enabled(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)


async def individual(db, eid, start, end, *, sid=None, action="SAVE"):
    draft = EnrollmentSuspensionDraft(
        suspension_id=sid,
        action=action,
        suspended_from=start,
        resume_on=end,
        reason="Gia đình xin bảo lưu",
    )
    preview, *_ = await prepare_individual_suspension(db, UUID(eid), draft)
    command = EnrollmentSuspensionApply(
        **draft.model_dump(),
        request_id=uuid4(),
        expected_fingerprint=preview.fingerprint,
    )
    result = await apply_individual_suspension(db, UUID(eid), command)
    assert result.model_dump(exclude={"suspension_id"}) == preview.model_dump(
        exclude={"suspension_id"}
    )
    return result, command


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_preview_without_reason_then_save_note_preserves_fingerprint_and_receipt(
    kind,
):
    async with AsyncSessionLocal() as db:
        _, eid, dates = await setup_case(db, kind)
        draft = EnrollmentSuspensionDraft(
            suspended_from=dates.suspended_from,
            resume_on=dates.resume_on,
        )
        preview, *_ = await prepare_individual_suspension(db, UUID(eid), draft)
        noted = draft.model_copy(update={"reason": "Gia đình xin tạm nghỉ"})
        noted_preview, *_ = await prepare_individual_suspension(db, UUID(eid), noted)
        assert noted_preview.fingerprint == preview.fingerprint
        command = EnrollmentSuspensionApply(
            **noted.model_dump(),
            request_id=uuid4(),
            expected_fingerprint=preview.fingerprint,
        )
        with pytest.raises(HTTPException) as blank:
            await apply_individual_suspension(
                db, UUID(eid), command.model_copy(update={"reason": "   "})
            )
        assert blank.value.status_code == 422
        result = await apply_individual_suspension(db, UUID(eid), command)
        row = await db.get(EnrollmentSuspension, str(result.suspension_id))
        assert row.reason == noted.reason
        replay = await apply_individual_suspension(db, UUID(eid), command)
        assert replay == result
        with pytest.raises(HTTPException) as changed_note:
            await apply_individual_suspension(
                db, UUID(eid), command.model_copy(update={"reason": "Lý do khác"})
            )
        assert changed_note.value.status_code == 409


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_create_extend_shorten_cancel_replay_and_no_class_attendance_changes(
    kind,
):
    async with AsyncSessionLocal() as db:
        cid, eid, draft = await setup_case(db, kind)
        first, cmd = await individual(db, eid, draft.suspended_from, draft.resume_on)
        assert first.delta_days == 10
        fee = await db.scalar(
            select(FeeRecord).where(
                FeeRecord.enrollment_id == eid,
                FeeRecord.coverage_start == first.target_coverage_start,
            )
        )
        assert fee.adjusted_due_date == first.new_due_date
        extended, _ = await individual(
            db,
            eid,
            draft.suspended_from,
            draft.resume_on + timedelta(days=4),
            sid=first.suspension_id,
        )
        assert extended.delta_days == 4
        shortened, _ = await individual(
            db,
            eid,
            draft.suspended_from,
            draft.resume_on - timedelta(days=3),
            sid=first.suspension_id,
        )
        assert shortened.delta_days == -7
        cancelled, _ = await individual(
            db,
            eid,
            draft.suspended_from,
            draft.resume_on - timedelta(days=3),
            sid=first.suspension_id,
            action="CANCEL",
        )
        assert cancelled.delta_days == -7
        assert await enrollment_total_deferral_days(db, eid) == 0
        assert await apply_individual_suspension(db, UUID(eid), cmd) == first
        assert (
            await db.scalar(
                select(func.count())
                .select_from(ClassSessionException)
                .where(ClassSessionException.class_id == cid)
            )
            == 0
        )
        assert (
            await db.scalar(
                select(func.count())
                .select_from(SuspensionCommand)
                .where(
                    SuspensionCommand.enrollment_suspension_id
                    == str(first.suspension_id)
                )
            )
            == 4
        )


@pytest.mark.parametrize("class_first", [True, False])
async def test_class_and_individual_overlap_count_once_and_cancel_keeps_class_days(
    class_first,
):
    async with AsyncSessionLocal() as db:
        cid, eid, draft = await setup_case(db)

        async def class_pause():
            p = await preview_suspension(db, UUID(cid), draft)
            return await create_suspension(
                db,
                UUID(cid),
                SuspensionCreateRequest(
                    **draft.model_dump(),
                    request_id=uuid4(),
                    expected_fingerprint=p.fingerprint,
                ),
            )

        if class_first:
            await class_pause()
        private, _ = await individual(
            db, eid, draft.suspended_from, draft.resume_on + timedelta(days=4)
        )
        if not class_first:
            common = await class_pause()
            assert common.member_summary[0].overlap_days == 0
        else:
            assert private.delta_days == 4
            assert private.overlap_or_waived_days == 10
        assert await enrollment_total_deferral_days(db, eid) == 14
        cancelled, _ = await individual(
            db,
            eid,
            draft.suspended_from,
            draft.resume_on + timedelta(days=4),
            sid=private.suspension_id,
            action="CANCEL",
        )
        assert cancelled.delta_days == -4
        assert await enrollment_total_deferral_days(db, eid) == 10


async def test_concurrent_same_command_and_stale_preview():
    async with AsyncSessionLocal() as db:
        _, eid, dates = await setup_case(db)
        draft = EnrollmentSuspensionDraft(**dates.model_dump(), reason="Xin nghỉ")
        preview, *_ = await prepare_individual_suspension(db, UUID(eid), draft)
        command = EnrollmentSuspensionApply(
            **draft.model_dump(),
            request_id=uuid4(),
            expected_fingerprint=preview.fingerprint,
        )

    async def apply():
        async with AsyncSessionLocal() as session:
            return await apply_individual_suspension(session, UUID(eid), command)

    one, two = await asyncio.gather(apply(), apply())
    assert one == two
    async with AsyncSessionLocal() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(EnrollmentSuspension)
                .where(EnrollmentSuspension.enrollment_id == eid)
            )
            == 1
        )
        with pytest.raises(HTTPException) as err:
            await apply_individual_suspension(
                db, UUID(eid), command.model_copy(update={"request_id": uuid4()})
            )
        assert err.value.status_code == 409
        assert (
            await db.scalar(
                select(func.count())
                .select_from(Event)
                .where(Event.enrollment_id == eid)
            )
            == 1
        )
