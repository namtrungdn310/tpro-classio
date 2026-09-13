"""Batch-load authoritative deferral dates for synchronous billing projections."""

from sqlalchemy import case, func, select
from app.models.enrollment_service_credit_event import (
    EnrollmentServiceCreditEvent as Event,
    ServiceCreditAllocation as Allocation,
)


async def attach_deferral_context(db, enrollments):
    by_id = {str(enrollment.id): enrollment for enrollment in enrollments}
    if not by_id:
        return
    for enrollment in by_id.values():
        enrollment.billing_deferral_windows = []
    effective = func.coalesce(Allocation.applies_from, Event.overlap_start)
    rows = (
        await db.execute(
            select(
                Event.enrollment_id,
                effective.label("effective"),
                func.sum(
                    Allocation.allocated_days
                    * case(
                        (Event.event_type == "REVERSAL", -1),
                        else_=1,
                    )
                ).label("days"),
            )
            .join(Allocation, Allocation.credit_event_id == Event.id)
            .where(
                Event.enrollment_id.in_(by_id),
            )
            .group_by(Event.enrollment_id, effective)
        )
    ).all()
    for row in rows:
        by_id[str(row.enrollment_id)].billing_deferral_windows.append(
            (row.effective, int(row.days))
        )
