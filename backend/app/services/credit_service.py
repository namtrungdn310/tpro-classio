"""Service-credit ledger (R6-D11/D12).

Whole-class suspension grants calendar-day membership overlap to every ACTIVE
enrollment; credit targets the first affected unprotected renewal cycle
(never cycle 0) and shifts adjusted due cumulatively from base anchors.
Reversals are negative linked events; consumed/protected credit requires
compensating future allocation.
"""

from datetime import date
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.billing_schedule import adjusted_due_after_deferral
from app.models.enrollment import Enrollment
from app.models.enrollment_service_credit_event import (
    EnrollmentServiceCreditEvent,
    ServiceCreditAllocation,
)
from app.models.fee_record import FeeRecord
from app.models.makeup import ClassScheduleAdjustment

GRANT = "GRANT"
REVERSAL = "REVERSAL"


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
) -> FeeRecord | None:
    """Kỳ tái thu đầu tiên có coverage bị ảnh hưởng và chưa protected.

    Materialize các cycle tương lai qua khoảng hoãn trước khi chọn target
    (generator là lazy window theo tháng hiện tại).
    """
    from app.services.fee_cycle_service import ensure_enrollment_cycles

    await ensure_enrollment_cycles(db, enrollment, up_to=materialize_through)
    result = await db.execute(
        select(FeeRecord)
        .where(
            FeeRecord.enrollment_id == enrollment.id,
            FeeRecord.cycle_no.is_not(None),
            FeeRecord.cycle_no > 0,
            FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
            FeeRecord.coverage_start >= affected_from,
        )
        .order_by(FeeRecord.cycle_no.asc())
    )
    candidates = list(result.scalars().unique().all())
    for record in candidates:
        if record.status == "PAID" or record.notified_at is not None:
            continue
        return record
    return None


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
    for enrollment in enrollments:
        if enrollment.status != "active":
            continue
        overlap = membership_overlap_days(
            enrollment.enrollment_date,
            (enrollment.ended_at.date() if enrollment.ended_at is not None else None),
            suspended_from,
            resume_on,
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
                overlap_end=resume_on,
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
            overlap_end=resume_on,
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
            )
        )
        # Shift target + mọi cycle sau (cumulative từ base anchor, không chain
        # adjusted date gây drift).
        total_deferral = await enrollment_total_deferral_days(db, enrollment.id)
        later_result = await db.execute(
            select(FeeRecord)
            .where(
                FeeRecord.enrollment_id == enrollment.id,
                FeeRecord.cycle_no.is_not(None),
                FeeRecord.cycle_no >= target.cycle_no,
                FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
            )
            .order_by(FeeRecord.cycle_no.asc())
        )
        for later in later_result.scalars().unique().all():
            if later.status == "PAID" or later.notified_at is not None:
                continue
            later.adjusted_due_date = adjusted_due_after_deferral(
                later.base_due_date
                or later.due_date
                or later.coverage_start
                or later.adjusted_due_date,
                total_deferral,
            )
        events.append(event)
    await db.flush()
    return events


async def enrollment_total_deferral_days(
    db: AsyncSession,
    enrollment_id: str,
) -> int:
    total = await db.scalar(
        select(func.coalesce(func.sum(ServiceCreditAllocation.allocated_days), 0))
        .join(
            EnrollmentServiceCreditEvent,
            EnrollmentServiceCreditEvent.id == ServiceCreditAllocation.credit_event_id,
        )
        .where(EnrollmentServiceCreditEvent.enrollment_id == enrollment_id)
    )
    return int(total or 0)
