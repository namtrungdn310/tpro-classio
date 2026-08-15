"""R6-D11/D12 — service-credit ledger + whole-class suspension.

Run with RUN_DB_INTEGRATION=1. Proves test.md §5.1 exact examples: A 14/08
+10 days -> cycle 1 adjusted 24/09, next cycle 24/10; B 20/08 +10 -> 30/09;
mid-join overlap; cycle 0 never targeted; class end unchanged; ledger
append-only.
"""

import os
from datetime import date, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.core.class_dates import add_months_eom_clamped
from app.core.database import AsyncSessionLocal
from app.models.enrollment import Enrollment
from app.schemas.enrollment import EnrollmentCreate
from app.schemas.suspension import SuspensionCreateRequest
from app.services.enrollment_service import create_enrollment
from app.services.fee_cycle_service import ensure_enrollment_cycles
from app.services.suspension_service import create_suspension, preview_suspension
from tests.integration.test_enrollment_selections import (
    _make_operational_class_with_slots,
    _make_student,
)

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _enroll_with_date(db, class_id: str, salt: str, enrollment_date: date) -> str:
    student_id = await _make_student(db, salt)
    enrollment = await create_enrollment(
        db,
        EnrollmentCreate(
            student_id=UUID(student_id),
            class_id=UUID(class_id),
            enrollment_date=enrollment_date,
        ),
    )
    return str(enrollment.id)


async def _adjusted_due(db, enrollment_id: str, cycle_no: int) -> date:
    row = (
        await db.execute(
            text(
                "select adjusted_due_date from public.fee_records "
                "where enrollment_id = :id and cycle_no = :cycle"
            ),
            {"id": enrollment_id, "cycle": cycle_no},
        )
    ).one()
    return row.adjusted_due_date


async def _class_start(db, class_id: str) -> date:
    return (
        await db.execute(
            text("select start_date from public.classes where id = :id"),
            {"id": class_id},
        )
    ).scalar_one()


async def test_suspension_credit_examples_a_and_b() -> None:
    async with AsyncSessionLocal() as db:
        class_id = await _make_operational_class_with_slots(db, slot_count=1)
        class_start = await _class_start(db, class_id)
        enrollment_date_a = class_start
        enrollment_date_b = class_start + timedelta(days=6)
        enrollment_a = await _enroll_with_date(
            db, class_id, "credit-a", enrollment_date_a
        )
        enrollment_b = await _enroll_with_date(
            db, class_id, "credit-b", enrollment_date_b
        )
        end_before = (
            await db.execute(
                text("select end_date from public.classes where id = :id"),
                {"id": class_id},
            )
        ).scalar()

        suspended_from = class_start + timedelta(days=27)
        resume_on = suspended_from + timedelta(days=10)
        preview = await preview_suspension(
            db,
            UUID(class_id),
            SuspensionCreateRequest(
                suspended_from=suspended_from,
                resume_on=resume_on,
            ),
        )
        assert preview.credit_days == 10
        assert len(preview.member_summary) == 2
        assert all(item.overlap_days == 10 for item in preview.member_summary)

        await create_suspension(
            db,
            UUID(class_id),
            SuspensionCreateRequest(
                suspended_from=suspended_from,
                resume_on=resume_on,
                request_id=uuid4(),
            ),
            actor_user_id=None,
        )

        # Materialize các cycle tương lai để kiểm tra anchor shift (lazy window).
        result = await db.execute(
            select(Enrollment)
            .where(Enrollment.id.in_([enrollment_a, enrollment_b]))
            .options(selectinload(Enrollment.class_))
        )
        for enrollment in result.scalars().unique().all():
            await ensure_enrollment_cycles(
                db, enrollment, up_to=add_months_eom_clamped(enrollment_date_b, 3)
            )

        assert await _adjusted_due(db, enrollment_a, 1) == (
            add_months_eom_clamped(enrollment_date_a, 1) + timedelta(days=10)
        )
        assert await _adjusted_due(db, enrollment_a, 2) == (
            add_months_eom_clamped(enrollment_date_a, 2) + timedelta(days=10)
        )
        assert await _adjusted_due(db, enrollment_b, 1) == (
            add_months_eom_clamped(enrollment_date_b, 1) + timedelta(days=10)
        )

        # Class end không đổi.
        end_after = (
            await db.execute(
                text("select end_date from public.classes where id = :id"),
                {"id": class_id},
            )
        ).scalar()
        assert end_after == end_before

        # Ledger append-only.
        with pytest.raises(Exception):
            await db.execute(
                text(
                    "delete from public.enrollment_service_credit_events "
                    "where enrollment_id = :id"
                ),
                {"id": enrollment_a},
            )
        await db.rollback()


async def test_mid_join_overlap_and_cycle_zero_never_targeted() -> None:

    async with AsyncSessionLocal() as db:
        class_id = await _make_operational_class_with_slots(db, slot_count=1)
        class_start = await _class_start(db, class_id)
        suspended_from = class_start + timedelta(days=27)
        resume_on = suspended_from + timedelta(days=10)
        full_member = await _enroll_with_date(db, class_id, "credit-full", class_start)
        mid_member = await _enroll_with_date(
            db, class_id, "credit-mid", suspended_from + timedelta(days=5)
        )
        late_member = await _enroll_with_date(db, class_id, "credit-late", resume_on)

        await create_suspension(
            db,
            UUID(class_id),
            SuspensionCreateRequest(
                suspended_from=suspended_from,
                resume_on=resume_on,
                request_id=uuid4(),
            ),
            actor_user_id=None,
        )

        async with AsyncSessionLocal() as check:
            events = (
                await check.execute(
                    text(
                        "select enrollment_id, credit_days, event_type "
                        "from public.enrollment_service_credit_events order by enrollment_id"
                    )
                )
            ).all()
            by_enrollment = {str(row.enrollment_id): row for row in events}
            assert by_enrollment[full_member].credit_days == 10
            assert by_enrollment[mid_member].credit_days == 5
            assert late_member not in by_enrollment or (
                by_enrollment[late_member].credit_days == 0
            )
            # Cycle 0 chưa bao giờ bị target: không allocation nào trỏ cycle 0.
            bad_allocations = (
                await check.execute(
                    text(
                        """
                        select count(*) from public.service_credit_allocations a
                        join public.fee_records f on f.id = a.fee_record_id
                        where f.cycle_no = 0
                        """
                    )
                )
            ).scalar()
            assert bad_allocations == 0
