import os
from datetime import timedelta
from uuid import UUID, uuid4
import pytest
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.makeup import ClassSessionException
from app.models.fee_record import FeeRecord
from app.schemas.suspension import (
    SuspensionCreateRequest,
    ClassSuspensionChangeDraft,
    ClassSuspensionChangeApply,
)
from app.services.suspension_service import create_suspension, preview_suspension
from app.services.class_suspension_lifecycle_service import (
    prepare_class_suspension_change,
    apply_class_suspension_change,
)
from app.services.credit_service import enrollment_total_deferral_days
from tests.integration.test_suspension_command_contract import setup_case
from tests.integration.test_enrollment_suspensions import individual

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1", reason="disposable PostgreSQL only"
    ),
]


@pytest.fixture(autouse=True)
def enable(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_class_extend_early_resume_cancel_preserves_individual_days(kind):
    async with AsyncSessionLocal() as db:
        cid, eid, dates = await setup_case(db, kind)
        await individual(
            db, eid, dates.suspended_from, dates.resume_on + timedelta(days=4)
        )
        p = await preview_suspension(db, UUID(cid), dates)
        original_cmd = SuspensionCreateRequest(
            **dates.model_dump(), request_id=uuid4(), expected_fingerprint=p.fingerprint
        )
        original = await create_suspension(db, UUID(cid), original_cmd)

        async def change(end, *, cancel=False):
            draft = ClassSuspensionChangeDraft(
                resume_on=end, cancel=cancel, reason="Điều chỉnh kế hoạch nghỉ"
            )
            result, *_ = await prepare_class_suspension_change(
                db, UUID(cid), original.adjustment_id, draft
            )
            assert not result.blocked_reasons
            command = ClassSuspensionChangeApply(
                **draft.model_dump(),
                request_id=uuid4(),
                expected_fingerprint=result.fingerprint,
            )
            applied = await apply_class_suspension_change(
                db, UUID(cid), original.adjustment_id, command
            )
            assert applied == result
            assert (
                await apply_class_suspension_change(
                    db, UUID(cid), original.adjustment_id, command
                )
                == result
            )
            return result

        extended = await change(dates.resume_on + timedelta(days=11))
        assert extended.member_summary[0].overlap_days == 7
        assert await enrollment_total_deferral_days(db, eid) == 21
        shortened = await change(dates.resume_on + timedelta(days=1))
        assert shortened.member_summary[0].overlap_days == -7
        cancelled = await change(dates.resume_on + timedelta(days=1), cancel=True)
        assert cancelled.member_summary[0].overlap_days == 0
        assert await enrollment_total_deferral_days(db, eid) == 14
        assert await create_suspension(db, UUID(cid), original_cmd) == original
        rows = (
            await db.scalars(
                select(ClassSessionException).where(
                    ClassSessionException.adjustment_id == str(original.adjustment_id)
                )
            )
        ).all()
        assert rows and all(x.status == "RESTORED" for x in rows)
        fees = (
            await db.scalars(
                select(FeeRecord).where(
                    FeeRecord.enrollment_id == eid, FeeRecord.cycle_no > 0
                )
            )
        ).all()
        assert all(
            f.adjusted_due_date == f.base_due_date + timedelta(days=14) for f in fees
        )
