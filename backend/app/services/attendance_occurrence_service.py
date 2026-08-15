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
from app.models.class_schedule_slot import ClassScheduleSlotStaff
from app.models.class_ import Class
from app.services.schedule_slot_service import expand_class_occurrences


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


async def resolve_occurrence_for_staff(
    db: AsyncSession,
    occurrence_id: UUID,
    staff_id: str,
) -> StaffOccurrence | None:
    """Find the canonical occurrence matching the requested occurrence id."""
    range_start = datetime.now(timezone.utc) - timedelta(days=2)
    range_end = datetime.now(timezone.utc) + timedelta(days=7)
    result = await db.execute(
        select(Class).where(
            Class.is_active.is_(True),
            Class.cancelled_at.is_(None),
        )
    )
    for class_ in result.scalars().unique().all():
        occurrences = await expand_class_occurrences(
            db,
            class_,
            range_start=range_start,
            range_end=range_end,
        )
        for occurrence in occurrences:
            if attendance_occurrence_id(occurrence.key) != occurrence_id:
                continue
            if occurrence.source_slot_id is None:
                continue
            assignment = await db.scalar(
                select(ClassScheduleSlotStaff.role).where(
                    ClassScheduleSlotStaff.slot_id == occurrence.source_slot_id,
                    ClassScheduleSlotStaff.staff_id == staff_id,
                )
            )
            if assignment is None:
                continue
            return StaffOccurrence(occurrence, assignment, occurrence.source_slot_id)
    return None


async def teacher_today_occurrences(db: AsyncSession, staff_id: str):
    """Occurrences hôm nay + upcoming 7 ngày assigned tới staff; kèm checkins."""
    from app.models.staff_attendance import StaffAttendanceEntry

    today = business_today()
    range_start = datetime.combine(today, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE)
    range_end = range_start + timedelta(days=7)
    result = await db.execute(
        select(Class).where(
            Class.is_active.is_(True),
            Class.cancelled_at.is_(None),
        )
    )
    occurrences = []
    checkins = []
    for class_ in result.scalars().unique().all():
        expanded = await expand_class_occurrences(
            db,
            class_,
            range_start=range_start,
            range_end=range_end,
        )
        for occurrence in expanded:
            if occurrence.source_slot_id is None:
                continue
            assignment = await db.scalar(
                select(ClassScheduleSlotStaff.role).where(
                    ClassScheduleSlotStaff.slot_id == occurrence.source_slot_id,
                    ClassScheduleSlotStaff.staff_id == staff_id,
                )
            )
            if assignment is None:
                continue
            checkin = await db.scalar(
                select(StaffAttendanceEntry).where(
                    StaffAttendanceEntry.staff_id == staff_id,
                    StaffAttendanceEntry.occurrence_slot_id
                    == occurrence.source_slot_id,
                    StaffAttendanceEntry.occurrence_start_at
                    == occurrence.original_start_at,
                )
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
