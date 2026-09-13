"""Options -> preview -> apply -> worker on disposable PostgreSQL, not mocks."""

import os
import asyncio
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from fastapi import HTTPException

from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.models.fee_record import FeeRecord
from app.schemas.enrollment import EnrollmentCreate, EnrollmentUpdate
from app.schemas.billing_schedule_change import (
    BillingScheduleOptionsRequest,
    BillingSchedulePreviewRequest,
    BillingScheduleApplyRequest,
)
from app.services.enrollment_service import create_enrollment, update_enrollment
from app.services.billing_schedule_change_service import (
    analyze_billing_schedule_options,
    preview_billing_schedule,
    apply_billing_schedule,
    load_billing_context,
)
from app.services.fee_cycle_service import ensure_enrollment_cycles
from test_billing_cycles import _make_operational_class, _make_student
from test_membership_transitions import _financial_snapshot

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="disposable PostgreSQL only",
    ),
]


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
@pytest.mark.parametrize("fee_state", ["UNPAID", "PAID", "NOTIFIED"])
@pytest.mark.parametrize("offset", [-400, -10, 5, 100])
@pytest.mark.parametrize(
    "apply_strategy",
    ["KEEP_CURRENT", "REPLACE_CURRENT", "FROM_CYCLE", "CONTINUE_OLD_UNTIL_NEW"],
)
async def test_date_direction_matrix_preserves_money_and_generates_next_cycle(
    monkeypatch, kind, fee_state, offset, apply_strategy
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    today = business_today()
    async with AsyncSessionLocal() as db:
        class_id, _ = await _make_operational_class(
            db,
            class_type=kind,
            cycle_weeks=4 if kind == "COURSE" else None,
            start=today - timedelta(days=800),
        )
        student_id = await _make_student(db, uuid4().hex)
        enrollment = await create_enrollment(
            db,
            EnrollmentCreate(
                class_id=UUID(class_id),
                student_id=UUID(student_id),
                enrollment_date=today,
            ),
        )
        # Start with a confirmed billing baseline, then independently backdate
        # admission. Backdated enrollment creation intentionally requires review.
        enrollment = await update_enrollment(
            db,
            enrollment.id,
            EnrollmentUpdate(
                contract_version=4,
                enrollment_date=today - timedelta(days=700),
                expected_admission_version=0,
            ),
        )
        original_admission = enrollment.enrollment_date
        fee = await db.scalar(
            select(FeeRecord).where(FeeRecord.enrollment_id == str(enrollment.id))
        )
        if fee_state == "PAID":
            fee.status, fee.paid_amount, fee.paid_date = "PAID", fee.final_amount, today
        elif fee_state == "NOTIFIED":
            fee.notified_at = datetime.now(timezone.utc)
            fee.notification_channel = "zalo_manual"
            fee.notification_message = "Thông báo kiểm thử"
            fee.student_name_snapshot = "Học viên kiểm thử"
        await db.commit()
        before = await _financial_snapshot(db, enrollment.id)
        options = await analyze_billing_schedule_options(
            db,
            enrollment.id,
            BillingScheduleOptionsRequest(
                anchor_date=today + timedelta(days=offset),
                expected_version=0,
            ),
        )
        allowed = [
            o for o in options.options if o.is_allowed and o.strategy != "UNCHANGED"
        ]
        assert allowed, options.blocked_reason or options.model_dump_json()
        allowed.sort(key=lambda option: option.strategy == "CONTINUE_OLD_UNTIL_NEW")
        # Every displayed strategy must really preview with its required gap decision.
        selected = None
        for option in allowed:
            draft = dict(
                anchor_date=options.new_anchor_date,
                expected_version=0,
                strategy=option.strategy,
                first_cycle=option.suggested_first_cycle
                if option.strategy == "FROM_CYCLE"
                else None,
                historical_cycles=[],
                gap_policy="WAIVE",
                reason="Kiểm thử thay mốc kỳ thu",
                expected_context_token=options.context_token,
            )
            preview = await preview_billing_schedule(
                db, enrollment.id, BillingSchedulePreviewRequest(**draft)
            )
            assert preview.can_apply, (option.id, preview)
            assert {f.id for f in preview.replaced_fees} == set(
                preview.plan.supersede_ids
            )
            if option.strategy == apply_strategy:
                selected = (draft, preview)
        assert await _financial_snapshot(db, enrollment.id) == before
        if selected is None:
            assert not any(
                o.is_allowed and o.strategy == apply_strategy for o in options.options
            )
            return  # This strategy is correctly not offered for this financial state.
        draft, preview = selected
        command = BillingScheduleApplyRequest(
            **draft,
            request_id=uuid4(),
            expected_preview_fingerprint=preview.preview_fingerprint,
        )
        await apply_billing_schedule(db, enrollment.id, command, actor_user_id=None)
        after = await _financial_snapshot(db, enrollment.id)
        await apply_billing_schedule(db, enrollment.id, command, actor_user_id=None)
        assert await _financial_snapshot(db, enrollment.id) == after
        if fee_state == "PAID":
            original = next(f for f in before["fees"] if f["id"] == fee.id)
            assert next(f for f in after["fees"] if f["id"] == fee.id) == original
        for f in after["fees"]:
            if f["status"] == "SUPERSEDED":
                assert f["superseded_at"] and f["voided_at"] is None
        refreshed, _, _ = await load_billing_context(db, enrollment.id, lock=True)
        assert refreshed.enrollment_date == original_admission
        first = next(
            c
            for c in preview.plan.charges
            if c.kind == "CYCLE" and c.cycle_no == preview.plan.first_cycle
        )
        generated = await ensure_enrollment_cycles(
            db, refreshed, up_to=first.coverage.end + timedelta(days=1)
        )
        assert any(f.anchor_cycle_no == preview.plan.first_cycle + 1 for f in generated)
        await db.rollback()


async def confirmed_enrollment(db, kind="MONTHLY"):
    today = business_today()
    class_id, _ = await _make_operational_class(
        db,
        start=today - timedelta(days=800),
        class_type=kind,
        cycle_weeks=4 if kind == "COURSE" else None,
    )
    student_id = await _make_student(db, uuid4().hex)
    return await create_enrollment(
        db,
        EnrollmentCreate(
            class_id=UUID(class_id),
            student_id=UUID(student_id),
            enrollment_date=today,
        ),
    )


async def command_for(
    db, enrollment_id, anchor, version=0, strategy="CONTINUE_OLD_UNTIL_NEW", **extra
):
    options = await analyze_billing_schedule_options(
        db,
        enrollment_id,
        BillingScheduleOptionsRequest(
            anchor_date=anchor,
            expected_version=version,
            replace_future_waivers=extra.get("replace_future_waivers", False),
        ),
    )
    draft = dict(
        anchor_date=anchor,
        expected_version=version,
        strategy=strategy,
        reason="Kiểm thử lịch thu liên thông",
        gap_policy="WAIVE",
        expected_context_token=options.context_token,
        **extra,
    )
    preview = await preview_billing_schedule(
        db, enrollment_id, BillingSchedulePreviewRequest(**draft)
    )
    return BillingScheduleApplyRequest(
        **draft,
        request_id=uuid4(),
        expected_preview_fingerprint=preview.preview_fingerprint,
    ), preview


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_repeated_future_cutovers_keep_bounded_generation_and_waivers(
    monkeypatch, kind
):
    from app.core.config import settings
    from app.services.billing_schedule_read_service import read_schedule_summary

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    today = business_today()
    async with AsyncSessionLocal() as db:
        enrollment = await confirmed_enrollment(db, kind)
        enrollment_id = enrollment.id
        command, preview = await command_for(
            db, enrollment_id, today + timedelta(days=400)
        )
        assert (
            len(preview.plan.charges) == 1 and len(preview.plan.scheduled_segments) == 1
        )
        await apply_billing_schedule(db, enrollment_id, command, actor_user_id=None)
        current, records, _ = await load_billing_context(db, enrollment_id, lock=True)
        assert len(records) == 2  # Not a year's invoices.
        waivers = current.current_billing_revision.waived_intervals
        generated = await ensure_enrollment_cycles(
            db, current, up_to=today + timedelta(days=40)
        )
        assert len(generated) == 1
        await db.commit()
        second, preview = await command_for(
            db, enrollment_id, today + timedelta(days=800), 1
        )
        assert (
            len(preview.plan.charges) == 1 and len(preview.plan.scheduled_segments) == 2
        )
        await apply_billing_schedule(db, enrollment_id, second, actor_user_id=None)
        current, records, _ = await load_billing_context(db, enrollment_id, lock=True)
        assert all(
            w in current.current_billing_revision.waived_intervals for w in waivers
        )
        assert len(records) == 4
        assert (
            await ensure_enrollment_cycles(
                db, current, up_to=today + timedelta(days=40)
            )
            == []
        )
        more = await ensure_enrollment_cycles(
            db, current, up_to=today + timedelta(days=95)
        )
        assert 1 <= len(more) <= 3
        await db.commit()
        _, records, _ = await load_billing_context(db, enrollment_id)
        active = sorted(
            (f for f in records if f.status not in ("VOID", "SUPERSEDED")),
            key=lambda f: f.coverage_start,
        )
        assert all(
            a.coverage_end <= b.coverage_start for a, b in zip(active, active[1:])
        )
        before = await _financial_snapshot(db, enrollment_id)
        summary = await read_schedule_summary(db, enrollment_id)
        assert date.fromisoformat(summary["next_due_date"]) <= today + timedelta(
            days=95
        )
        assert await _financial_snapshot(db, enrollment_id) == before


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_concurrent_admin_commands_only_one_commits(monkeypatch, kind):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment = await confirmed_enrollment(db, kind)
        enrollment_id = enrollment.id
        command, _ = await command_for(
            db, enrollment_id, business_today() + timedelta(days=400)
        )
        await (
            db.rollback()
        )  # Preview connection must not hold a transaction in the race.

    async def apply(command):
        async with AsyncSessionLocal() as db:
            try:
                await apply_billing_schedule(
                    db, enrollment_id, command, actor_user_id=None
                )
                return "APPLIED"
            except HTTPException as error:
                assert error.status_code == 409
                await db.rollback()
                return "STALE"

    results = await asyncio.wait_for(
        asyncio.gather(
            apply(command),
            apply(command.model_copy(update={"request_id": uuid4()})),
        ),
        timeout=20,
    )
    assert sorted(results) == ["APPLIED", "STALE"]
    async with AsyncSessionLocal() as db:
        current, records, _ = await load_billing_context(db, enrollment_id)
        assert current.billing_anchor_version == 1 and len(records) == 2


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_custom_apply_date_snaps_to_calendar_and_keeps_current_unpaid(
    monkeypatch, kind
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    today = business_today()
    async with AsyncSessionLocal() as db:
        enrollment = await confirmed_enrollment(db, kind)
        before = await _financial_snapshot(db, enrollment.id)
        command, preview = await command_for(
            db,
            enrollment.id,
            today + timedelta(days=5),
            strategy="KEEP_CURRENT",
            apply_from_date=today + timedelta(days=80),
        )
        first = next(
            c for c in preview.plan.charges if c.cycle_no == preview.plan.first_cycle
        )
        assert first.coverage.start >= today + timedelta(days=80)
        if kind == "COURSE":
            assert (first.coverage.start - (today + timedelta(days=5))).days % 28 == 0
            assert first.coverage.start - timedelta(days=28) < today + timedelta(
                days=80
            )
        else:
            assert first.coverage.start.day == (today + timedelta(days=5)).day
        await apply_billing_schedule(db, enrollment.id, command, actor_user_id=None)
        after = await _financial_snapshot(db, enrollment.id)
        for fee in before["fees"]:
            assert next(f for f in after["fees"] if f["id"] == fee["id"]) == fee


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_pause_targets_retained_old_cadence_without_materializing_far_future(
    monkeypatch, kind
):
    from app.core.config import settings
    from app.schemas.suspension import SuspensionCreateRequest
    from app.services.suspension_service import create_suspension
    from app.models.enrollment_service_credit_event import (
        EnrollmentServiceCreditEvent,
        ServiceCreditAllocation,
    )
    from tests.integration.test_enrollment_selections import (
        _make_operational_class_with_slots,
    )

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    today = business_today()
    async with AsyncSessionLocal() as db:
        # A service suspension requires canonical dated slots/staff snapshots.
        # Keep the billing assertion, upgrade the old JSON-only class fixture.
        cid = await _make_operational_class_with_slots(
            db, slot_count=1, class_type=kind
        )
        sid = await _make_student(db, uuid4().hex)
        enrollment = await create_enrollment(
            db,
            EnrollmentCreate(
                class_id=UUID(cid),
                student_id=UUID(sid),
                enrollment_date=today + timedelta(days=1),
            ),
        )
        enrollment_id, class_id = enrollment.id, enrollment.class_id
        command, _ = await command_for(db, enrollment_id, today + timedelta(days=4000))
        await apply_billing_schedule(db, enrollment_id, command, actor_user_id=None)
        await create_suspension(
            db,
            UUID(str(class_id)),
            SuspensionCreateRequest(
                suspended_from=today + timedelta(days=5),
                resume_on=today + timedelta(days=15),
                request_id=uuid4(),
            ),
            actor_user_id=None,
        )
        current, records, _ = await load_billing_context(db, enrollment_id, lock=True)
        assert len(records) < 6
        allocation = await db.scalar(
            select(ServiceCreditAllocation)
            .join(
                EnrollmentServiceCreditEvent,
                EnrollmentServiceCreditEvent.id
                == ServiceCreditAllocation.credit_event_id,
            )
            .where(EnrollmentServiceCreditEvent.enrollment_id == enrollment_id)
        )
        assert allocation and allocation.allocated_days == 10
        target = next(f for f in records if f.id == allocation.fee_record_id)
        assert target.coverage_start < today + timedelta(days=60)
        assert target.adjusted_due_date == target.base_due_date + timedelta(days=10)
        future = max(records, key=lambda f: f.coverage_start)
        assert future.adjusted_due_date == future.base_due_date + timedelta(days=10)
        await db.rollback()


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_unallocated_pause_credit_is_in_preview_and_allocated_once(
    monkeypatch, kind
):
    from app.core.config import settings
    from app.models.enrollment_service_credit_event import (
        EnrollmentServiceCreditEvent,
        ServiceCreditAllocation,
    )

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    today = business_today()
    async with AsyncSessionLocal() as db:
        enrollment = await confirmed_enrollment(db, kind)
        enrollment_id = enrollment.id
        event = EnrollmentServiceCreditEvent(
            enrollment_id=enrollment_id,
            class_id=enrollment.class_id,
            event_type="GRANT",
            overlap_start=today,
            overlap_end=today + timedelta(days=10),
            credit_days=10,
            request_id=str(uuid4()),
        )
        db.add(event)
        await db.commit()
        event_id = event.id
        command, preview = await command_for(
            db, enrollment_id, today + timedelta(days=40), strategy="KEEP_CURRENT"
        )
        first = next(
            c for c in preview.plan.charges if c.cycle_no == preview.plan.first_cycle
        )
        assert first.due_date == first.coverage.start + timedelta(days=10)
        await apply_billing_schedule(db, enrollment_id, command, actor_user_id=None)
        await apply_billing_schedule(db, enrollment_id, command, actor_user_id=None)
        allocations = list(
            (
                await db.scalars(
                    select(ServiceCreditAllocation).where(
                        ServiceCreditAllocation.credit_event_id == event_id
                    )
                )
            ).all()
        )
        assert len(allocations) == 1 and allocations[0].allocated_days == 10
        target = await db.get(FeeRecord, allocations[0].fee_record_id)
        assert target.adjusted_due_date == first.due_date
        _, records, _ = await load_billing_context(db, enrollment_id)
        initial = min(records, key=lambda f: f.cycle_no)
        assert initial.adjusted_due_date == today  # KEEP_CURRENT really keeps it.
        from sqlalchemy.exc import DBAPIError

        with pytest.raises(DBAPIError, match="exceeds event balance"):
            async with db.begin_nested():
                db.add(
                    ServiceCreditAllocation(
                        credit_event_id=event_id,
                        fee_record_id=target.id,
                        allocated_days=1,
                        applies_from=target.coverage_start,
                    )
                )
                await db.flush()


@pytest.mark.parametrize("kind", ["MONTHLY", "COURSE"])
async def test_stop_before_future_cutover_retains_the_old_final_cycle(
    monkeypatch, kind
):
    from app.core.config import settings
    from app.services.fee_cycle_service import ensure_final_cycle_for_stop

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    today = business_today()
    async with AsyncSessionLocal() as db:
        enrollment = await confirmed_enrollment(db, kind)
        enrollment_id = enrollment.id
        command, _ = await command_for(db, enrollment_id, today + timedelta(days=400))
        await apply_billing_schedule(db, enrollment_id, command, actor_user_id=None)
        current, _, _ = await load_billing_context(db, enrollment_id, lock=True)
        stop = today + timedelta(days=45)
        final = await ensure_final_cycle_for_stop(db, current, stopped_on=stop)
        assert final is not None and final.is_final_cycle
        assert final.coverage_start < stop and final.coverage_end == stop
        assert final.billing_anchor_date_snapshot == today
        assert final.base_amount == current.class_.base_fee
        assert await ensure_final_cycle_for_stop(db, current, stopped_on=stop) is final
        await db.rollback()


async def test_package_change_preserves_retained_schedule_after_review(monkeypatch):
    from app.core.config import settings
    from app.schemas.class_ import (
        ClassBillingCyclePreviewRequest,
        ClassBillingCycleUpdate,
    )
    from app.schemas.billing_anchor import BillingReviewResolveRequest
    from app.services.class_billing_cycle_service import (
        preview_class_billing_cycle,
        update_class_billing_cycle,
    )
    from app.services.billing_anchor_service import resolve_billing_review

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    today = business_today()
    async with AsyncSessionLocal() as db:
        enrollment = await confirmed_enrollment(db, "COURSE")
        enrollment_id, class_id = enrollment.id, UUID(str(enrollment.class_id))
        command, _ = await command_for(db, enrollment_id, today + timedelta(days=400))
        await apply_billing_schedule(db, enrollment_id, command, actor_user_id=None)
        current, _, _ = await load_billing_context(db, enrollment_id)
        segments = current.current_billing_revision.scheduled_segments
        waivers = current.current_billing_revision.waived_intervals
        draft = dict(billing_cycle_weeks=6, expected_version=current.class_.version)
        preview = await preview_class_billing_cycle(
            db, class_id, ClassBillingCyclePreviewRequest(**draft)
        )
        await update_class_billing_cycle(
            db,
            class_id,
            ClassBillingCycleUpdate(
                **draft,
                request_id=uuid4(),
                reason="Kiểm thử đổi thời lượng sau đổi mốc",
                expected_fingerprint=preview.preview_fingerprint,
            ),
            actor_user_id=None,
        )
        current, _, _ = await load_billing_context(db, enrollment_id)
        revision = current.current_billing_revision
        assert (
            revision.scheduled_segments == segments
            and revision.waived_intervals == waivers
        )
        await resolve_billing_review(
            db,
            UUID(str(revision.id)),
            BillingReviewResolveRequest(decision="CONFIRM"),
            actor_user_id=None,
        )
        current, _, _ = await load_billing_context(db, enrollment_id, lock=True)
        generated = await ensure_enrollment_cycles(
            db, current, up_to=today + timedelta(days=60)
        )
        assert generated and all(f.billing_cycle_weeks_snapshot == 4 for f in generated)
        await db.rollback()
