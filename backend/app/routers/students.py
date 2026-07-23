from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_admin
from app.core.search import matches_smart_search
from app.schemas.enrollment import (
    EnrollmentCreate,
    EnrollmentResponse,
    EnrollmentUpdate,
)
from app.schemas.student import (
    ContactSuggestionResponse,
    StudentCreate,
    StudentResponse,
    StudentStatus,
    StudentUpdate,
)
from app.services.enrollment_service import (
    create_enrollment,
    drop_enrollment,
    get_student_enrollments,
    update_enrollment,
)
from app.services.student_service import (
    create_student,
    delete_student,
    get_students,
    lookup_contact_suggestion,
    redact_student_hidden_fields,
    update_student,
)

students_router = APIRouter(tags=["students"])
enrollments_router = APIRouter(tags=["enrollments"])


@students_router.get("", response_model=list[StudentResponse])
async def list_students(
    search: str | None = Query(default=None),
    class_id: UUID | None = Query(default=None),
    status: StudentStatus | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(get_current_user),
) -> list[StudentResponse]:
    is_admin = current_user.get("role") == "admin"
    students = await get_students(
        db,
        search=search if is_admin else None,
        class_id=class_id,
        status=status,
    )
    if is_admin:
        return students

    visible_students = [redact_student_hidden_fields(student) for student in students]
    if not search:
        return visible_students

    return [
        student
        for student in visible_students
        if matches_smart_search(
            search,
            [
                student.full_name,
                student.school,
                student.parent_phone,
                student.parent_zalo,
                student.student_phone,
                student.student_zalo,
                student.notes,
                *[class_.name for class_ in student.classes],
            ],
        )
    ]


@students_router.get(
    "/contact-suggestion", response_model=ContactSuggestionResponse | None
)
async def get_contact_suggestion(
    owner: Literal["student", "parent"],
    phone: str | None = Query(default=None, min_length=1, max_length=32),
    zalo_name: str | None = Query(default=None, min_length=1, max_length=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> ContactSuggestionResponse | None:
    if (phone is None) == (zalo_name is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide exactly one contact lookup value",
        )
    return await lookup_contact_suggestion(
        db,
        owner=owner,
        phone=phone,
        zalo_name=zalo_name,
    )


@students_router.post("", response_model=StudentResponse)
async def create_student_route(
    payload: StudentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> StudentResponse:
    return await create_student(db, payload)


@students_router.patch("/{id}", response_model=StudentResponse)
async def update_student_route(
    id: UUID,
    payload: StudentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> StudentResponse:
    student = await update_student(db, id, payload)
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học viên",
        )

    return student


@students_router.delete("/{id}")
async def delete_student_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> dict[str, str]:
    student = await delete_student(db, id)
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học viên",
        )

    return {"message": "Đã xoá học viên"}


@students_router.get("/{id}/enrollments", response_model=list[EnrollmentResponse])
async def list_student_enrollments(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(get_current_user),
) -> list[EnrollmentResponse]:
    return await get_student_enrollments(db, id)


@enrollments_router.post("", response_model=EnrollmentResponse)
async def create_enrollment_route(
    payload: EnrollmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> EnrollmentResponse:
    return await create_enrollment(db, payload)


@enrollments_router.patch("/{id}", response_model=EnrollmentResponse)
async def update_enrollment_route(
    id: UUID,
    payload: EnrollmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> EnrollmentResponse:
    enrollment = await update_enrollment(db, id, payload)
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học của học viên",
        )

    return enrollment


@enrollments_router.delete("/{id}", response_model=EnrollmentResponse)
async def drop_enrollment_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, str | None] = Depends(require_admin),
) -> EnrollmentResponse:
    enrollment = await drop_enrollment(db, id)
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học của học viên",
        )

    return enrollment
