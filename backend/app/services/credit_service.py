"""Service-credit ledger (R6-D11/D12).

Whole-class suspension grants calendar-day membership overlap to every ACTIVE
enrollment; credit targets the first affected unprotected renewal cycle
(never cycle 0) and shifts adjusted due cumulatively from base anchors.
Reversals are negative linked events; consumed/protected credit requires
compensating future allocation.
"""

from datetime import date, timedelta
from dataclasses import replace
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.billing_schedule import adjusted_due_after_deferral
from app.models.enrollment import Enrollment
from app.models.enrollment_service_credit_event import (
    EnrollmentServiceCreditEvent,
    ServiceCreditAllocation,
)
from app.models.fee_record import FeeRecord
from app.models.makeup import ClassScheduleAdjustment
from app.services.fee_reconciliation import is_fee_record_protected
from app.services.suspension_payment_protection import is_suspension_fee_protected

GRANT = "GRANT"
REVERSAL = "REVERSAL"


def deferral_from_events(events, coverage_start, *, include_unallocated=False):
    """Same signed boundary calculation for an already batch-loaded snapshot."""
    days = 0
    for event in events:
        sign = -1 if event.event_type == REVERSAL else 1
        days += sign * sum(
            a.allocated_days
            for a in event.allocations
            if (a.applies_from or event.overlap_start) <= coverage_start
        )
        if include_unallocated and event.overlap_start <= coverage_start:
            days += sign * (
                event.credit_days - sum(a.allocated_days for a in event.allocations)
            )
    return days


def membership_overlap_days(
    enrollment_date: date | None,
    ended_date: date | None,
    suspended_from: date,
    resume_on: date,
) -> int:
    """Half-open [suspended_from, resume_on) x active membership interval."""
    if enrollment_date is None:
        return 0
    interval_start = max(suspended_from, enrollment_date)
    interval_end = resume_on
    if ended_date is not None and ended_date < interval_end:
        interval_end = ended_date
    if interval_end <= interval_start:
        return 0
    return (interval_end - interval_start).days


async def _first_unprotected_renewal_cycle(
    db: AsyncSession,
    enrollment: Enrollment,
    affected_from: date,
    materialize_through: date,
    *,
    days: int | None = None,
) -> FeeRecord | None:
    """Materialize only through the target chosen by the read-only planner."""
    from app.services.fee_cycle_service import ensure_enrollment_cycles
    from app.services.suspension_billing_plan import (
        plan_renewal_target,
        plan_credit_delta_target,
    )

    target = (
        await plan_credit_delta_target(db, enrollment, affected_from, days)
        if days is not None
        else plan_renewal_target(enrollment, affected_from)
    )
    if target is None:
        return None
    if target.record is not None:
        return target.record
    await ensure_enrollment_cycles(db, enrollment, up_to=target.coverage_start)
    candidates = (
        await db.scalars(
            select(FeeRecord)
            .where(
                FeeRecord.enrollment_id == enrollment.id,
                FeeRecord.cycle_no > 0,
                FeeRecord.status == "UNPAID",
                FeeRecord.coverage_start == target.coverage_start,
            )
            .options(selectinload(FeeRecord.payments))
            .order_by(FeeRecord.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).all()
    for record in candidates:
        if (
            not is_suspension_fee_protected(enrollment, record)
            and not record.review_required
        ):
            return record
    # A planner/generator disagreement must rollback, never silently grant to
    # another period than the one shown on the confirmation screen.
    raise RuntimeError("Suspension target no longer matches the confirmed renewal plan")


async def grant_whole_class_credit(
    db: AsyncSession,
    *,
    class_id: str,
    adjustment: ClassScheduleAdjustment,
    enrollments: list[Enrollment],
    suspended_from: date,
    resume_on: date,
    request_id: UUID,
    actor_user_id: str | None,
) -> list[EnrollmentServiceCreditEvent]:
    """Grant overlap credit to every ACTIVE enrollment (whole-class pause)."""
    events: list[EnrollmentServiceCreditEvent] = []
    stale_fee_ids: list[str] = []
    before_snapshots, after_snapshots = [], []
    from app.services.fee_operation_service import (
        append_fee_operation,
        snapshot_fee_record,
    )

    from app.services.suspension_union_service import (
        added_class_days,
        load_pause_intervals_bulk,
    )

    pauses = await load_pause_intervals_bulk(
        db, enrollments, exclude_class=adjustment.id
    )
    for enrollment in enrollments:
        if enrollment.status == "cancelled":
            continue
        overlap = await added_class_days(
            db,
            enrollment,
            suspended_from,
            resume_on,
            existing=pauses[str(enrollment.id)],
        )
        if overlap <= 0:
            continue
        target = await _first_unprotected_renewal_cycle(
            db,
            enrollment,
            affected_from=suspended_from,
            materialize_through=resume_on,
        )
        if target is None:
            # Protected carry/compensation: không mutate protected record;
            # ghi event không allocation (review sau).
            event = EnrollmentServiceCreditEvent(
                enrollment_id=enrollment.id,
                class_id=class_id,
                adjustment_id=adjustment.id,
                event_type=GRANT,
                overlap_start=max(suspended_from, enrollment.enrollment_date),
                overlap_end=min(resume_on, enrollment.ended_on or resume_on),
                credit_days=overlap,
                request_id=request_id,
                actor_user_id=actor_user_id,
            )
            db.add(event)
            events.append(event)
            continue
        event = EnrollmentServiceCreditEvent(
            enrollment_id=enrollment.id,
            class_id=class_id,
            adjustment_id=adjustment.id,
            event_type=GRANT,
            overlap_start=max(suspended_from, enrollment.enrollment_date),
            overlap_end=min(resume_on, enrollment.ended_on or resume_on),
            credit_days=overlap,
            request_id=request_id,
            actor_user_id=actor_user_id,
        )
        db.add(event)
        await db.flush()
        db.add(
            ServiceCreditAllocation(
                credit_event_id=event.id,
                fee_record_id=target.id,
                allocated_days=overlap,
                applies_from=target.coverage_start,
            )
        )
        # Shift target + mọi cycle sau (cumulative từ base anchor, không chain
        # adjusted date gây drift).
        await db.flush()
        later_result = await db.execute(
            select(FeeRecord)
            .where(
                FeeRecord.enrollment_id == enrollment.id,
                FeeRecord.cycle_no.is_not(None),
                FeeRecord.coverage_start >= target.coverage_start,
                FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
            )
            .options(selectinload(FeeRecord.payments))
            .order_by(FeeRecord.coverage_start.asc(), FeeRecord.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        for later in later_result.scalars().unique().all():
            if is_suspension_fee_protected(enrollment, later) or later.review_required:
                continue
            old_due = later.adjusted_due_date or later.base_due_date or later.due_date
            before_snapshot = replace(snapshot_fee_record(later), due_date=old_due)
            total_deferral = await enrollment_total_deferral_days(
                db,
                enrollment.id,
                coverage_start=later.coverage_start,
            )
            later.adjusted_due_date = adjusted_due_after_deferral(
                later.base_due_date
                or later.due_date
                or later.coverage_start
                or later.adjusted_due_date,
                total_deferral,
            ) + timedelta(
                days=int(getattr(later, "collection_due_offset_days", 0) or 0)
            )
            if later.adjusted_due_date != old_due:
                stale_fee_ids.append(later.id)
                before_snapshots.append(before_snapshot)
                after_snapshots.append(
                    replace(
                        snapshot_fee_record(later), due_date=later.adjusted_due_date
                    )
                )
        events.append(event)
    if stale_fee_ids:
        await append_fee_operation(
            db,
            action="due_date_change",
            before=before_snapshots,
            after=after_snapshots,
            actor_id=actor_user_id,
            request_id=request_id,
            origin="application",
            reason="Dời ngày thu theo ngày nghỉ bảo lưu của lớp",
        )
        # A due-date adjustment changes the payment-request snapshot.  Revoke
        # open references atomically; paid/reviewed requests remain history.
        from app.services.payment_scaffold_service import (
            revoke_open_payment_requests_for_fee_records,
        )

        await revoke_open_payment_requests_for_fee_records(
            db,
            stale_fee_ids,
            actor_id=actor_user_id,
            reason="Kỳ thu đã thay đổi do hoãn lớp; cần tạo mã mới",
        )
    await db.flush()
    return events


async def enrollment_total_deferral_days(
    db: AsyncSession,
    enrollment_id: str,
    *,
    coverage_start: date | None = None,
    include_unallocated: bool = False,
) -> int:
    query = (
        select(
            func.coalesce(
                func.sum(
                    ServiceCreditAllocation.allocated_days
                    * case(
                        (EnrollmentServiceCreditEvent.event_type == REVERSAL, -1),
                        else_=1,
                    )
                ),
                0,
            )
        )
        .join(
            EnrollmentServiceCreditEvent,
            EnrollmentServiceCreditEvent.id == ServiceCreditAllocation.credit_event_id,
        )
        .where(EnrollmentServiceCreditEvent.enrollment_id == enrollment_id)
    )
    if coverage_start is not None:
        query = query.where(
            func.coalesce(
                ServiceCreditAllocation.applies_from,
                EnrollmentServiceCreditEvent.overlap_start,
            )
            <= coverage_start
        )
    total = await db.scalar(query)
    days = int(total or 0)
    if include_unallocated:
        for event, remaining in await pending_service_credits(db, enrollment_id):
            if coverage_start is None or event.overlap_start <= coverage_start:
                days += remaining
    return days


async def pending_service_credits(db, enrollment_id):
    """Signed unallocated balance; existing events/allocations are immutable."""
    event = EnrollmentServiceCreditEvent
    remaining = event.credit_days - func.coalesce(
        func.sum(ServiceCreditAllocation.allocated_days), 0
    )
    rows = (
        await db.execute(
            select(event, remaining.label("remaining"))
            .outerjoin(
                ServiceCreditAllocation,
                ServiceCreditAllocation.credit_event_id == event.id,
            )
            .where(event.enrollment_id == enrollment_id)
            .group_by(event.id)
            .having(remaining > 0)
            .order_by(event.overlap_start, event.id)
        )
    ).all()
    return [
        (row[0], int(row[1]) * (-1 if row[0].event_type == REVERSAL else 1))
        for row in rows
    ]


async def allocate_pending_service_credits(db, enrollment_id, created_records):
    """Caller holds the enrollment/class lock. Only newly previewed/generated
    obligations receive carry; kept/paid records and old ledger rows stay intact.
    """
    if not created_records:
        return
    changed = False
    eligible = sorted(
        (
            r
            for r in created_records
            if r.cycle_no > 0
            and r.status == "UNPAID"
            and not r.review_required
            and not is_fee_record_protected(r)
        ),
        key=lambda r: (r.coverage_start, str(r.id)),
    )
    for event, remaining in await pending_service_credits(db, enrollment_id):
        target = next(
            (r for r in eligible if r.coverage_start >= event.overlap_start), None
        )
        if target is not None:
            db.add(
                ServiceCreditAllocation(
                    credit_event_id=event.id,
                    fee_record_id=target.id,
                    allocated_days=abs(remaining),
                    applies_from=target.coverage_start,
                )
            )
            changed = True
    if changed:
        await db.flush()
        for record in eligible:
            days = await enrollment_total_deferral_days(
                db, enrollment_id, coverage_start=record.coverage_start
            )
            if days < 0:
                from fastapi import HTTPException

                raise HTTPException(
                    409, "Số ngày bảo lưu cần kiểm tra trước khi tạo kỳ thu"
                )
            record.adjusted_due_date = adjusted_due_after_deferral(
                record.base_due_date, days
            ) + timedelta(
                days=int(getattr(record, "collection_due_offset_days", 0) or 0)
            )
        await db.flush()


async def apply_individual_credit_delta(
    db,
    enrollment,
    *,
    days,
    affected_from,
    overlap_end,
    request_id,
    command_id,
    actor_id,
    reason,
    audit_collector=None,
):
    """Apply one signed union difference; never pull a protected deadline back.

    A reversal takes effect only from the next editable target chosen in preview.
    Original grants stay in the ledger; the command's before snapshot links the
    correction to the source pause and to the credit history used for calculation.
    """
    if not days:
        return
    target = await _first_unprotected_renewal_cycle(
        db, enrollment, affected_from, overlap_end, days=days
    )
    event = EnrollmentServiceCreditEvent(
        enrollment_id=enrollment.id,
        class_id=enrollment.class_id,
        event_type=GRANT if days > 0 else REVERSAL,
        overlap_start=affected_from,
        overlap_end=max(affected_from, overlap_end),
        credit_days=abs(days),
        request_id=str(request_id),
        actor_user_id=actor_id,
        reason_snapshot=reason,
        suspension_command_id=command_id,
    )
    db.add(event)
    await db.flush()
    if target is None:
        return
    db.add(
        ServiceCreditAllocation(
            credit_event_id=event.id,
            fee_record_id=target.id,
            allocated_days=abs(days),
            applies_from=target.coverage_start,
        )
    )
    await db.flush()
    rows = (
        await db.scalars(
            select(FeeRecord)
            .where(
                FeeRecord.enrollment_id == enrollment.id,
                FeeRecord.cycle_no > 0,
                FeeRecord.coverage_start >= target.coverage_start,
                FeeRecord.status == "UNPAID",
            )
            .options(selectinload(FeeRecord.payments))
            .order_by(FeeRecord.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).all()
    from app.services.fee_operation_service import (
        append_fee_operation,
        snapshot_fee_record,
    )

    before, after, changed = [], [], []
    for record in rows:
        if is_suspension_fee_protected(enrollment, record) or record.review_required:
            continue
        total = await enrollment_total_deferral_days(
            db, enrollment.id, coverage_start=record.coverage_start
        )
        if total < 0:
            # Corrupt/legacy unmatched grants must not become an earlier bill.
            from fastapi import HTTPException

            raise HTTPException(
                409,
                "Số ngày bảo lưu cần kiểm tra lại trước khi điều chỉnh lần hoãn này",
            )
        old = record.adjusted_due_date or record.base_due_date or record.due_date
        new = adjusted_due_after_deferral(
            record.base_due_date or record.due_date, total
        ) + timedelta(days=int(record.collection_due_offset_days or 0))
        if new != old:
            before.append(replace(snapshot_fee_record(record), due_date=old))
            record.adjusted_due_date = new
            after.append(replace(snapshot_fee_record(record), due_date=new))
            changed.append(record.id)
    if changed:
        if audit_collector is not None:
            audit_collector[0].extend(before)
            audit_collector[1].extend(after)
        else:
            await append_fee_operation(
                db,
                action="due_date_change",
                before=before,
                after=after,
                actor_id=actor_id,
                request_id=request_id,
                origin="application",
                reason=reason,
            )
        from app.services.payment_scaffold_service import (
            revoke_open_payment_requests_for_fee_records,
        )

        await revoke_open_payment_requests_for_fee_records(
            db,
            changed,
            actor_id=actor_id,
            reason="Ngày thu thay đổi do điều chỉnh hoãn học; cần tạo mã mới",
        )
    await db.flush()
