from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.schemas.enrollment import (
    EnrollmentCreate,
    EnrollmentResponse,
    EnrollmentUpdate,
)
from app.schemas.student import (
    StudentArchiveRequest,
    StudentCreateCommand,
    StudentListPageResponse,
    StudentListState,
    StudentMembershipCommand,
    StudentReactivationRequest,
    StudentResponse,
    StudentRestoreRequest,
    StudentScopeSummary,
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
    archive_student,
    apply_student_membership_command,
    create_student,
    get_student,
    get_students,
    get_student_scope_summary,
    redact_student_hidden_fields,
    restore_student,
    update_student,
)
from app.services.student_reactivation_service import reactivate_student

students_router = APIRouter(tags=["students"])
enrollments_router = APIRouter(tags=["enrollments"])


@students_router.get("", response_model=list[StudentResponse])
async def list_students(
    response: Response,
    search: str | None = Query(default=None, max_length=120),
    class_id: UUID | None = Query(default=None),
    status: StudentStatus | None = Query(default=None),
    list_state: StudentListState | None = Query(default=None),
    cursor: UUID | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> list[StudentResponse]:
    is_admin = principal.effective_role in {"dev", "admin"}
    students, has_more = await get_students(
        db,
        search=search if is_admin else None,
        class_id=class_id,
        status=status,
        list_state=list_state,
        cursor=cursor,
        limit=limit,
    )
    if has_more and students:
        response.headers["X-Next-Cursor"] = str(students[-1].id)
    response.headers["X-Has-More"] = "true" if has_more else "false"
    if is_admin:
        return students

    return [redact_student_hidden_fields(student) for student in students]


@students_router.post("", response_model=StudentResponse)
async def create_student_route(
    payload: StudentCreateCommand,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StudentResponse:
    return await create_student(
        db,
        payload,
        actor_user_id=principal.user_id,
    )


@students_router.get("/page", response_model=StudentListPageResponse)
async def list_students_page(
    search: str | None = Query(default=None, max_length=120),
    class_id: UUID | None = Query(default=None),
    status: StudentStatus | None = Query(default=None),
    list_state: StudentListState | None = Query(default=None),
    cursor: UUID | None = Query(default=None),
    limit: int = Query(default=80, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StudentListPageResponse:
    items, has_more = await get_students(
        db,
        search=search,
        class_id=class_id,
        status=status,
        list_state=list_state,
        cursor=cursor,
        limit=limit,
    )
    return StudentListPageResponse(
        items=items,
        next_cursor=items[-1].id if has_more and items else None,
        has_more=has_more,
    )


@students_router.get("/summary", response_model=StudentScopeSummary)
async def get_students_summary(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StudentScopeSummary:
    return await get_student_scope_summary(db)


@students_router.get("/{id}", response_model=StudentResponse)
async def get_student_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StudentResponse:
    student = await get_student(db, id)
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học viên",
        )
    return student


@students_router.post("/{id}/reactivate", response_model=StudentResponse)
async def reactivate_student_route(
    id: UUID,
    payload: StudentReactivationRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StudentResponse:
    return await reactivate_student(
        db,
        id,
        payload,
        actor_user_id=principal.user_id,
    )


@students_router.patch("/{id}", response_model=StudentResponse)
async def update_student_route(
    id: UUID,
    payload: StudentUpdate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StudentResponse:
    student = await update_student(db, id, payload)
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học viên",
        )

    return student


@students_router.post("/{id}/membership-command", response_model=StudentResponse)
async def student_membership_command_route(
    id: UUID,
    payload: StudentMembershipCommand,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StudentResponse:
    student = await apply_student_membership_command(
        db,
        id,
        payload,
        actor_user_id=principal.user_id,
    )
    if student is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy học viên")
    return student


@students_router.post("/{id}/archive", response_model=StudentResponse)
async def archive_student_route(
    id: UUID,
    payload: StudentArchiveRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StudentResponse:
    student = await archive_student(
        db,
        id,
        payload,
        actor_user_id=principal.user_id,
    )
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học viên",
        )
    return student


@students_router.post("/{id}/restore", response_model=StudentResponse)
async def restore_student_route(
    id: UUID,
    payload: StudentRestoreRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> StudentResponse:
    student = await restore_student(
        db,
        id,
        payload,
        actor_user_id=principal.user_id,
    )
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy học viên",
        )
    return student


@students_router.get("/{id}/enrollments", response_model=list[EnrollmentResponse])
async def list_student_enrollments(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> list[EnrollmentResponse]:
    return await get_student_enrollments(db, id)


@enrollments_router.post("", response_model=EnrollmentResponse)
async def create_enrollment_route(
    payload: EnrollmentCreate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> EnrollmentResponse:
    return await create_enrollment(db, payload)


@enrollments_router.patch("/{id}", response_model=EnrollmentResponse)
async def update_enrollment_route(
    id: UUID,
    payload: EnrollmentUpdate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
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
    principal: Principal = Depends(require_management),
) -> EnrollmentResponse:
    enrollment = await drop_enrollment(
        db,
        id,
        actor_user_id=principal.user_id,
    )
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học của học viên",
        )

    return enrollment
