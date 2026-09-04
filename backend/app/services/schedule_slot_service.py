"""Relational schedule-slot service (R6-D07, dev.md §5.1).

`class_schedule_slots` + `class_schedule_slot_staff` are the canonical
schedule source; `classes.schedule` JSON is a compatibility projection until
D19. Slots carry stable UUIDs, version and an effective range; editing hours
keeps the UUID and bumps the version; closing a slot sets `effective_until`
without touching history.
"""

from datetime import date, datetime, time, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_time import business_today
from app.models.class_ import Class
from app.models.class_schedule_slot import (
    ClassScheduleSlot,
    ClassScheduleSlotStaff,
    ClassScheduleSlotStaffRevision,
    ClassScheduleSlotTeacherEvent,
)
from app.models.staff import StaffMember
from app.core.business_time import BUSINESS_TIMEZONE

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
    Columns are selected explicitly so the ``lazy="selectin"`` ``staff_links``
    relationship is never auto-loaded (which would duplicate the staff read).
    """
    reference = effective_at or business_today()
    rows = await db.execute(
        select(
            ClassScheduleSlot.id,
            ClassScheduleSlot.weekday,
            ClassScheduleSlot.local_start,
            ClassScheduleSlot.local_end,
            ClassScheduleSlot.version,
            ClassScheduleSlotStaff.staff_id,
            ClassScheduleSlotStaff.role,
        )
        .outerjoin(
            ClassScheduleSlotStaff,
            ClassScheduleSlotStaff.slot_id == ClassScheduleSlot.id,
        )
        .where(
            ClassScheduleSlot.class_id == class_id,
            ClassScheduleSlot.effective_from <= reference,
            (ClassScheduleSlot.effective_until.is_(None))
            | (ClassScheduleSlot.effective_until > reference),
        )
        .order_by(ClassScheduleSlot.weekday, ClassScheduleSlot.local_start)
    )

    slots: list[tuple[str, str, time, time, int]] = []
    staff_by_slot: dict[str, list[tuple[str, str]]] = {}
    seen_slot_ids: set[str] = set()
    for slot_id, weekday, local_start, local_end, version, staff_id, role in rows.all():
        key = str(slot_id)
        if key not in seen_slot_ids:
            seen_slot_ids.add(key)
            slots.append(
                (
                    key,
                    weekday,
                    local_start,
                    local_end,
                    version,
                )
            )
        if staff_id is not None and role is not None:
            staff_by_slot.setdefault(key, []).append((str(staff_id), role))

    projection: list[dict] = []
    for key, weekday, local_start, local_end, version in slots:
        teacher_ids = [
            staff_id
            for staff_id, item_role in staff_by_slot.get(key, [])
            if item_role == "TEACHER"
        ]
        assistant_ids = [
            staff_id
            for staff_id, item_role in staff_by_slot.get(key, [])
            if item_role == "ASSISTANT"
        ]
        projection.append(
            {
                "day": weekday,
                "start": _time_text(local_start),
                "end": _time_text(local_end),
                "teacher_ids": teacher_ids,
                "assistant_ids": assistant_ids,
                "slot_id": key,
                "version": version,
            }
        )
    return projection


async def load_class_slots_bulk(
    db: AsyncSession,
    class_ids: list[str],
    *,
    effective_at: date | None = None,
) -> dict[str, list[dict]]:
    """Load current relational slots for many classes in ONE bounded query.

    Availability checks run against every active class.  Calling
    :func:`load_class_slots` once per class turns that path into an N+1 query
    pattern, which is especially expensive when the database is a remote
    Supabase pooler.  Slots and their staff links are joined in a single
    statement with explicit columns (the ORM's ``lazy="selectin"`` is skipped
    on purpose), keeping the same relational-first projection as the single
    class loader.
    """
    ids = list(dict.fromkeys(str(class_id) for class_id in class_ids))
    if not ids:
        return {}

    reference = effective_at or business_today()
    rows = await db.execute(
        select(
            ClassScheduleSlot.id,
            ClassScheduleSlot.class_id,
            ClassScheduleSlot.weekday,
            ClassScheduleSlot.local_start,
            ClassScheduleSlot.local_end,
            ClassScheduleSlot.version,
            ClassScheduleSlotStaff.staff_id,
            ClassScheduleSlotStaff.role,
        )
        .outerjoin(
            ClassScheduleSlotStaff,
            ClassScheduleSlotStaff.slot_id == ClassScheduleSlot.id,
        )
        .where(
            ClassScheduleSlot.class_id.in_(ids),
            ClassScheduleSlot.effective_from <= reference,
            (ClassScheduleSlot.effective_until.is_(None))
            | (ClassScheduleSlot.effective_until > reference),
        )
        .order_by(
            ClassScheduleSlot.class_id,
            ClassScheduleSlot.weekday,
            ClassScheduleSlot.local_start,
        )
    )

    slots: list[tuple[str, str, str, time, time, int]] = []
    staff_by_slot: dict[str, list[tuple[str, str]]] = {}
    seen_slot_ids: set[str] = set()
    for (
        slot_id,
        class_id,
        weekday,
        local_start,
        local_end,
        version,
        staff_id,
        role,
    ) in rows.all():
        key = str(slot_id)
        if key not in seen_slot_ids:
            seen_slot_ids.add(key)
            slots.append((key, str(class_id), weekday, local_start, local_end, version))
        if staff_id is not None and role is not None:
            staff_by_slot.setdefault(key, []).append((str(staff_id), role))

    projection: dict[str, list[dict]] = {class_id: [] for class_id in ids}
    for key, slot_class_id, weekday, local_start, local_end, version in slots:
        teacher_ids = [
            staff_id
            for staff_id, item_role in staff_by_slot.get(key, [])
            if item_role == "TEACHER"
        ]
        assistant_ids = [
            staff_id
            for staff_id, item_role in staff_by_slot.get(key, [])
            if item_role == "ASSISTANT"
        ]
        projection.setdefault(slot_class_id, []).append(
            {
                "day": weekday,
                "start": _time_text(local_start),
                "end": _time_text(local_end),
                "teacher_ids": teacher_ids,
                "assistant_ids": assistant_ids,
                "slot_id": key,
                "version": version,
            }
        )
    return {class_id: slots for class_id, slots in projection.items() if slots}


def _time_text(value: time) -> str:
    return value.strftime("%H:%M")


async def sync_class_slots(
    db: AsyncSession,
    class_: Class,
    schedule: dict | None,
    *,
    effective_from: date | None = None,
    actor_user_id: str | None = None,
    reason: str | None = None,
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
            await _sync_slot_staff_revisions(
                db,
                class_=class_,
                slot=slot,
                next_assignments={},
                effective_from=reference,
                actor_user_id=actor_user_id,
                reason=reason or "Đóng buổi học trong lịch lớp",
            )
            await _record_teacher_assignment_events(
                db,
                class_=class_,
                slot=slot,
                next_teacher_ids=[],
                effective_from=reference,
                actor_user_id=actor_user_id,
                reason=reason or "Đóng buổi học trong lịch lớp",
            )
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
        await _replace_slot_staff(
            db,
            class_=class_,
            slot=current,
            item=item,
            effective_from=reference,
            actor_user_id=actor_user_id,
            reason=reason,
        )

    await db.flush()


async def _replace_slot_staff(
    db: AsyncSession,
    *,
    class_: Class,
    slot: ClassScheduleSlot,
    item: dict,
    effective_from: date,
    actor_user_id: str | None,
    reason: str | None,
) -> None:
    teacher_ids = [str(value) for value in item.get("teacher_ids") or []]
    assistant_ids = [str(value) for value in item.get("assistant_ids") or []]
    next_assignments = {
        **{staff_id: "TEACHER" for staff_id in teacher_ids},
        **{staff_id: "ASSISTANT" for staff_id in assistant_ids},
    }
    if len(next_assignments) != len(teacher_ids) + len(assistant_ids):
        raise ValueError("Một nhân sự không thể vừa là giáo viên vừa là trợ giảng")
    await _sync_slot_staff_revisions(
        db,
        class_=class_,
        slot=slot,
        next_assignments=next_assignments,
        effective_from=effective_from,
        actor_user_id=actor_user_id,
        reason=reason,
    )
    await _record_teacher_assignment_events(
        db,
        class_=class_,
        slot=slot,
        next_teacher_ids=teacher_ids,
        effective_from=effective_from,
        actor_user_id=actor_user_id,
        reason=reason,
    )
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


def _assignment_boundary(class_: Class, effective_from: date) -> datetime:
    """Return a non-retroactive boundary for a staffing projection change."""
    requested = datetime.combine(
        effective_from,
        datetime.min.time(),
        tzinfo=BUSINESS_TIMEZONE,
    ).astimezone(timezone.utc)
    return max(requested, datetime.now(timezone.utc))


async def _sync_slot_staff_revisions(
    db: AsyncSession,
    *,
    class_: Class,
    slot: ClassScheduleSlot,
    next_assignments: dict[str, str],
    effective_from: date,
    actor_user_id: str | None,
    reason: str | None,
) -> None:
    """Close/open effective assignment rows without rewriting elapsed sessions."""
    boundary = _assignment_boundary(class_, effective_from)
    rows = list(
        (
            await db.scalars(
                select(ClassScheduleSlotStaffRevision)
                .where(
                    ClassScheduleSlotStaffRevision.slot_id == str(slot.id),
                    ClassScheduleSlotStaffRevision.effective_until.is_(None),
                )
                .order_by(ClassScheduleSlotStaffRevision.staff_id.asc())
                .with_for_update()
            )
        ).all()
    )
    current = {str(row.staff_id): row for row in rows}

    for staff_id, revision in current.items():
        next_role = next_assignments.get(staff_id)
        if next_role == revision.role:
            continue
        if revision.effective_from >= boundary:
            await db.delete(revision)
        else:
            revision.effective_until = boundary

    for staff_id, role in next_assignments.items():
        revision = current.get(staff_id)
        if revision is not None and revision.role == role:
            continue
        db.add(
            ClassScheduleSlotStaffRevision(
                class_id=str(class_.id),
                slot_id=str(slot.id),
                staff_id=staff_id,
                role=role,
                effective_from=boundary,
                actor_user_id=actor_user_id,
                reason=reason,
            )
        )


async def _record_teacher_assignment_events(
    db: AsyncSession,
    *,
    class_: Class,
    slot: ClassScheduleSlot,
    next_teacher_ids: list[str],
    effective_from: date,
    actor_user_id: str | None,
    reason: str | None,
) -> None:
    """Append only the teacher delta; assistant assignments are untouched."""
    current_rows = await db.execute(
        select(ClassScheduleSlotStaff, StaffMember.full_name)
        .join(StaffMember, StaffMember.id == ClassScheduleSlotStaff.staff_id)
        .where(
            ClassScheduleSlotStaff.slot_id == slot.id,
            ClassScheduleSlotStaff.role == "TEACHER",
        )
        .with_for_update()
    )
    current = {str(link.staff_id): name for link, name in current_rows.all()}
    requested = list(dict.fromkeys(next_teacher_ids))
    requested_set = set(requested)
    current_set = set(current)
    changed = (current_set - requested_set) | (requested_set - current_set)
    if not changed:
        return

    names: dict[str, str] = dict(current)
    if requested_set - current_set:
        result = await db.execute(
            select(StaffMember.id, StaffMember.full_name).where(
                StaffMember.id.in_(requested_set - current_set),
                StaffMember.is_active.is_(True),
            )
        )
        names.update({str(staff_id): full_name for staff_id, full_name in result.all()})

    for staff_id in sorted(current_set - requested_set):
        db.add(
            ClassScheduleSlotTeacherEvent(
                class_id=str(class_.id),
                slot_id=str(slot.id),
                staff_id=staff_id,
                event_type="REMOVED",
                effective_from=effective_from,
                teacher_name_snapshot=names[staff_id],
                actor_user_id=actor_user_id,
                reason=reason,
            )
        )
    for staff_id in requested:
        if staff_id in current_set:
            continue
        name = names.get(staff_id)
        if not name:
            raise ValueError("Giáo viên không hợp lệ")
        db.add(
            ClassScheduleSlotTeacherEvent(
                class_id=str(class_.id),
                slot_id=str(slot.id),
                staff_id=staff_id,
                event_type="ASSIGNED",
                effective_from=effective_from,
                teacher_name_snapshot=name,
                actor_user_id=actor_user_id,
                reason=reason,
            )
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
        end_date=class_.stopped_on,
        range_start=range_start,
        range_end=range_end,
    )
