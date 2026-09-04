from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import case, exists, func, literal, or_, select, union
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import raiseload

from app.core.contact import validate_complete_contact_pair
from app.core.performance import log_timing
from app.models.class_ import Class
from app.core.class_lifecycle import operational_class_predicate
from app.models.class_teacher import ClassTeacher
from app.models.invitation import AccountInvitation
from app.models.staff import StaffMember
from app.models.staff_account_link import StaffAccountLink
from app.models.user import Profile
from app.schemas.staff import (
    StaffAttendanceHistoryItem,
    StaffAttendanceHistoryResponse,
    StaffClassResponse,
    StaffCreate,
    StaffResponse,
    StaffUpdate,
    TeacherOptionResponse,
)


class StaffConflictError(ValueError):
    """Raised when a staff mutation conflicts with persisted business state."""


def _staff_projection_statement():
    staff_class_assignments = union(
        select(
            ClassTeacher.teacher_id.label("teacher_id"),
            ClassTeacher.class_id.label("class_id"),
            ClassTeacher.role.label("assignment_role"),
        ),
        select(
            Class.teacher_id.label("teacher_id"),
            Class.id.label("class_id"),
            literal("TEACHER").label("assignment_role"),
        ).where(Class.teacher_id.is_not(None)),
    ).subquery("staff_class_assignments")
    from app.core.business_time import business_today
    from app.models.staff_attendance import StaffCompensationRate

    current_rates = (
        select(
            StaffCompensationRate.staff_id.label("rate_staff_id"),
            StaffCompensationRate.rate_amount.label("rate_amount"),
        )
        .where(
            StaffCompensationRate.assignment_role.is_(None),
            StaffCompensationRate.effective_from <= business_today(),
            (StaffCompensationRate.effective_to.is_(None))
            | (StaffCompensationRate.effective_to > business_today()),
        )
        # PostgreSQL requires DISTINCT ON keys to be the first ORDER BY
        # expressions.  Keeping the staff id first also makes the selected
        # rate deterministic when more than one current row shares a date.
        .order_by(
            StaffCompensationRate.staff_id.asc(),
            StaffCompensationRate.effective_from.desc(),
            StaffCompensationRate.version.desc(),
            StaffCompensationRate.created_at.desc(),
            StaffCompensationRate.id.desc(),
        )
        .distinct(StaffCompensationRate.staff_id)
        .subquery("staff_current_rates")
    )
    has_active_account_link = exists(
        select(StaffAccountLink.id)
        .join(Profile, Profile.id == StaffAccountLink.profile_id)
        .where(
            StaffAccountLink.staff_id == StaffMember.id,
            StaffAccountLink.lifecycle_status == "active",
            Profile.account_status == "active",
        )
    )
    has_disabled_account_link = exists(
        select(StaffAccountLink.id)
        .join(Profile, Profile.id == StaffAccountLink.profile_id)
        .where(
            StaffAccountLink.staff_id == StaffMember.id,
            StaffAccountLink.lifecycle_status == "active",
            Profile.account_status != "active",
        )
    )
    has_pending_invitation = exists(
        select(AccountInvitation.id).where(
            AccountInvitation.staff_id == StaffMember.id,
            AccountInvitation.role == "teacher",
            AccountInvitation.consumed_at.is_(None),
            AccountInvitation.revoked_at.is_(None),
            AccountInvitation.expires_at > func.now(),
        )
    )
    has_expired_invitation = exists(
        select(AccountInvitation.id).where(
            AccountInvitation.staff_id == StaffMember.id,
            AccountInvitation.role == "teacher",
            AccountInvitation.consumed_at.is_(None),
            AccountInvitation.revoked_at.is_(None),
            AccountInvitation.expires_at <= func.now(),
        )
    )
    attendance_account_status = case(
        (has_active_account_link, literal("connected")),
        (has_disabled_account_link, literal("disabled")),
        (has_pending_invitation, literal("invited")),
        (has_expired_invitation, literal("expired")),
        else_=literal("not_connected"),
    )
    return (
        select(
            StaffMember.id.label("id"),
            StaffMember.full_name.label("full_name"),
            StaffMember.staff_type.label("staff_type"),
            StaffMember.zalo_name.label("zalo_name"),
            StaffMember.phone.label("phone"),
            StaffMember.email.label("email"),
            StaffMember.checkin_window_after_hours.label("checkin_window_after_hours"),
            StaffMember.is_active.label("is_active"),
            StaffMember.created_at.label("created_at"),
            StaffMember.updated_at.label("updated_at"),
            current_rates.c.rate_amount.label("current_rate"),
            attendance_account_status.label("attendance_account_status"),
            Class.id.label("class_id"),
            Class.name.label("class_name"),
            operational_class_predicate().label("class_is_active"),
            staff_class_assignments.c.assignment_role.label("assignment_role"),
        )
        .select_from(StaffMember)
        .outerjoin(
            staff_class_assignments,
            staff_class_assignments.c.teacher_id == StaffMember.id,
        )
        .outerjoin(Class, Class.id == staff_class_assignments.c.class_id)
        .outerjoin(
            current_rates,
            current_rates.c.rate_staff_id == StaffMember.id,
        )
    )


def _rows_to_responses(
    rows: list[Mapping[str, Any]],
    *,
    include_sensitive: bool,
) -> list[StaffResponse]:
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        staff_id = str(row["id"])
        entry = grouped.get(staff_id)
        if entry is None:
            entry = {
                "id": row["id"],
                "full_name": row["full_name"],
                "staff_type": row["staff_type"],
                "zalo_name": row["zalo_name"] if include_sensitive else None,
                "phone": row["phone"] if include_sensitive else None,
                "email": row["email"] if include_sensitive else None,
                "checkin_window_after_hours": int(
                    row["checkin_window_after_hours"] or 24
                ),
                "current_rate": (
                    int(row["current_rate"])
                    if row["current_rate"] is not None
                    else None
                ),
                "attendance_account_status": (
                    row.get("attendance_account_status") or "not_connected"
                    if include_sensitive
                    else "not_connected"
                ),
                "is_active": row["is_active"],
                "assigned_classes": [],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            grouped[staff_id] = entry

        if row["class_id"] is not None:
            assigned_class = StaffClassResponse(
                id=row["class_id"],
                name=str(row["class_name"]),
                is_active=bool(row["class_is_active"]),
                role=row.get("assignment_role"),
            )
            if not any(
                item.id == assigned_class.id and item.role == assigned_class.role
                for item in entry["assigned_classes"]
            ):
                entry["assigned_classes"].append(assigned_class)

    return [StaffResponse.model_validate(entry) for entry in grouped.values()]


async def _query_staff_responses(
    db: AsyncSession,
    *,
    staff_type: str | None = None,
    is_active: bool | None = None,
    staff_id: UUID | None = None,
    include_sensitive: bool,
) -> list[StaffResponse]:
    statement = _staff_projection_statement()
    if staff_type is not None:
        statement = statement.where(StaffMember.staff_type == staff_type)
    if is_active is not None:
        statement = statement.where(StaffMember.is_active == is_active)
    if staff_id is not None:
        statement = statement.where(StaffMember.id == str(staff_id))
    statement = statement.order_by(
        StaffMember.full_name.asc(),
        StaffMember.id.asc(),
        Class.is_active.desc(),
        Class.name.asc(),
        Class.id.asc(),
    )

    with log_timing("staff_service.staff_projection.db", threshold_ms=30):
        result = await db.execute(statement)
    return _rows_to_responses(
        list(result.mappings().all()),
        include_sensitive=include_sensitive,
    )


async def get_staff_members(
    db: AsyncSession,
    staff_type: str | None = None,
    is_active: bool | None = None,
    *,
    include_sensitive: bool = False,
) -> list[StaffResponse]:
    with log_timing(
        "staff_service.get_staff_members",
        threshold_ms=40,
        staff_type=staff_type,
        is_active=is_active,
    ):
        return await _query_staff_responses(
            db,
            staff_type=staff_type,
            is_active=is_active,
            include_sensitive=include_sensitive,
        )


async def get_active_teacher_options(
    db: AsyncSession,
) -> list[TeacherOptionResponse]:
    result = await db.execute(
        select(
            StaffMember.id,
            StaffMember.full_name,
            StaffMember.staff_type,
            StaffMember.email,
        )
        .where(StaffMember.is_active.is_(True))
        .order_by(StaffMember.full_name.asc(), StaffMember.id.asc())
    )
    return [
        TeacherOptionResponse(
            id=row.id,
            full_name=row.full_name,
            staff_type=row.staff_type,
            email=row.email,
        )
        for row in result.all()
    ]


async def get_staff_member(
    db: AsyncSession,
    id: UUID,
    *,
    for_update: bool = False,
) -> StaffMember | None:
    statement = (
        select(StaffMember).options(raiseload("*")).where(StaffMember.id == str(id))
    )
    if for_update:
        statement = statement.with_for_update()
    result = await db.execute(statement)
    return result.scalar_one_or_none()


async def get_staff_response(
    db: AsyncSession,
    id: UUID,
    *,
    include_sensitive: bool = False,
) -> StaffResponse | None:
    responses = await _query_staff_responses(
        db,
        staff_id=id,
        include_sensitive=include_sensitive,
    )
    return responses[0] if responses else None


async def _read_assigned_classes(
    db: AsyncSession,
    staff_id: str,
    *,
    active_only: bool,
) -> list[StaffClassResponse]:
    linked_class_ids = select(ClassTeacher.class_id).where(
        ClassTeacher.teacher_id == staff_id
    )
    statement = (
        select(
            Class.id,
            Class.name,
            Class.is_active,
            ClassTeacher.role,
        )
        .outerjoin(
            ClassTeacher,
            (ClassTeacher.class_id == Class.id)
            & (ClassTeacher.teacher_id == staff_id),
        )
        .where(
            or_(
                Class.teacher_id == staff_id,
                Class.id.in_(linked_class_ids),
            )
        )
        .order_by(Class.is_active.desc(), Class.name.asc(), Class.id.asc())
    )
    if active_only:
        statement = statement.where(operational_class_predicate())
    result = await db.execute(statement)
    assignments: list[StaffClassResponse] = []
    seen: set[tuple[str, str]] = set()
    for row in result.all():
        role = row.role or "TEACHER"
        key = (str(row.id), role)
        if key in seen:
            continue
        seen.add(key)
        assignments.append(
            StaffClassResponse(
                id=row.id,
                name=row.name,
                is_active=row.is_active,
                role=role,
            )
        )
    return assignments


def _class_conflict_message(prefix: str, classes: list[StaffClassResponse]) -> str:
    names = ", ".join(class_.name for class_ in classes[:3])
    suffix = "..." if len(classes) > 3 else ""
    return f"{prefix}: {names}{suffix}"


async def _commit_staff_changes(db: AsyncSession) -> None:
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        lifecycle_message = _read_lifecycle_conflict(str(exc))
        if lifecycle_message is not None:
            raise StaffConflictError(lifecycle_message) from exc
        raise


def _read_lifecycle_conflict(detail: str) -> str | None:
    conflicts = {
        "assigned teacher cannot change staff type": (
            "Không thể đổi loại vì nhân sự vẫn được gắn với lớp"
        ),
        "teacher assigned to an active class cannot be deactivated": (
            "Hãy thay giáo viên cho các lớp đang hoạt động trước"
        ),
        "assigned staff on an active class cannot be deactivated": (
            "Hãy kết thúc phân công ở các lớp đang hoạt động trước"
        ),
        "staff records must be archived instead of deleted": (
            "Nhân sự phải được ngừng hoạt động thay vì xoá khỏi lịch sử"
        ),
    }
    return next(
        (message for marker, message in conflicts.items() if marker in detail),
        None,
    )


async def create_staff_member(db: AsyncSession, data: StaffCreate) -> StaffMember:
    payload = data.model_dump()
    staff = StaffMember(**payload)
    db.add(staff)
    await _commit_staff_changes(db)
    return staff


async def update_staff_member(
    db: AsyncSession, id: UUID, data: StaffUpdate
) -> StaffMember | None:
    staff = await get_staff_member(db, id, for_update=True)
    if staff is None:
        return None

    payload = data.model_dump(exclude_unset=True)
    next_is_active = payload.get("is_active", staff.is_active)
    next_zalo_name = payload.get("zalo_name", staff.zalo_name)
    next_phone = payload.get("phone", staff.phone)

    validate_complete_contact_pair(
        zalo_name=next_zalo_name,
        phone=next_phone,
        owner="nhân sự",
    )

    if staff.is_active and not next_is_active:
        active_assignments = await _read_assigned_classes(
            db,
            str(staff.id),
            active_only=True,
        )
        if active_assignments:
            raise StaffConflictError(
                _class_conflict_message(
                    "Hãy kết thúc phân công ở các lớp đang hoạt động trước",
                    active_assignments,
                )
            )

    for field, value in payload.items():
        setattr(staff, field, value)

    await _commit_staff_changes(db)
    return staff


async def archive_staff_member(db: AsyncSession, id: UUID) -> StaffMember | None:
    staff = await get_staff_member(db, id, for_update=True)
    if staff is None:
        return None
    if not staff.is_active:
        return staff

    active_assignments = await _read_assigned_classes(
        db,
        str(staff.id),
        active_only=True,
    )
    if active_assignments:
        raise StaffConflictError(
            _class_conflict_message(
                "Hãy kết thúc phân công ở các lớp đang hoạt động trước",
                active_assignments,
            )
        )

    staff.is_active = False
    await _commit_staff_changes(db)
    return staff


async def get_staff_attendance_history(
    db: AsyncSession,
    staff_id: UUID,
) -> StaffAttendanceHistoryResponse:
    """Admin/dev review: lịch sử chấm công (attendance + earning snapshot).

    Chỉ dùng cho quản lý rà soát; không lộ contact/PII ngoài tên lớp cần thiết.
    """
    from app.models.class_ import Class
    from app.models.staff_attendance import StaffAttendanceEntry

    result = await db.execute(
        select(
            StaffAttendanceEntry,
            Class.name.label("class_name"),
        )
        .outerjoin(Class, Class.id == StaffAttendanceEntry.occurrence_class_id)
        .where(StaffAttendanceEntry.staff_id == str(staff_id))
        .order_by(StaffAttendanceEntry.occurrence_start_at.desc())
        .limit(500)
    )
    items = [
        StaffAttendanceHistoryItem(
            attendance_id=UUID(str(entry.id)),
            class_name=class_name,
            role=entry.staff_role,
            occurrence_start_at=entry.occurrence_start_at,
            occurrence_end_at=entry.occurrence_end_at,
            kind=entry.occurrence_kind,
            checkin_at=entry.checkin_at,
            rate_amount=int(entry.rate_amount),
            rate_version=entry.rate_version,
            reversed_at=entry.reversed_at,
            reversal_reason=entry.reversal_reason,
        )
        for entry, class_name in result.all()
    ]
    return StaffAttendanceHistoryResponse(
        staff_id=staff_id,
        items=items,
    )
