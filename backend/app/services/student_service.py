import hashlib
import json
import re
from datetime import datetime, timezone
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import raiseload, selectinload

from app.core.performance import log_timing
from app.core.billing import get_enrollment_fee_amount
from app.core.business_time import business_today
from app.core.class_lifecycle import (
    is_operational_class,
    operational_class_predicate,
)
from app.core.student_lifecycle import (
    derive_student_list_state,
    student_list_state_filter,
)
from app.core.enrollment_lifecycle import (
    effective_enrollment_state,
    enrollment_current_or_scheduled_predicate,
    enrollment_visible_current_or_scheduled,
)
from app.core.phone import normalize_vietnam_phone
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.student_membership_command import (
    StudentMembershipCommandItem,
    StudentMembershipCommandRecord,
)
from app.models.student import Student
from app.schemas.student import (
    StudentArchiveRequest,
    StudentClassInfo,
    StudentCreate,
    StudentCreateCommand,
    StudentEnrollmentInfo,
    StudentLastEnrollmentInfo,
    StudentResponse,
    StudentScopeSummary,
    StudentMembershipCommand,
    StudentMembershipPreviewRequest,
    StudentRestoreRequest,
    StudentUpdate,
    validate_complete_contact_pairs,
)
from app.services.enrollment_service import (
    _reconcile_current_fee_records,
    _replace_slot_selections,
    close_enrollment_financial_projection,
    close_enrollment_slot_selections,
    enroll_locked_student,
    realign_open_slot_selections,
)
from app.services.student_identity_service import (
    build_student_identity_conflict,
    find_student_identity_candidates,
    lock_student_identity,
)
from app.services.student_lifecycle_audit_service import (
    append_student_lifecycle_event,
)
from app.services.enrollment_guard import ensure_enrollment_allowed


def _normalize_phone(value: str | None) -> str | None:
    return normalize_vietnam_phone(value)


def _clear_dependent_caches() -> None:
    # R6: không còn process-local cache; no-op giữ signature cho callers.
    return None


def _student_response_load_options():
    """Load only relationships serialized by ``_to_response``.

    ``Class`` owns several ``lazy='selectin'`` collections used by the class
    workspace. Loading a class through a student must not recursively fetch
    teachers, exceptions, adjustments and class rosters that the student
    response never reads.
    """

    enrollments = selectinload(Student.enrollments)
    return (
        enrollments.selectinload(Enrollment.class_).raiseload("*"),
        enrollments.selectinload(Enrollment.slot_selections),
    )


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


def _membership_command_hash(
    student_id: UUID, command: StudentMembershipCommand
) -> str:
    payload = command.model_dump(mode="json", exclude={"expected_preview_fingerprint"})
    canonical = json.dumps(
        {"student_id": str(student_id), "command": payload},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _to_response(student: Student) -> StudentResponse:
    classes = [
        StudentClassInfo(id=enrollment.class_.id, name=enrollment.class_.name)
        for enrollment in student.enrollments
        if (
            enrollment_visible_current_or_scheduled(enrollment)
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
            class_end_date=None,
            custom_fee=int(enrollment.custom_fee)
            if enrollment.custom_fee is not None
            else None,
            effective_fee=get_enrollment_fee_amount(enrollment),
            enrollment_date=enrollment.enrollment_date,
            ended_on=enrollment.ended_on,
            effective_state=effective_enrollment_state(enrollment),
            billing_anchor_version=int(enrollment.billing_anchor_version or 0),
            status=enrollment.status,
            selected_slot_ids=[
                selection.slot_id
                for selection in enrollment.slot_selections
                if selection.effective_until is None
            ],
        )
        for enrollment in student.enrollments
        if (
            enrollment_visible_current_or_scheduled(enrollment)
            and enrollment.class_ is not None
            and enrollment.class_.identity_scheme != "LEGACY"
            and is_operational_class(enrollment.class_)
        )
    ]
    historical_enrollments = [
        enrollment
        for enrollment in student.enrollments
        if enrollment.class_ is not None
        and enrollment.class_.identity_scheme != "LEGACY"
    ]
    latest_enrollment = max(
        historical_enrollments,
        key=lambda enrollment: (
            enrollment.ended_at or enrollment.created_at,
            enrollment.created_at,
            enrollment.id,
        ),
        default=None,
    )

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
        list_state=derive_student_list_state(student),
        archived_at=student.archived_at,
        archived_reason=student.archived_reason,
        classes=classes,
        active_enrollments=active_enrollments,
        last_enrollment=StudentLastEnrollmentInfo(
            class_id=latest_enrollment.class_id,
            class_name=latest_enrollment.class_.name,
            status=latest_enrollment.status,
            enrollment_date=latest_enrollment.enrollment_date,
            ended_on=latest_enrollment.ended_on,
            effective_state=effective_enrollment_state(latest_enrollment),
            ended_at=latest_enrollment.ended_at,
            end_reason=latest_enrollment.end_reason,
        )
        if latest_enrollment is not None
        else None,
        created_at=student.created_at,
        updated_at=student.updated_at,
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
    Cursor: keyset theo đúng thứ tự hiển thị — mã học viên tăng dần trong
    một lớp, hoặc (created_at, id) cho các danh sách hồ sơ còn lại.
    """
    with log_timing(
        "student_service.get_students",
        threshold_ms=40,
        search=bool(search),
        class_id=str(class_id) if class_id else None,
        status=status,
        list_state=list_state,
    ):
        statement = select(Student).options(*_student_response_load_options())

        if class_id:
            statement = (
                statement.where(
                    Student.enrollments.any(
                        and_(
                            Enrollment.class_id == str(class_id),
                            enrollment_current_or_scheduled_predicate(),
                            Enrollment.class_.has(operational_class_predicate()),
                        ),
                    ),
                )
                # Student codes contain a fixed-width eight-digit serial before
                # the final check digit. Lexical order therefore matches the
                # center-wide student sequence shown to users.
                .order_by(Student.student_code.asc().nulls_last(), Student.id.asc())
            )
        else:
            statement = statement.order_by(Student.created_at.desc(), Student.id.asc())
        if status:
            statement = statement.where(Student.status == status)
        if list_state is not None:
            statement = statement.where(student_list_state_filter(list_state))
        if cursor:
            cursor_row = await db.get(Student, str(cursor))
            if cursor_row is not None:
                if class_id:
                    if cursor_row.student_code is None:
                        statement = statement.where(
                            and_(
                                Student.student_code.is_(None), Student.id > str(cursor)
                            )
                        )
                    else:
                        statement = statement.where(
                            or_(
                                Student.student_code > cursor_row.student_code,
                                and_(
                                    Student.student_code == cursor_row.student_code,
                                    Student.id > str(cursor),
                                ),
                                Student.student_code.is_(None),
                            )
                        )
                else:
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


async def get_student_scope_summary(db: AsyncSession) -> StudentScopeSummary:
    """Return all workspace-scoped list counters in one database round trip."""
    statement = select(
        func.count(Student.id)
        .filter(student_list_state_filter("UNASSIGNED"))
        .label("unassigned"),
        func.count(Student.id)
        .filter(student_list_state_filter("CURRENT"))
        .label("current"),
        func.count(Student.id)
        .filter(student_list_state_filter("STOPPED"))
        .label("stopped"),
    )
    row = (await db.execute(statement)).one()
    return StudentScopeSummary(
        unassigned=int(row.unassigned or 0),
        current=int(row.current or 0),
        stopped=int(row.stopped or 0),
    )


def _apply_student_search_filter(statement, normalized_search: str) -> None:
    """SQL-side search: student_code exact/prefix, name/phone/zalo normalized."""
    # The UI displays codes as ``TP-0000-0001-8`` while the database stores
    # the immutable compact form ``TP000000018``. Strip every non-alphanumeric
    # separator for the code branch so copy/paste from the table, spaces, and
    # typographic dashes all resolve to the same student.
    compact = re.sub(r"[\s\-]", "", normalized_search).upper()
    code_compact = re.sub(r"[^A-Z0-9]", "", normalized_search.upper())
    code_pattern = re.compile(r"^TP\d{9}$")
    code_prefix = bool(re.match(r"^TP\d{2,}$", code_compact))
    digits_only = re.sub(r"\D", "", compact)

    conditions = []
    if code_pattern.match(code_compact):
        conditions.append(
            or_(
                Student.student_code == code_compact,
                Student.student_code.like(f"{code_compact}%"),
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
            conditions.append(Student.student_code.like(f"{code_compact}%"))
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
        # Also accept the numeric serial copied from the visible code. The
        # serial is eight digits, so a short query such as ``16`` resolves to
        # ``TP00000016X`` (the same value shown as ``TP-0000-0016-X``). This
        # keeps code lookup useful without matching arbitrary digit substrings
        # from unrelated student codes.
        if len(digits_only) == 9:
            conditions.append(Student.student_code == f"TP{digits_only}")
        elif 1 <= len(digits_only) <= 8:
            conditions.append(Student.student_code.like(f"TP{digits_only.zfill(8)}%"))
    return statement.where(or_(*conditions))


async def get_student(db: AsyncSession, id: UUID) -> StudentResponse | None:
    result = await db.execute(
        select(Student)
        .where(Student.id == str(id))
        .options(*_student_response_load_options())
        # Membership commands can add/remove rows while this Student already
        # exists in the session identity map.  Refresh the loaded collections
        # so the response never returns the pre-command roster.
        .execution_options(populate_existing=True),
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
    selected_slot_ids = payload.pop("selected_slot_ids")

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
        enrollment = await enroll_locked_student(
            db,
            student=student,
            class_=class_,
            custom_fee=custom_fee,
            enrollment_date=enrollment_date,
            selected_slot_ids=(
                [str(slot_id) for slot_id in selected_slot_ids]
                if selected_slot_ids is not None
                else None
            ),
            actor_user_id=actor_user_id,
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


async def apply_student_membership_command(
    db: AsyncSession,
    id: UUID,
    command: StudentMembershipCommand,
    *,
    actor_user_id: str | None = None,
) -> StudentResponse | None:
    """Apply profile, membership and slot changes in one database transaction."""

    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"student-command:{command.request_id}"},
    )
    payload_hash = _membership_command_hash(id, command)
    previous_command = await db.scalar(
        select(StudentMembershipCommandRecord).where(
            StudentMembershipCommandRecord.request_id == str(command.request_id)
        )
    )
    if previous_command is not None:
        if previous_command.payload_hash != payload_hash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "IDEMPOTENCY_PAYLOAD_MISMATCH",
                    "message": "Mã yêu cầu đã được dùng cho một nội dung khác.",
                },
            )
        if previous_command.state == "COMPLETED":
            return await get_student(db, id)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "MEMBERSHIP_COMMAND_IN_PROGRESS",
                "message": "Yêu cầu đang được xử lý. Vui lòng thử lại sau.",
            },
        )
    referenced_enrollment_ids = {
        str(item.enrollment_id) for item in command.enrollment_updates
    }
    if command.source_enrollment_id is not None:
        referenced_enrollment_ids.add(str(command.source_enrollment_id))
    referenced_class_ids: set[str] = set()
    if referenced_enrollment_ids:
        referenced_class_ids = set(
            (
                await db.scalars(
                    select(Enrollment.class_id).where(
                        Enrollment.id.in_(sorted(referenced_enrollment_ids)),
                        Enrollment.student_id == str(id),
                    )
                )
            ).all()
        )
        if len(referenced_class_ids) == 0:
            raise HTTPException(
                status_code=409, detail="Thông tin lớp của học viên đã thay đổi"
            )
    class_ids = sorted(
        {str(target.class_id) for target in command.targets} | referenced_class_ids
    )
    if class_ids:
        locked_classes = list(
            (
                await db.scalars(
                    select(Class)
                    .where(Class.id.in_(class_ids), operational_class_predicate())
                    .options(raiseload("*"))
                    .order_by(Class.id)
                    .with_for_update()
                )
            ).all()
        )
        if len(locked_classes) != len(class_ids):
            raise HTTPException(
                status_code=404, detail="Không tìm thấy lớp học đang mở"
            )
    else:
        locked_classes = []
    class_by_id = {class_.id: class_ for class_ in locked_classes}

    student = await db.scalar(
        select(Student)
        .where(Student.id == str(id))
        .options(*_student_response_load_options())
        .with_for_update()
    )
    if student is None:
        return None
    if student.status == "archived":
        raise HTTPException(
            status_code=409, detail="Hãy khôi phục hồ sơ trước khi thay đổi lớp"
        )
    if student.updated_at != command.expected_updated_at:
        raise HTTPException(
            status_code=409, detail="Hồ sơ vừa được thay đổi. Vui lòng tải lại."
        )

    preview = None
    has_date_change = any(
        update.enrollment_date is not None for update in command.enrollment_updates
    )
    requires_preview = (
        command.contract_version in (2, 3)
        and (bool(command.targets) or has_date_change)
    ) or command.expected_preview_fingerprint is not None
    if requires_preview:
        if not command.expected_preview_fingerprint:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Yêu cầu thay đổi lớp bắt buộc phải có mã xác thực xem trước",
            )

        from app.models.fee_record import FeeRecord
        from app.services.membership_preview_service import preview_student_membership

        # Khóa toàn bộ FeeRecord liên quan của học viên bằng FOR UPDATE trước khi
        # tính lại fingerprint và giữ khóa đến khi commit transaction.
        locked_fee_enrollment_ids = set()
        if command.source_enrollment_id is not None:
            locked_fee_enrollment_ids.add(str(command.source_enrollment_id))
        for update in command.enrollment_updates:
            locked_fee_enrollment_ids.add(str(update.enrollment_id))
        if locked_fee_enrollment_ids:
            await db.execute(
                select(FeeRecord.id)
                .where(
                    FeeRecord.enrollment_id.in_(sorted(locked_fee_enrollment_ids)),
                    FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
                )
                .order_by(FeeRecord.id)
                .with_for_update()
            )

        preview = await preview_student_membership(
            db,
            id,
            StudentMembershipPreviewRequest(
                expected_updated_at=command.expected_updated_at,
                targets=command.targets,
                enrollment_updates=command.enrollment_updates,
                mode=command.mode,
                source_enrollment_id=command.source_enrollment_id,
                contract_version=command.contract_version,
            ),
        )
        if preview is None:
            return None
        if (
            command.expected_preview_fingerprint is not None
            and preview.preview_fingerprint != command.expected_preview_fingerprint
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "STALE_MEMBERSHIP_PREVIEW",
                    "message": "Thông tin lớp hoặc học phí đã thay đổi. Vui lòng kiểm tra lại.",
                },
            )

    command_record = StudentMembershipCommandRecord(
        request_id=str(command.request_id),
        payload_hash=payload_hash,
        preview_fingerprint=command.expected_preview_fingerprint,
        student_id=str(id),
        source_enrollment_id=(
            str(command.source_enrollment_id)
            if command.source_enrollment_id is not None
            else None
        ),
        mode=command.mode,
        state="PENDING",
        target_count=len(command.targets),
        actor_user_id=actor_user_id,
    )
    db.add(command_record)
    await db.flush()

    profile_payload = _clean_payload(command.profile.model_dump(exclude_unset=True))
    contact_fields = {"student_zalo", "student_phone", "parent_zalo", "parent_phone"}
    if contact_fields.intersection(profile_payload):
        try:
            validate_complete_contact_pairs(
                student_zalo=profile_payload.get("student_zalo", student.student_zalo),
                student_phone=profile_payload.get(
                    "student_phone", student.student_phone
                ),
                parent_zalo=profile_payload.get("parent_zalo", student.parent_zalo),
                parent_phone=profile_payload.get("parent_phone", student.parent_phone),
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    for field, value in profile_payload.items():
        setattr(student, field, value)

    enrollment_ids = referenced_enrollment_ids
    enrollment_by_id: dict[str, Enrollment] = {}
    if enrollment_ids:
        enrollments = list(
            (
                await db.scalars(
                    select(Enrollment)
                    .where(
                        Enrollment.id.in_(sorted(enrollment_ids)),
                        Enrollment.student_id == student.id,
                    )
                    .options(selectinload(Enrollment.class_).raiseload("*"))
                    .order_by(Enrollment.id)
                    .with_for_update()
                )
            ).all()
        )
        enrollment_by_id = {enrollment.id: enrollment for enrollment in enrollments}
        if len(enrollment_by_id) != len(enrollment_ids):
            raise HTTPException(
                status_code=409, detail="Thông tin lớp của học viên đã thay đổi"
            )

    for update in command.enrollment_updates:
        enrollment = enrollment_by_id[str(update.enrollment_id)]
        if enrollment.status != "active":
            raise HTTPException(
                status_code=409, detail="Lớp của học viên không còn hoạt động"
            )
        fields = update.model_fields_set
        if "custom_fee" in fields:
            enrollment.custom_fee = update.custom_fee
        if "enrollment_date" in fields:
            if update.enrollment_date is None:
                raise HTTPException(
                    status_code=422, detail="Ngày bắt đầu không được để trống"
                )
            from app.services.enrollment_service import resolve_enrollment_date
            from app.services.billing_anchor_service import reanchor_enrollment_billing

            resolved_date = resolve_enrollment_date(
                enrollment.class_, update.enrollment_date
            )
            await ensure_enrollment_allowed(db, enrollment.class_, resolved_date)
            if resolved_date != enrollment.enrollment_date:
                previous_start = enrollment.enrollment_date
                await reanchor_enrollment_billing(
                    db,
                    enrollment,
                    new_anchor=resolved_date,
                    reason=(
                        update.billing_change_reason
                        or command.billing_change_reason
                        or "Điều chỉnh ngày bắt đầu từ hồ sơ học viên"
                    ),
                    actor_user_id=actor_user_id,
                    request_id=uuid5(
                        NAMESPACE_URL,
                        f"{command.request_id}:enrollment:{enrollment.id}",
                    ),
                    expected_version=update.expected_billing_version,
                    decision_code=update.decision_code,
                    selected_historical_cycles=update.selected_historical_cycles,
                )
                if "selected_slot_ids" not in fields and previous_start is not None:
                    await realign_open_slot_selections(
                        db,
                        enrollment,
                        enrollment.class_,
                        previous_start=previous_start,
                        next_start=resolved_date,
                    )
        if "selected_slot_ids" in fields:
            await _replace_slot_selections(
                db,
                enrollment,
                enrollment.class_,
                [str(slot_id) for slot_id in (update.selected_slot_ids or [])],
                actor_user_id=actor_user_id,
            )
        if {"custom_fee", "enrollment_date"}.intersection(fields):
            await _reconcile_current_fee_records(db, [enrollment])

    active_class_ids = {
        enrollment.class_id
        for enrollment in student.enrollments
        if enrollment.status == "active"
    }
    created_targets: list[Enrollment] = []
    protected_overlap = bool(
        preview is not None
        and preview.source is not None
        and preview.source.protected_fee_count > 0
    )
    source_for_transfer = (
        enrollment_by_id.get(str(command.source_enrollment_id))
        if command.source_enrollment_id is not None
        else None
    )
    for target in command.targets:
        target_class_id = str(target.class_id)
        if target_class_id in active_class_ids:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "TARGET_ALREADY_ACTIVE",
                    "message": "Học viên đã có trong lớp được chọn.",
                    "class_id": target_class_id,
                },
            )
        created = await enroll_locked_student(
            db,
            student=student,
            class_=class_by_id[target_class_id],
            custom_fee=target.custom_fee,
            enrollment_date=target.enrollment_date,
            selected_slot_ids=[str(slot_id) for slot_id in target.selected_slot_ids]
            if target.selected_slot_ids is not None
            else None,
            actor_user_id=actor_user_id,
            excluded_conflict_enrollment_ids=(
                {source_for_transfer.id}
                if command.mode == "transfer" and source_for_transfer is not None
                else None
            ),
            billing_review_required=protected_overlap,
            billing_change_kind=(
                "MEMBERSHIP_TRANSFER" if command.mode == "transfer" else None
            ),
            billing_reason=(
                "Rà soát lịch thu sau khi chuyển lớp"
                if command.mode == "transfer"
                else None
            ),
        )
        created_targets.append(created)
        db.add(
            StudentMembershipCommandItem(
                command_id=command_record.id,
                class_id=created.class_id,
                enrollment_id=created.id,
                requested_start=target.enrollment_date,
                resolved_start=created.enrollment_date,
                custom_fee_snapshot=target.custom_fee,
                selected_slot_ids=(
                    [str(slot_id) for slot_id in target.selected_slot_ids]
                    if target.selected_slot_ids is not None
                    else None
                ),
            )
        )
        active_class_ids.add(target_class_id)

    if command.mode == "transfer" and command.source_enrollment_id is not None:
        source = enrollment_by_id[str(command.source_enrollment_id)]
        target_enrollment = created_targets[0]
        transfer_on = target_enrollment.enrollment_date
        if source.enrollment_date is None or transfer_on <= source.enrollment_date:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "TRANSFER_BEFORE_SOURCE_START",
                    "message": "Ngày chuyển lớp phải sau ngày bắt đầu của lớp nguồn.",
                },
            )
        if source.status != "cancelled":
            from app.services.fee_cycle_service import ensure_final_cycle_for_stop

            await ensure_final_cycle_for_stop(db, source, stopped_on=transfer_on)
            source.status = "dropped"
            source.ended_on = transfer_on
            source.ended_at = datetime.now(timezone.utc)
            source.end_reason = f"Chuyển lớp từ {transfer_on:%d/%m/%Y}"
            await close_enrollment_slot_selections(
                db,
                source,
                ended_on=transfer_on,
            )
            await close_enrollment_financial_projection(
                db,
                source,
                actor_user_id=actor_user_id,
                reason="Chuyển lớp",
                close_on=transfer_on,
            )

    command_record.state = "COMPLETED"
    command_record.completed_at = datetime.now(timezone.utc)
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
            enrollment_current_or_scheduled_predicate(),
        )
        .options(selectinload(Enrollment.class_))
        .with_for_update()
    )
    active_enrollments = list(active_enrollments_result.scalars().unique().all())
    for enrollment in active_enrollments:
        today = business_today()
        never_started = bool(
            enrollment.enrollment_date is not None
            and enrollment.enrollment_date > today
        )
        if not never_started:
            from app.services.fee_cycle_service import ensure_final_cycle_for_stop

            await ensure_final_cycle_for_stop(db, enrollment, stopped_on=today)
        enrollment.status = "cancelled" if never_started else "dropped"
        enrollment.ended_on = None if never_started else today
        enrollment.ended_at = datetime.now(timezone.utc)
        enrollment.end_reason = (
            "Hủy ghi danh tương lai do lưu trữ hồ sơ"
            if never_started
            else "Hồ sơ học viên được lưu trữ"
        )
        await close_enrollment_slot_selections(
            db,
            enrollment,
            ended_on=enrollment.enrollment_date if never_started else today,
        )
        await close_enrollment_financial_projection(
            db,
            enrollment,
            actor_user_id=actor_user_id,
            reason=enrollment.end_reason,
            close_on=enrollment.enrollment_date if never_started else today,
        )

    if previous_status != "archived":
        append_student_lifecycle_event(
            db,
            student_id=student.id,
            actor_user_id=actor_user_id,
            action="student_archived",
            previous_status=previous_status,
            next_status="archived",
            reason=request.reason,
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
            detail={
                "code": "STUDENT_NOT_STOPPED",
                "message": "Chỉ hồ sơ học viên đang ngừng học mới có thể cho học lại.",
            },
            headers={"Cache-Control": "no-store"},
        )

    if student.updated_at != request.expected_updated_at:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "STUDENT_CHANGED",
                "message": "Hồ sơ vừa được cập nhật bởi thao tác khác. Vui lòng kiểm tra lại.",
            },
            headers={"Cache-Control": "no-store"},
        )

    active_enrollments_result = await db.execute(
        select(Enrollment).where(
            Enrollment.student_id == student.id,
            enrollment_current_or_scheduled_predicate(),
        )
    )
    active_enrollments = list(active_enrollments_result.scalars().all())
    if active_enrollments:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "STUDENT_RESTORE_MEMBERSHIP_CONFLICT",
                "message": "Hồ sơ đang có ghi danh lớp học hiệu lực. Vui lòng kiểm tra lại trạng thái lớp học trước khi cho học lại.",
            },
            headers={"Cache-Control": "no-store"},
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
        reason=request.reason,
    )

    await db.commit()
    return await get_student(db, id)
