"""Dated exceptions shared by calendars, suspension and attendance.

Raw weekly expansion is deliberately kept separate: schedule editing needs
the template, whereas attendance must never rediscover a suppressed original.
"""

from datetime import datetime, timedelta
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import noload, raiseload, selectinload

from app.core.occurrence import apply_exceptions
from app.core.business_time import BUSINESS_TIMEZONE
from app.models.makeup import ClassScheduleAdjustment, ClassSessionException
from app.services.schedule_slot_service import expand_class_occurrences


def exception_payload(item):
    return {
        "id": item.id,
        "status": item.status,
        "original_start_at": item.original_start_at,
        "original_end_at": item.original_end_at,
        "replacement_start_at": item.replacement_start_at,
        "replacement_end_at": item.replacement_end_at,
        "source_slot_id": item.source_slot_id,
        "source_slot_key": item.staff_snapshots[0].source_slot_key
        if item.staff_snapshots
        else "",
        "staff_snapshots": [
            {"staff_id": s.staff_id, "role": s.role} for s in item.staff_snapshots
        ],
    }


async def load_exception_payloads(db, class_ids, *, range_start, range_end):
    if not class_ids:
        return {}
    rows = await db.scalars(
        select(ClassSessionException)
        .where(
            ClassSessionException.class_id.in_(class_ids),
            or_(
                and_(
                    ClassSessionException.original_start_at < range_end,
                    ClassSessionException.original_end_at > range_start,
                ),
                and_(
                    ClassSessionException.replacement_start_at < range_end,
                    ClassSessionException.replacement_end_at > range_start,
                ),
            ),
        )
        .options(raiseload("*"), selectinload(ClassSessionException.staff_snapshots))
        .execution_options(populate_existing=True)
    )
    by_class = {}
    for item in rows.unique().all():
        by_class.setdefault(str(item.class_id), []).append(exception_payload(item))
    # The service interval is authoritative even for slots added after the
    # original command. Do not manufacture makeup/audit rows on a calendar read.
    pauses = await db.scalars(
        select(ClassScheduleAdjustment)
        .where(
            ClassScheduleAdjustment.class_id.in_(class_ids),
            ClassScheduleAdjustment.adjustment_kind == "CLASS_SUSPENSION",
            ClassScheduleAdjustment.status == "OPEN",
            ClassScheduleAdjustment.affected_from
            <= range_end.astimezone(BUSINESS_TIMEZONE).date(),
            ClassScheduleAdjustment.affected_through
            >= range_start.astimezone(BUSINESS_TIMEZONE).date(),
        )
        .options(noload(ClassScheduleAdjustment.exceptions))
        .execution_options(populate_existing=True)
    )
    for pause in pauses.unique().all():
        by_class.setdefault(str(pause.class_id), []).append(
            {
                "suspension_window": (
                    datetime.combine(
                        pause.affected_from,
                        datetime.min.time(),
                        tzinfo=BUSINESS_TIMEZONE,
                    ),
                    datetime.combine(
                        pause.affected_through + timedelta(days=1),
                        datetime.min.time(),
                        tzinfo=BUSINESS_TIMEZONE,
                    ),
                ),
            }
        )
    return by_class


def overlay_occurrences(regular, payloads, *, class_id, range_start, range_end):
    windows = [p["suspension_window"] for p in payloads if "suspension_window" in p]
    regular = [
        o
        for o in regular
        if not any(start <= o.original_start_at < end for start, end in windows)
    ]
    return [
        item
        for item in apply_exceptions(regular, payloads, class_id=str(class_id))
        if item.original_start_at < range_end and item.original_end_at > range_start
    ]


async def expand_effective_occurrences(
    db, class_, *, range_start, range_end, payloads=None
):
    if payloads is None:
        by_class = await load_exception_payloads(
            db,
            [str(class_.id)],
            range_start=range_start,
            range_end=range_end,
        )
        payloads = by_class.get(str(class_.id), [])
    regular = await expand_class_occurrences(
        db, class_, range_start=range_start, range_end=range_end
    )
    return overlay_occurrences(
        regular,
        payloads,
        class_id=class_.id,
        range_start=range_start,
        range_end=range_end,
    )
