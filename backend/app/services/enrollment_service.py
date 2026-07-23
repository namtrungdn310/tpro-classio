from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.student import Student
from app.schemas.enrollment import (
    EnrollmentCreate,
    EnrollmentResponse,
    EnrollmentUpdate,
)
from app.core.billing import (
    get_billing_period_key,
    get_enrollment_fee_amount,
)
from app.core.business_time import business_today
from app.services.fee_reconciliation import (
    lock_fee_period,
    reconcile_fee_record_for_period,
)
from app.services.student_service import clear_students_cache
from app.services.class_service import clear_classes_cache


def _clear_dependent_caches() -> None:
    clear_students_cache()
    clear_classes_cache()


def _to_response(enrollment: Enrollment) -> EnrollmentResponse:
    return EnrollmentResponse(
        id=enrollment.id,
        student_id=enrollment.student_id,
        class_id=enrollment.class_id,
        custom_fee=int(enrollment.custom_fee)
        if enrollment.custom_fee is not None
        else None,
        status=enrollment.status,
        enrollment_date=enrollment.enrollment_date,
        class_name=enrollment.class_.name if enrollment.class_ else "",
        effective_fee=get_enrollment_fee_amount(enrollment),
    )


def _current_period() -> str:
    return get_billing_period_key()


async def _get_enrollment(
    db: AsyncSession,
    id: UUID,
    *,
    for_update: bool = False,
) -> Enrollment | None:
    statement = (
        select(Enrollment)
        .where(Enrollment.id == str(id))
        .options(selectinload(Enrollment.class_))
    )
    if for_update:
        statement = statement.with_for_update()
    result = await db.execute(statement)
    return result.scalar_one_or_none()


async def _get_active_enrollments(
    db: AsyncSession,
    student_id: str,
) -> list[Enrollment]:
    result = await db.execute(
        select(Enrollment)
        .where(
            Enrollment.student_id == student_id,
            Enrollment.status == "active",
        )
        .options(selectinload(Enrollment.class_))
        .order_by(Enrollment.created_at.asc(), Enrollment.id.asc())
        .with_for_update()
    )
    return list(result.scalars().unique().all())


async def _reconcile_current_fee_records(
    db: AsyncSession,
    enrollments: list[Enrollment],
) -> None:
    current_period = _current_period()
    today = business_today()
    await lock_fee_period(db, current_period)
    for enrollment in enrollments:
        await reconcile_fee_record_for_period(
            db,
            enrollment,
            current_period,
            today,
        )


async def create_enrollment(
    db: AsyncSession,
    data: EnrollmentCreate,
) -> EnrollmentResponse:
    student = await db.scalar(
        select(Student)
        .where(
            Student.id == str(data.student_id),
            Student.status == "active",
        )
        .with_for_update()
    )
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học viên đang hoạt động",
        )

    class_ = await db.scalar(
        select(Class)
        .where(
            Class.id == str(data.class_id),
            Class.is_active.is_(True),
        )
        .with_for_update()
    )
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học đang hoạt động",
        )

    existing = await db.scalar(
        select(Enrollment)
        .where(
            Enrollment.student_id == str(data.student_id),
            Enrollment.class_id == str(data.class_id),
        )
        .with_for_update(),
    )
    if existing is not None:
        if existing.status == "active":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Học viên đã có trong lớp này",
            )

    active_enrollments = await _get_active_enrollments(db, str(data.student_id))
    existing_anchor = next(
        (
            active.enrollment_date
            for active in active_enrollments
            if active.enrollment_date is not None
        ),
        None,
    )
    shared_date = data.enrollment_date or existing_anchor or business_today()
    for active in active_enrollments:
        active.enrollment_date = shared_date

    if existing is not None:
        enrollment = existing
        enrollment.status = "active"
        enrollment.custom_fee = data.custom_fee
        enrollment.enrollment_date = shared_date
        enrollment.class_ = class_
    else:
        enrollment = Enrollment(
            student_id=str(data.student_id),
            class_id=str(data.class_id),
            custom_fee=data.custom_fee,
            enrollment_date=shared_date,
        )
        db.add(enrollment)
        await db.flush()
        enrollment.class_ = class_

    enrollments_to_reconcile = [
        *[active for active in active_enrollments if active.id != enrollment.id],
        enrollment,
    ]
    await _reconcile_current_fee_records(db, enrollments_to_reconcile)
    await db.commit()
    _clear_dependent_caches()

    created = await _get_enrollment(db, UUID(enrollment.id))
    if created is None:
        raise RuntimeError("Created or reactivated enrollment could not be loaded")

    return _to_response(created)


async def get_student_enrollments(
    db: AsyncSession,
    student_id: UUID,
) -> list[EnrollmentResponse]:
    result = await db.execute(
        select(Enrollment)
        .where(Enrollment.student_id == str(student_id))
        .options(selectinload(Enrollment.class_))
        .order_by(Enrollment.created_at.desc()),
    )
    return [_to_response(enrollment) for enrollment in result.scalars().all()]


async def update_enrollment(
    db: AsyncSession,
    id: UUID,
    data: EnrollmentUpdate,
) -> EnrollmentResponse | None:
    enrollment = await _get_enrollment(db, id)
    if enrollment is None:
        return None
    if enrollment.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Không thể chỉnh sửa một lớp học đã ngừng của học viên",
        )
    if enrollment.class_ is None or not enrollment.class_.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Không thể chỉnh sửa ghi danh của lớp đã ngừng hoạt động",
        )
    active_student_id = await db.scalar(
        select(Student.id)
        .where(
            Student.id == enrollment.student_id,
            Student.status == "active",
        )
        .with_for_update()
    )
    if active_student_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Không thể chỉnh sửa ghi danh của học viên đã ngừng hoạt động",
        )

    enrollment = await _get_enrollment(db, id, for_update=True)
    if enrollment is None:
        return None
    if enrollment.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Không thể chỉnh sửa một lớp học đã ngừng của học viên",
        )
    if enrollment.class_ is None or not enrollment.class_.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Không thể chỉnh sửa ghi danh của lớp đã ngừng hoạt động",
        )

    fields = data.model_fields_set
    if "custom_fee" in fields:
        enrollment.custom_fee = data.custom_fee
    if "enrollment_date" in fields:
        if data.enrollment_date is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Ngày bắt đầu không được để trống",
            )
        active_enrollments = await _get_active_enrollments(
            db,
            enrollment.student_id,
        )
        for active_enrollment in active_enrollments:
            active_enrollment.enrollment_date = data.enrollment_date
    else:
        active_enrollments = [enrollment]

    await _reconcile_current_fee_records(db, list(active_enrollments))
    await db.commit()
    _clear_dependent_caches()

    updated = await _get_enrollment(db, id)
    if updated is None:
        return None

    return _to_response(updated)


async def drop_enrollment(db: AsyncSession, id: UUID) -> EnrollmentResponse | None:
    enrollment = await _get_enrollment(db, id, for_update=True)
    if enrollment is None:
        return None

    if enrollment.status == "dropped":
        return _to_response(enrollment)

    enrollment.status = "dropped"
    await _reconcile_current_fee_records(db, [enrollment])
    await db.commit()
    _clear_dependent_caches()

    dropped = await _get_enrollment(db, id)
    if dropped is None:
        return None

    return _to_response(dropped)
