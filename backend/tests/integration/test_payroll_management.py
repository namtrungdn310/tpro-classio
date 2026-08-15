"""Round 7 payroll management commands on migrated disposable PostgreSQL."""

import os
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.schemas.staff import (
    StaffCompensationRateCreate,
    StaffPayrollSettlementCreate,
    StaffPayrollSettlementReversalCreate,
)
from app.services.payroll_service import (
    create_staff_compensation_rate,
    get_staff_payroll_summary,
    reverse_staff_payroll_settlement,
    settle_staff_payroll,
)
from tests.integration.test_enrollment_selections import (
    _make_operational_class_with_slots,
)

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def test_rate_overlap_balance_and_settlement_replay() -> None:
    async with AsyncSessionLocal() as db:
        class_id = await _make_operational_class_with_slots(db, slot_count=1)
        assignment = (
            await db.execute(
                text(
                    """
                    select css.id as slot_id, csss.staff_id
                    from public.class_schedule_slots css
                    join public.class_schedule_slot_staff csss on csss.slot_id = css.id
                    where css.class_id = cast(:class_id as uuid)
                    limit 1
                    """
                ),
                {"class_id": class_id},
            )
        ).one()
        staff_id = UUID(str(assignment.staff_id))
        effective_from = business_today()
        rate = await create_staff_compensation_rate(
            db,
            staff_id,
            StaffCompensationRateCreate(
                rate_amount=250_000,
                effective_from=effective_from,
            ),
            actor_user_id=None,  # type: ignore[arg-type]
        )
        assert rate.rate_amount == 250_000

        with pytest.raises(HTTPException) as overlap:
            await create_staff_compensation_rate(
                db,
                staff_id,
                StaffCompensationRateCreate(
                    rate_amount=300_000,
                    effective_from=effective_from + timedelta(days=1),
                ),
                actor_user_id=None,  # type: ignore[arg-type]
            )
        assert overlap.value.status_code == 409

        attendance_id = str(uuid4())
        attendance_request = str(uuid4())
        start = datetime.now(timezone.utc)
        await db.execute(
            text(
                """
                insert into public.staff_attendance_entries (
                  id, staff_id, occurrence_class_id, occurrence_slot_id,
                  occurrence_start_at, occurrence_end_at, occurrence_kind,
                  staff_role, scheduled_start_at, checkin_at, rate_amount,
                  rate_version, request_id
                ) values (
                  cast(:id as uuid), cast(:staff as uuid), cast(:class_id as uuid),
                  cast(:slot as uuid), :start, :end, 'REGULAR', 'TEACHER',
                  :start, :start, 250000, 1, cast(:request_id as uuid)
                )
                """
            ),
            {
                "id": attendance_id,
                "staff": str(staff_id),
                "class_id": class_id,
                "slot": str(assignment.slot_id),
                "start": start,
                "end": start + timedelta(minutes=90),
                "request_id": attendance_request,
            },
        )
        await db.execute(
            text(
                """
                insert into public.staff_earning_ledger (
                  staff_id, attendance_entry_id, entry_type, amount, request_id
                ) values (
                  cast(:staff as uuid), cast(:attendance as uuid), 'EARNING',
                  250000, cast(:request_id as uuid)
                )
                """
            ),
            {
                "staff": str(staff_id),
                "attendance": attendance_id,
                "request_id": str(uuid4()),
            },
        )
        await db.commit()

        summary = await get_staff_payroll_summary(db, staff_id)
        assert summary.balance == 250_000

        request_id = uuid4()
        payload = StaffPayrollSettlementCreate(
            request_id=request_id,
            method="bank_transfer",
            reference="TEST-R7",
        )
        settlement = await settle_staff_payroll(
            db,
            staff_id,
            payload,
            actor_user_id=None,  # type: ignore[arg-type]
        )
        replay = await settle_staff_payroll(
            db,
            staff_id,
            payload,
            actor_user_id=None,  # type: ignore[arg-type]
        )
        assert replay.id == settlement.id
        assert settlement.total_amount == 250_000
        assert (await get_staff_payroll_summary(db, staff_id)).balance == 0

        reversal_payload = StaffPayrollSettlementReversalCreate(
            request_id=uuid4(), reason="Ghi nhận nhầm hình thức thanh toán"
        )
        reversal = await reverse_staff_payroll_settlement(
            db,
            staff_id,
            settlement.id,
            reversal_payload,
            actor_user_id=None,  # type: ignore[arg-type]
        )
        reversal_replay = await reverse_staff_payroll_settlement(
            db,
            staff_id,
            settlement.id,
            reversal_payload,
            actor_user_id=None,  # type: ignore[arg-type]
        )
        assert reversal_replay.id == reversal.id
        assert (await get_staff_payroll_summary(db, staff_id)).balance == 250_000

        with pytest.raises(HTTPException) as duplicate_reversal:
            await reverse_staff_payroll_settlement(
                db,
                staff_id,
                settlement.id,
                StaffPayrollSettlementReversalCreate(
                    request_id=uuid4(), reason="Hoàn tác lần hai"
                ),
                actor_user_id=None,  # type: ignore[arg-type]
            )
        assert duplicate_reversal.value.status_code == 409

        replacement = await settle_staff_payroll(
            db,
            staff_id,
            StaffPayrollSettlementCreate(request_id=uuid4(), method="cash"),
            actor_user_id=None,  # type: ignore[arg-type]
        )
        assert replacement.id != settlement.id
        assert replacement.total_amount == 250_000
        assert (await get_staff_payroll_summary(db, staff_id)).balance == 0
