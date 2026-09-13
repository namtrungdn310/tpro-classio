"""Workspace, immutability and signed-boundary probes against disposable DB."""

import os
from uuid import UUID, uuid4
import asyncpg
import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from app.core.database import AsyncSessionLocal
from app.core.workspace import set_workspace_id, reset_workspace_id
from app.models.enrollment_service_credit_event import (
    EnrollmentServiceCreditEvent as Event,
    ServiceCreditAllocation as Allocation,
)
from app.models.enrollment_suspension import EnrollmentSuspension, SuspensionCommand
from app.models.fee_record import FeeRecord
from app.services.suspension_report_service import read_suspension_history
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


async def test_other_workspace_cannot_read_receipts_or_reference_source():
    async with AsyncSessionLocal() as db:
        _, eid, dates = await setup_case(db)
        result, _ = await individual(db, eid, dates.suspended_from, dates.resume_on)
    owner = await asyncpg.connect(os.environ["DB_TEST_ADMIN_DSN"])
    try:
        other = await owner.fetchval(
            "insert into public.workspaces (name) values ('Suspension isolation probe') returning id"
        )
    finally:
        await owner.close()
    token = set_workspace_id(str(other))
    try:
        async with AsyncSessionLocal() as db:
            assert (
                await db.scalar(
                    select(EnrollmentSuspension).where(
                        EnrollmentSuspension.id == str(result.suspension_id)
                    )
                )
                is None
            )
            assert (
                await db.scalar(
                    select(SuspensionCommand).where(
                        SuspensionCommand.enrollment_suspension_id
                        == str(result.suspension_id)
                    )
                )
                is None
            )
            with pytest.raises(HTTPException) as err:
                await read_suspension_history(db, UUID(eid))
            assert err.value.status_code == 404
            db.add(
                SuspensionCommand(
                    id=str(uuid4()),
                    workspace_id=str(other),
                    enrollment_suspension_id=str(result.suspension_id),
                    request_id=str(uuid4()),
                    actor_id=str(uuid4()),
                    payload={},
                    result={},
                    before_snapshot={},
                )
            )
            with pytest.raises(DBAPIError, match="another workspace"):
                await db.flush()
            await db.rollback()
    finally:
        reset_workspace_id(token)


async def test_receipts_cannot_be_edited_and_days_cannot_be_reversed_twice():
    async with AsyncSessionLocal() as db:
        cid, eid, dates = await setup_case(db)
        result, _ = await individual(db, eid, dates.suspended_from, dates.resume_on)
        command = await db.scalar(
            select(SuspensionCommand).where(
                SuspensionCommand.enrollment_suspension_id == str(result.suspension_id)
            )
        )
        with pytest.raises(DBAPIError, match="append-only|immutable"):
            await db.execute(
                text(
                    "update suspension_commands set result = '{}'::jsonb where id = cast(:id as uuid)"
                ),
                {"id": command.id},
            )
        await db.rollback()
        db.add(
            Event(
                enrollment_id=eid,
                class_id=cid,
                event_type="REVERSAL",
                credit_days=11,
                overlap_start=dates.suspended_from,
                overlap_end=dates.resume_on,
                request_id=str(uuid4()),
            )
        )
        with pytest.raises(DBAPIError, match="exceeds granted"):
            await db.flush()
        await db.rollback()


async def test_allocations_cannot_target_initial_fee_or_another_enrollment():
    async with AsyncSessionLocal() as db:
        cid, eid, dates = await setup_case(db)
        _, other, _ = await setup_case(db)
        event = Event(
            enrollment_id=eid,
            class_id=cid,
            event_type="GRANT",
            credit_days=2,
            overlap_start=dates.suspended_from,
            overlap_end=dates.resume_on,
            request_id=str(uuid4()),
        )
        db.add(event)
        await db.commit()
        event_id = event.id
        for target_eid in (eid, other):
            fee = await db.scalar(
                select(FeeRecord).where(
                    FeeRecord.enrollment_id == target_eid, FeeRecord.cycle_no == 0
                )
            )
            db.add(
                Allocation(
                    credit_event_id=event_id,
                    fee_record_id=fee.id,
                    allocated_days=1,
                    applies_from=fee.coverage_start,
                )
            )
            with pytest.raises(DBAPIError, match="editable renewal"):
                await db.flush()
            await db.rollback()


async def test_browser_roles_have_no_access_to_pause_tables():
    owner = await asyncpg.connect(os.environ["DB_TEST_ADMIN_DSN"])
    try:
        for role in ("anon", "authenticated"):
            for table in ("enrollment_suspensions", "suspension_commands"):
                for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                    assert not await owner.fetchval(
                        "select has_table_privilege($1, $2, $3)",
                        role,
                        f"public.{table}",
                        privilege,
                    )
    finally:
        await owner.close()
