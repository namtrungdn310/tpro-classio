"""Reconcile explicit billing waivers without changing protected history.

The caller owns the enrollment lock and the surrounding financial command.
Academic-only edits are guarded separately: they must not silently change fees.
"""

from datetime import date, timedelta
from uuid import uuid4
from sqlalchemy import select
from app.models.enrollment_suspension import EnrollmentSuspension, SuspensionCommand
from app.models.enrollment_service_credit_event import (
    EnrollmentServiceCreditEvent as Event,
    ServiceCreditAllocation as Allocation,
)
from app.models.makeup import ClassScheduleAdjustment
from app.services.credit_service import enrollment_total_deferral_days
from app.services.suspension_union_service import (
    effective_preservation,
    load_pause_intervals,
)


async def plan_waiver_preservation(db, enrollment, plan):
    old_waivers = enrollment.current_billing_revision.waived_intervals or []
    new_waivers = [
        {"start": str(w.start), "end": str(w.end)}
        for w in (*plan.retained_waived_intervals, *plan.waived_intervals)
    ]
    if sorted(old_waivers, key=str) == sorted(new_waivers, key=str):
        return None
    pauses = await load_pause_intervals(db, enrollment)
    before = sum(i.days for i in effective_preservation(enrollment, pauses))
    after = sum(
        i.days
        for i in effective_preservation(
            enrollment, pauses, waived_intervals=new_waivers
        )
    )
    delta = after - before
    if not delta:
        return None
    # Never back-apply a reversal before the grant's actual allocation boundary.
    candidates = sorted(
        {
            c.coverage.start
            for c in plan.charges
            if c.coverage.start >= min(i.start for i in pauses)
        }
    )
    boundary = None
    for candidate in candidates:
        shift = await enrollment_total_deferral_days(
            db, enrollment.id, coverage_start=candidate, include_unallocated=True
        )
        if shift + delta >= 0:
            boundary = candidate
            break
    pending_only = boundary is None
    if boundary is None:
        boundaries = (
            await db.scalars(
                select(Allocation.applies_from)
                .join(Event, Event.id == Allocation.credit_event_id)
                .where(
                    Event.enrollment_id == enrollment.id,
                    Allocation.applies_from.is_not(None),
                )
            )
        ).all()
        boundary = max(
            [
                plan.business_date,
                *(i.start for i in pauses),
                *boundaries,
                *(c.coverage.start + timedelta(days=1) for c in plan.charges),
            ]
        )
    sid = await db.scalar(
        select(EnrollmentSuspension.id)
        .where(
            EnrollmentSuspension.enrollment_id == enrollment.id,
            EnrollmentSuspension.status == "ACTIVE",
        )
        .order_by(EnrollmentSuspension.id)
        .limit(1)
    )
    cid = (
        None
        if sid
        else await db.scalar(
            select(ClassScheduleAdjustment.id)
            .where(
                ClassScheduleAdjustment.class_id == enrollment.class_id,
                ClassScheduleAdjustment.status == "OPEN",
                ClassScheduleAdjustment.adjustment_kind == "CLASS_SUSPENSION",
            )
            .order_by(ClassScheduleAdjustment.id)
            .limit(1)
        )
    )
    return dict(
        delta_days=delta,
        applies_from=str(boundary),
        previous_days=before,
        preserved_days=after,
        pending_only=pending_only,
        enrollment_suspension_id=str(sid) if sid else None,
        class_adjustment_id=str(cid) if cid else None,
    )


async def append_waiver_preservation(
    db,
    enrollment,
    adjustment,
    *,
    request_id,
    actor_id,
    reason,
    action="WAIVER_RECONCILIATION",
):
    """Append only; allocation to the previewed fees happens in the caller."""
    if not adjustment:
        return
    command_id = str(uuid4())
    boundary = date.fromisoformat(adjustment["applies_from"])
    days = adjustment["delta_days"]
    db.add(
        SuspensionCommand(
            id=command_id,
            request_id=str(request_id),
            actor_id=str(actor_id)
            if actor_id
            else "00000000-0000-0000-0000-000000000000",
            enrollment_suspension_id=adjustment["enrollment_suspension_id"],
            class_adjustment_id=adjustment["class_adjustment_id"],
            payload=dict(
                action=action, enrollment_id=str(enrollment.id), reason=reason
            ),
            result=dict(
                **adjustment, pending_days=days if adjustment["pending_only"] else 0
            ),
            before_snapshot=dict(preserved_days=adjustment["previous_days"]),
        )
    )
    db.add(
        Event(
            enrollment_id=enrollment.id,
            class_id=enrollment.class_id,
            event_type="GRANT" if days > 0 else "REVERSAL",
            overlap_start=boundary,
            overlap_end=boundary,
            credit_days=abs(days),
            request_id=str(request_id),
            actor_user_id=actor_id,
            reason_snapshot="Đối chiếu bảo lưu: " + reason,
            suspension_command_id=command_id,
        )
    )
    await db.flush()


async def record_closed_preservation(db, enrollment, close_on, *, actor_id, reason):
    """Keep remaining compensation with the old enrollment, not the destination.

    A closed enrollment has no future collection target. Never recover days by
    pulling a paid/notified deadline back or by changing transfer money.
    """
    if close_on is None:
        return
    from types import SimpleNamespace
    from sqlalchemy import case, func
    from app.models.enrollment import Enrollment
    from sqlalchemy.orm import selectinload

    # Some close callers set ended_on before entering, others afterwards.
    member = await db.scalar(
        select(Enrollment)
        .where(Enrollment.id == enrollment.id)
        .options(
            selectinload(Enrollment.current_billing_revision),
            selectinload(Enrollment.class_),
        )
    )
    pauses = await load_pause_intervals(db, member)
    if not pauses:
        return
    # Ambiguous pre-migration grants remain visible as reconciliation in reports;
    # do not reclassify or consume those events during an unrelated membership edit.
    legacy = await db.scalar(
        select(Event.id)
        .join(
            ClassScheduleAdjustment, ClassScheduleAdjustment.id == Event.adjustment_id
        )
        .where(
            Event.enrollment_id == member.id,
            ClassScheduleAdjustment.adjustment_kind != "CLASS_SUSPENSION",
        )
        .limit(1)
    )
    if legacy:
        return
    view = SimpleNamespace(
        current_billing_revision=member.current_billing_revision,
        enrollment_date=member.enrollment_date,
        ended_on=close_on,
        class_=member.class_,
    )
    expected = sum(i.days for i in effective_preservation(view, pauses))
    net = int(
        await db.scalar(
            select(
                func.coalesce(
                    func.sum(
                        Event.credit_days
                        * case((Event.event_type == "REVERSAL", -1), else_=1)
                    ),
                    0,
                )
            ).where(Event.enrollment_id == member.id)
        )
        or 0
    )
    if expected >= net:
        return
    sid = await db.scalar(
        select(EnrollmentSuspension.id)
        .where(
            EnrollmentSuspension.enrollment_id == member.id,
            EnrollmentSuspension.status == "ACTIVE",
        )
        .order_by(EnrollmentSuspension.id)
        .limit(1)
    )
    cid = (
        None
        if sid
        else await db.scalar(
            select(ClassScheduleAdjustment.id)
            .where(
                ClassScheduleAdjustment.class_id == member.class_id,
                ClassScheduleAdjustment.status == "OPEN",
                ClassScheduleAdjustment.adjustment_kind == "CLASS_SUSPENSION",
            )
            .order_by(ClassScheduleAdjustment.id)
            .limit(1)
        )
    )
    await append_waiver_preservation(
        db,
        member,
        dict(
            delta_days=expected - net,
            applies_from=str(close_on),
            previous_days=net,
            preserved_days=expected,
            pending_only=True,
            enrollment_suspension_id=str(sid) if sid else None,
            class_adjustment_id=str(cid) if cid else None,
        ),
        request_id=uuid4(),
        actor_id=actor_id,
        reason=reason,
        action="MEMBERSHIP_CLOSED",
    )
