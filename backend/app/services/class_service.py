from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.billing import get_billing_period_key
from app.core.business_time import business_today
from app.core.performance import log_timing
from app.core.search import matches_smart_search, normalize_search_text
from app.models.class_ import Class
from app.models.class_teacher import ClassTeacher
from app.models.enrollment import Enrollment
from app.models.staff import StaffMember
from app.schemas.class_ import (
    ClassCreate,
    ClassResponse,
    ClassSchedule,
    ClassUpdate,
    validate_class_configuration,
)
from app.services.fee_reconciliation import (
    lock_fee_period,
    reconcile_fee_record_for_period,
)

_CACHE_TTL = timedelta(minutes=2)
_CACHE_MAX_ENTRIES = 128
_classes_cache: OrderedDict[
    tuple[str | None, str | None, bool | None],
    tuple[datetime, list[ClassResponse]],
] = OrderedDict()


def clear_classes_cache() -> None:
    _classes_cache.clear()


def _read_classes_cache(
    cache_key: tuple[str | None, str | None, bool | None],
) -> list[ClassResponse] | None:
    cached = _classes_cache.get(cache_key)
    if cached is None:
        return None
    cached_at, cached_classes = cached
    if datetime.now(timezone.utc) - cached_at >= _CACHE_TTL:
        _classes_cache.pop(cache_key, None)
        return None
    _classes_cache.move_to_end(cache_key)
    return cached_classes


def _write_classes_cache(
    cache_key: tuple[str | None, str | None, bool | None],
    classes: list[ClassResponse],
) -> None:
    _classes_cache[cache_key] = (datetime.now(timezone.utc), classes)
    _classes_cache.move_to_end(cache_key)
    while len(_classes_cache) > _CACHE_MAX_ENTRIES:
        _classes_cache.popitem(last=False)


def _clear_dependent_caches() -> None:
    clear_classes_cache()
    from app.services.student_service import clear_students_cache

    clear_students_cache()


async def _commit_class_changes(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if "classes_active_name_unique_idx" in str(exc):
            raise ValueError("Tên lớp đang được sử dụng") from exc
        raise


async def _reconcile_current_class_fees(
    db: AsyncSession,
    class_: Class,
) -> list[Enrollment]:
    current_period = get_billing_period_key()
    result = await db.execute(
        select(Enrollment)
        .where(
            Enrollment.class_id == class_.id,
            Enrollment.status == "active",
        )
        .with_for_update()
    )
    enrollments = list(result.scalars().unique().all())
    if not enrollments:
        return []

    await lock_fee_period(db, current_period)
    today = business_today()
    for enrollment in enrollments:
        enrollment.class_ = class_
        await reconcile_fee_record_for_period(
            db,
            enrollment,
            current_period,
            today,
        )
    return enrollments


def _to_response(
    class_: Class,
    student_count: int = 0,
) -> ClassResponse:
    teachers = [
        link.teacher
        for link in sorted(
            class_.teacher_links,
            key=lambda item: item.teacher.full_name if item.teacher else "",
        )
        if link.teacher is not None
    ]
    teacher_ids = [teacher.id for teacher in teachers]
    teacher_names = [teacher.full_name for teacher in teachers]
    legacy_teacher_id = teacher_ids[0] if teacher_ids else class_.teacher_id
    legacy_teacher_name = ", ".join(teacher_names) if teacher_names else None

    return ClassResponse(
        id=class_.id,
        name=class_.name,
        type=class_.type,
        base_fee=int(class_.base_fee),
        billing_cycle_months=class_.billing_cycle_months,
        start_date=class_.start_date,
        end_date=class_.end_date,
        schedule=class_.schedule,
        teacher_id=legacy_teacher_id,
        teacher_ids=teacher_ids,
        is_active=class_.is_active,
        student_count=student_count,
        teacher_name=legacy_teacher_name,
        teacher_names=teacher_names,
        created_at=class_.created_at,
    )


def _normalize_teacher_ids(
    teacher_ids: list[UUID | str] | None,
    legacy_teacher_id: UUID | str | None,
) -> list[str]:
    raw_ids = (
        teacher_ids
        if teacher_ids is not None
        else ([] if legacy_teacher_id is None else [legacy_teacher_id])
    )
    normalized: list[str] = []
    seen: set[str] = set()
    for teacher_id in raw_ids:
        value = str(teacher_id)
        if value not in seen:
            seen.add(value)
            normalized.append(value)
    return normalized


async def _sync_class_teachers(
    db: AsyncSession,
    class_: Class,
    teacher_ids: list[str],
) -> None:
    if teacher_ids:
        result = await db.execute(
            select(StaffMember.id).where(
                StaffMember.id.in_(teacher_ids),
                StaffMember.staff_type == "TEACHER",
                StaffMember.is_active.is_(True),
            )
        )
        existing_teacher_ids = {str(id_) for id_ in result.scalars().all()}
        missing_teacher_ids = [
            id_ for id_ in teacher_ids if id_ not in existing_teacher_ids
        ]
        if missing_teacher_ids:
            raise ValueError("Giáo viên không hợp lệ")

    await db.execute(delete(ClassTeacher).where(ClassTeacher.class_id == class_.id))
    class_.teacher_id = teacher_ids[0] if teacher_ids else None
    for teacher_id in teacher_ids:
        db.add(ClassTeacher(class_id=class_.id, teacher_id=teacher_id))


async def _get_class_teacher_ids(db: AsyncSession, class_: Class) -> list[str]:
    result = await db.execute(
        select(ClassTeacher.teacher_id)
        .where(ClassTeacher.class_id == class_.id)
        .order_by(ClassTeacher.teacher_id.asc())
    )
    teacher_ids = [str(teacher_id) for teacher_id in result.scalars().all()]
    if not teacher_ids and class_.teacher_id is not None:
        teacher_ids.append(str(class_.teacher_id))
    return teacher_ids


async def _validate_teacher_schedule_availability(
    db: AsyncSession,
    *,
    class_id: str,
    teacher_ids: list[str],
    schedule: dict | ClassSchedule | None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> None:
    if not teacher_ids:
        raise ValueError("Vui lòng chọn ít nhất một giáo viên")

    teacher_result = await db.execute(
        select(StaffMember)
        .where(
            StaffMember.id.in_(teacher_ids),
            StaffMember.staff_type == "TEACHER",
            StaffMember.is_active.is_(True),
        )
        .order_by(StaffMember.id.asc())
        .with_for_update()
    )
    teachers = list(teacher_result.scalars().all())
    teacher_by_id = {str(teacher.id): teacher for teacher in teachers}
    missing_teacher_ids = [
        teacher_id for teacher_id in teacher_ids if teacher_id not in teacher_by_id
    ]
    if missing_teacher_ids:
        raise ValueError("Giáo viên không hợp lệ hoặc đã ngừng hoạt động")

    normalized_schedule = (
        schedule
        if isinstance(schedule, ClassSchedule)
        else ClassSchedule.model_validate(schedule)
        if schedule is not None
        else None
    )
    if normalized_schedule is None or not normalized_schedule.slots:
        return

    result = await db.execute(
        select(
            Class.name,
            Class.schedule,
            ClassTeacher.teacher_id,
            Class.start_date,
            Class.end_date,
        )
        .join(ClassTeacher, ClassTeacher.class_id == Class.id)
        .where(
            Class.is_active.is_(True),
            Class.id != class_id,
            ClassTeacher.teacher_id.in_(teacher_ids),
        )
    )
    for (
        existing_name,
        existing_payload,
        teacher_id,
        existing_start_date,
        existing_end_date,
    ) in result.all():
        if not _date_ranges_overlap(
            start_date,
            end_date,
            existing_start_date,
            existing_end_date,
        ):
            continue
        if existing_payload is None:
            continue
        try:
            existing_schedule = ClassSchedule.model_validate(existing_payload)
        except ValueError as exc:
            raise ValueError(
                f"Lịch học đã lưu của lớp {existing_name} không hợp lệ. "
                "Vui lòng chỉnh sửa lớp này trước"
            ) from exc
        for requested in normalized_schedule.slots:
            for existing in existing_schedule.slots:
                overlaps = (
                    requested.day == existing.day
                    and requested.start < existing.end
                    and existing.start < requested.end
                )
                if overlaps:
                    teacher_name = teacher_by_id[str(teacher_id)].full_name
                    raise ValueError(
                        f"{teacher_name} đã có lịch lớp {existing_name} vào "
                        f"{requested.day}, {existing.start}-{existing.end}"
                    )


def _date_ranges_overlap(
    first_start: date | None,
    first_end: date | None,
    second_start: date | None,
    second_end: date | None,
) -> bool:
    """Return whether two inclusive class date ranges intersect.

    A missing start or end is an unbounded side of the range. Classes whose
    end date equals another class's start date still overlap on that day.
    """

    if first_end is not None and second_start is not None:
        if first_end < second_start:
            return False
    if second_end is not None and first_start is not None:
        if second_end < first_start:
            return False
    return True


async def get_classes(
    db: AsyncSession,
    search: str | None = None,
    type: str | None = None,
    is_active: bool | None = None,
) -> list[ClassResponse]:
    with log_timing(
        "class_service.get_classes",
        threshold_ms=40,
        search=bool(search),
        type=type,
        is_active=is_active,
    ):
        normalized_search = search.strip() if search else None
        cache_key = (
            normalize_search_text(normalized_search) if normalized_search else None,
            type or None,
            is_active,
        )
        cached_classes = _read_classes_cache(cache_key)
        if cached_classes is not None:
            return cached_classes

        active_enrollment_count = (
            select(
                Enrollment.class_id,
                func.count(Enrollment.id).label("student_count"),
            )
            .where(Enrollment.status == "active")
            .group_by(Enrollment.class_id)
            .subquery()
        )
        statement = (
            select(
                Class,
                func.coalesce(active_enrollment_count.c.student_count, 0).label(
                    "student_count"
                ),
            )
            .outerjoin(
                active_enrollment_count, active_enrollment_count.c.class_id == Class.id
            )
            .options(
                selectinload(Class.teacher_links).selectinload(ClassTeacher.teacher)
            )
            .order_by(Class.created_at.desc())
        )

        if type:
            statement = statement.where(Class.type == type)
        if is_active is not None:
            statement = statement.where(Class.is_active == is_active)

        with log_timing(
            "class_service.get_classes.db",
            threshold_ms=30,
            type=type,
            is_active=is_active,
        ):
            result = await db.execute(statement)

        classes = [
            _to_response(class_, student_count)
            for class_, student_count in result.all()
        ]
        if normalized_search:
            classes = [
                class_
                for class_ in classes
                if matches_smart_search(
                    normalized_search,
                    [
                        class_.name,
                        *class_.teacher_names,
                        class_.schedule.text if class_.schedule else None,
                    ],
                )
            ]

        _write_classes_cache(cache_key, classes)
        return classes


async def get_class(
    db: AsyncSession,
    id: UUID,
    *,
    for_update: bool = False,
) -> Class | None:
    statement = select(Class).where(Class.id == str(id))
    if for_update:
        statement = statement.with_for_update()
    result = await db.execute(statement)
    return result.scalar_one_or_none()


async def _ensure_unique_active_class_name(
    db: AsyncSession,
    name: str,
    *,
    exclude_id: str | None = None,
) -> None:
    statement = select(Class.id).where(
        Class.is_active.is_(True),
        func.lower(func.btrim(Class.name)) == name.strip().lower(),
    )
    if exclude_id is not None:
        statement = statement.where(Class.id != exclude_id)
    if await db.scalar(statement) is not None:
        raise ValueError("Tên lớp đang được sử dụng")


async def get_class_response(db: AsyncSession, id: UUID) -> ClassResponse | None:
    active_enrollment_count = (
        select(
            Enrollment.class_id,
            func.count(Enrollment.id).label("student_count"),
        )
        .where(Enrollment.status == "active")
        .group_by(Enrollment.class_id)
        .subquery()
    )
    result = await db.execute(
        select(
            Class,
            func.coalesce(active_enrollment_count.c.student_count, 0).label(
                "student_count"
            ),
        )
        .outerjoin(
            active_enrollment_count, active_enrollment_count.c.class_id == Class.id
        )
        .options(selectinload(Class.teacher_links).selectinload(ClassTeacher.teacher))
        .where(Class.id == str(id))
    )
    row = result.one_or_none()
    if row is None:
        return None
    class_, student_count = row
    return _to_response(class_, student_count)


async def create_class(db: AsyncSession, data: ClassCreate) -> Class:
    payload = data.model_dump()
    teacher_ids = _normalize_teacher_ids(
        payload.pop("teacher_ids", None),
        payload.pop("teacher_id", None),
    )
    if payload["type"] == "MONTHLY":
        payload["billing_cycle_months"] = 1

    await _ensure_unique_active_class_name(db, payload["name"])

    class_ = Class(**payload)
    db.add(class_)
    await db.flush()
    await _validate_teacher_schedule_availability(
        db,
        class_id=class_.id,
        teacher_ids=teacher_ids,
        schedule=payload.get("schedule"),
        start_date=payload.get("start_date"),
        end_date=payload.get("end_date"),
    )
    await _sync_class_teachers(db, class_, teacher_ids)
    await _commit_class_changes(db)
    await db.refresh(class_)
    _clear_dependent_caches()
    return class_


async def update_class(db: AsyncSession, id: UUID, data: ClassUpdate) -> Class | None:
    class_ = await get_class(db, id, for_update=True)
    if class_ is None:
        return None

    was_active = class_.is_active
    payload = data.model_dump(exclude_unset=True)
    teacher_ids_was_set = "teacher_ids" in payload or "teacher_id" in payload
    teacher_ids = _normalize_teacher_ids(
        payload.pop("teacher_ids", None),
        payload.pop("teacher_id", None)
        if "teacher_id" in payload
        else class_.teacher_id,
    )
    if not teacher_ids_was_set:
        teacher_ids = await _get_class_teacher_ids(db, class_)
    next_type = payload.get("type", class_.type)
    if next_type == "MONTHLY":
        payload["billing_cycle_months"] = 1

    next_billing_cycle = payload.get(
        "billing_cycle_months",
        class_.billing_cycle_months,
    )
    next_start_date = payload.get("start_date", class_.start_date)
    next_end_date = payload.get("end_date", class_.end_date)
    validate_class_configuration(
        class_type=next_type,
        billing_cycle_months=next_billing_cycle,
        start_date=next_start_date,
        end_date=next_end_date,
    )

    if teacher_ids_was_set and not teacher_ids:
        raise ValueError("Vui lòng chọn ít nhất một giáo viên")

    next_name = payload.get("name", class_.name)
    next_is_active = payload.get("is_active", class_.is_active)
    if next_is_active and ("name" in payload or not class_.is_active):
        await _ensure_unique_active_class_name(
            db,
            next_name,
            exclude_id=class_.id,
        )

    for field, value in payload.items():
        setattr(class_, field, value)

    if next_is_active and (
        teacher_ids_was_set
        or "schedule" in payload
        or "start_date" in payload
        or "end_date" in payload
        or not was_active
    ):
        await _validate_teacher_schedule_availability(
            db,
            class_id=class_.id,
            teacher_ids=teacher_ids,
            schedule=payload.get("schedule", class_.schedule),
            start_date=next_start_date,
            end_date=next_end_date,
        )

    if teacher_ids_was_set:
        await _sync_class_teachers(db, class_, teacher_ids)

    if {"base_fee", "type", "billing_cycle_months", "is_active"} & payload.keys():
        await _reconcile_current_class_fees(db, class_)

    await _commit_class_changes(db)
    await db.refresh(class_)
    _clear_dependent_caches()
    return class_


async def archive_class(db: AsyncSession, id: UUID) -> Class | None:
    class_ = await get_class(db, id, for_update=True)
    if class_ is None:
        return None

    class_.is_active = False
    active_enrollments = await _reconcile_current_class_fees(db, class_)
    for enrollment in active_enrollments:
        enrollment.status = "dropped"
    await db.commit()
    await db.refresh(class_)
    _clear_dependent_caches()
    return class_
