"""Relational schedule-slot service (R6-D07, dev.md §5.1).

`class_schedule_slots` + `class_schedule_slot_staff` are the canonical
schedule source; `classes.schedule` JSON is a compatibility projection until
D19. Slots carry stable UUIDs, version and an effective range; editing hours
keeps the UUID and bumps the version; closing a slot sets `effective_until`
without touching history.
"""

from datetime import date, time

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_time import business_today
from app.models.class_ import Class
from app.models.class_schedule_slot import (
    ClassScheduleSlot,
    ClassScheduleSlotStaff,
)

WEEKDAY_TO_INDEX = {
    "Thứ 2": 0,
    "Thứ 3": 1,
    "Thứ 4": 2,
    "Thứ 5": 3,
    "Thứ 6": 4,
    "Thứ 7": 5,
    "Chủ Nhật": 6,
}
INDEX_TO_WEEKDAY = {index: day for day, index in WEEKDAY_TO_INDEX.items()}


async def load_class_slots(
    db: AsyncSession,
    class_id: str,
    *,
    effective_at: date | None = None,
) -> list[dict]:
    """Relational-first slot projection (JSON-slot shape + stable identity).

    Each slot dict: day/start/end/teacher_ids/assistant_ids + slot_id/version.
    """
    reference = effective_at or business_today()
    rows = await db.execute(
        select(ClassScheduleSlot)
        .where(
            ClassScheduleSlot.class_id == class_id,
            ClassScheduleSlot.effective_from <= reference,
            (ClassScheduleSlot.effective_until.is_(None))
            | (ClassScheduleSlot.effective_until > reference),
        )
        .order_by(ClassScheduleSlot.weekday, ClassScheduleSlot.local_start)
    )
    slots = list(rows.scalars().unique().all())
    if not slots:
        return []

    staff_rows = await db.execute(
        select(ClassScheduleSlotStaff).where(
            ClassScheduleSlotStaff.slot_id.in_([slot.id for slot in slots])
        )
    )
    staff_by_slot: dict[str, list[ClassScheduleSlotStaff]] = {}
    for staff in staff_rows.scalars().unique().all():
        staff_by_slot.setdefault(str(staff.slot_id), []).append(staff)

    projection: list[dict] = []
    for slot in slots:
        teacher_ids = [
            str(item.staff_id)
            for item in staff_by_slot.get(str(slot.id), [])
            if item.role == "TEACHER"
        ]
        assistant_ids = [
            str(item.staff_id)
            for item in staff_by_slot.get(str(slot.id), [])
            if item.role == "ASSISTANT"
        ]
        projection.append(
            {
                "day": slot.weekday,
                "start": _time_text(slot.local_start),
                "end": _time_text(slot.local_end),
                "teacher_ids": teacher_ids,
                "assistant_ids": assistant_ids,
                "slot_id": str(slot.id),
                "version": slot.version,
            }
        )
    return projection


def _time_text(value: time) -> str:
    return value.strftime("%H:%M")


async def sync_class_slots(
    db: AsyncSession,
    class_: Class,
    schedule: dict | None,
    *,
    effective_from: date | None = None,
) -> None:
    """Dual-write the relational slot projection from a class schedule payload.

    Identity rules: a slot whose (weekday, start) still exists keeps its UUID;
    time changes bump the version; removed slots are closed
    (`effective_until = today`) instead of deleted; new slots are inserted.
    """
    reference = effective_from or business_today()
    requested = _normalize_slot_payload(schedule)

    existing_rows = await db.execute(
        select(ClassScheduleSlot).where(
            ClassScheduleSlot.class_id == class_.id,
            (ClassScheduleSlot.effective_until.is_(None))
            | (ClassScheduleSlot.effective_until > reference),
        )
    )
    existing = list(existing_rows.scalars().unique().all())
    existing_by_key: dict[tuple, ClassScheduleSlot] = {}
    existing_by_weekday: dict[str, list[ClassScheduleSlot]] = {}
    for slot in existing:
        key = (str(slot.weekday), _time_text(slot.local_start))
        existing_by_key.setdefault(key, slot)
        existing_by_weekday.setdefault(str(slot.weekday), []).append(slot)

    # Xác định slot mục tiêu cho từng slot yêu cầu (exact key trước, rồi
    # weekday-single heuristic cho trường hợp sửa giờ).
    claimed: set[str] = set()
    targets: list[tuple[dict, ClassScheduleSlot | None]] = []
    for item in requested:
        key = (item["day"], item["start"])
        target = existing_by_key.get(key)
        if target is None:
            weekday_matches = existing_by_weekday.get(item["day"], [])
            if len(weekday_matches) == 1:
                target = weekday_matches[0]
        if target is not None:
            claimed.add(str(target.id))
        targets.append((item, target))

    # Đóng các slot cũ không còn được claim — không bao giờ xóa history.
    for slot in existing:
        if str(slot.id) in claimed:
            continue
        if slot.effective_until is None:
            slot.effective_until = reference

    for item, current in targets:
        if current is None:
            current = ClassScheduleSlot(
                class_id=class_.id,
                weekday=item["day"],
                local_start=_parse_time(item["start"]),
                local_end=_parse_time(item["end"]),
                timezone="Asia/Ho_Chi_Minh",
                version=1,
                effective_from=reference,
            )
            db.add(current)
            await db.flush()
        elif current.local_start != _parse_time(
            item["start"]
        ) or current.local_end != _parse_time(item["end"]):
            # Sửa giờ: giữ UUID, tăng version.
            current.local_start = _parse_time(item["start"])
            current.local_end = _parse_time(item["end"])
            current.version += 1
            current.updated_at = __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            )
        await _replace_slot_staff(db, current, item)

    await db.flush()


async def _replace_slot_staff(
    db: AsyncSession,
    slot: ClassScheduleSlot,
    item: dict,
) -> None:
    teacher_ids = [str(value) for value in item.get("teacher_ids") or []]
    assistant_ids = [str(value) for value in item.get("assistant_ids") or []]
    await db.execute(
        delete(ClassScheduleSlotStaff).where(ClassScheduleSlotStaff.slot_id == slot.id)
    )
    for staff_id in teacher_ids:
        db.add(
            ClassScheduleSlotStaff(slot_id=slot.id, staff_id=staff_id, role="TEACHER")
        )
    for staff_id in assistant_ids:
        db.add(
            ClassScheduleSlotStaff(slot_id=slot.id, staff_id=staff_id, role="ASSISTANT")
        )


def _normalize_slot_payload(schedule: dict | None) -> list[dict]:
    if not schedule:
        return []
    raw_slots = schedule.get("slots") or []
    normalized: list[dict] = []
    for slot in raw_slots:
        if not isinstance(slot, dict):
            continue
        day = slot.get("day")
        start = slot.get("start")
        end = slot.get("end")
        if day not in WEEKDAY_TO_INDEX or not start or not end:
            continue
        normalized.append(
            {
                "day": day,
                "start": start,
                "end": end,
                "teacher_ids": [str(value) for value in slot.get("teacher_ids") or []],
                "assistant_ids": [
                    str(value) for value in slot.get("assistant_ids") or []
                ],
            }
        )
    return normalized


def _parse_time(value: str) -> time:
    hour, minute = (int(part) for part in value.split(":"))
    return time(hour, minute)


async def expand_class_occurrences(
    db: AsyncSession,
    class_: Class,
    *,
    range_start,
    range_end,
) -> list:
    """Occurrence expansion từ nguồn relational (fallback JSON compat).

    R6-D07: canonical source là `class_schedule_slots`; `classes.schedule`
    chỉ là compatibility projection (retire tại D19).
    """

    from app.core.occurrence import expand_weekly_occurrences

    slots = await load_class_slots(db, str(class_.id))
    schedule_payload: dict | None = None
    schedule_text = (
        class_.schedule.get("text", "") if isinstance(class_.schedule, dict) else ""
    )
    if slots:
        schedule_payload = {
            "text": schedule_text,
            "slots": slots,
        }
    elif class_.schedule is not None:
        # Legacy class chưa được dual-write: dùng JSON làm nguồn tạm.
        schedule_payload = (
            class_.schedule if isinstance(class_.schedule, dict) else None
        )

    return expand_weekly_occurrences(
        class_id=str(class_.id),
        schedule=schedule_payload,
        start_date=class_.start_date,
        end_date=class_.end_date,
        range_start=range_start,
        range_end=range_end,
    )
