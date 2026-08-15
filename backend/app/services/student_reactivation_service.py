from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.class_ import Class
from app.core.class_lifecycle import operational_class_predicate
from app.models.student import Student
from app.schemas.student import (
    StudentIdentityCandidate,
    StudentReactivationRequest,
    StudentResponse,
)
from app.services.enrollment_service import enroll_locked_student
from app.services.student_identity_service import (
    build_student_identity_conflict,
    find_student_identity_candidates,
    lock_student_identity,
)
from app.services.student_lifecycle_audit_service import (
    append_student_lifecycle_event,
)
from app.services.student_service import (
    _clean_payload,
    _clear_dependent_caches,
    get_student,
)


def _raise_identity_changed(
    request: StudentReactivationRequest,
    candidates: list[StudentIdentityCandidate],
) -> None:
    if candidates:
        conflict = build_student_identity_conflict(
            request.student,
            candidates,
            changed=True,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=conflict.model_dump(mode="json"),
            headers={"Cache-Control": "no-store"},
        )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "STUDENT_IDENTITY_STALE",
            "message": (
                "Thông tin hồ sơ đã thay đổi. Vui lòng quay lại form và kiểm tra lại."
            ),
        },
        headers={"Cache-Control": "no-store"},
    )


async def reactivate_student(
    db: AsyncSession,
    student_id: UUID,
    request: StudentReactivationRequest,
    *,
    actor_user_id: str | None,
) -> StudentResponse:
    class_ = await db.scalar(
        select(Class)
        .where(
            Class.id == str(request.student.class_id),
            operational_class_predicate(),
            Class.identity_scheme != "LEGACY",
        )
        .with_for_update()
    )
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học đang mở",
        )

    await lock_student_identity(db, request.student)
    candidates = await find_student_identity_candidates(db, request.student)
    selected_candidate = next(
        (candidate for candidate in candidates if str(candidate.id) == str(student_id)),
        None,
    )
    if selected_candidate is None:
        _raise_identity_changed(request, candidates)

    student = await db.scalar(
        select(Student)
        .where(Student.id == str(student_id))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy hồ sơ học viên",
        )
    if student.updated_at != request.expected_updated_at:
        _raise_identity_changed(request, candidates)

    previous_status = student.status
    payload = _clean_payload(request.student.model_dump())
    payload.pop("class_id")
    custom_fee = payload.pop("custom_fee")
    enrollment_date = payload.pop("enrollment_date")
    for field, value in payload.items():
        setattr(student, field, value)
    student.status = "active"

    enrollment = await enroll_locked_student(
        db,
        student=student,
        class_=class_,
        custom_fee=custom_fee,
        enrollment_date=enrollment_date,
    )
    append_student_lifecycle_event(
        db,
        student_id=student.id,
        class_id=class_.id,
        enrollment_id=enrollment.id,
        actor_user_id=actor_user_id,
        action=(
            "student_reactivated"
            if previous_status == "inactive"
            else "existing_student_enrolled"
        ),
        previous_status=previous_status,
        next_status="active",
    )
    await db.commit()
    _clear_dependent_caches()

    restored = await get_student(db, student_id)
    if restored is None:
        raise RuntimeError("Reactivated student could not be loaded")
    return restored
