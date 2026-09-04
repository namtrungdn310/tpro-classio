"""One canonical conflict/availability engine for class sessions.

Owns recurring-schedule conflict detection (teachers + assistants, half-open
intervals, date-intersection weekday rule) AND dated make-up conflict checks
against recurring templates and other dated make-ups. Preview is advisory;
every command rechecks inside its transaction.
"""

from datetime import date, datetime, timedelta
import hashlib
import json
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_time import BUSINESS_TIMEZONE
from app.core.occurrence import (
    INDEX_TO_WEEKDAY,
)
from app.models.class_ import Class
from app.models.class_schedule_slot import (
    ClassScheduleSlot as ClassScheduleSlotRecord,
    ClassScheduleSlotStaff,
)
from app.models.class_teacher import ClassTeacher
from app.models.makeup import ClassSessionException, ClassSessionStaffSnapshot
from app.models.staff import StaffMember
from app.schemas.class_ import (
    ClassSchedule,
    ClassScheduleSlot,
    ScheduleAvailabilityConflict,
    StaffAvailabilityCandidateResponse,
    StaffAvailabilityConflictResponse,
    StaffAvailabilityPreviewRequest,
    StaffAvailabilityPreviewResponse,
)
from app.services.schedule_slot_service import expand_class_occurrences
from app.schemas.makeup import ConflictDetail, MakeupDomainError

DAY_ORDER = {
    "Thứ 2": 0,
    "Thứ 3": 1,
    "Thứ 4": 2,
    "Thứ 5": 3,
    "Thứ 6": 4,
    "Thứ 7": 5,
    "Chủ Nhật": 6,
}

WEEKDAY_INDEX = DAY_ORDER


class ScheduleDataInvalidError(ValueError):
    """Dữ liệu lịch đã lưu hỏng — mã ổn định cho client, không để lộ traceback."""

    code = "CLASS_SCHEDULE_DATA_INVALID"


def _date_intersection_contains_weekday(
    existing_start: date | None,
    existing_end: date | None,
    requested_start: date | None,
    requested_end: date | None,
    class_day: str,
) -> bool:
    """Một slot tuần chỉ gây xung đột khi GIAO của hai khoảng ngày (inclusive,
    NULL = không giới hạn) có ít nhất một ngày đúng weekday của slot."""
    start: date | None
    end: date | None
    if existing_start is not None and requested_start is not None:
        start = max(existing_start, requested_start)
    else:
        start = existing_start or requested_start
    if existing_end is not None and requested_end is not None:
        end = min(existing_end, requested_end)
    else:
        end = existing_end or requested_end

    if start is not None and end is not None and start > end:
        return False
    if start is None or end is None:
        return True
    target = WEEKDAY_INDEX[class_day]
    first = start + timedelta(days=(target - start.weekday()) % 7)
    return first <= end


def _slot_effective_teacher_ids(
    slot: ClassScheduleSlot,
    class_teacher_pool: list[str],
) -> list[str]:
    """Resolve teacher assignment without silently bleeding the class pool.

    Canonical slots always carry an explicit list.  The pool fallback is kept
    only for an old payload that literally omits the field; an explicit empty
    list remains empty and is rejected by the class command before persist.
    """
    explicit = slot.teacher_ids
    if explicit is None:
        return list(class_teacher_pool)
    return [str(teacher_id) for teacher_id in explicit]


def _slot_effective_assistant_ids(slot: ClassScheduleSlot) -> list[str]:
    """Assistant effective: explicit non-empty thì dùng đúng danh sách đó;
    thiếu HOẶC rỗng đều nghĩa là KHÔNG có trợ giảng."""
    explicit = slot.assistant_ids
    return [str(assistant_id) for assistant_id in explicit] if explicit else []


async def _load_overlapping_class_memberships(
    db: AsyncSession,
    *,
    class_id: str,
    requested_ids: list[str] | None,
    requested_start_date: date | None = None,
    requested_end_date: date | None = None,
) -> dict[str, dict]:
    """Nạp mọi lớp HOẠT ĐỘNG có ít nhất một nhân sự thuộc tập yêu cầu và khoảng
    ngày giao với khoảng yêu cầu. Loại completed/cancelled và class đang sửa
    ngay trong SQL; membership kèm role nhân sự được LEFT JOIN trong cùng một
    round-trip. Candidate selection and effective membership both merge the
    class-level junction with canonical per-slot assignments so legacy drift
    can neither hide a conflict nor produce a false invalid-data error."""
    date_filters = []
    if requested_start_date is not None:
        date_filters.append(
            or_(Class.stopped_on.is_(None), Class.stopped_on >= requested_start_date)
        )
    if requested_end_date is not None:
        date_filters.append(
            or_(Class.start_date.is_(None), Class.start_date <= requested_end_date)
        )
    if class_id:
        date_filters.append(Class.id != class_id)

    statement = (
        select(
            Class.id,
            Class.name,
            Class.class_category,
            Class.grade_level,
            Class.schedule,
            Class.start_date,
            Class.stopped_on,
            ClassTeacher.teacher_id.label("member_id"),
            ClassTeacher.role.label("member_role"),
        )
        .outerjoin(ClassTeacher, ClassTeacher.class_id == Class.id)
        .outerjoin(StaffMember, StaffMember.id == ClassTeacher.teacher_id)
        .where(
            Class.is_active.is_(True),
            Class.cancelled_at.is_(None),
            Class.completed_at.is_(None),
            Class.stopped_at.is_(None),
            *date_filters,
        )
    )
    if requested_ids is not None:
        # Keep a class when the requested staff appears in either source.  The
        # slot source is essential for legacy rows whose canonical schedule was
        # written before the class-level junction was repaired.
        member_class_ids = select(ClassTeacher.class_id).where(
            ClassTeacher.teacher_id.in_(requested_ids)
        )
        slot_class_ids = (
            select(ClassScheduleSlotRecord.class_id)
            .join(
                ClassScheduleSlotStaff,
                ClassScheduleSlotStaff.slot_id == ClassScheduleSlotRecord.id,
            )
            .where(ClassScheduleSlotStaff.staff_id.in_(requested_ids))
        )
        statement = statement.where(
            Class.id.in_(union(member_class_ids, slot_class_ids))
        )

    result = await db.execute(statement)
    rows_by_class: dict[str, dict] = {}
    for (
        class_row_id,
        class_name,
        class_category,
        class_grade_level,
        payload,
        class_start,
        class_end,
        member_id,
        member_role,
    ) in result.all():
        key = str(class_row_id)
        entry = rows_by_class.setdefault(
            key,
            {
                "id": key,
                "name": class_name,
                "class_category": class_category,
                "grade_level": class_grade_level,
                "payload": payload,
                "start": class_start,
                "end": class_end,
                "members": [],
            },
        )
        if member_id is not None and member_role is not None:
            entry["members"].append((str(member_id), member_role))

    if rows_by_class:
        slot_staff_statement = (
            select(
                ClassScheduleSlotRecord.class_id,
                ClassScheduleSlotStaff.staff_id,
                ClassScheduleSlotStaff.role,
            )
            .join(
                ClassScheduleSlotRecord,
                ClassScheduleSlotRecord.id == ClassScheduleSlotStaff.slot_id,
            )
            .join(StaffMember, StaffMember.id == ClassScheduleSlotStaff.staff_id)
            .where(
                ClassScheduleSlotRecord.class_id.in_(list(rows_by_class.keys())),
            )
        )
        slot_staff_result = await db.execute(slot_staff_statement)
        for class_id_val, staff_id_val, assignment_role in slot_staff_result.all():
            key = str(class_id_val)
            if key in rows_by_class:
                member_pair = (str(staff_id_val), assignment_role)
                if member_pair not in rows_by_class[key]["members"]:
                    rows_by_class[key]["members"].append(member_pair)

    return rows_by_class


def _membership_from_entries(
    rows_by_class: dict[str, dict],
) -> dict[str, dict[str, str]]:
    """Derive full role-correct membership from the merged class rows."""
    return {entry["id"]: dict(entry["members"]) for entry in rows_by_class.values()}


async def _class_has_relational_slots(db: AsyncSession, class_: Class) -> bool:
    from app.models.class_schedule_slot import ClassScheduleSlot

    return (
        await db.scalar(
            select(ClassScheduleSlot.id)
            .where(ClassScheduleSlot.class_id == class_.id)
            .limit(1)
        )
    ) is not None


async def _resolve_class_schedule_slots(
    db: AsyncSession,
    class_id: str,
    payload: dict | None,
    *,
    class_name: str = "",
) -> list[ClassScheduleSlot] | None:
    """R6-D07: slots từ nguồn relational (canonical); JSON là fallback tạm.

    Trả None khi lớp không có lịch hợp lệ ở cả hai nguồn.
    """
    from app.services.schedule_slot_service import load_class_slots

    relational = await load_class_slots(db, class_id)
    if relational:
        return [
            ClassScheduleSlot(
                day=item["day"],
                start=item["start"],
                end=item["end"],
                teacher_ids=[UUID(value) for value in item["teacher_ids"]],
                assistant_ids=[UUID(value) for value in item["assistant_ids"]],
            )
            for item in relational
        ]
    if payload is None:
        return None
    try:
        schedule = ClassSchedule.model_validate(payload)
    except ValueError as exc:
        raise ScheduleDataInvalidError(
            f"Lịch học đã lưu của lớp {class_name} không hợp lệ. "
            "Vui lòng chỉnh sửa lớp này trước"
        ) from exc
    return schedule.slots


def _slot_models_from_relational_projection(
    projection: list[dict],
) -> list[ClassScheduleSlot]:
    """Convert the canonical relational projection to the API/domain model."""
    return [
        ClassScheduleSlot(
            day=item["day"],
            start=item["start"],
            end=item["end"],
            teacher_ids=[UUID(value) for value in item["teacher_ids"]],
            assistant_ids=[UUID(value) for value in item["assistant_ids"]],
        )
        for item in projection
    ]


async def _resolve_class_schedule_slots_bulk(
    db: AsyncSession,
    entries: list[dict],
    *,
    effective_at: date | None = None,
) -> dict[str, list[ClassScheduleSlot] | None]:
    """Resolve schedules for all conflict candidates without N+1 queries.

    Relational slots are canonical.  For legacy rows that have not yet been
    dual-written, parse the JSON projection already selected by the membership
    query instead of issuing one relational lookup per class.
    """
    if not entries:
        return {}

    from app.services.schedule_slot_service import load_class_slots_bulk

    class_ids = [entry["id"] for entry in entries]
    relational_by_class = await load_class_slots_bulk(
        db,
        class_ids,
        effective_at=effective_at,
    )
    resolved: dict[str, list[ClassScheduleSlot] | None] = {}
    for entry in entries:
        class_id = entry["id"]
        relational = relational_by_class.get(class_id)
        if relational:
            resolved[class_id] = _slot_models_from_relational_projection(relational)
            continue

        payload = entry["payload"]
        if payload is None:
            resolved[class_id] = None
            continue
        try:
            resolved[class_id] = ClassSchedule.model_validate(payload).slots
        except ValueError as exc:
            raise ScheduleDataInvalidError(
                f"Lịch học đã lưu của lớp {entry['name']} không hợp lệ. "
                "Vui lòng chỉnh sửa lớp này trước"
            ) from exc
    return resolved


def _validate_slot_explicit_against_membership(
    slot: ClassScheduleSlot,
    membership: dict[str, str],
    class_name: str,
) -> None:
    """Fail-closed: assignment explicit phải thuộc junction đúng role."""
    for teacher_id in slot.teacher_ids:
        if membership.get(str(teacher_id)) != "TEACHER":
            raise ScheduleDataInvalidError(
                f"Phân công giáo viên của lớp {class_name} không khớp danh sách "
                "giáo viên của lớp. Vui lòng chỉnh sửa lớp này trước"
            )
    for assistant_id in slot.assistant_ids:
        if membership.get(str(assistant_id)) != "ASSISTANT":
            raise ScheduleDataInvalidError(
                f"Phân công trợ giảng của lớp {class_name} không khớp danh sách "
                "trợ giảng của lớp. Vui lòng chỉnh sửa lớp này trước"
            )


async def _collect_schedule_conflicts(
    db: AsyncSession,
    *,
    class_id: str,
    teacher_ids: list[str],
    assistant_ids: list[str],
    schedule: ClassSchedule | None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[dict]:
    """Truy vấn TOÀN BỘ lớp hoạt động theo khoảng ngày và trả xung đột cho cả
    giáo viên lẫn trợ giảng."""
    if schedule is None or not schedule.slots:
        return []

    requested_slot_staff = [
        (
            slot,
            _slot_effective_teacher_ids(slot, teacher_ids),
            _slot_effective_assistant_ids(slot),
        )
        for slot in schedule.slots
    ]
    if not any(
        requested_teachers or requested_assistants
        for _slot, requested_teachers, requested_assistants in requested_slot_staff
    ):
        return []

    requested_ids = list(dict.fromkeys([*teacher_ids, *assistant_ids]))
    rows_by_class = await _load_overlapping_class_memberships(
        db,
        class_id=class_id,
        requested_ids=requested_ids,
        requested_start_date=start_date,
        requested_end_date=end_date,
    )
    full_membership = _membership_from_entries(rows_by_class)

    conflicts: list[dict] = []
    entries = list(rows_by_class.values())
    slots_by_class = await _resolve_class_schedule_slots_bulk(
        db,
        entries,
        effective_at=start_date,
    )
    for entry in entries:
        existing_slots = slots_by_class.get(entry["id"])
        if existing_slots is None:
            continue
        membership = full_membership.get(entry["id"], {})
        pool_teachers = [
            staff_id
            for staff_id in teacher_ids
            if membership.get(staff_id) == "TEACHER"
        ]
        for existing in existing_slots:
            _validate_slot_explicit_against_membership(
                existing, membership, entry["name"]
            )
            if not _date_intersection_contains_weekday(
                entry["start"],
                entry["end"],
                start_date,
                end_date,
                existing.day,
            ):
                continue
            effective_teachers = _slot_effective_teacher_ids(existing, pool_teachers)
            effective_assistants = _slot_effective_assistant_ids(existing)
            for (
                requested,
                requested_teachers,
                requested_assistants,
            ) in requested_slot_staff:
                overlaps = (
                    requested.day == existing.day
                    and requested.start < existing.end
                    and existing.start < requested.end
                )
                if not overlaps:
                    continue
                # Availability belongs to a person, not to their contextual
                # role. A teacher in the draft is still busy when they assist
                # another class, and vice versa.
                occupied_staff = set(effective_teachers) | set(effective_assistants)
                teacher_conflict = sorted(occupied_staff & set(requested_teachers))
                if teacher_conflict:
                    conflicts.append(
                        {
                            "class_id": entry["id"],
                            "class_name": entry["name"],
                            "day": existing.day,
                            "start": existing.start,
                            "end": existing.end,
                            "conflict_type": "TEACHER",
                            "staff_ids": teacher_conflict,
                        }
                    )
                assistant_conflict = sorted(occupied_staff & set(requested_assistants))
                if assistant_conflict:
                    conflicts.append(
                        {
                            "class_id": entry["id"],
                            "class_name": entry["name"],
                            "day": existing.day,
                            "start": existing.start,
                            "end": existing.end,
                            "conflict_type": "ASSISTANT",
                            "staff_ids": assistant_conflict,
                        }
                    )
    return conflicts


async def _lock_and_validate_staff(
    db: AsyncSession,
    *,
    teacher_ids: list[str],
    assistant_ids: list[str],
) -> tuple[dict[str, StaffMember], dict[str, StaffMember]]:
    """Khóa staff row theo ID ổn định và kiểm tra active.

    Role is validated on the class assignment, never on the staff profile.
    """
    all_ids = list(dict.fromkeys([*teacher_ids, *assistant_ids]))
    result = await db.execute(
        select(StaffMember)
        .where(StaffMember.id.in_(all_ids))
        .order_by(StaffMember.id.asc())
        .with_for_update()
    )
    staff_by_id = {str(staff.id): staff for staff in result.scalars().all()}
    missing = [staff_id for staff_id in all_ids if staff_id not in staff_by_id]
    if missing:
        raise ValueError("Nhân sự không hợp lệ hoặc đã ngừng hoạt động")
    inactive = [staff_id for staff_id in all_ids if not staff_by_id[staff_id].is_active]
    if inactive:
        raise ValueError("Nhân sự đã ngừng hoạt động không thể được phân công")
    return (
        {staff_id: staff_by_id[staff_id] for staff_id in teacher_ids},
        {staff_id: staff_by_id[staff_id] for staff_id in assistant_ids},
    )


async def validate_availability_request_staff(
    db: AsyncSession,
    *,
    teacher_ids: list[str],
    assistant_ids: list[str],
    class_id: str | None,
    scope: str = "selected_staff",
) -> None:
    """Validate read-only cho endpoint availability. Không khóa row."""
    if class_id is not None:
        existing_class = await db.get(Class, class_id)
        if existing_class is None:
            raise ValueError("Không tìm thấy lớp học đang chỉnh sửa")

    if len(set(teacher_ids)) != len(teacher_ids) or len(set(assistant_ids)) != len(
        assistant_ids
    ):
        raise ValueError("Danh sách nhân sự không được trùng ID")
    overlap = set(teacher_ids) & set(assistant_ids)
    if overlap:
        raise ValueError("Một nhân sự không thể vừa là giáo viên vừa là trợ giảng")

    all_ids = list(dict.fromkeys([*teacher_ids, *assistant_ids]))
    if scope not in {"selected_staff", "all_classes"}:
        raise ValueError("Phạm vi lịch không hợp lệ")
    if scope == "selected_staff" and not all_ids:
        raise ValueError("Vui lòng chọn ít nhất một giáo viên hoặc trợ giảng")
    if scope == "all_classes" and not all_ids:
        return
    result = await db.execute(select(StaffMember).where(StaffMember.id.in_(all_ids)))
    staff_by_id = {str(staff.id): staff for staff in result.scalars().all()}
    missing = [staff_id for staff_id in all_ids if staff_id not in staff_by_id]
    if missing:
        raise ValueError("Nhân sự không hợp lệ hoặc đã ngừng hoạt động")
    if any(not staff.is_active for staff in staff_by_id.values()):
        raise ValueError("Nhân sự đã ngừng hoạt động không thể được phân công")


async def get_class_schedule_availability(
    db: AsyncSession,
    *,
    class_id: str | None,
    teacher_ids: list[str],
    assistant_ids: list[str],
    start_date: date,
    end_date: date | None,
    scope: str = "selected_staff",
) -> list[ScheduleAvailabilityConflict]:
    """Return occupied recurring class slots in the requested date range.

    ``selected_staff`` preserves the legacy availability query.  The class
    picker uses ``all_classes``: the grid is class-centric and must lock every
    other class block before per-session teacher assignment is made.

    CANONICAL contract:
    MỘT block cho mỗi class+day+start+end, giữ đồng thời busy_teacher_ids và
    busy_assistant_ids. Không chứa thông tin liên hệ nhân sự."""
    requested_ids = list(dict.fromkeys([*teacher_ids, *assistant_ids]))
    if scope not in {"selected_staff", "all_classes"}:
        raise ValueError("Phạm vi lịch không hợp lệ")
    if scope == "selected_staff" and not requested_ids:
        return []
    rows_by_class = await _load_overlapping_class_memberships(
        db,
        class_id=class_id or "",
        requested_ids=requested_ids if scope == "selected_staff" else None,
        requested_start_date=start_date,
        requested_end_date=end_date,
    )
    full_membership = _membership_from_entries(rows_by_class)

    blocks: list[ScheduleAvailabilityConflict] = []
    entries = list(rows_by_class.values())
    slots_by_class = await _resolve_class_schedule_slots_bulk(
        db,
        entries,
        effective_at=start_date,
    )
    for entry in entries:
        existing_slots = slots_by_class.get(entry["id"])
        if existing_slots is None:
            continue
        membership = full_membership.get(entry["id"], {})
        pool_teachers = [
            staff_id
            for staff_id in teacher_ids
            if membership.get(staff_id) == "TEACHER"
        ]
        for existing in existing_slots:
            _validate_slot_explicit_against_membership(
                existing, membership, entry["name"]
            )
            if not _date_intersection_contains_weekday(
                entry["start"],
                entry["end"],
                start_date,
                end_date,
                existing.day,
            ):
                continue
            effective_teachers = _slot_effective_teacher_ids(existing, pool_teachers)
            effective_assistants = _slot_effective_assistant_ids(existing)
            if scope == "all_classes":
                busy_teachers = sorted(set(effective_teachers))
                busy_assistants = sorted(set(effective_assistants))
            else:
                busy_teachers = sorted(set(effective_teachers) & set(teacher_ids))
                busy_assistants = sorted(set(effective_assistants) & set(assistant_ids))
            # In the class-centric picker every occupied slot is a hard
            # exclusion, even when the legacy/class record has no explicit
            # staff assignment.  Staff IDs are only metadata for the
            # selected-staff compatibility scope; they must never decide
            # whether another class blocks the new class.
            if scope == "selected_staff" and not busy_teachers and not busy_assistants:
                continue
            blocks.append(
                ScheduleAvailabilityConflict(
                    class_id=UUID(entry["id"]),
                    class_name=entry["name"],
                    class_category=entry["class_category"],
                    grade_level=entry["grade_level"],
                    day=existing.day,
                    start=existing.start,
                    end=existing.end,
                    busy_teacher_ids=[UUID(staff_id) for staff_id in busy_teachers],
                    busy_assistant_ids=[UUID(staff_id) for staff_id in busy_assistants],
                )
            )
    blocks.sort(
        key=lambda block: (
            DAY_ORDER.get(block.day, 99),
            block.start,
            block.end,
            block.class_name,
        )
    )
    return blocks


async def preview_staff_availability(
    db: AsyncSession,
    payload: StaffAvailabilityPreviewRequest,
) -> StaffAvailabilityPreviewResponse:
    """Preview selected staff against a schedule-first class draft."""
    class_id = str(payload.class_id) if payload.class_id else ""
    class_version: int | None = None
    if payload.class_id is not None:
        class_ = await db.get(Class, class_id)
        if class_ is None:
            raise ValueError("Không tìm thấy lớp học đang chỉnh sửa")
        class_version = int(class_.version)
        if (
            payload.expected_version is not None
            and payload.expected_version != class_version
        ):
            raise ValueError("CLASS_CHANGED: Lớp vừa được cập nhật, vui lòng tải lại")

    teacher_ids = list(
        dict.fromkeys(
            str(staff_id)
            for slot in payload.schedule.slots
            for staff_id in slot.teacher_ids
        )
    )
    assistant_ids = list(
        dict.fromkeys(
            str(staff_id)
            for slot in payload.schedule.slots
            for staff_id in slot.assistant_ids
        )
    )
    candidates = sorted({*teacher_ids, *assistant_ids})
    await validate_availability_request_staff(
        db,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        class_id=class_id or None,
        scope="selected_staff",
    )
    conflicts = await _collect_schedule_conflicts(
        db,
        class_id=class_id,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        schedule=payload.schedule,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    makeup_conflicts = await _collect_recurring_against_makeup_conflicts(
        db,
        class_id=class_id,
        schedule=payload.schedule,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    for item in makeup_conflicts:
        item["source"] = "MAKEUP"
    conflicts.extend(makeup_conflicts)

    by_staff: dict[str, list[StaffAvailabilityConflictResponse]] = {
        staff_id: [] for staff_id in candidates
    }
    for item in conflicts:
        detail = StaffAvailabilityConflictResponse(
            class_id=UUID(item["class_id"]),
            class_name=item["class_name"],
            day=item["day"],
            start=item["start"],
            end=item["end"],
            source=item.get("source", "REGULAR"),
        )
        for staff_id in item["staff_ids"]:
            if staff_id in by_staff and detail not in by_staff[staff_id]:
                by_staff[staff_id].append(detail)

    candidate_responses = [
        StaffAvailabilityCandidateResponse(
            staff_id=UUID(staff_id),
            role="TEACHER" if staff_id in teacher_ids else "ASSISTANT",
            available=not by_staff[staff_id],
            conflicts=by_staff[staff_id],
        )
        for staff_id in candidates
    ]
    hash_payload = {
        "class_id": class_id or None,
        "class_version": class_version,
        "start_date": payload.start_date.isoformat(),
        "end_date": payload.end_date.isoformat() if payload.end_date else None,
        "schedule": payload.schedule.model_dump(mode="json"),
        "candidate_staff_ids": candidates,
        "conflicts": [item.model_dump(mode="json") for item in candidate_responses],
    }
    fingerprint = hashlib.sha256(
        json.dumps(hash_payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return StaffAvailabilityPreviewResponse(
        can_apply=all(item.available for item in candidate_responses),
        preview_fingerprint=fingerprint,
        candidates=candidate_responses,
    )


async def _validate_staff_schedule_availability(
    db: AsyncSession,
    *,
    class_id: str,
    teacher_ids: list[str],
    assistant_ids: list[str],
    schedule: dict | ClassSchedule | None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> None:
    if not teacher_ids and not assistant_ids:
        return

    teacher_by_id, assistant_by_id = await _lock_and_validate_staff(
        db,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
    )

    normalized_schedule = (
        schedule
        if isinstance(schedule, ClassSchedule)
        else ClassSchedule.model_validate(schedule)
        if schedule is not None
        else None
    )

    conflicts = await _collect_schedule_conflicts(
        db,
        class_id=class_id,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        schedule=normalized_schedule,
        start_date=start_date,
        end_date=end_date,
    )
    conflicts.extend(
        await _collect_recurring_against_makeup_conflicts(
            db,
            class_id=class_id,
            schedule=normalized_schedule,
            start_date=start_date,
            end_date=end_date,
        )
    )
    if not conflicts:
        return

    name_by_id = {
        **{staff_id: staff.full_name for staff_id, staff in teacher_by_id.items()},
        **{staff_id: staff.full_name for staff_id, staff in assistant_by_id.items()},
    }
    first = conflicts[0]
    staff_names = [
        name_by_id.get(staff_id, "Nhân sự") for staff_id in first["staff_ids"]
    ]
    raise ValueError(
        f"{', '.join(staff_names)} đã có lịch lớp {first['class_name']} vào "
        f"{first['day']}, {first['start']}-{first['end']}"
    )


async def _collect_recurring_against_makeup_conflicts(
    db: AsyncSession,
    *,
    class_id: str,
    schedule: ClassSchedule | None,
    start_date: date | None,
    end_date: date | None,
) -> list[dict]:
    """Check a recurring draft against dated makeup staff snapshots."""
    if schedule is None or not schedule.slots:
        return []
    requested_ids = {
        str(staff_id)
        for slot in schedule.slots
        for staff_id in [*slot.teacher_ids, *slot.assistant_ids]
    }
    if not requested_ids:
        return []

    filters = [
        ClassSessionException.replacement_start_at.is_not(None),
        ClassSessionException.replacement_end_at.is_not(None),
        ClassSessionException.status == "MAKEUP_SCHEDULED",
        ClassSessionException.replacement_end_at > datetime.now(BUSINESS_TIMEZONE),
        ClassSessionStaffSnapshot.staff_id.in_(requested_ids),
    ]
    if start_date is not None:
        filters.append(
            ClassSessionException.replacement_start_at
            >= datetime.combine(start_date, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE)
        )
    if end_date is not None:
        filters.append(
            ClassSessionException.replacement_start_at
            < datetime.combine(
                end_date + timedelta(days=1),
                datetime.min.time(),
                tzinfo=BUSINESS_TIMEZONE,
            )
        )
    result = await db.execute(
        select(
            ClassSessionException,
            ClassSessionStaffSnapshot.staff_id,
            Class.name,
        )
        .join(
            ClassSessionStaffSnapshot,
            ClassSessionStaffSnapshot.exception_id == ClassSessionException.id,
        )
        .join(Class, Class.id == ClassSessionException.class_id)
        .where(*filters)
    )
    conflicts: list[dict] = []
    for exception, staff_id, class_name in result.all():
        local_start = exception.replacement_start_at.astimezone(BUSINESS_TIMEZONE)
        local_end = exception.replacement_end_at.astimezone(BUSINESS_TIMEZONE)
        day = INDEX_TO_WEEKDAY[local_start.weekday()]
        busy_staff_id = str(staff_id)
        for slot in schedule.slots:
            slot_staff = {
                str(value) for value in [*slot.teacher_ids, *slot.assistant_ids]
            }
            if busy_staff_id not in slot_staff or slot.day != day:
                continue
            if slot.start >= local_end.strftime("%H:%M") or local_start.strftime(
                "%H:%M"
            ) >= slot.end:
                continue
            conflicts.append(
                {
                    "class_id": str(exception.class_id),
                    "class_name": class_name,
                    "day": day,
                    "start": local_start.strftime("%H:%M"),
                    "end": local_end.strftime("%H:%M"),
                    "conflict_type": "STAFF",
                    "staff_ids": [busy_staff_id],
                }
            )
    return conflicts


async def check_makeup_conflicts(
    db: AsyncSession,
    *,
    class_id: str,
    replacement_start_at: datetime,
    replacement_end_at: datetime,
    teacher_ids: list[str],
    assistant_ids: list[str],
    exclude_exception_id: str | None = None,
) -> list[ConflictDetail]:
    """Kiểm tra toàn bộ conflict cho một candidate make-up interval (half-open).

    1. Recurring template của CHÍNH lớp đó (trừ original đang được bù).
    2. Recurring template của các lớp khác (staff overlap).
    3. Các dated make-up khác (mọi lớp, gồm lớp này) chồng interval.
    Không tin dữ liệu từ frontend; mọi giá trị canonical được nạp lại ở đây.
    """
    conflicts: list[ConflictDetail] = []
    class_ = await db.get(Class, str(class_id))
    if class_ is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy lớp học")

    # 1. Self recurring template.
    has_slots = class_.schedule is not None or await _class_has_relational_slots(
        db, class_
    )
    if has_slots:
        window_start = replacement_start_at - timedelta(days=7)
        window_end = replacement_end_at + timedelta(days=7)
        self_regular = await expand_class_occurrences(
            db,
            class_,
            range_start=window_start,
            range_end=window_end,
        )
        for occurrence in self_regular:
            if (
                occurrence.original_start_at < replacement_end_at
                and replacement_start_at < occurrence.original_end_at
            ):
                # Loại bỏ chính original slot đang được thay thế: exception đó
                # sẽ suppress original nên không còn tồn tại trên lịch hiệu lực.
                if exclude_exception_id is not None:
                    exc_row = await db.get(
                        ClassSessionException, str(exclude_exception_id)
                    )
                    if (
                        exc_row is not None
                        and exc_row.original_start_at == occurrence.original_start_at
                    ):
                        continue
                conflicts.append(
                    ConflictDetail(
                        code="CLASS_SCHEDULE_CONFLICT",
                        message=(
                            f"Buổi bù trùng lịch tuần của chính lớp {class_.name} "
                            f"({occurrence.source_slot_key})"
                        ),
                        class_id=UUID(str(class_.id)),
                        class_name=class_.name,
                        staff_ids=[],
                    )
                )

    # 2. Recurring template của các lớp khác (staff overlap).
    if teacher_ids or assistant_ids:
        local_start = replacement_start_at.astimezone(BUSINESS_TIMEZONE)
        candidate_day = INDEX_TO_WEEKDAY[local_start.weekday()]
        candidate_start_str = local_start.strftime("%H:%M")
        candidate_end_str = replacement_end_at.astimezone(BUSINESS_TIMEZONE).strftime(
            "%H:%M"
        )
        synthetic = ClassSchedule(
            text="makeup-candidate",
            slots=[
                ClassScheduleSlot(
                    day=candidate_day,
                    start=candidate_start_str,
                    end=candidate_end_str,
                    teacher_ids=[UUID(staff_id) for staff_id in teacher_ids],
                    assistant_ids=[UUID(staff_id) for staff_id in assistant_ids],
                )
            ],
        )
        recurring = await _collect_schedule_conflicts(
            db,
            class_id=str(class_id),
            teacher_ids=teacher_ids,
            assistant_ids=assistant_ids,
            schedule=synthetic,
            start_date=local_start.date(),
            end_date=local_start.date(),
        )
        for item in recurring:
            conflicts.append(
                ConflictDetail(
                    code="STAFF_SCHEDULE_CONFLICT",
                    message=(
                        f"{item['class_name']} có lịch {item['day']} "
                        f"{item['start']}-{item['end']} trùng nhân sự"
                    ),
                    class_id=UUID(item["class_id"]),
                    class_name=item["class_name"],
                    staff_ids=[UUID(staff_id) for staff_id in item["staff_ids"]],
                    day=item["day"],
                    start=item["start"],
                    end=item["end"],
                )
            )

    # 3. Dated make-ups khác chồng interval (mọi lớp, gồm chính lớp này).
    result = await db.execute(
        select(
            ClassSessionException,
            ClassSessionStaffSnapshot.staff_id,
            ClassSessionStaffSnapshot.role,
            Class.name,
        )
        .join(
            ClassSessionStaffSnapshot,
            ClassSessionStaffSnapshot.exception_id == ClassSessionException.id,
        )
        .join(Class, Class.id == ClassSessionException.class_id)
        .where(
            ClassSessionException.replacement_start_at.is_not(None),
            ClassSessionException.replacement_start_at < replacement_end_at,
            replacement_start_at < ClassSessionException.replacement_end_at,
            ClassSessionException.status.in_(["MAKEUP_SCHEDULED", "MAKEUP_COMPLETED"]),
        )
    )
    overlapping: dict[str, dict[str, Any]] = {}
    for exception, staff_id, role, class_name in result.all():
        exception_id = str(exception.id)
        if exclude_exception_id is not None and exception_id == str(
            exclude_exception_id
        ):
            continue
        entry = overlapping.setdefault(
            exception_id,
            {
                "class_id": str(exception.class_id),
                "class_name": class_name,
                "replacement_start_at": exception.replacement_start_at,
                "replacement_end_at": exception.replacement_end_at,
                "staff_ids": [],
                "staff_roles": {},
            },
        )
        if staff_id is not None:
            entry["staff_ids"].append(str(staff_id))
            entry["staff_roles"][str(staff_id)] = role

    inherited_teacher_ids = set(teacher_ids)
    inherited_assistant_ids = set(assistant_ids)
    for exception_id, entry in overlapping.items():
        entry_staff_ids = set(entry["staff_ids"])
        if str(entry["class_id"]) == str(class_id):
            conflicts.append(
                ConflictDetail(
                    code="CLASS_SCHEDULE_CONFLICT",
                    message=(
                        f"Buổi bù trùng buổi bù khác của lớp {entry['class_name']}"
                    ),
                    class_id=UUID(entry["class_id"]),
                    class_name=entry["class_name"],
                )
            )
            continue
        staff_overlap = [
            staff_id
            for staff_id in entry_staff_ids
            if staff_id in inherited_teacher_ids or staff_id in inherited_assistant_ids
        ]
        if staff_overlap:
            conflicts.append(
                ConflictDetail(
                    code="STAFF_SCHEDULE_CONFLICT",
                    message=(
                        f"Nhân sự đã có buổi bù lớp {entry['class_name']} "
                        "trong khung giờ này"
                    ),
                    class_id=UUID(entry["class_id"]),
                    class_name=entry["class_name"],
                    staff_ids=[UUID(staff_id) for staff_id in sorted(staff_overlap)],
                )
            )

    seen: set[tuple] = set()
    unique_conflicts: list[ConflictDetail] = []
    for conflict in conflicts:
        fingerprint = (
            conflict.code,
            str(conflict.class_id),
            conflict.day,
            conflict.start,
            conflict.end,
            tuple(str(staff_id) for staff_id in conflict.staff_ids),
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        unique_conflicts.append(conflict)
    unique_conflicts.sort(key=lambda item: (item.code, str(item.class_id)))
    return unique_conflicts


async def inherited_staff_active(
    db: AsyncSession,
    staff_ids: list[str],
) -> tuple[list[dict], list[dict]]:
    """Chia nhân sự kế thừa thành (active, inactive). Snapshot display name luôn
    được giữ; inactive chặn scheduling thay vì âm thầm thay người."""
    if not staff_ids:
        return [], []
    result = await db.execute(select(StaffMember).where(StaffMember.id.in_(staff_ids)))
    staff_by_id = {str(staff.id): staff for staff in result.scalars().all()}
    active: list[dict] = []
    inactive: list[dict] = []
    for staff_id in staff_ids:
        staff = staff_by_id.get(staff_id)
        if staff is None or not staff.is_active:
            inactive.append(
                {
                    "staff_id": staff_id,
                    "display_name": (
                        staff.full_name if staff is not None else "Nhân sự đã gỡ"
                    ),
                }
            )
        else:
            active.append(
                {
                    "staff_id": staff_id,
                    "display_name": staff.full_name,
                }
            )
    return active, inactive
