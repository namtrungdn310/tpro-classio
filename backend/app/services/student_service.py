from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.performance import log_timing
from app.core.billing import get_billing_period_key, get_enrollment_fee_amount
from app.core.business_time import business_today
from app.core.phone import normalize_vietnam_phone
from app.core.search import matches_smart_search, normalize_search_text
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.student import Student
from app.schemas.student import (
    ContactSuggestionResponse,
    StudentClassInfo,
    StudentCreate,
    StudentEnrollmentInfo,
    StudentResponse,
    StudentUpdate,
    validate_complete_contact_pairs,
)
from app.services.class_service import clear_classes_cache
from app.services.fee_reconciliation import (
    lock_fee_period,
    reconcile_fee_record_for_period,
)

_CACHE_TTL = timedelta(minutes=2)
_students_cache: dict[
    tuple[str | None, str | None, str | None],
    tuple[datetime, list[StudentResponse]],
] = {}


def _read_students_cache(
    cache_key: tuple[str | None, str | None, str | None],
) -> list[StudentResponse] | None:
    cached = _students_cache.get(cache_key)
    if cached is None:
        return None

    cached_at, cached_students = cached
    if datetime.now(timezone.utc) - cached_at >= _CACHE_TTL:
        _students_cache.pop(cache_key, None)
        return None

    return cached_students


def clear_students_cache() -> None:
    _students_cache.clear()


def _clear_dependent_caches(include_classes: bool = True) -> None:
    clear_students_cache()
    if include_classes:
        clear_classes_cache()


def _normalize_phone(value: str | None) -> str | None:
    return normalize_vietnam_phone(value)


def _clean_payload(payload: dict) -> dict:
    cleaned = {
        key: (value.strip() if isinstance(value, str) else value)
        for key, value in payload.items()
    }
    if "parent_phone" in cleaned:
        cleaned["parent_phone"] = _normalize_phone(cleaned["parent_phone"])
    if "student_phone" in cleaned:
        cleaned["student_phone"] = _normalize_phone(cleaned["student_phone"])
    return cleaned


def _to_response(student: Student) -> StudentResponse:
    classes = [
        StudentClassInfo(id=enrollment.class_.id, name=enrollment.class_.name)
        for enrollment in student.enrollments
        if enrollment.status == "active" and enrollment.class_ is not None
    ]
    active_enrollments = [
        StudentEnrollmentInfo(
            id=enrollment.id,
            class_id=enrollment.class_.id,
            class_name=enrollment.class_.name,
            custom_fee=int(enrollment.custom_fee)
            if enrollment.custom_fee is not None
            else None,
            effective_fee=get_enrollment_fee_amount(enrollment),
            enrollment_date=enrollment.enrollment_date,
            status=enrollment.status,
        )
        for enrollment in student.enrollments
        if enrollment.status == "active" and enrollment.class_ is not None
    ]

    return StudentResponse(
        id=student.id,
        full_name=student.full_name,
        birth_date=student.birth_date,
        school=student.school,
        parent_name=student.parent_name,
        parent_phone=student.parent_phone,
        parent_zalo=student.parent_zalo,
        student_zalo=student.student_zalo,
        student_phone=student.student_phone,
        notes=student.notes,
        hidden_fields=student.hidden_fields or [],
        status=student.status,
        classes=classes,
        active_enrollments=active_enrollments,
        created_at=student.created_at,
    )


def redact_student_hidden_fields(student: StudentResponse) -> StudentResponse:
    """Return a display-safe copy without changing the cached admin response."""
    hidden_fields = set(student.hidden_fields)
    updates: dict[str, object] = {}

    if "birth_date" in hidden_fields:
        updates["birth_date"] = None
    if "school" in hidden_fields:
        updates["school"] = None
    if "student_contact" in hidden_fields:
        updates["student_phone"] = None
        updates["student_zalo"] = None
    if "parent_contact" in hidden_fields:
        updates["parent_phone"] = None
        updates["parent_zalo"] = None
        updates["parent_name"] = None
    if "notes" in hidden_fields:
        updates["notes"] = None

    if "enrollment_date" in hidden_fields or "custom_fee" in hidden_fields:
        enrollment_updates: dict[str, object] = {}
        if "enrollment_date" in hidden_fields:
            enrollment_updates["enrollment_date"] = None
        if "custom_fee" in hidden_fields:
            enrollment_updates["custom_fee"] = None
        updates["active_enrollments"] = [
            enrollment.model_copy(update=enrollment_updates)
            for enrollment in student.active_enrollments
        ]

    return student.model_copy(update=updates) if updates else student


async def get_students(
    db: AsyncSession,
    search: str | None = None,
    class_id: UUID | None = None,
    status: str | None = None,
) -> list[StudentResponse]:
    with log_timing(
        "student_service.get_students",
        threshold_ms=40,
        search=bool(search),
        class_id=str(class_id) if class_id else None,
        status=status,
    ):
        normalized_search = search.strip() if search else None
        cache_key = (
            normalize_search_text(normalized_search) if normalized_search else None,
            str(class_id) if class_id else None,
            status,
        )
        cached_students = _read_students_cache(cache_key)
        if cached_students is not None:
            return cached_students

        # The class pages request a subset of the same active-student model.
        # Reuse the warmed superset to avoid another remote database round-trip.
        if class_id is not None and normalized_search is None:
            all_students = _read_students_cache((None, None, status))
            if all_students is not None:
                class_id_text = str(class_id)
                response = [
                    student
                    for student in all_students
                    if any(
                        str(class_.id) == class_id_text for class_ in student.classes
                    )
                ]
                _students_cache[cache_key] = (datetime.now(timezone.utc), response)
                return response

        statement = (
            select(Student)
            .options(selectinload(Student.enrollments).selectinload(Enrollment.class_))
            .order_by(Student.created_at.desc(), Student.id.asc())
        )

        if class_id:
            statement = statement.where(
                Student.enrollments.any(
                    and_(
                        Enrollment.class_id == str(class_id),
                        Enrollment.status == "active",
                    ),
                ),
            )
        if status:
            statement = statement.where(Student.status == status)

        with log_timing(
            "student_service.get_students.db",
            threshold_ms=30,
            class_id=str(class_id) if class_id else None,
            status=status,
        ):
            result = await db.execute(statement)

        students = list(result.scalars().unique().all())
        if normalized_search:
            students = [
                student
                for student in students
                if matches_smart_search(
                    normalized_search,
                    [
                        student.full_name,
                        student.school,
                        student.parent_phone,
                        student.parent_zalo,
                        student.student_phone,
                        student.student_zalo,
                        student.parent_name,
                        *[
                            enrollment.class_.name
                            for enrollment in student.enrollments
                            if enrollment.status == "active"
                            and enrollment.class_ is not None
                        ],
                    ],
                )
            ]

        response = [_to_response(student) for student in students]
        _students_cache[cache_key] = (datetime.now(timezone.utc), response)
        return response


async def lookup_contact_suggestion(
    db: AsyncSession,
    *,
    owner: str,
    phone: str | None = None,
    zalo_name: str | None = None,
) -> ContactSuggestionResponse | None:
    """Find a complete, visible contact pair for inline form assistance.

    A hidden contact must never become an autocomplete source.  Keeping this
    check in the query also prevents briefly exposing the value to the client.
    """
    if owner not in {"student", "parent"}:
        return None

    phone_column = Student.student_phone if owner == "student" else Student.parent_phone
    zalo_column = Student.student_zalo if owner == "student" else Student.parent_zalo
    hidden_field = f"{owner}_contact"
    normalized_phone = _normalize_phone(phone) if phone is not None else None
    normalized_zalo_name = zalo_name.strip() if zalo_name is not None else ""
    if bool(normalized_phone) == bool(normalized_zalo_name):
        return None

    lookup_condition = (
        func.regexp_replace(func.coalesce(phone_column, ""), r"\D", "", "g")
        == normalized_phone
        if normalized_phone
        else func.lower(func.btrim(func.coalesce(zalo_column, "")))
        == normalized_zalo_name.lower()
    )

    result = await db.execute(
        select(
            phone_column.label("phone"),
            zalo_column.label("zalo_name"),
        )
        .distinct()
        .where(
            lookup_condition,
            phone_column.is_not(None),
            func.btrim(phone_column) != "",
            zalo_column.is_not(None),
            func.btrim(zalo_column) != "",
            ~Student.hidden_fields.contains([hidden_field]),
        )
        .limit(2),
    )
    rows = result.all()
    if len(rows) != 1:
        return None

    row = rows[0]
    if row.phone is None or row.zalo_name is None:
        return None

    return ContactSuggestionResponse(
        phone=row.phone,
        zalo_name=row.zalo_name,
    )


async def get_student(db: AsyncSession, id: UUID) -> StudentResponse | None:
    result = await db.execute(
        select(Student)
        .where(Student.id == str(id))
        .options(selectinload(Student.enrollments).selectinload(Enrollment.class_)),
    )
    student = result.scalar_one_or_none()
    if student is None:
        return None

    return _to_response(student)


async def create_student(db: AsyncSession, data: StudentCreate) -> StudentResponse:
    payload = _clean_payload(data.model_dump())
    class_id = payload.pop("class_id")
    custom_fee = payload.pop("custom_fee")
    enrollment_date = payload.pop("enrollment_date")

    class_ = await db.scalar(
        select(Class).where(
            Class.id == str(class_id),
            Class.is_active.is_(True),
        ),
    )
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học đang mở",
        )

    student = Student(**payload)
    db.add(student)
    await db.flush()

    enrollment = Enrollment(
        student_id=student.id,
        class_id=str(class_id),
        custom_fee=custom_fee,
        enrollment_date=enrollment_date or business_today(),
    )
    db.add(enrollment)
    await db.flush()
    enrollment.class_ = class_
    current_period = get_billing_period_key()
    await lock_fee_period(db, current_period)
    await reconcile_fee_record_for_period(
        db,
        enrollment,
        current_period,
        business_today(),
    )
    await db.commit()

    created_student = await get_student(db, UUID(student.id))
    if created_student is None:
        raise RuntimeError("Created student could not be loaded")

    _clear_dependent_caches()
    return created_student


async def update_student(
    db: AsyncSession,
    id: UUID,
    data: StudentUpdate,
) -> StudentResponse | None:
    result = await db.execute(
        select(Student).where(Student.id == str(id)).with_for_update()
    )
    student = result.scalar_one_or_none()
    if student is None:
        return None

    payload = _clean_payload(data.model_dump(exclude_unset=True))
    contact_fields = {
        "student_zalo",
        "student_phone",
        "parent_zalo",
        "parent_phone",
    }
    if contact_fields.intersection(payload):
        try:
            validate_complete_contact_pairs(
                student_zalo=payload.get("student_zalo", student.student_zalo),
                student_phone=payload.get("student_phone", student.student_phone),
                parent_zalo=payload.get("parent_zalo", student.parent_zalo),
                parent_phone=payload.get("parent_phone", student.parent_phone),
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

    for field, value in payload.items():
        setattr(student, field, value)

    await db.commit()
    _clear_dependent_caches(include_classes=False)
    return await get_student(db, id)


async def delete_student(db: AsyncSession, id: UUID) -> StudentResponse | None:
    result = await db.execute(
        select(Student).where(Student.id == str(id)).with_for_update()
    )
    student = result.scalar_one_or_none()
    if student is None:
        return None

    response = await get_student(db, id)
    if response is None:
        return None

    student.status = "inactive"
    active_enrollments_result = await db.execute(
        select(Enrollment)
        .where(
            Enrollment.student_id == student.id,
            Enrollment.status == "active",
        )
        .options(selectinload(Enrollment.class_))
        .with_for_update()
    )
    active_enrollments = list(active_enrollments_result.scalars().unique().all())
    for enrollment in active_enrollments:
        enrollment.status = "dropped"

    if active_enrollments:
        current_period = get_billing_period_key()
        await lock_fee_period(db, current_period)
        today = business_today()
        for enrollment in active_enrollments:
            await reconcile_fee_record_for_period(
                db,
                enrollment,
                current_period,
                today,
            )

    await db.commit()
    _clear_dependent_caches()
    return response
