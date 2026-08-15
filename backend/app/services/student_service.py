import re
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.performance import log_timing
from app.core.billing import get_enrollment_fee_amount
from app.core.billing_schedule import month_end
from app.core.business_time import business_today
from app.core.class_lifecycle import (
    is_operational_class,
    operational_class_predicate,
)
from app.core.phone import normalize_vietnam_phone
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.student import Student
from app.schemas.student import (
    StudentArchiveRequest,
    StudentClassInfo,
    StudentCreate,
    StudentCreateCommand,
    StudentEnrollmentInfo,
    StudentResponse,
    StudentRestoreRequest,
    StudentUpdate,
    validate_complete_contact_pairs,
)
from app.services.fee_cycle_service import (
    create_cycle_zero,
    ensure_enrollment_cycles,
)
from app.services.student_identity_service import (
    build_student_identity_conflict,
    find_student_identity_candidates,
    lock_student_identity,
)
from app.services.student_lifecycle_audit_service import (
    append_student_lifecycle_event,
)


def _normalize_phone(value: str | None) -> str | None:
    return normalize_vietnam_phone(value)


def _clear_dependent_caches() -> None:
    # R6: không còn process-local cache; no-op giữ signature cho callers.
    return None


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
        if (
            enrollment.status == "active"
            and enrollment.class_ is not None
            and enrollment.class_.identity_scheme != "LEGACY"
            and is_operational_class(enrollment.class_)
        )
    ]
    active_enrollments = [
        StudentEnrollmentInfo(
            id=enrollment.id,
            class_id=enrollment.class_.id,
            class_name=enrollment.class_.name,
            class_category=enrollment.class_.class_category,
            class_grade_mode=enrollment.class_.grade_mode,
            class_grade_level=enrollment.class_.grade_level,
            class_start_date=enrollment.class_.start_date,
            class_end_date=enrollment.class_.end_date,
            custom_fee=int(enrollment.custom_fee)
            if enrollment.custom_fee is not None
            else None,
            effective_fee=get_enrollment_fee_amount(enrollment),
            enrollment_date=enrollment.enrollment_date,
            status=enrollment.status,
        )
        for enrollment in student.enrollments
        if (
            enrollment.status == "active"
            and enrollment.class_ is not None
            and enrollment.class_.identity_scheme != "LEGACY"
            and is_operational_class(enrollment.class_)
        )
    ]

    return StudentResponse(
        id=student.id,
        student_code=student.student_code,
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
        list_state=_derive_list_state(student),
        archived_at=student.archived_at,
        archived_reason=student.archived_reason,
        classes=classes,
        active_enrollments=active_enrollments,
        created_at=student.created_at,
    )


def _derive_list_state(student: Student) -> str:
    """R6: derived list state — UNASSIGNED/CURRENT/FORMER; ARCHIVED explicit."""
    if student.status == "archived":
        return "ARCHIVED"
    has_active = any(
        enrollment.status == "active"
        and enrollment.class_ is not None
        and enrollment.class_.identity_scheme != "LEGACY"
        and is_operational_class(enrollment.class_)
        for enrollment in student.enrollments
    )
    if has_active:
        return "CURRENT"
    has_history = any(
        enrollment.status in ("dropped", "completed", "cancelled")
        for enrollment in student.enrollments
    )
    if has_history:
        return "FORMER"
    return "UNASSIGNED"


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
    list_state: str | None = None,
    cursor: UUID | None = None,
    limit: int = 200,
) -> tuple[list[StudentResponse], bool]:
    """Server-side, indexed, cursor-paginated student search (R6-D08).

    Không load-toàn-bộ-rồi-filter Python; không cache process-local.
    Search: student_code exact/prefix (indexed), name/phone/zalo SQL-normalized.
    Cursor: keyset (created_at, id) — ổn định dưới concurrent insert.
    """
    with log_timing(
        "student_service.get_students",
        threshold_ms=40,
        search=bool(search),
        class_id=str(class_id) if class_id else None,
        status=status,
        list_state=list_state,
    ):
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
                        Enrollment.class_.has(operational_class_predicate()),
                    ),
                ),
            )
        if status:
            statement = statement.where(Student.status == status)
        if list_state == "ARCHIVED":
            statement = statement.where(Student.status == "archived")
        elif list_state == "CURRENT":
            statement = statement.where(
                Student.enrollments.any(
                    and_(
                        Enrollment.status == "active",
                        Enrollment.class_.has(operational_class_predicate()),
                    )
                )
            )
        elif list_state == "FORMER":
            statement = statement.where(
                and_(
                    ~Student.enrollments.any(
                        and_(
                            Enrollment.status == "active",
                            Enrollment.class_.has(operational_class_predicate()),
                        )
                    ),
                    Student.enrollments.any(
                        Enrollment.status.in_(("dropped", "completed"))
                    ),
                )
            )
        elif list_state == "UNASSIGNED":
            statement = statement.where(
                ~Student.enrollments.any(
                    Enrollment.status.in_(("active", "dropped", "completed"))
                )
            )
        if cursor:
            cursor_row = await db.get(Student, str(cursor))
            if cursor_row is not None:
                statement = statement.where(
                    or_(
                        and_(
                            Student.created_at == cursor_row.created_at,
                            Student.id > str(cursor),
                        ),
                        Student.created_at < cursor_row.created_at,
                    )
                )

        bounded_limit = min(max(limit, 1), 500)
        statement = statement.limit(bounded_limit + 1)

        normalized_search = search.strip() if search else None
        if normalized_search:
            statement = _apply_student_search_filter(statement, normalized_search)

        with log_timing(
            "student_service.get_students.db",
            threshold_ms=30,
            class_id=str(class_id) if class_id else None,
            status=status,
        ):
            result = await db.execute(statement)

        students = list(result.scalars().unique().all())
        has_more = len(students) > bounded_limit
        if has_more:
            students = students[:bounded_limit]

        return [_to_response(student) for student in students], has_more


def _apply_student_search_filter(statement, normalized_search: str) -> None:
    """SQL-side search: student_code exact/prefix, name/phone/zalo normalized."""
    compact = re.sub(r"[\s\-]", "", normalized_search).upper()
    code_pattern = re.compile(r"^TP\d{9}$")
    code_prefix = bool(re.match(r"^TP\d{2,}$", compact))
    digits_only = re.sub(r"\D", "", compact)

    conditions = []
    if code_pattern.match(compact):
        conditions.append(
            or_(
                Student.student_code == compact,
                Student.student_code.like(f"{compact}%"),
            )
        )
    else:
        like_name = f"%{compact}%"
        compact_name = func.lower(
            func.replace(
                func.replace(func.coalesce(Student.full_name, ""), " ", ""), "-", ""
            )
        )
        compact_zalo = func.lower(
            func.replace(
                func.replace(func.coalesce(Student.parent_zalo, ""), " ", ""), "-", ""
            )
        )
        compact_zalo_student = func.lower(
            func.replace(
                func.replace(func.coalesce(Student.student_zalo, ""), " ", ""), "-", ""
            )
        )
        compact_school = func.lower(
            func.replace(
                func.replace(func.coalesce(Student.school, ""), " ", ""), "-", ""
            )
        )
        conditions.append(
            or_(
                compact_name.like(func.lower(like_name)),
                compact_zalo.like(func.lower(like_name)),
                compact_zalo_student.like(func.lower(like_name)),
                compact_school.like(func.lower(like_name)),
            )
        )
        if code_prefix:
            conditions.append(Student.student_code.like(f"{compact}%"))
    if digits_only:
        conditions.append(
            or_(
                func.regexp_replace(
                    func.coalesce(Student.parent_phone, ""), r"\D", "", "g"
                )
                == digits_only,
                func.regexp_replace(
                    func.coalesce(Student.student_phone, ""), r"\D", "", "g"
                )
                == digits_only,
            )
        )
    return statement.where(or_(*conditions))


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


async def create_student(
    db: AsyncSession,
    data: StudentCreate | StudentCreateCommand,
    *,
    actor_user_id: str | None = None,
) -> StudentResponse:
    duplicate_resolution = (
        data.duplicate_resolution if isinstance(data, StudentCreateCommand) else None
    )
    student_data = StudentCreate.model_validate(
        data.model_dump(exclude={"duplicate_resolution"})
    )
    payload = _clean_payload(student_data.model_dump())
    class_id = payload.pop("class_id")
    custom_fee = payload.pop("custom_fee")
    enrollment_date = payload.pop("enrollment_date")

    # R6: profile create độc lập lớp; ghi danh là command riêng (tùy chọn).
    if class_id is not None:
        class_ = await db.scalar(
            select(Class)
            .where(
                Class.id == str(class_id),
                operational_class_predicate(),
            )
            .with_for_update(),
        )
        if class_ is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy lớp học đang mở",
            )
    else:
        class_ = None

    await lock_student_identity(db, student_data)
    candidates = await find_student_identity_candidates(db, student_data)
    candidate_ids = {str(candidate.id) for candidate in candidates}
    acknowledged_ids = (
        {str(candidate_id) for candidate_id in duplicate_resolution.candidate_ids}
        if duplicate_resolution is not None
        else set()
    )
    if candidates and duplicate_resolution is None:
        conflict = build_student_identity_conflict(student_data, candidates)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=conflict.model_dump(mode="json"),
            headers={"Cache-Control": "no-store"},
        )
    if candidates and acknowledged_ids != candidate_ids:
        conflict = build_student_identity_conflict(
            student_data,
            candidates,
            changed=True,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=conflict.model_dump(mode="json"),
            headers={"Cache-Control": "no-store"},
        )

    student = Student(**payload)
    db.add(student)
    await db.flush()

    if class_ is not None:
        enrollment = Enrollment(
            student_id=student.id,
            class_id=str(class_id),
            custom_fee=custom_fee,
            enrollment_date=enrollment_date or business_today(),
        )
        db.add(enrollment)
        await db.flush()
        enrollment.class_ = class_
        # R6: cycle 0 cùng transaction ghi danh + các cycle trong tháng hiện tại.
        await create_cycle_zero(db, enrollment)
        await ensure_enrollment_cycles(
            db,
            enrollment,
            up_to=month_end(business_today()),
        )
        enrollment_id = enrollment.id
    else:
        enrollment_id = None
    if duplicate_resolution is not None:
        append_student_lifecycle_event(
            db,
            student_id=student.id,
            class_id=str(class_id) if class_id else None,
            enrollment_id=enrollment_id,
            actor_user_id=actor_user_id,
            action="duplicate_candidate_overridden",
            previous_status=None,
            next_status="active",
        )
    await db.commit()

    created_student = await get_student(db, UUID(student.id))
    if created_student is None:
        raise RuntimeError("Created student could not be loaded")

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
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc

    for field, value in payload.items():
        setattr(student, field, value)

    await db.commit()
    return await get_student(db, id)


async def archive_student(
    db: AsyncSession,
    id: UUID,
    request: StudentArchiveRequest,
    *,
    actor_user_id: str | None = None,
) -> StudentResponse | None:
    """R6: archive explicit, có actor/reason; giữ nguyên mã + history."""
    result = await db.execute(
        select(Student).where(Student.id == str(id)).with_for_update()
    )
    student = result.scalar_one_or_none()
    if student is None:
        return None

    previous_status = student.status
    student.status = "archived"
    student.archived_at = datetime.now(timezone.utc)
    student.archived_by = actor_user_id
    student.archived_reason = request.reason

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
        enrollment.ended_at = datetime.now(timezone.utc)
        enrollment.end_reason = "Hồ sơ học viên được lưu trữ"

    if previous_status != "archived":
        append_student_lifecycle_event(
            db,
            student_id=student.id,
            actor_user_id=actor_user_id,
            action="student_archived",
            previous_status=previous_status,
            next_status="archived",
        )

    await db.commit()
    return await get_student(db, id)


async def restore_student(
    db: AsyncSession,
    id: UUID,
    request: StudentRestoreRequest,
    *,
    actor_user_id: str | None = None,
) -> StudentResponse | None:
    """R6: restore explicit; mã không đổi; quay lại trạng thái active."""
    result = await db.execute(
        select(Student).where(Student.id == str(id)).with_for_update()
    )
    student = result.scalar_one_or_none()
    if student is None:
        return None

    if student.status != "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Chỉ hồ sơ đã lưu trữ mới được khôi phục",
        )
    previous_status = student.status
    student.status = "active"
    student.archived_at = None
    student.archived_by = None
    student.archived_reason = None

    append_student_lifecycle_event(
        db,
        student_id=student.id,
        actor_user_id=actor_user_id,
        action="student_restored",
        previous_status=previous_status,
        next_status="active",
    )

    await db.commit()
    return await get_student(db, id)
