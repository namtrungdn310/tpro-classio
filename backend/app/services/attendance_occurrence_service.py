"""Occurrence resolution for teacher attendance (R6-D16).

Resolves the canonical occurrence (regular or makeup) a staff member is
assigned to, based on slot assignment (class_schedule_slot_staff) and dated
exceptions.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_time import BUSINESS_TIMEZONE, business_today
from app.models.class_schedule_slot import (
    ClassScheduleSlotStaff,
    ClassScheduleSlotStaffRevision,
)
from app.models.class_ import Class
from app.services.effective_occurrence_service import (
    expand_effective_occurrences,
    load_exception_payloads,
)


class StaffOccurrence:
    def __init__(self, occurrence, staff_role: str, slot_id: str):
        self.occurrence = occurrence
        self.staff_role = staff_role
        self.slot_id = slot_id
        self.class_id = occurrence.class_id
        self.original_start_at = occurrence.original_start_at
        self.original_end_at = occurrence.original_end_at
        self.kind = occurrence.kind


# Public occurrence identifiers must be stable, opaque UUIDs because the HTTP
# route is UUID-typed.  Never expose/parse the internal ``class_id:timestamp``
# key in a URL.
ATTENDANCE_OCCURRENCE_NAMESPACE = UUID("a895fb18-e0b4-4c37-a064-6961c0be88fd")


def attendance_occurrence_id(occurrence_key: str) -> UUID:
    return uuid5(ATTENDANCE_OCCURRENCE_NAMESPACE, occurrence_key)


async def _assignment_role_at_occurrence(
    db: AsyncSession,
    *,
    occurrence,
    slot_id: str,
    staff_id: str,
) -> str | None:
    # Dated makeup occurrences already carry an immutable staff snapshot.
    if occurrence.kind == "MAKEUP":
        if staff_id in occurrence.teacher_ids:
            return "TEACHER"
        if staff_id in occurrence.assistant_ids:
            return "ASSISTANT"
        return None

    role = await db.scalar(
        select(ClassScheduleSlotStaffRevision.role)
        .where(
            ClassScheduleSlotStaffRevision.slot_id == slot_id,
            ClassScheduleSlotStaffRevision.staff_id == staff_id,
            ClassScheduleSlotStaffRevision.effective_from
            <= occurrence.original_start_at,
            (ClassScheduleSlotStaffRevision.effective_until.is_(None))
            | (
                ClassScheduleSlotStaffRevision.effective_until
                > occurrence.original_start_at
            ),
        )
        .order_by(ClassScheduleSlotStaffRevision.effective_from.desc())
        .limit(1)
    )
    if role is not None:
        return role
    has_revision = await db.scalar(
        select(ClassScheduleSlotStaffRevision.id)
        .where(
            ClassScheduleSlotStaffRevision.slot_id == slot_id,
            ClassScheduleSlotStaffRevision.staff_id == staff_id,
        )
        .limit(1)
    )
    if has_revision is not None:
        return None
    # Compatibility fallback only for assignments not backfilled yet while
    # migration 122 is being rolled out.
    return await db.scalar(
        select(ClassScheduleSlotStaff.role).where(
            ClassScheduleSlotStaff.slot_id == slot_id,
            ClassScheduleSlotStaff.staff_id == staff_id,
        )
    )


async def resolve_occurrence_for_staff(
    db: AsyncSession,
    occurrence_id: UUID,
    staff_id: str,
    *,
    days_before: int = 2,
    days_after: int = 7,
    for_update: bool = False,
) -> StaffOccurrence | None:
    """Find the canonical occurrence matching the requested occurrence id."""
    range_start = datetime.now(timezone.utc) - timedelta(days=days_before)
    range_end = datetime.now(timezone.utc) + timedelta(days=days_after)
    result = await db.execute(
        select(Class).where(
            Class.is_active.is_(True),
            Class.cancelled_at.is_(None),
        )
    )
    classes = result.scalars().unique().all()
    payloads = await load_exception_payloads(
        db,
        [str(c.id) for c in classes],
        range_start=range_start,
        range_end=range_end,
    )
    for class_ in classes:
        occurrences = await expand_effective_occurrences(
            db,
            class_,
            range_start=range_start,
            range_end=range_end,
            payloads=payloads.get(str(class_.id), []),
        )
        for occurrence in occurrences:
            if attendance_occurrence_id(occurrence.key) != occurrence_id:
                continue
            if occurrence.source_slot_id is None:
                continue
            if for_update:
                # The same class lock is acquired by suspension/makeup commands.
                # Re-read the overlay after waiting, never trust the earlier list.
                locked_class = await db.scalar(
                    select(Class)
                    .where(Class.id == class_.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                if (
                    locked_class is None
                    or not locked_class.is_active
                    or locked_class.cancelled_at
                ):
                    return None
                current = await expand_effective_occurrences(
                    db,
                    locked_class,
                    range_start=range_start,
                    range_end=range_end,
                )
                occurrence = next(
                    (
                        o
                        for o in current
                        if attendance_occurrence_id(o.key) == occurrence_id
                    ),
                    None,
                )
                if occurrence is None or occurrence.source_slot_id is None:
                    return None
            assignment = await _assignment_role_at_occurrence(
                db,
                occurrence=occurrence,
                slot_id=occurrence.source_slot_id,
                staff_id=staff_id,
            )
            if assignment is None:
                continue
            return StaffOccurrence(occurrence, assignment, occurrence.source_slot_id)
    return None


async def teacher_today_occurrences(db: AsyncSession, staff_id: str):
    """Occurrences hôm nay + upcoming 7 ngày assigned tới staff; kèm checkins."""
    from app.models.staff_attendance import StaffAttendanceEntry
    from app.services.schedule_slot_service import expand_class_occurrences_bulk
    from app.services.effective_occurrence_service import overlay_occurrences

    today = business_today()
    range_start = datetime.combine(today, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE)
    range_end = range_start + timedelta(days=7)
    result = await db.execute(
        select(Class.id).where(
            Class.is_active.is_(True),
            Class.cancelled_at.is_(None),
        )
    )
    occurrences = []
    checkins = []
    class_ids = [str(cid) for cid in result.scalars().all()]
    payloads = await load_exception_payloads(
        db,
        class_ids,
        range_start=range_start,
        range_end=range_end,
    )
    regular = await expand_class_occurrences_bulk(
        db, class_ids, range_start=range_start, range_end=range_end
    )
    entries = (
        await db.scalars(
            select(StaffAttendanceEntry).where(
                StaffAttendanceEntry.staff_id == staff_id,
                StaffAttendanceEntry.occurrence_start_at >= range_start,
                StaffAttendanceEntry.occurrence_start_at < range_end,
                StaffAttendanceEntry.reversed_at.is_(None),
            )
        )
    ).all()
    by_occurrence = {
        (str(e.occurrence_slot_id), e.occurrence_start_at): e for e in entries
    }
    for class_id in class_ids:
        expanded = overlay_occurrences(
            regular.get(class_id, []),
            payloads.get(class_id, []),
            class_id=class_id,
            range_start=range_start,
            range_end=range_end,
        )
        for occurrence in expanded:
            if occurrence.source_slot_id is None:
                continue
            # Dated expansion already applied the assignment history, and makeup
            # expansion uses the immutable staff snapshot rather than today's links.
            if str(staff_id) not in {
                *occurrence.teacher_ids,
                *occurrence.assistant_ids,
            }:
                continue
            checkin = by_occurrence.get(
                (str(occurrence.source_slot_id), occurrence.original_start_at)
            )
            occurrences.append(
                {
                    "occurrence_id": str(attendance_occurrence_id(occurrence.key)),
                    "key": occurrence.key,
                    "kind": occurrence.kind,
                    "original_start_at": occurrence.original_start_at,
                    "original_end_at": occurrence.original_end_at,
                    "status": occurrence.status,
                }
            )
            if checkin is not None:
                checkins.append(
                    {
                        "key": occurrence.key,
                        "checkin_at": checkin.checkin_at,
                        "rate_amount": int(checkin.rate_amount),
                    }
                )
    return occurrences, checkins
