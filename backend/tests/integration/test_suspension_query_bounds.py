"""Query count must not grow with students or calendar occurrences."""

import os
from datetime import datetime, timedelta
from uuid import UUID, uuid4
import pytest
from app.core.business_time import BUSINESS_TIMEZONE
from app.core.database import AsyncSessionLocal
from app.core.performance import track_request_metrics
from app.schemas.enrollment import EnrollmentCreate
from app.services.enrollment_service import create_enrollment
from app.services.suspension_service import preview_suspension
from app.services.schedule_slot_service import expand_class_occurrences_bulk
from tests.integration.test_suspension_command_contract import setup_case
from tests.integration.test_enrollment_selections import (
    _make_student,
    _make_operational_class_with_slots,
)

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1", reason="disposable DB only"
    ),
]


async def test_class_pause_preview_uses_batch_queries_not_one_query_per_student():
    async with AsyncSessionLocal() as db:
        cid, _, draft = await setup_case(db)
    async with AsyncSessionLocal() as db:
        with track_request_metrics() as one:
            assert (
                len((await preview_suspension(db, UUID(cid), draft)).member_summary)
                == 1
            )
    async with AsyncSessionLocal() as db:
        for _ in range(9):
            sid = await _make_student(db, uuid4().hex)
            await create_enrollment(
                db, EnrollmentCreate(student_id=UUID(sid), class_id=UUID(cid))
            )
    async with AsyncSessionLocal() as db:
        with track_request_metrics() as many:
            assert (
                len((await preview_suspension(db, UUID(cid), draft)).member_summary)
                == 10
            )
    assert many.sql_count <= one.sql_count + 1, (one.sql_count, many.sql_count)
    assert many.sql_count <= 30
    print(f"SUSPENSION_PREVIEW_SQL one={one.sql_count} ten={many.sql_count}")


async def test_dated_calendar_batches_remain_bounded_when_class_count_grows():
    async with AsyncSessionLocal() as db:
        cid, _, draft = await setup_case(db)
        ids = [cid] + [
            await _make_operational_class_with_slots(db, slot_count=1) for _ in range(5)
        ]
    start = datetime.combine(
        draft.suspended_from, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    counts = []
    for selected in ([cid], ids):
        async with AsyncSessionLocal() as db:
            with track_request_metrics() as metrics:
                result = await expand_class_occurrences_bulk(
                    db,
                    selected,
                    range_start=start,
                    range_end=start + timedelta(days=120),
                )
            assert set(result) == set(selected)
            assert all(len(items) >= 16 for items in result.values())
            counts.append(metrics.sql_count)
    assert counts[1] <= counts[0] + 1
    assert counts[1] <= 15
    print(f"SUSPENSION_CALENDAR_SQL one={counts[0]} six={counts[1]}")


async def test_private_pause_does_not_stop_teacher_calendar_but_class_pause_does(
    monkeypatch,
):
    from sqlalchemy import select
    from app.models.class_schedule_slot import ClassScheduleSlot, ClassScheduleSlotStaff
    from app.schemas.suspension import SuspensionCreateRequest, SuspensionPreviewRequest
    from app.services.suspension_service import create_suspension
    from app.services.attendance_occurrence_service import teacher_today_occurrences
    from tests.integration.test_enrollment_suspensions import individual
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        cid, eid, dates = await setup_case(db)
        staff = await db.scalar(
            select(ClassScheduleSlotStaff.staff_id)
            .join(
                ClassScheduleSlot,
                ClassScheduleSlot.id == ClassScheduleSlotStaff.slot_id,
            )
            .where(
                ClassScheduleSlot.class_id == cid,
                ClassScheduleSlotStaff.role == "TEACHER",
            )
        )
        start = dates.suspended_from - timedelta(days=3)
        # Stable test window independent of the day the suite is run.
        monkeypatch.setattr(
            "app.services.attendance_occurrence_service.business_today", lambda: start
        )
        before, _ = await teacher_today_occurrences(db, str(staff))
        assert before
        await individual(db, eid, start, start + timedelta(days=10))
        after, _ = await teacher_today_occurrences(db, str(staff))
        assert after == before
        draft = SuspensionPreviewRequest(
            suspended_from=start, resume_on=start + timedelta(days=10)
        )
        preview = await preview_suspension(db, UUID(cid), draft)
        await create_suspension(
            db,
            UUID(cid),
            SuspensionCreateRequest(
                **draft.model_dump(),
                request_id=uuid4(),
                expected_fingerprint=preview.fingerprint,
            ),
        )
        with track_request_metrics() as metrics:
            after, _ = await teacher_today_occurrences(db, str(staff))
        assert after == []
        # Bounded even when unrelated classes in this disposable dataset grow.
        assert metrics.sql_count < 30
