"""One interval calculator for class and membership service interruptions."""

from datetime import date, timedelta
from sqlalchemy import select
from app.core.suspension_days import (
    PauseInterval,
    preserved_intervals,
    preservation_change,
)
from app.models.makeup import ClassScheduleAdjustment
from app.models.enrollment_suspension import EnrollmentSuspension


async def load_pause_intervals(
    db, enrollment, *, exclude_individual=None, exclude_class=None
):
    by_enrollment = await load_pause_intervals_bulk(
        db,
        [enrollment],
        exclude_individual=exclude_individual,
        exclude_class=exclude_class,
    )
    return by_enrollment[str(enrollment.id)]


async def load_pause_intervals_bulk(
    db, enrollments, *, exclude_individual=None, exclude_class=None
):
    if not enrollments:
        return {}
    c, s = ClassScheduleAdjustment, EnrollmentSuspension
    classes = (
        await db.execute(
            select(c.id, c.class_id, c.affected_from, c.affected_through).where(
                c.class_id.in_({e.class_id for e in enrollments}),
                c.adjustment_kind == "CLASS_SUSPENSION",
                c.status == "OPEN",
            )
        )
    ).all()
    individuals = (
        await db.execute(
            select(s.id, s.enrollment_id, s.suspended_from, s.resume_on).where(
                s.enrollment_id.in_([e.id for e in enrollments]), s.status == "ACTIVE"
            )
        )
    ).all()
    common, private = {}, {}
    for row in classes:
        if str(row.id) != str(exclude_class):
            common.setdefault(str(row.class_id), []).append(
                PauseInterval(
                    row.affected_from, row.affected_through + timedelta(days=1)
                )
            )
    for row in individuals:
        if str(row.id) != str(exclude_individual):
            private.setdefault(str(row.enrollment_id), []).append(
                PauseInterval(row.suspended_from, row.resume_on)
            )
    return {
        str(e.id): [*common.get(str(e.class_id), []), *private.get(str(e.id), [])]
        for e in enrollments
    }


def effective_preservation(enrollment, intervals, *, waived_intervals=None):
    if getattr(enrollment, "status", None) == "cancelled":
        return ()
    revision = enrollment.current_billing_revision
    waived = []
    for item in (
        ((revision.waived_intervals if revision else []) or [])
        if waived_intervals is None
        else waived_intervals
    ):
        start, end = date.fromisoformat(item["start"]), date.fromisoformat(item["end"])
        if start < end:
            waived.append(PauseInterval(start, end))
    ends = [d for d in (enrollment.ended_on, enrollment.class_.stopped_on) if d]
    return preserved_intervals(
        intervals,
        admitted_on=enrollment.enrollment_date,
        ended_on=min(ends) if ends else None,
        waived=waived,
    )


async def added_class_days(
    db, enrollment, start, end, *, exclude_class=None, existing=None
):
    if existing is None:
        existing = await load_pause_intervals(
            db, enrollment, exclude_class=exclude_class
        )
    change = preservation_change(
        effective_preservation(enrollment, existing),
        effective_preservation(enrollment, [*existing, PauseInterval(start, end)]),
    )
    return sum(i.days for i in change.granted)
