"""Real PostgreSQL regressions for course correction and payment races."""

import asyncio
import os
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text

from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.models.fee_record import FeeRecord
from app.models.billing_anchor_revision import BillingAnchorRevision
from app.schemas.class_ import ClassBillingCyclePreviewRequest, ClassBillingCycleUpdate
from app.schemas.billing_schedule_change import BillingScheduleOptionsRequest
from app.services.billing_schedule_change_service import (
    analyze_billing_schedule_options,
    apply_billing_schedule,
    load_billing_context,
    waiver_scope,
)
from app.services.class_billing_cycle_service import (
    preview_class_billing_cycle,
    update_class_billing_cycle,
)
from app.services.fee_cycle_service import ensure_enrollment_cycles
from test_billing_schedule_decisions import confirmed_enrollment, command_for

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="disposable PostgreSQL only",
    ),
]


async def test_course_repeated_corrections_preserve_history_and_do_not_resurrect_waivers(
    monkeypatch,
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    today = business_today()
    async with AsyncSessionLocal() as db:
        enrollment = await confirmed_enrollment(db, "COURSE")
        enrollment_id = enrollment.id
    original_revision_id = None
    original_waivers = None
    for version, offset in enumerate((400, 5, 800, -40, 12)):
        async with AsyncSessionLocal() as db:
            current, _, _ = await load_billing_context(db, enrollment_id)
            _, replaceable = waiver_scope(current.current_billing_revision, today)
            extra = {"replace_future_waivers": True} if replaceable else {}
            options = await analyze_billing_schedule_options(
                db,
                enrollment_id,
                BillingScheduleOptionsRequest(
                    anchor_date=today + timedelta(days=offset),
                    expected_version=version,
                    **extra,
                ),
            )
            assert any(option.is_allowed for option in options.options)
            command, preview = await command_for(
                db, enrollment_id, today + timedelta(days=offset), version, **extra
            )
            await apply_billing_schedule(db, enrollment_id, command, actor_user_id=None)
            replay = await apply_billing_schedule(
                db, enrollment_id, command, actor_user_id=None
            )
            assert replay.preview_fingerprint == preview.preview_fingerprint
            current, _, _ = await load_billing_context(db, enrollment_id, lock=True)
            if version == 0:
                original_revision_id = current.current_billing_revision_id
                original_waivers = list(
                    current.current_billing_revision.waived_intervals
                )
            else:
                old = await db.get(BillingAnchorRevision, original_revision_id)
                assert old.waived_intervals == original_waivers
            effective = preview.model_dump(mode="json")["plan"]
            assert (
                current.current_billing_revision.waived_intervals
                == effective["retained_waived_intervals"]
                + effective["waived_intervals"]
            )
            await ensure_enrollment_cycles(
                db, current, up_to=today + timedelta(days=95)
            )
            await db.commit()
        # Re-open a session: legacy history hydration must not restore revoked waivers.
        async with AsyncSessionLocal() as db:
            current, fees, _ = await load_billing_context(db, enrollment_id, lock=True)
            assert (
                current.current_billing_revision.waived_intervals
                == effective["retained_waived_intervals"]
                + effective["waived_intervals"]
            )
            assert (
                await ensure_enrollment_cycles(
                    db, current, up_to=today + timedelta(days=95)
                )
                == []
            )
            active = sorted(
                (f for f in fees if f.status not in ("VOID", "SUPERSEDED")),
                key=lambda f: f.coverage_start,
            )
            assert all(
                a.coverage_end <= b.coverage_start for a, b in zip(active, active[1:])
            )


async def test_course_duration_waits_for_payment_and_rejects_stale_preview(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    today = business_today()
    async with AsyncSessionLocal() as db:
        enrollment = await confirmed_enrollment(db, "COURSE")
        enrollment_id, class_id = enrollment.id, UUID(str(enrollment.class_id))
        current, _, _ = await load_billing_context(db, enrollment_id, lock=True)
        generated = await ensure_enrollment_cycles(
            db, current, up_to=today + timedelta(days=35)
        )
        fee_id = generated[0].id
        await db.commit()
        request = dict(billing_cycle_weeks=6, expected_version=current.class_.version)
        preview = await preview_class_billing_cycle(
            db, class_id, ClassBillingCyclePreviewRequest(**request)
        )
        command = ClassBillingCycleUpdate(
            **request,
            expected_fingerprint=preview.preview_fingerprint,
            request_id=uuid4(),
            reason="Fixture simultaneous payment",
        )
    started = asyncio.Event()
    shared = {}

    async def change():
        async with AsyncSessionLocal() as db:
            shared["pid"] = await db.scalar(text("select pg_backend_pid()"))
            started.set()
            try:
                await update_class_billing_cycle(
                    db, class_id, command, actor_user_id=None
                )
                return "APPLIED"
            except ValueError as exc:
                assert "xem trước lại" in str(exc)
                return "STALE"

    async with AsyncSessionLocal() as payer:
        fee = await payer.scalar(
            select(FeeRecord).where(FeeRecord.id == fee_id).with_for_update()
        )
        fee.status, fee.paid_amount, fee.paid_date = "PAID", fee.final_amount, today
        await payer.flush()
        task = asyncio.create_task(change())
        try:
            await asyncio.wait_for(started.wait(), 5)
            # Verify actual PostgreSQL blocking, rather than a timing-only sleep.
            async with AsyncSessionLocal() as observer:

                async def wait_for_lock():
                    while not await observer.scalar(
                        text("select cardinality(pg_blocking_pids(:pid)) > 0"),
                        {"pid": shared["pid"]},
                    ):
                        if task.done():
                            raise AssertionError(
                                "Duration update did not wait for the fee lock"
                            )
                        await asyncio.sleep(0.02)

                await asyncio.wait_for(wait_for_lock(), 10)
            await payer.commit()
            assert await asyncio.wait_for(task, 10) == "STALE"
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
    async with AsyncSessionLocal() as db:
        current, fees, _ = await load_billing_context(db, enrollment_id)
        paid = next(f for f in fees if f.id == fee_id)
        assert paid.status == "PAID" and paid.superseded_at is None
        assert current.class_.billing_cycle_weeks == 4
