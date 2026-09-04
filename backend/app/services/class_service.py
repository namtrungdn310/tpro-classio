from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import hmac
import json
from uuid import UUID, uuid4

from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload, selectinload

from app.core.billing import (
    NEXT_FEE_DUE_NONE,
    get_class_course_weeks,
    get_class_next_fee_due,
)
from app.core.billing_schedule import month_end
from app.core.business_time import business_today
from app.core.class_lifecycle import (
    active_class_today_predicate,
    effective_class_status,
    is_active_class_today,
    is_operational_class,
    operational_class_predicate,
)
from app.core.enrollment_lifecycle import (
    effective_enrollment_state,
    enrollment_current_or_scheduled_predicate,
)
from app.core.makeup_state import derived_display_status as adjustment_display_status
from app.core.performance import log_timing
from app.core.search import matches_smart_search
from app.models.class_ import Class
from app.models.billing_anchor_revision import BillingAnchorRevision
from app.models.class_lifecycle_event import ClassLifecycleEvent
from app.models.class_teacher import ClassTeacher
from app.models.class_teacher_event import ClassTeacherEvent
from app.models.class_schedule_slot import (
    ClassScheduleSlot as ClassScheduleSlotModel,
    ClassScheduleSlotStaff,
)
from app.models.enrollment import Enrollment
from app.models.enrollment_slot_selection import EnrollmentSlotSelection
from app.models.fee_record import FeeRecord
from app.models.makeup import ClassScheduleAdjustment, ClassSessionException
from app.models.staff import StaffMember
from app.models.student import Student
from app.schemas.class_ import (
    ClassCategory,
    ClassCopyTemplateResponse,
    ClassContinuationCreate,
    ClassContinuationPreviewResponse,
    ClassContinuationStudentCandidate,
    ClassContinuationSlotReference,
    ClassCreate,
    ClassEndDatePreviewRequest,
    ClassEndDatePreviewResponse,
    ClassEndDateUpdate,
    ClassStartDatePreviewRequest,
    ClassStartDatePreviewResponse,
    ClassStartDateUpdate,
    ClassStopPreviewRequest,
    ClassStopPreviewResponse,
    ClassStopRequest,
    ClassHistoryAdjustment,
    ClassHistoryEnrollment,
    ClassHistoryEvent,
    ClassHistoryScheduleSlot,
    ClassHistorySlotTeacher,
    ClassHistoryResponse,
    ClassHistoryTeacherEvent,
    ClassIdentityScheme,
    ClassResponse,
    ClassActiveSuspension,
    ClassSchedule,
    ClassScheduleSlot,
    ClassScope,
    ClassScopeSummary,
    ClassUpdate,
    education_level_for_grade,
    validate_class_configuration,
    validate_class_identity,
)
from app.services.class_conflict_service import (
    _validate_staff_schedule_availability,
)
from app.services.fee_cycle_service import (
    ensure_enrollment_cycles,
    ensure_final_cycle_for_stop,
)
from app.services.enrollment_service import (
    close_enrollment_financial_projection,
    close_enrollment_slot_selections,
    enroll_locked_student,
)
from app.services.schedule_slot_service import load_class_slots, sync_class_slots


def _clear_dependent_caches() -> None:
    # Không còn cache process-local (nhiều worker có thể trả dữ liệu lệch
    # nhau); ưu tiên truy vấn DB có index + React Query invalidation ở frontend.
    return None


def get_effective_class_status(class_: Class, *, today: date | None = None) -> str:
    """Return the only lifecycle label consumers should display."""

    return effective_class_status(class_, today=today)


def class_is_operational(class_: Class, *, today: date | None = None) -> bool:
    return is_operational_class(class_, today=today)


def class_is_active_today(class_: Class, *, today: date | None = None) -> bool:
    return is_active_class_today(class_, today=today)


def get_class_labels(class_: Class) -> tuple[str, str | None, str]:
    """Build one canonical display identity for every UI and financial snapshot."""

    if class_.identity_scheme == "ACADEMIC_YEAR" and class_.academic_year_start:
        secondary = " · ".join(
            part
            for part in (
                _category_label(class_.class_category),
                f"Khối {class_.grade_level}"
                if class_.grade_level
                else "Không theo khối",
                f"Năm học {class_.academic_year_start}–{class_.academic_year_start + 1}",
            )
            if part
        )
        return class_.name, secondary, f"{class_.name} · {secondary}"
    if class_.identity_scheme == "INTAKE" and class_.start_date:
        category = _category_label(class_.class_category)
        secondary = " · ".join(
            part for part in (category, f"Mở lớp {class_.start_date:%m/%Y}") if part
        )
        return class_.name, secondary, f"{class_.name} · {secondary}"
    return class_.name, None, class_.name


def _education_level_label(education_level: str | None) -> str | None:
    return {
        "PRIMARY": "Tiểu học",
        "MIDDLE": "THCS",
        "HIGH": "THPT",
    }.get(education_level or "")


def _category_label(category: str | None) -> str | None:
    return {
        "GENERAL": "Phổ thông",
        "SPECIALIZED": "Chuyên",
        "IELTS": "IELTS",
        "CUSTOM": "Custom",
    }.get(category or "")


def _synchronize_identity_metadata(class_: Class) -> None:
    """Derive trusted class metadata without ever replacing the entered name."""

    if class_.class_category == "IELTS":
        class_.identity_scheme = "INTAKE"
        class_.grade_mode = "NONE"
        class_.program_name = None
        class_.education_level = None
        class_.grade_level = None
        class_.academic_year_start = None
    elif class_.class_category in {"GENERAL", "SPECIALIZED", "CUSTOM"}:
        class_.identity_scheme = "ACADEMIC_YEAR"
        if class_.class_category == "GENERAL":
            class_.grade_mode = "GRADE"
        if class_.grade_mode == "NONE":
            class_.grade_level = None
        if class_.grade_level is not None:
            class_.education_level = education_level_for_grade(class_.grade_level)
        else:
            class_.education_level = None
        class_.program_name = None
    elif class_.identity_scheme == "ACADEMIC_YEAR":
        # Compatibility for pre-044 rows while they are being classified.
        class_.education_level = (
            education_level_for_grade(class_.grade_level)
            if class_.grade_level is not None
            else None
        )
        class_.program_name = None
    elif class_.identity_scheme == "INTAKE":
        class_.program_name = None
        class_.education_level = None
        class_.grade_level = None
        class_.academic_year_start = None
    else:
        class_.education_level = None


def _operational_class_predicate(today: date):
    return operational_class_predicate(today)


def _active_today_class_predicate(today: date):
    return active_class_today_predicate(today)


def _scope_predicate(scope: ClassScope, today: date):
    visible_operational = and_(
        Class.is_active.is_(True),
        Class.cancelled_at.is_(None),
        Class.completed_at.is_(None),
        Class.stopped_at.is_(None),
        Class.identity_scheme != "LEGACY",
    )
    if scope == "active":
        return and_(visible_operational, Class.start_date <= today)
    if scope == "enrollable":
        return and_(
            visible_operational,
            Class.start_date <= today,
        )
    if scope == "assignable":
        # Membership screens may schedule a future start; other class lists
        # keep their existing semantics.
        return visible_operational
    if scope == "scheduled":
        return and_(visible_operational, Class.start_date > today)
    if scope in {"completed", "stopped"}:
        return and_(
            Class.cancelled_at.is_(None),
            Class.identity_scheme != "LEGACY",
            or_(Class.stopped_at.is_not(None), Class.completed_at.is_not(None)),
        )
    if scope == "cancelled":
        return Class.cancelled_at.is_not(None)
    # "operational" = đang hoạt động hoặc sắp mở: đã cấu hình và chưa kết thúc.
    # Lớp có ngày bắt đầu trong tương lai (SCHEDULED) chỉ xuất hiện ở tab "Sắp mở".
    return and_(
        visible_operational,
        Class.start_date <= today,
    )


def _can_edit_end_date(class_: Class, today: date) -> bool:
    return (
        class_.identity_scheme != "LEGACY"
        and class_.is_active
        and class_.cancelled_at is None
        and class_.completed_at is None
        and class_.end_date is not None
        and today < class_.end_date
    )


async def _commit_class_changes(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        message = str(exc)
        if "classes_academic_identity_unique_idx" in message:
            raise ValueError("Tên lớp này đã tồn tại trong năm học đã chọn") from exc
        if "classes_intake_identity_unique_idx" in message:
            raise ValueError("Tên lớp này đã tồn tại trong đợt học đã chọn") from exc
        raise


async def _reconcile_current_class_fees(
    db: AsyncSession,
    class_: Class,
) -> list[Enrollment]:
    """R6: lazily materialize future cycles up to the current business month."""
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

    today = business_today()
    for enrollment in enrollments:
        enrollment.class_ = class_
        await ensure_enrollment_cycles(
            db,
            enrollment,
            up_to=month_end(today),
        )
    return enrollments


def _to_response(
    class_: Class,
    student_count: int = 0,
    next_fee_due: tuple[date | None, str] | None = None,
    unresolved_makeup_count: int = 0,
    active_suspension: ClassActiveSuspension | None = None,
) -> ClassResponse:
    today = business_today()
    schedule = _schedule_projection_with_slot_identity(class_)
    links = [
        link
        for link in sorted(
            class_.teacher_links,
            key=lambda item: item.teacher.full_name if item.teacher else "",
        )
        if link.teacher is not None
    ]
    teachers = [link.teacher for link in links if link.role == "TEACHER"]
    assistants = [link.teacher for link in links if link.role == "ASSISTANT"]
    teacher_ids = [teacher.id for teacher in teachers]
    teacher_names = [teacher.full_name for teacher in teachers]
    assistant_ids = [assistant.id for assistant in assistants]
    assistant_names = [assistant.full_name for assistant in assistants]
    legacy_teacher_id = teacher_ids[0] if teacher_ids else class_.teacher_id
    legacy_teacher_name = ", ".join(teacher_names) if teacher_names else None
    assignment_slot_ids: dict[tuple[str, str], list[UUID]] = {}
    uncovered_slot_ids: list[UUID] = []
    if schedule is not None:
        for slot in schedule.slots:
            if slot.id is not None and not slot.teacher_ids:
                uncovered_slot_ids.append(slot.id)
            if slot.id is None:
                continue
            for staff_id in slot.teacher_ids:
                assignment_slot_ids.setdefault((str(staff_id), "TEACHER"), []).append(
                    slot.id
                )
            for staff_id in slot.assistant_ids:
                assignment_slot_ids.setdefault((str(staff_id), "ASSISTANT"), []).append(
                    slot.id
                )
    staff_assignments = [
        {
            "staff_id": link.teacher_id,
            "full_name": link.teacher.full_name,
            "role": link.role,
            "slot_ids": assignment_slot_ids.get((str(link.teacher_id), link.role), []),
        }
        for link in links
    ]
    staffing_status = (
        "UNASSIGNED"
        if not staff_assignments
        else "PARTIAL"
        if uncovered_slot_ids
        else "READY"
    )
    primary_label, secondary_label, display_name = get_class_labels(class_)
    next_fee_due_date, next_fee_due_state = next_fee_due or (None, NEXT_FEE_DUE_NONE)

    return ClassResponse(
        id=class_.id,
        name=class_.name,
        type=class_.type,
        base_fee=int(class_.base_fee),
        billing_cycle_months=class_.billing_cycle_months,
        billing_cycle_weeks=class_.billing_cycle_weeks,
        start_date=class_.start_date,
        end_date=class_.end_date,
        identity_scheme=class_.identity_scheme,
        class_category=class_.class_category,
        grade_mode=class_.grade_mode,
        program_name=class_.program_name,
        grade_level=class_.grade_level,
        education_level=class_.education_level,
        academic_year_start=class_.academic_year_start,
        schedule=schedule,
        teacher_id=legacy_teacher_id,
        teacher_ids=teacher_ids,
        teacher_name=legacy_teacher_name,
        teacher_names=teacher_names,
        assistant_ids=assistant_ids,
        assistant_names=assistant_names,
        is_active=class_.is_active,
        student_count=student_count,
        created_at=class_.created_at,
        updated_at=class_.updated_at,
        version=class_.version,
        display_name=display_name,
        primary_label=primary_label,
        secondary_label=secondary_label,
        effective_status=effective_class_status(class_, today=today),
        can_edit_end_date=False,
        can_edit_start_date=(
            class_.identity_scheme != "LEGACY"
            and class_.cancelled_at is None
            and class_.stopped_at is None
            and class_.completed_at is None
        ),
        can_stop=(
            class_.identity_scheme != "LEGACY"
            and class_.is_active
            and class_.cancelled_at is None
            and class_.stopped_at is None
            and class_.completed_at is None
        ),
        can_edit=(class_.completed_at is None and class_.cancelled_at is None),
        can_edit_billing_mode=(
            class_.start_date is not None
            and class_.start_date > today
            and class_.cancelled_at is None
            and class_.stopped_at is None
            and class_.completed_at is None
        ),
        can_edit_package_duration=(
            class_.type == "COURSE"
            and class_.is_active
            and class_.cancelled_at is None
            and class_.stopped_at is None
            and class_.completed_at is None
        ),
        can_cancel=(
            class_.is_active
            and class_.completed_at is None
            and class_.cancelled_at is None
        ),
        next_fee_due_date=next_fee_due_date,
        next_fee_due_state=next_fee_due_state,
        cancelled_at=class_.cancelled_at,
        stopped_on=class_.stopped_on,
        stopped_at=class_.stopped_at,
        stopped_reason=class_.stopped_reason,
        unresolved_makeup_count=unresolved_makeup_count,
        active_suspension=active_suspension,
        previous_class_id=class_.previous_class_id,
        staff_assignments=staff_assignments,
        staffing_status=staffing_status,
        unassigned_slot_ids=uncovered_slot_ids,
    )


async def _load_next_fee_due_map(
    db: AsyncSession,
    classes: list[Class],
    today: date,
) -> dict[str, tuple[date | None, str]]:
    """One batched query set cho toàn bộ class_id, tránh N+1 theo số lớp.

    Không load toàn bộ fee_records: chỉ lấy (a) enrollment đang hoạt động,
    (b) aggregate max cycle_no / max deferral trên toàn bộ record và (c) các
    record UNPAID (thành phần duy nhất ảnh hưởng overdue/upcoming). Các giá
    trị được dựng lại thành projection nhẹ tương đương hành vi
    ``get_class_next_fee_due`` — không thay đổi kết quả hiển thị.
    """

    due_map: dict[str, tuple[date | None, str]] = {
        class_.id: (None, NEXT_FEE_DUE_NONE) for class_ in classes
    }
    class_ids = [class_.id for class_ in classes]
    if not class_ids:
        return due_map
    class_by_id = {class_.id: class_ for class_ in classes}

    enrollment_result = await db.execute(
        select(
            Enrollment.id,
            Enrollment.class_id,
            Enrollment.enrollment_date,
            Enrollment.current_billing_revision_id,
            BillingAnchorRevision.anchor_date,
            BillingAnchorRevision.billing_type_snapshot,
            BillingAnchorRevision.billing_cycle_weeks_snapshot,
        )
        .outerjoin(
            BillingAnchorRevision,
            BillingAnchorRevision.id == Enrollment.current_billing_revision_id,
        )
        .where(
            Enrollment.class_id.in_(class_ids),
            Enrollment.status == "active",
        )
    )
    enrollments = [
        (
            str(row.id),
            str(row.class_id),
            row.enrollment_date,
            str(getattr(row, "current_billing_revision_id", None))
            if getattr(row, "current_billing_revision_id", None)
            else None,
            getattr(row, "anchor_date", None),
            getattr(row, "billing_type_snapshot", None),
            getattr(row, "billing_cycle_weeks_snapshot", None),
        )
        for row in enrollment_result.all()
    ]
    enrollment_ids = [row[0] for row in enrollments]
    if not enrollment_ids:
        return due_map

    aggregate_result = await db.execute(
        select(
            FeeRecord.enrollment_id,
            func.max(FeeRecord.cycle_no).label("max_cycle"),
            func.max(
                case(
                    (
                        FeeRecord.billing_revision_id
                        == Enrollment.current_billing_revision_id,
                        FeeRecord.anchor_cycle_no,
                    ),
                    else_=None,
                )
            ).label("max_anchor_cycle"),
            func.max(
                func.greatest(0, FeeRecord.adjusted_due_date - FeeRecord.base_due_date)
            ).label("max_deferral"),
        )
        .join(Enrollment, Enrollment.id == FeeRecord.enrollment_id)
        .where(FeeRecord.enrollment_id.in_(enrollment_ids))
        .group_by(FeeRecord.enrollment_id)
    )
    aggregates = {
        str(row.enrollment_id): (
            row.max_cycle,
            getattr(row, "max_anchor_cycle", None),
            row.max_deferral,
        )
        for row in aggregate_result.all()
    }

    unpaid_result = await db.execute(
        select(
            FeeRecord.enrollment_id,
            FeeRecord.adjusted_due_date,
            FeeRecord.due_date,
        ).where(
            FeeRecord.enrollment_id.in_(enrollment_ids),
            FeeRecord.status == "UNPAID",
        )
    )
    unpaid_by_enrollment: dict[str, list[tuple[date | None, date | None]]] = {}
    for row in unpaid_result.all():
        unpaid_by_enrollment.setdefault(str(row.enrollment_id), []).append(
            (row.adjusted_due_date, row.due_date)
        )

    enrollments_by_class: dict[str, list[_ProjectedEnrollment]] = {}
    deferral_anchor = date(2000, 1, 1)
    for (
        enrollment_id,
        class_id,
        enrollment_date,
        current_revision_id,
        anchor_date,
        billing_type_snapshot,
        billing_cycle_weeks_snapshot,
    ) in enrollments:
        max_cycle, max_anchor_cycle, max_deferral = aggregates.get(
            enrollment_id, (None, None, None)
        )
        records: list[_ProjectedFeeRecord] = [
            _ProjectedFeeRecord(
                cycle_no=int(max_cycle) if max_cycle is not None else None,
                billing_revision_id=current_revision_id,
                anchor_cycle_no=(
                    int(max_anchor_cycle) if max_anchor_cycle is not None else None
                ),
                base_due_date=None,
                adjusted_due_date=None,
                due_date=None,
                status="PAID",
            )
        ]
        if max_deferral:
            records.append(
                _ProjectedFeeRecord(
                    cycle_no=None,
                    billing_revision_id=None,
                    anchor_cycle_no=None,
                    base_due_date=deferral_anchor,
                    adjusted_due_date=deferral_anchor
                    + timedelta(days=int(max_deferral)),
                    due_date=None,
                    status="PAID",
                )
            )
        for adjusted_due_date, due_date in unpaid_by_enrollment.get(enrollment_id, []):
            records.append(
                _ProjectedFeeRecord(
                    cycle_no=None,
                    billing_revision_id=None,
                    anchor_cycle_no=None,
                    base_due_date=None,
                    adjusted_due_date=adjusted_due_date,
                    due_date=due_date,
                    status="UNPAID",
                )
            )
        projected = _ProjectedEnrollment(
            status="active",
            class_=class_by_id[class_id],
            enrollment_date=enrollment_date,
            fee_records=records,
            current_billing_revision_id=current_revision_id,
            current_billing_revision=(
                _ProjectedBillingRevision(
                    anchor_date=anchor_date,
                    billing_type_snapshot=billing_type_snapshot,
                    billing_cycle_weeks_snapshot=billing_cycle_weeks_snapshot,
                )
                if current_revision_id and anchor_date and billing_type_snapshot
                else None
            ),
        )
        enrollments_by_class.setdefault(class_id, []).append(projected)

    for class_id, projected_enrollments in enrollments_by_class.items():
        due_map[class_id] = get_class_next_fee_due(
            class_by_id[class_id], projected_enrollments, today
        )
    return due_map


class _ProjectedFeeRecord:
    """Lightweight stand-in for ``FeeRecord`` consumed by fee-due projection."""

    __slots__ = (
        "cycle_no",
        "billing_revision_id",
        "anchor_cycle_no",
        "base_due_date",
        "adjusted_due_date",
        "due_date",
        "status",
    )

    def __init__(
        self,
        *,
        cycle_no: int | None,
        billing_revision_id: str | None,
        anchor_cycle_no: int | None,
        base_due_date: date | None,
        adjusted_due_date: date | None,
        due_date: date | None,
        status: str,
    ) -> None:
        self.cycle_no = cycle_no
        self.billing_revision_id = billing_revision_id
        self.anchor_cycle_no = anchor_cycle_no
        self.base_due_date = base_due_date
        self.adjusted_due_date = adjusted_due_date
        self.due_date = due_date
        self.status = status


class _ProjectedEnrollment:
    """Minimal enrollment view exposing exactly the fields the fee-due logic reads."""

    __slots__ = (
        "status",
        "class_",
        "enrollment_date",
        "fee_records",
        "current_billing_revision_id",
        "current_billing_revision",
    )

    def __init__(
        self,
        *,
        status: str,
        class_: Class,
        enrollment_date: date | None,
        fee_records: list[_ProjectedFeeRecord],
        current_billing_revision_id: str | None,
        current_billing_revision: "_ProjectedBillingRevision | None",
    ) -> None:
        self.status = status
        self.class_ = class_
        self.enrollment_date = enrollment_date
        self.fee_records = fee_records
        self.current_billing_revision_id = current_billing_revision_id
        self.current_billing_revision = current_billing_revision


class _ProjectedBillingRevision:
    __slots__ = (
        "anchor_date",
        "billing_type_snapshot",
        "billing_cycle_weeks_snapshot",
    )

    def __init__(
        self,
        *,
        anchor_date: date,
        billing_type_snapshot: str,
        billing_cycle_weeks_snapshot: int | None,
    ) -> None:
        self.anchor_date = anchor_date
        self.billing_type_snapshot = billing_type_snapshot
        self.billing_cycle_weeks_snapshot = billing_cycle_weeks_snapshot


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


async def _sync_class_staff(
    db: AsyncSession,
    class_: Class,
    *,
    teacher_ids: list[str],
    assistant_ids: list[str],
    actor_user_id: str | None = None,
) -> None:
    """Synchronize the role-bearing class assignment projection atomically."""
    requested: dict[str, str] = {}
    for staff_id in teacher_ids:
        requested[staff_id] = "TEACHER"
    for staff_id in assistant_ids:
        if staff_id in requested:
            raise ValueError("Một nhân sự không thể vừa là giáo viên vừa là trợ giảng")
        requested[staff_id] = "ASSISTANT"

    staff_by_id: dict[str, StaffMember] = {}
    if requested:
        result = await db.execute(
            select(StaffMember)
            .where(
                StaffMember.id.in_(requested),
                StaffMember.is_active.is_(True),
            )
            .order_by(StaffMember.id.asc())
            .with_for_update()
        )
        staff_by_id = {str(staff.id): staff for staff in result.scalars().all()}
        if set(staff_by_id) != set(requested):
            raise ValueError("Nhân sự không hợp lệ hoặc đã ngừng hoạt động")

    result = await db.execute(
        select(ClassTeacher, StaffMember.full_name)
        .join(StaffMember, StaffMember.id == ClassTeacher.teacher_id)
        .where(ClassTeacher.class_id == class_.id)
        .with_for_update()
    )
    current = {
        str(link.teacher_id): (link, full_name) for link, full_name in result.all()
    }

    for staff_id, (link, full_name) in current.items():
        next_role = requested.get(staff_id)
        if next_role == link.role:
            continue
        db.add(
            ClassTeacherEvent(
                class_id=class_.id,
                teacher_id=staff_id,
                teacher_name_snapshot=full_name,
                staff_type_snapshot=link.role,
                event_type="unassigned",
                actor_user_id=actor_user_id,
            )
        )
        if next_role is None:
            await db.delete(link)
            continue
        link.role = next_role
        db.add(
            ClassTeacherEvent(
                class_id=class_.id,
                teacher_id=staff_id,
                teacher_name_snapshot=full_name,
                staff_type_snapshot=next_role,
                event_type="assigned",
                actor_user_id=actor_user_id,
            )
        )

    for staff_id, role in requested.items():
        if staff_id in current:
            continue
        db.add(
            ClassTeacher(
                class_id=class_.id,
                teacher_id=staff_id,
                role=role,
            )
        )
        db.add(
            ClassTeacherEvent(
                class_id=class_.id,
                teacher_id=staff_id,
                teacher_name_snapshot=staff_by_id[staff_id].full_name,
                staff_type_snapshot=role,
                event_type="assigned",
                actor_user_id=actor_user_id,
            )
        )

    class_.teacher_id = teacher_ids[0] if teacher_ids else None
    await db.flush()


async def _sync_class_teachers(
    db: AsyncSession,
    class_: Class,
    teacher_ids: list[str],
    *,
    actor_user_id: str | None = None,
) -> None:
    teacher_by_id: dict[str, StaffMember] = {}
    if teacher_ids:
        result = await db.execute(
            select(StaffMember).where(
                StaffMember.id.in_(teacher_ids),
                StaffMember.is_active.is_(True),
            )
        )
        teachers = list(result.scalars().all())
        teacher_by_id = {str(teacher.id): teacher for teacher in teachers}
        existing_teacher_ids = set(teacher_by_id)
        missing_teacher_ids = [
            id_ for id_ in teacher_ids if id_ not in existing_teacher_ids
        ]
        if missing_teacher_ids:
            raise ValueError("Giáo viên không hợp lệ")

    current_result = await db.execute(
        select(ClassTeacher, StaffMember.full_name)
        .join(StaffMember, StaffMember.id == ClassTeacher.teacher_id)
        .where(
            ClassTeacher.class_id == class_.id,
            ClassTeacher.role == "TEACHER",
        )
        .with_for_update()
    )
    current_teachers = {
        str(link.teacher_id): name for link, name in current_result.all()
    }
    requested_teacher_ids = set(teacher_ids)
    removed_teacher_ids = set(current_teachers) - requested_teacher_ids
    added_teacher_ids = requested_teacher_ids - set(current_teachers)

    if removed_teacher_ids:
        await db.execute(
            delete(ClassTeacher).where(
                ClassTeacher.class_id == class_.id,
                ClassTeacher.teacher_id.in_(removed_teacher_ids),
            )
        )
        for teacher_id in sorted(removed_teacher_ids):
            db.add(
                ClassTeacherEvent(
                    class_id=class_.id,
                    teacher_id=teacher_id,
                    teacher_name_snapshot=current_teachers[teacher_id],
                    staff_type_snapshot="TEACHER",
                    event_type="unassigned",
                    actor_user_id=actor_user_id,
                )
            )

    class_.teacher_id = teacher_ids[0] if teacher_ids else None
    for teacher_id in sorted(added_teacher_ids):
        db.add(
            ClassTeacher(
                class_id=class_.id,
                teacher_id=teacher_id,
                role="TEACHER",
            )
        )
        db.add(
            ClassTeacherEvent(
                class_id=class_.id,
                teacher_id=teacher_id,
                teacher_name_snapshot=teacher_by_id[teacher_id].full_name,
                staff_type_snapshot="TEACHER",
                event_type="assigned",
                actor_user_id=actor_user_id,
            )
        )


async def _sync_class_assistants(
    db: AsyncSession,
    class_: Class,
    assistant_ids: list[str],
    *,
    actor_user_id: str | None = None,
) -> None:
    assistant_by_id: dict[str, StaffMember] = {}
    if assistant_ids:
        result = await db.execute(
            select(StaffMember).where(
                StaffMember.id.in_(assistant_ids),
                StaffMember.is_active.is_(True),
            )
        )
        assistants = list(result.scalars().all())
        assistant_by_id = {str(assistant.id): assistant for assistant in assistants}
        existing_assistant_ids = set(assistant_by_id)
        missing_assistant_ids = [
            id_ for id_ in assistant_ids if id_ not in existing_assistant_ids
        ]
        if missing_assistant_ids:
            raise ValueError("Trợ giảng không hợp lệ")

    current_result = await db.execute(
        select(ClassTeacher, StaffMember.full_name)
        .join(StaffMember, StaffMember.id == ClassTeacher.teacher_id)
        .where(
            ClassTeacher.class_id == class_.id,
            ClassTeacher.role == "ASSISTANT",
        )
        .with_for_update()
    )
    current_assistants = {
        str(link.teacher_id): name for link, name in current_result.all()
    }
    requested_assistant_ids = set(assistant_ids)
    removed_assistant_ids = set(current_assistants) - requested_assistant_ids
    added_assistant_ids = requested_assistant_ids - set(current_assistants)

    if removed_assistant_ids:
        await db.execute(
            delete(ClassTeacher).where(
                ClassTeacher.class_id == class_.id,
                ClassTeacher.teacher_id.in_(removed_assistant_ids),
            )
        )
        for assistant_id in sorted(removed_assistant_ids):
            db.add(
                ClassTeacherEvent(
                    class_id=class_.id,
                    teacher_id=assistant_id,
                    teacher_name_snapshot=current_assistants[assistant_id],
                    staff_type_snapshot="ASSISTANT",
                    event_type="unassigned",
                    actor_user_id=actor_user_id,
                )
            )

    for assistant_id in sorted(added_assistant_ids):
        db.add(
            ClassTeacher(
                class_id=class_.id,
                teacher_id=assistant_id,
                role="ASSISTANT",
            )
        )
        db.add(
            ClassTeacherEvent(
                class_id=class_.id,
                teacher_id=assistant_id,
                teacher_name_snapshot=assistant_by_id[assistant_id].full_name,
                staff_type_snapshot="ASSISTANT",
                event_type="assigned",
                actor_user_id=actor_user_id,
            )
        )


async def _get_class_teacher_ids(db: AsyncSession, class_: Class) -> list[str]:
    result = await db.execute(
        select(ClassTeacher.teacher_id)
        .where(
            ClassTeacher.class_id == class_.id,
            ClassTeacher.role == "TEACHER",
        )
        .order_by(ClassTeacher.teacher_id.asc())
    )
    teacher_ids = [str(teacher_id) for teacher_id in result.scalars().all()]
    if not teacher_ids and class_.teacher_id is not None:
        teacher_ids.append(str(class_.teacher_id))
    return teacher_ids


async def _get_class_assistant_ids(db: AsyncSession, class_: Class) -> list[str]:
    result = await db.execute(
        select(ClassTeacher.teacher_id)
        .where(
            ClassTeacher.class_id == class_.id,
            ClassTeacher.role == "ASSISTANT",
        )
        .order_by(ClassTeacher.teacher_id.asc())
    )
    return [str(assistant_id) for assistant_id in result.scalars().all()]


def normalize_schedule_assignments(
    schedule: ClassSchedule | dict | None,
    teacher_ids: list[str],
    assistant_ids: list[str],
) -> ClassSchedule | None:
    """Canonicalize assignment cho từng slot trước conflict-check và persist:
    1. dedupe ID theo thứ tự ổn định;
    2. teacher: explicit theo từng slot; danh sách rỗng là trạng thái lớp chưa
       phân công hợp lệ và không tự materialize từ pool cấp lớp;
    3. assistant: explicit non-empty giữ nguyên; thiếu/rỗng → [] (không fallback);
    4. validate subset của pool lớp (teacher pool / assistant pool riêng);
    5. không biến thiếu nhân sự thành lỗi tạo/sửa lớp.
    Không thay đổi day/start/end/text."""
    if schedule is None:
        return None
    normalized = (
        schedule
        if isinstance(schedule, ClassSchedule)
        else ClassSchedule.model_validate(schedule)
    )
    teacher_set = set(teacher_ids)
    assistant_set = set(assistant_ids)
    canonical_slots: list[ClassScheduleSlot] = []
    for slot in normalized.slots:
        teachers = [str(teacher_id) for teacher_id in slot.teacher_ids]
        assistants = (
            [str(assistant_id) for assistant_id in slot.assistant_ids]
            if slot.assistant_ids
            else []
        )
        teachers = list(dict.fromkeys(teachers))
        assistants = list(dict.fromkeys(assistants))
        invalid_teachers = [
            teacher_id for teacher_id in teachers if teacher_id not in teacher_set
        ]
        if invalid_teachers:
            raise ValueError(
                "Giáo viên của từng buổi phải nằm trong danh sách giáo viên của lớp"
            )
        invalid_assistants = [
            assistant_id
            for assistant_id in assistants
            if assistant_id not in assistant_set
        ]
        if invalid_assistants:
            raise ValueError(
                "Trợ giảng của từng buổi phải nằm trong danh sách trợ giảng của lớp"
            )
        canonical_slots.append(
            ClassScheduleSlot(
                day=slot.day,
                start=slot.start,
                end=slot.end,
                teacher_ids=[UUID(teacher_id) for teacher_id in teachers],
                assistant_ids=[UUID(assistant_id) for assistant_id in assistants],
            )
        )
    return ClassSchedule(text=normalized.text, slots=canonical_slots)


def _schedule_teacher_ids(schedule: ClassSchedule | None) -> list[str]:
    """Return the distinct teacher union used by the class-level summary."""
    if schedule is None:
        return []
    return list(
        dict.fromkeys(
            str(teacher_id)
            for slot in schedule.slots
            for teacher_id in slot.teacher_ids
        )
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


def _searchable_class_values(class_: Class, today: date) -> list[str | None]:
    """Searchable projection từ ORM Class — khớp đúng danh sách giá trị mà
    phiên bản cũ feed cho ``matches_smart_search`` sau khi build ClassResponse.

    Giữ helper tách riêng để lọc ngay sau query chính (trước pagination và
    trước khi load fee/adjustment projection), không cần dựng toàn bộ response.
    """
    teacher_names = [
        link.teacher.full_name
        for link in sorted(
            class_.teacher_links,
            key=lambda item: item.teacher.full_name if item.teacher else "",
        )
        if link.teacher is not None
    ]
    schedule = class_.schedule if isinstance(class_.schedule, dict) else {}
    slots = schedule.get("slots", []) if isinstance(schedule, dict) else []
    return [
        class_.name,
        class_.program_name,
        _category_label(class_.class_category),
        f"Khối {class_.grade_level}" if class_.grade_level else None,
        _education_level_label(class_.education_level),
        get_class_labels(class_)[2],
        class_.start_date.isoformat() if class_.start_date else None,
        class_.end_date.isoformat() if class_.end_date else None,
        effective_class_status(class_, today=today),
        str(class_.academic_year_start) if class_.academic_year_start else None,
        *teacher_names,
        schedule.get("text"),
        *(slot.get("day") for slot in slots),
    ]


async def get_classes(
    db: AsyncSession,
    search: str | None = None,
    type: str | None = None,
    is_active: bool | None = None,
    scope: ClassScope = "operational",
    limit: int | None = 200,
    offset: int | None = None,
) -> list[ClassResponse]:
    today = business_today()
    with log_timing(
        "class_service.get_classes",
        threshold_ms=40,
        search=bool(search),
        type=type,
        is_active=is_active,
        scope=scope,
        limit=limit,
        offset=offset,
    ):
        normalized_search = search.strip() if search else None
        enrollment_count_filter = (
            enrollment_current_or_scheduled_predicate()
            if scope
            in {"operational", "active", "enrollable", "assignable", "scheduled"}
            else None
        )
        enrollment_count = select(
            Enrollment.class_id,
            func.count(func.distinct(Enrollment.student_id)).label("student_count"),
        ).group_by(Enrollment.class_id)
        if enrollment_count_filter is not None:
            enrollment_count = enrollment_count.where(enrollment_count_filter)
        enrollment_count = enrollment_count.subquery()
        unresolved_count = (
            select(
                ClassSessionException.class_id,
                func.count(ClassSessionException.id).label("unresolved_count"),
            )
            .where(
                ClassSessionException.status.in_(["MAKEUP_PENDING", "MAKEUP_SCHEDULED"])
            )
            .group_by(ClassSessionException.class_id)
            .subquery()
        )
        statement = (
            select(
                Class,
                func.coalesce(enrollment_count.c.student_count, 0).label(
                    "student_count"
                ),
                func.coalesce(unresolved_count.c.unresolved_count, 0).label(
                    "unresolved_count"
                ),
            )
            .outerjoin(enrollment_count, enrollment_count.c.class_id == Class.id)
            .outerjoin(unresolved_count, unresolved_count.c.class_id == Class.id)
            .options(
                selectinload(Class.teacher_links).selectinload(ClassTeacher.teacher),
                selectinload(Class.schedule_slots).selectinload(
                    ClassScheduleSlotModel.staff_links
                ),
                # `Class` declares seven lazy="selectin" relationships that fire
                # as eager post-loads whenever entities are materialized.  The
                # list endpoint does not need enrollments/teacher/teachers/
                # adjustments/exceptions on the entities — counts and the active
                # suspension come from explicit projections — so suppress them
                # to avoid the N+1 cascade on scale datasets.
                noload(Class.enrollments),
                noload(Class.teachers),
                noload(Class.teacher),
                noload(Class.schedule_adjustments),
                noload(Class.session_exceptions),
            )
            .order_by(Class.created_at.desc(), Class.id.desc())
        )

        if type:
            statement = statement.where(Class.type == type)
        scope_filter = _scope_predicate(scope, today)
        if scope_filter is not None:
            statement = statement.where(scope_filter)
        if is_active is not None:
            statement = statement.where(Class.is_active == is_active)

        # The common browse path has no server-side smart-search term. Apply
        # pagination before ORM entities and their select-in relationships are
        # materialized; loading every class and slicing in Python made route
        # latency grow linearly with the workspace.
        if not normalized_search:
            if offset:
                statement = statement.offset(offset)
            if limit is not None:
                statement = statement.limit(limit)

        with log_timing(
            "class_service.get_classes.db",
            threshold_ms=30,
            type=type,
            is_active=is_active,
        ):
            result = await db.execute(statement)

        rows = result.all()
        matched_rows = [
            (class_, student_count, unresolved_count)
            for class_, student_count, unresolved_count in rows
            if not normalized_search
            or matches_smart_search(
                normalized_search,
                _searchable_class_values(class_, today),
            )
        ]
        if normalized_search:
            if offset:
                matched_rows = matched_rows[offset:]
            if limit is not None:
                matched_rows = matched_rows[:limit]

        adjustment_map: dict[str, ClassActiveSuspension] = {}
        class_ids = [
            str(class_.id) for class_, _student_count, _unresolved in matched_rows
        ]
        # A suspension is only actionable for operational/enrollable classes.
        # Historical and scheduled scopes cannot have an active suspension in
        # the list projection, so avoid an unnecessary round-trip for those
        # views (and keep the bounded list query budget stable on scale data).
        if class_ids and scope in {"operational", "active", "enrollable"}:
            adjustment_result = await db.execute(
                select(
                    ClassScheduleAdjustment.class_id,
                    ClassScheduleAdjustment.id,
                    ClassScheduleAdjustment.affected_from,
                    ClassScheduleAdjustment.affected_through,
                    ClassScheduleAdjustment.reason_code,
                )
                .where(
                    ClassScheduleAdjustment.class_id.in_(class_ids),
                    ClassScheduleAdjustment.status == "OPEN",
                    ClassScheduleAdjustment.affected_from <= today,
                    ClassScheduleAdjustment.affected_through >= today,
                )
                .order_by(
                    ClassScheduleAdjustment.created_at.desc(),
                    ClassScheduleAdjustment.id.desc(),
                )
            )
            # Column projection (no ORM entity) để tránh lazy relationship
            # cascade (exceptions -> staff/student snapshots) khi dataset lớn.
            for (
                class_id,
                adj_id,
                affected_from,
                affected_through,
                reason_code,
            ) in adjustment_result.all():
                adjustment_map.setdefault(
                    str(class_id),
                    ClassActiveSuspension(
                        id=adj_id,
                        suspended_from=affected_from,
                        resume_on=affected_through + timedelta(days=1),
                        reason_code=reason_code,
                    ),
                )
        due_map = await _load_next_fee_due_map(
            db,
            [class_ for class_, _student_count, _unresolved in matched_rows],
            today,
        )
        return [
            _to_response(
                class_,
                student_count,
                next_fee_due=due_map.get(class_.id),
                unresolved_makeup_count=int(unresolved_count or 0),
                active_suspension=adjustment_map.get(str(class_.id)),
            )
            for class_, student_count, unresolved_count in matched_rows
        ]


async def get_class_scope_summary(db: AsyncSession) -> ClassScopeSummary:
    """Return one compact lifecycle count row without loading class/PII rows."""

    today = business_today()
    scopes = {
        "operational": _scope_predicate("operational", today),
        "active": _scope_predicate("active", today),
        "scheduled": _scope_predicate("scheduled", today),
        "stopped": _scope_predicate("stopped", today),
        "completed": _scope_predicate("completed", today),
        "cancelled": _scope_predicate("cancelled", today),
    }
    result = await db.execute(
        select(
            *(
                func.count().filter(predicate).label(name)
                for name, predicate in scopes.items()
            )
        )
    )
    row = result.one()
    return ClassScopeSummary(**{name: int(getattr(row, name) or 0) for name in scopes})


async def get_class(
    db: AsyncSession,
    id: UUID,
    *,
    for_update: bool = False,
    suppress_eager: bool = False,
) -> Class | None:
    statement = select(Class).where(Class.id == str(id))
    if suppress_eager:
        from sqlalchemy.orm import noload

        statement = statement.options(
            noload(Class.enrollments),
            noload(Class.teacher),
            noload(Class.teacher_links),
            noload(Class.schedule_adjustments),
            noload(Class.session_exceptions),
        )
    if for_update:
        statement = statement.with_for_update()
    result = await db.execute(statement)
    return result.scalar_one_or_none()


async def _ensure_unique_class_identity(
    db: AsyncSession,
    *,
    identity_scheme: ClassIdentityScheme,
    class_category: ClassCategory | None,
    name: str,
    grade_level: int | None,
    academic_year_start: int | None,
    start_date: date | None,
    exclude_id: str | None = None,
) -> None:
    if identity_scheme == "LEGACY":
        return
    if identity_scheme == "ACADEMIC_YEAR":
        statement = select(Class.id).where(
            Class.identity_scheme == "ACADEMIC_YEAR",
            Class.class_category == class_category,
            func.lower(func.btrim(Class.name)) == name.strip().lower(),
            Class.grade_level == grade_level,
            Class.academic_year_start == academic_year_start,
        )
    else:
        intake_year_month = (
            (start_date.year * 100 + start_date.month) if start_date else None
        )
        statement = select(Class.id).where(
            Class.identity_scheme == "INTAKE",
            Class.class_category == class_category,
            func.lower(func.btrim(Class.name)) == name.strip().lower(),
            Class.intake_year_month == intake_year_month,
        )
    if exclude_id is not None:
        statement = statement.where(Class.id != exclude_id)
    if await db.scalar(statement) is not None:
        if identity_scheme == "ACADEMIC_YEAR":
            raise ValueError("Tên lớp này đã tồn tại trong năm học đã chọn")
        raise ValueError("Tên lớp này đã tồn tại trong đợt học đã chọn")


async def get_class_response(db: AsyncSession, id: UUID) -> ClassResponse | None:
    active_enrollment_count = (
        select(
            Enrollment.class_id,
            func.count(Enrollment.id).label("student_count"),
        )
        .where(enrollment_current_or_scheduled_predicate())
        .group_by(Enrollment.class_id)
        .subquery()
    )
    unresolved_count = (
        select(
            ClassSessionException.class_id,
            func.count(ClassSessionException.id).label("unresolved_count"),
        )
        .where(ClassSessionException.status.in_(["MAKEUP_PENDING", "MAKEUP_SCHEDULED"]))
        .group_by(ClassSessionException.class_id)
        .subquery()
    )
    result = await db.execute(
        select(
            Class,
            func.coalesce(active_enrollment_count.c.student_count, 0).label(
                "student_count"
            ),
            func.coalesce(unresolved_count.c.unresolved_count, 0).label(
                "unresolved_count"
            ),
        )
        .outerjoin(
            active_enrollment_count, active_enrollment_count.c.class_id == Class.id
        )
        .outerjoin(unresolved_count, unresolved_count.c.class_id == Class.id)
        .options(
            selectinload(Class.teacher_links).selectinload(ClassTeacher.teacher),
            selectinload(Class.schedule_slots).selectinload(
                ClassScheduleSlotModel.staff_links
            ),
            noload(Class.enrollments),
            noload(Class.teachers),
            noload(Class.teacher),
            noload(Class.schedule_adjustments),
            noload(Class.session_exceptions),
        )
        .where(Class.id == str(id))
    )
    row = result.one_or_none()
    if row is None:
        return None
    class_, student_count, unresolved_count = row
    due_map = await _load_next_fee_due_map(db, [class_], business_today())
    today = business_today()
    active_adjustment = await db.scalar(
        select(
            ClassScheduleAdjustment.id,
            ClassScheduleAdjustment.affected_from,
            ClassScheduleAdjustment.affected_through,
            ClassScheduleAdjustment.reason_code,
        )
        .where(
            ClassScheduleAdjustment.class_id == str(class_.id),
            ClassScheduleAdjustment.status == "OPEN",
            ClassScheduleAdjustment.affected_from <= today,
            ClassScheduleAdjustment.affected_through >= today,
        )
        .order_by(ClassScheduleAdjustment.created_at.desc())
        .limit(1)
    )
    active_suspension = (
        ClassActiveSuspension(
            id=active_adjustment.id,
            suspended_from=active_adjustment.affected_from,
            resume_on=active_adjustment.affected_through + timedelta(days=1),
            reason_code=active_adjustment.reason_code,
        )
        if active_adjustment is not None
        else None
    )
    return _to_response(
        class_,
        student_count,
        next_fee_due=due_map.get(class_.id),
        unresolved_makeup_count=int(unresolved_count or 0),
        active_suspension=active_suspension,
    )


async def get_class_history(
    db: AsyncSession,
    id: UUID,
) -> ClassHistoryResponse | None:
    """Return educational history only; fee ledger is deliberately excluded."""

    class_ = await get_class(db, id, suppress_eager=True)
    if class_ is None:
        return None

    primary_label, secondary_label, display_name = get_class_labels(class_)
    teacher_events_result = await db.execute(
        select(ClassTeacherEvent)
        .where(ClassTeacherEvent.class_id == class_.id)
        .order_by(ClassTeacherEvent.occurred_at.asc(), ClassTeacherEvent.id.asc())
    )
    enrollment_result = await db.execute(
        select(Enrollment, Student.full_name)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Enrollment.class_id == class_.id)
        .order_by(
            Enrollment.enrollment_date.asc().nulls_last(), Enrollment.created_at.asc()
        )
    )
    lifecycle_result = await db.execute(
        select(ClassLifecycleEvent)
        .where(ClassLifecycleEvent.class_id == class_.id)
        .order_by(ClassLifecycleEvent.occurred_at.asc(), ClassLifecycleEvent.id.asc())
    )
    adjustment_result = await db.execute(
        select(ClassSessionException)
        .options(selectinload(ClassSessionException.adjustment))
        .where(ClassSessionException.class_id == class_.id)
        .order_by(
            ClassSessionException.original_start_at.asc(),
            ClassSessionException.id.asc(),
        )
    )
    slot_result = await db.execute(
        select(
            ClassScheduleSlotModel,
            ClassScheduleSlotStaff.staff_id,
            StaffMember.full_name,
        )
        .outerjoin(
            ClassScheduleSlotStaff,
            (ClassScheduleSlotStaff.slot_id == ClassScheduleSlotModel.id)
            & (ClassScheduleSlotStaff.role == "TEACHER"),
        )
        .outerjoin(StaffMember, StaffMember.id == ClassScheduleSlotStaff.staff_id)
        .where(ClassScheduleSlotModel.class_id == class_.id)
        .order_by(
            ClassScheduleSlotModel.effective_from.asc(),
            ClassScheduleSlotModel.weekday.asc(),
            ClassScheduleSlotModel.local_start.asc(),
            ClassScheduleSlotModel.id.asc(),
        )
    )
    slots_by_id: dict[str, ClassHistoryScheduleSlot] = {}
    for slot, staff_id, full_name in slot_result.all():
        key = str(slot.id)
        current = slots_by_id.get(key)
        if current is None:
            current = ClassHistoryScheduleSlot(
                slot_id=slot.id,
                day=slot.weekday,
                start=slot.local_start.strftime("%H:%M"),
                end=slot.local_end.strftime("%H:%M"),
                effective_from=slot.effective_from,
                effective_until=slot.effective_until,
            )
            slots_by_id[key] = current
        if staff_id is not None and full_name is not None:
            current.teachers.append(
                ClassHistorySlotTeacher(staff_id=staff_id, staff_name=full_name)
            )

    return ClassHistoryResponse(
        id=class_.id,
        name=class_.name,
        display_name=display_name,
        primary_label=primary_label,
        secondary_label=secondary_label,
        effective_status=get_effective_class_status(class_),
        start_date=class_.start_date,
        end_date=class_.end_date,
        stopped_on=class_.stopped_on,
        stopped_at=class_.stopped_at,
        stopped_reason=class_.stopped_reason,
        schedule=class_.schedule,
        schedule_slots=list(slots_by_id.values()),
        teachers=[
            ClassHistoryTeacherEvent(
                teacher_id=event.teacher_id,
                teacher_name=event.teacher_name_snapshot,
                staff_type=event.staff_type_snapshot,
                event_type=event.event_type,
                occurred_at=event.occurred_at,
            )
            for event in teacher_events_result.scalars().all()
        ],
        enrollments=[
            ClassHistoryEnrollment(
                enrollment_id=enrollment.id,
                student_id=enrollment.student_id,
                student_name=student_name,
                enrollment_date=enrollment.enrollment_date,
                ended_on=enrollment.ended_on,
                effective_state=effective_enrollment_state(enrollment),
                ended_at=enrollment.ended_at,
                status=enrollment.status,
            )
            for enrollment, student_name in enrollment_result.all()
        ],
        lifecycle_events=[
            ClassHistoryEvent(
                event_type=event.event_type,
                previous_end_date=event.previous_end_date,
                next_end_date=event.next_end_date,
                previous_start_date=event.previous_start_date,
                next_start_date=event.next_start_date,
                previous_billing_cycle_weeks=event.previous_billing_cycle_weeks,
                next_billing_cycle_weeks=event.next_billing_cycle_weeks,
                reason=event.reason,
                occurred_at=event.occurred_at,
            )
            for event in lifecycle_result.scalars().all()
        ],
        adjustments=[
            ClassHistoryAdjustment(
                adjustment_id=adjustment.id,
                reason_code=adjustment.adjustment.reason_code,
                reason_note=adjustment.adjustment.reason_note,
                original_start_at=adjustment.original_start_at,
                original_end_at=adjustment.original_end_at,
                status=adjustment.status,
                display_status=adjustment_display_status(adjustment),
                replacement_start_at=adjustment.replacement_start_at,
                replacement_end_at=adjustment.replacement_end_at,
                completed_at=adjustment.completed_at,
                restored_at=adjustment.restored_at,
                version=adjustment.version,
            )
            for adjustment in adjustment_result.scalars().all()
        ],
    )


def _validate_effective_identity(
    class_: Class,
    *,
    allow_legacy: bool = False,
) -> None:
    validate_class_identity(
        identity_scheme=class_.identity_scheme,
        class_category=class_.class_category,
        grade_mode=class_.grade_mode,
        grade_level=class_.grade_level,
        academic_year_start=class_.academic_year_start,
        start_date=class_.start_date,
        end_date=class_.end_date,
        allow_legacy=allow_legacy,
    )


def _schedule_projection_with_slot_identity(class_: Class) -> ClassSchedule | None:
    """Compat projection: JSON schedule + stable slot ids/versions (R6-D07)."""
    schedule = class_.schedule
    if schedule is None:
        return None
    normalized = ClassSchedule.model_validate(schedule)
    if not class_.schedule_slots:
        return normalized
    enriched_slots: list[dict] = []
    for slot in class_.schedule_slots:
        if slot.effective_until is not None:
            continue
        enriched_slots.append(
            {
                "day": slot.weekday,
                "start": slot.local_start.strftime("%H:%M"),
                "end": slot.local_end.strftime("%H:%M"),
                "teacher_ids": [
                    str(link.staff_id)
                    for link in slot.staff_links
                    if link.role == "TEACHER"
                ],
                "assistant_ids": [
                    str(link.staff_id)
                    for link in slot.staff_links
                    if link.role == "ASSISTANT"
                ],
                "id": str(slot.id),
                "version": slot.version,
            }
        )
    return ClassSchedule.model_validate(
        {**normalized.model_dump(mode="json"), "slots": enriched_slots}
    )


def _schedule_summary(schedule: ClassSchedule | dict | None) -> str:
    """Tóm tắt slot cho audit: 'Thứ 2 18:00-19:30; Thứ 4 19:00-20:30'."""
    normalized = (
        schedule
        if isinstance(schedule, ClassSchedule)
        else ClassSchedule.model_validate(schedule)
        if schedule is not None
        else None
    )
    if normalized is None:
        return ""
    return "; ".join(f"{slot.day} {slot.start}-{slot.end}" for slot in normalized.slots)


def _append_lifecycle_event(
    db: AsyncSession,
    *,
    class_id: str,
    event_type: str,
    previous_end_date: date | None = None,
    next_end_date: date | None = None,
    previous_start_date: date | None = None,
    next_start_date: date | None = None,
    reason: str | None = None,
    actor_user_id: str | None = None,
    request_id: str | None = None,
) -> None:
    db.add(
        ClassLifecycleEvent(
            class_id=class_id,
            event_type=event_type,
            previous_end_date=previous_end_date,
            next_end_date=next_end_date,
            previous_start_date=previous_start_date,
            next_start_date=next_start_date,
            reason=reason,
            actor_user_id=actor_user_id,
            request_id=request_id,
            business_date=business_today(),
        )
    )


def classify_fee_record_for_end_date_change(
    record: FeeRecord,
    next_end_date: date,
) -> str:
    """Pure domain classifier for fee records under a planned or executed end_date change.

    A cycle is valid in the class lifecycle if its coverage_start < next_end_date.
    If coverage_start is None: fallback to due_date or base_due_date < next_end_date.
    Any cycle with coverage_start >= next_end_date is affected:
    - If status == 'PAID' or notified_at is not None or (record.refunded_amount and record.refunded_amount > 0): PROTECTED_AFFECTED
    - If status in ('VOID', 'SUPERSEDED'): VALID (already dead)
    - Otherwise (UNPAID + unnotified + 0 refund): MUTABLE_AFFECTED
    """
    if record.status in ("VOID", "SUPERSEDED"):
        return "VALID"
    anchor_start = record.coverage_start or record.base_due_date or record.due_date
    if anchor_start is None or anchor_start < next_end_date:
        return "VALID"
    if (
        record.status == "PAID"
        or record.notified_at is not None
        or (record.refunded_amount is not None and record.refunded_amount > 0)
    ):
        return "PROTECTED_AFFECTED"
    return "MUTABLE_AFFECTED"


async def _reconcile_class_fee_records_after_end_date_change(
    db: AsyncSession,
    class_: Class,
) -> None:
    """Remove only mutable out-of-range records; protected history blocks a cut-off."""

    result = await db.execute(
        select(FeeRecord, Enrollment)
        .join(Enrollment, Enrollment.id == FeeRecord.enrollment_id)
        .where(Enrollment.class_id == class_.id)
        .options(selectinload(Enrollment.class_))
        .with_for_update()
    )
    rows = list(result.all())
    if not rows:
        return

    for record, enrollment in rows:
        enrollment.class_ = class_
        category = classify_fee_record_for_end_date_change(record, class_.end_date)
        if category == "PROTECTED_AFFECTED":
            raise ValueError(
                "Không thể rút ngắn ngày học cuối cùng vì còn khoản học phí đã "
                "báo, đã nộp hoặc đã hoàn ngoài thời hạn mới; khoản này cần "
                "review/refund"
            )
        if category == "MUTABLE_AFFECTED":
            record.status = "SUPERSEDED"
            record.voided_at = datetime.now(timezone.utc)


async def _validate_end_date_against_enrollments(
    db: AsyncSession,
    *,
    class_id: str,
    end_date: date,
) -> None:
    enrollment_dates = list(
        (
            await db.scalars(
                select(Enrollment.enrollment_date).where(
                    Enrollment.class_id == class_id,
                    Enrollment.status != "cancelled",
                    Enrollment.enrollment_date.is_not(None),
                )
            )
        ).all()
    )
    latest_enrollment_date = max(enrollment_dates, default=None)
    if latest_enrollment_date is not None and end_date <= latest_enrollment_date:
        raise ValueError(
            "Ngày kết thúc phải sau ngày bắt đầu gần nhất trong lịch sử học viên của lớp"
        )


async def _create_class_without_commit(
    db: AsyncSession,
    data: ClassCreate,
    *,
    actor_user_id: str | None = None,
    continuation_request_id: UUID | None = None,
) -> Class:
    payload = data.model_dump()
    source_class_id = payload.pop("source_class_id", None)
    if source_class_id is not None:
        source_class = await db.get(Class, str(source_class_id))
        if source_class is None:
            raise ValueError("Không tìm thấy lớp nguồn trong workspace này")
    teacher_ids = _normalize_teacher_ids(
        payload.pop("teacher_ids", None),
        payload.pop("teacher_id", None),
    )
    assistant_ids = [
        str(assistant_id) for assistant_id in payload.pop("assistant_ids", None) or []
    ]
    if payload["type"] == "MONTHLY":
        payload["billing_cycle_months"] = 1
        payload["billing_cycle_weeks"] = None
    # Canonicalize assignment TRƯỚC khi tạo Class: teacher explicit, assistant
    # explicit (có thể rỗng), subset pool lớp được validate — đồng thời đảm bảo
    # JSONB lưu được (UUID → string) ngay từ lần insert đầu tiên.
    canonical_schedule = normalize_schedule_assignments(
        payload.get("schedule"),
        teacher_ids,
        assistant_ids,
    )
    if canonical_schedule and canonical_schedule.slots:
        teacher_ids = _schedule_teacher_ids(canonical_schedule)
    payload["schedule"] = (
        canonical_schedule.model_dump(mode="json") if canonical_schedule else None
    )
    class_ = Class(
        **payload,
        previous_class_id=str(source_class_id) if source_class_id else None,
        continuation_request_id=(
            str(continuation_request_id) if continuation_request_id else None
        ),
    )
    _synchronize_identity_metadata(class_)
    _validate_effective_identity(class_)
    await _ensure_unique_class_identity(
        db,
        identity_scheme=class_.identity_scheme,
        class_category=class_.class_category,
        name=class_.name,
        grade_level=class_.grade_level,
        academic_year_start=class_.academic_year_start,
        start_date=class_.start_date,
    )
    db.add(class_)
    await db.flush()
    await _validate_staff_schedule_availability(
        db,
        class_id=class_.id,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        schedule=payload["schedule"],
        start_date=payload.get("start_date"),
        end_date=payload.get("end_date"),
    )
    await _sync_class_staff(
        db,
        class_,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        actor_user_id=actor_user_id,
    )
    if payload.get("schedule"):
        await sync_class_slots(
            db,
            class_,
            payload.get("schedule"),
            actor_user_id=actor_user_id,
            reason="Phân công giáo viên theo từng buổi khi tạo lớp",
        )
    _append_lifecycle_event(
        db,
        class_id=class_.id,
        event_type="created",
        next_end_date=class_.end_date,
        reason=f"Tạo lớp kế tiếp từ lớp {source_class_id}" if source_class_id else None,
        actor_user_id=actor_user_id,
    )
    return class_


async def create_class(
    db: AsyncSession,
    data: ClassCreate,
    *,
    actor_user_id: str | None = None,
) -> Class:
    class_ = await _create_class_without_commit(
        db,
        data,
        actor_user_id=actor_user_id,
    )
    await _commit_class_changes(db)
    await db.refresh(class_)
    _clear_dependent_caches()
    return class_


async def get_class_copy_template(
    db: AsyncSession,
    id: UUID,
) -> ClassCopyTemplateResponse | None:
    class_ = await db.get(Class, str(id))
    if class_ is None:
        return None
    teacher_ids = await _get_class_teacher_ids(db, class_)
    assistant_ids = await _get_class_assistant_ids(db, class_)
    return ClassCopyTemplateResponse(
        name=f"{class_.name} (Bản sao)",
        type=class_.type,
        base_fee=int(class_.base_fee),
        billing_cycle_months=class_.billing_cycle_months,
        billing_cycle_weeks=class_.billing_cycle_weeks,
        identity_scheme=(
            class_.identity_scheme
            if class_.identity_scheme in ("ACADEMIC_YEAR", "INTAKE")
            else "INTAKE"
        ),
        class_category=class_.class_category,
        grade_mode=class_.grade_mode,
        program_name=class_.program_name,
        grade_level=class_.grade_level,
        academic_year_start=class_.academic_year_start,
        schedule=ClassSchedule.model_validate(class_.schedule)
        if class_.schedule
        else None,
        teacher_ids=[UUID(tid) for tid in teacher_ids],
        assistant_ids=[UUID(aid) for aid in assistant_ids],
        source_class_id=id,
    )


async def _continuation_source_enrollments(
    db: AsyncSession,
    class_: Class,
) -> list[Enrollment]:
    """Return the latest membership per active student that may continue.

    Looking at the latest membership first prevents a learner who left and was
    later re-enrolled from appearing twice, and prevents an older completed
    period from reviving a more recent dropped/cancelled membership.
    """

    result = await db.execute(
        select(Enrollment)
        .join(Student, Student.id == Enrollment.student_id)
        .where(
            Enrollment.class_id == class_.id,
            Student.status == "active",
        )
        .options(
            selectinload(Enrollment.student),
            selectinload(Enrollment.slot_selections),
        )
        .order_by(
            Enrollment.student_id.asc(),
            Enrollment.created_at.desc(),
            Enrollment.id.desc(),
        )
    )
    latest_by_student: dict[str, Enrollment] = {}
    for enrollment in result.scalars().unique().all():
        latest_by_student.setdefault(str(enrollment.student_id), enrollment)

    source_status = effective_class_status(class_)
    eligible: list[Enrollment] = []
    for enrollment in latest_by_student.values():
        if enrollment.status == "active":
            eligible.append(enrollment)
            continue
        if source_status == "STOPPED" and enrollment.status == "completed":
            eligible.append(enrollment)
    return sorted(
        eligible,
        key=lambda item: (
            item.student.full_name.casefold() if item.student else "",
            item.student_id,
        ),
    )


def _continuation_reference_date(class_: Class) -> date:
    return class_.stopped_on or business_today()


def _active_selection_ids(enrollment: Enrollment, reference: date) -> list[str]:
    return [
        str(selection.slot_id)
        for selection in enrollment.slot_selections
        if selection.effective_from <= reference
        and (selection.effective_until is None or selection.effective_until > reference)
    ]


async def preview_class_continuation(
    db: AsyncSession,
    id: UUID,
) -> ClassContinuationPreviewResponse | None:
    class_ = await db.get(Class, str(id))
    if class_ is None:
        return None
    if class_.cancelled_at is not None:
        raise ValueError("Không thể tạo lớp kế tiếp từ lớp đã hủy")
    if class_.identity_scheme == "LEGACY" or class_.start_date is None:
        raise ValueError("Lớp nguồn cần hoàn tất thông tin trước khi tạo lớp kế tiếp")

    suggested_start = business_today()
    template = await get_class_copy_template(db, id)
    if template is None:  # defensive: the class was loaded in this transaction
        return None
    template.name = class_.name
    if (
        template.identity_scheme == "ACADEMIC_YEAR"
        and template.academic_year_start is not None
    ):
        inferred_year = (
            suggested_start.year
            if suggested_start.month >= 8
            else suggested_start.year - 1
        )
        template.academic_year_start = max(
            template.academic_year_start + 1,
            inferred_year,
        )

    reference = _continuation_reference_date(class_)
    enrollments = await _continuation_source_enrollments(db, class_)
    source_slots = await load_class_slots(db, class_.id, effective_at=reference)
    source_slot_by_id = {
        str(slot["slot_id"]): ClassContinuationSlotReference(
            day=slot["day"],
            start=slot["start"],
            end=slot["end"],
        )
        for slot in source_slots
    }
    return ClassContinuationPreviewResponse(
        source_class_id=id,
        source_version=class_.version,
        suggested_start_date=suggested_start,
        suggested_end_date=None,
        template=template,
        students=[
            ClassContinuationStudentCandidate(
                student_id=UUID(str(enrollment.student_id)),
                student_code=enrollment.student.student_code,
                full_name=enrollment.student.full_name,
                source_enrollment_id=UUID(str(enrollment.id)),
                custom_fee=(
                    int(enrollment.custom_fee)
                    if enrollment.custom_fee is not None
                    else None
                ),
                selected_slot_count=len(_active_selection_ids(enrollment, reference)),
                selected_slots=[
                    source_slot_by_id[slot_id]
                    for slot_id in _active_selection_ids(enrollment, reference)
                    if slot_id in source_slot_by_id
                ],
            )
            for enrollment in enrollments
            if enrollment.student is not None
        ],
    )


def _slot_key(slot: dict) -> tuple[str, str, str]:
    return (str(slot["day"]), str(slot["start"]), str(slot["end"]))


def _clock_ranges_overlap(
    left_start: str,
    left_end: str,
    right_start: str,
    right_end: str,
) -> bool:
    return left_start < right_end and right_start < left_end


async def _student_schedule_rows_for_continuation(
    db: AsyncSession,
    *,
    student_ids: list[str],
    target_start: date,
    target_end: date | None,
) -> dict[str, list[tuple[str, str, str, str]]]:
    """Load existing selected sessions in one query for conflict checks."""

    if not student_ids:
        return {}
    effective_target_end = target_end or date.max
    rows = await db.execute(
        select(
            Enrollment.student_id,
            Class.name,
            ClassScheduleSlotModel.weekday,
            ClassScheduleSlotModel.local_start,
            ClassScheduleSlotModel.local_end,
        )
        .join(Class, Class.id == Enrollment.class_id)
        .join(
            EnrollmentSlotSelection,
            EnrollmentSlotSelection.enrollment_id == Enrollment.id,
        )
        .join(
            ClassScheduleSlotModel,
            ClassScheduleSlotModel.id == EnrollmentSlotSelection.slot_id,
        )
        .where(
            Enrollment.student_id.in_(student_ids),
            Enrollment.status != "cancelled",
            Enrollment.enrollment_date < effective_target_end,
            or_(Enrollment.ended_on.is_(None), Enrollment.ended_on > target_start),
            Class.cancelled_at.is_(None),
            Class.stopped_at.is_(None),
            Class.start_date < effective_target_end,
            or_(Class.stopped_on.is_(None), Class.stopped_on > target_start),
            EnrollmentSlotSelection.effective_from < effective_target_end,
            (EnrollmentSlotSelection.effective_until.is_(None))
            | (EnrollmentSlotSelection.effective_until > target_start),
            ClassScheduleSlotModel.effective_from < effective_target_end,
            (ClassScheduleSlotModel.effective_until.is_(None))
            | (ClassScheduleSlotModel.effective_until > target_start),
        )
        .order_by(Enrollment.student_id, Class.name)
    )
    result: dict[str, list[tuple[str, str, str, str]]] = {}
    for student_id, class_name, weekday, local_start, local_end in rows.all():
        result.setdefault(str(student_id), []).append(
            (
                str(class_name),
                str(weekday),
                local_start.strftime("%H:%M"),
                local_end.strftime("%H:%M"),
            )
        )
    return result


async def create_class_continuation(
    db: AsyncSession,
    source_id: UUID,
    data: ClassContinuationCreate,
    *,
    actor_user_id: str | None = None,
) -> tuple[Class, int]:
    """Create the next class and every selected membership atomically."""

    existing = await db.scalar(
        select(Class).where(
            Class.continuation_request_id == str(data.request_id),
        )
    )
    if existing is not None:
        if existing.previous_class_id != str(source_id):
            raise ValueError("Mã yêu cầu đã được sử dụng cho một lớp khác")
        enrolled_count = int(
            await db.scalar(
                select(func.count(Enrollment.id)).where(
                    Enrollment.class_id == existing.id,
                )
            )
            or 0
        )
        return existing, enrolled_count

    try:
        source = await db.scalar(
            select(Class).where(Class.id == str(source_id)).with_for_update()
        )
        if source is None:
            raise ValueError("Không tìm thấy lớp nguồn trong workspace này")
        if source.cancelled_at is not None:
            raise ValueError("Không thể tạo lớp kế tiếp từ lớp đã hủy")
        if source.identity_scheme == "LEGACY" or source.start_date is None:
            raise ValueError(
                "Lớp nguồn cần hoàn tất thông tin trước khi tạo lớp kế tiếp"
            )
        if source.version != data.expected_source_version:
            raise ValueError(
                "Lớp nguồn vừa được cập nhật. Vui lòng tải lại rồi thử lại"
            )
        if data.class_data.start_date is None:
            raise ValueError("Lớp mới cần có ngày bắt đầu")

        student_ids = sorted({str(item.student_id) for item in data.students})
        students = (
            list(
                (
                    await db.scalars(
                        select(Student)
                        .where(Student.id.in_(student_ids), Student.status == "active")
                        .order_by(Student.id.asc())
                        .with_for_update()
                    )
                ).all()
            )
            if student_ids
            else []
        )
        student_by_id = {str(student.id): student for student in students}
        if len(student_by_id) != len(student_ids):
            raise ValueError("Một hoặc nhiều học viên không còn hoạt động")

        source_enrollment_ids = sorted(
            {
                str(item.source_enrollment_id)
                for item in data.students
                if item.source_enrollment_id is not None
            }
        )
        source_enrollments = (
            list(
                (
                    await db.scalars(
                        select(Enrollment)
                        .where(
                            Enrollment.id.in_(source_enrollment_ids),
                            Enrollment.class_id == source.id,
                        )
                        .options(selectinload(Enrollment.slot_selections))
                        .order_by(Enrollment.id.asc())
                        .with_for_update()
                    )
                )
                .unique()
                .all()
            )
            if source_enrollment_ids
            else []
        )
        enrollment_by_id = {
            str(enrollment.id): enrollment for enrollment in source_enrollments
        }
        if len(enrollment_by_id) != len(source_enrollment_ids):
            raise ValueError("Một hoặc nhiều ghi danh không thuộc lớp nguồn")
        for selection in data.students:
            if selection.source_enrollment_id is None:
                continue
            enrollment = enrollment_by_id[str(selection.source_enrollment_id)]
            if enrollment.student_id != str(selection.student_id):
                raise ValueError("Học viên không khớp với ghi danh của lớp nguồn")

        class_payload = data.class_data.model_copy(
            update={"source_class_id": source_id},
        )
        target = await _create_class_without_commit(
            db,
            class_payload,
            actor_user_id=actor_user_id,
            continuation_request_id=data.request_id,
        )

        source_reference = _continuation_reference_date(source)
        source_slots = await load_class_slots(
            db,
            source.id,
            effective_at=source_reference,
        )
        source_slot_key_by_id = {
            str(slot["slot_id"]): _slot_key(slot) for slot in source_slots
        }
        target_slots = await load_class_slots(
            db,
            target.id,
            effective_at=target.start_date,
        )
        target_slot_id_by_key = {
            _slot_key(slot): str(slot["slot_id"]) for slot in target_slots
        }
        target_active_slot_ids = list(target_slot_id_by_key.values())
        target_slot_key_by_id = {
            slot_id: key for key, slot_id in target_slot_id_by_key.items()
        }
        if target.start_date is None:
            raise ValueError("Lớp mới cần có ngày bắt đầu")
        existing_schedule_by_student = await _student_schedule_rows_for_continuation(
            db,
            student_ids=student_ids,
            target_start=target.start_date,
            target_end=None,
        )

        for selection in data.students:
            source_enrollment = (
                enrollment_by_id.get(str(selection.source_enrollment_id))
                if selection.source_enrollment_id is not None
                else None
            )
            # Explicit per-student configuration wins. Omitted fields retain
            # the old continuation contract for safe rolling deployments.
            custom_fee = (
                selection.custom_fee
                if "custom_fee" in selection.model_fields_set
                else int(source_enrollment.custom_fee)
                if data.preserve_custom_fees
                and source_enrollment is not None
                and source_enrollment.custom_fee is not None
                else None
            )
            target_slot_ids: list[str] | None = None
            if selection.selected_slots is not None:
                selected_keys = [
                    (item.day, item.start, item.end)
                    for item in selection.selected_slots
                ]
                missing = [
                    key for key in selected_keys if key not in target_slot_id_by_key
                ]
                if missing:
                    raise ValueError(
                        "Lịch lớp mới đã thay đổi; vui lòng kiểm tra lại buổi học "
                        f"của {student_by_id[str(selection.student_id)].full_name}"
                    )
                target_slot_ids = [target_slot_id_by_key[key] for key in selected_keys]
                if (
                    len(target_slot_ids) < len(target_active_slot_ids)
                    and not selection.partial_fee_reviewed
                ):
                    raise ValueError(
                        "Vui lòng xác nhận học phí cho học viên học không đủ lịch: "
                        f"{student_by_id[str(selection.student_id)].full_name}"
                    )
            elif data.preserve_slot_selections and source_enrollment is not None:
                selected_source_ids = _active_selection_ids(
                    source_enrollment,
                    source_reference,
                )
                if selected_source_ids:
                    selected_keys = [
                        source_slot_key_by_id[source_slot_id]
                        for source_slot_id in selected_source_ids
                        if source_slot_id in source_slot_key_by_id
                    ]
                    missing = [
                        key for key in selected_keys if key not in target_slot_id_by_key
                    ]
                    if missing:
                        raise ValueError(
                            "Lịch lớp mới đã thay đổi; vui lòng kiểm tra lại buổi học "
                            f"của {student_by_id[str(selection.student_id)].full_name}"
                        )
                    target_slot_ids = [
                        target_slot_id_by_key[key] for key in selected_keys
                    ]

            effective_target_ids = target_slot_ids or target_active_slot_ids
            for target_slot_id in effective_target_ids:
                target_key = target_slot_key_by_id[target_slot_id]
                for class_name, day, start, end in existing_schedule_by_student.get(
                    str(selection.student_id),
                    [],
                ):
                    if day == target_key[0] and _clock_ranges_overlap(
                        start,
                        end,
                        target_key[1],
                        target_key[2],
                    ):
                        raise ValueError(
                            f"{student_by_id[str(selection.student_id)].full_name} "
                            f"trùng lịch lớp {class_name} vào {day}, {start}-{end}"
                        )

            await enroll_locked_student(
                db,
                student=student_by_id[str(selection.student_id)],
                class_=target,
                custom_fee=custom_fee,
                enrollment_date=target.start_date,
                selected_slot_ids=target_slot_ids,
                actor_user_id=actor_user_id,
                known_new_class=True,
                known_active_slot_ids=target_active_slot_ids,
            )

        await _commit_class_changes(db)
        await db.refresh(target)
        _clear_dependent_caches()
        return target, len(data.students)
    except Exception:
        await db.rollback()
        raise


async def update_class(
    db: AsyncSession,
    id: UUID,
    data: ClassUpdate,
    *,
    actor_user_id: str | None = None,
) -> Class | None:
    class_ = await get_class(db, id, for_update=True)
    if class_ is None:
        return None
    if (
        class_.completed_at is not None
        or class_.stopped_at is not None
        or class_.cancelled_at is not None
    ):
        raise ValueError("Không thể chỉnh sửa lớp đã ngừng hoặc đã hủy")

    payload = data.model_dump(exclude_unset=True)
    if "is_active" in payload:
        raise ValueError("Không thể thay đổi trạng thái lớp bằng biểu mẫu chỉnh sửa")
    if (
        class_.start_date is not None
        and "start_date" in payload
        and payload["start_date"] != class_.start_date
    ):
        raise ValueError("Vui lòng xem trước ảnh hưởng trước khi thay đổi ngày bắt đầu")
    changing_end_date = "end_date" in payload and payload["end_date"] != class_.end_date
    previous_end_date = class_.end_date if changing_end_date else None
    previous_schedule_summary = (
        _schedule_summary(class_.schedule) if "schedule" in payload else None
    )
    identity_was_changed = bool(
        {
            "identity_scheme",
            "class_category",
            "grade_mode",
            "grade_level",
            "academic_year_start",
        }
        & payload.keys()
    )
    end_date_reason = payload.pop("end_date_change_reason", None)
    expected_version = payload.pop("expected_version", None)
    expected_fingerprint = payload.pop("expected_fingerprint", None)
    if payload and expected_version != class_.version:
        raise ValueError("Dữ liệu lớp vừa được cập nhật. Vui lòng tải lại rồi thử lại")
    if changing_end_date and class_.identity_scheme != "LEGACY":
        if not end_date_reason:
            raise ValueError("Vui lòng nhập lý do đổi ngày học cuối cùng")
        if not _can_edit_end_date(class_, business_today()):
            raise ValueError("Ngày kết thúc đã bị khóa")

    teacher_ids_was_set = "teacher_ids" in payload or "teacher_id" in payload
    teacher_ids = _normalize_teacher_ids(
        payload.pop("teacher_ids", None),
        payload.pop("teacher_id", None)
        if "teacher_id" in payload
        else class_.teacher_id,
    )
    if not teacher_ids_was_set:
        teacher_ids = await _get_class_teacher_ids(db, class_)
    assistant_ids_was_set = "assistant_ids" in payload
    assistant_ids = (
        [str(assistant_id) for assistant_id in payload.pop("assistant_ids") or []]
        if assistant_ids_was_set
        else await _get_class_assistant_ids(db, class_)
    )
    next_type = payload.get("type", class_.type)
    if next_type == "MONTHLY":
        payload["billing_cycle_months"] = 1
        payload["billing_cycle_weeks"] = None

    today = business_today()
    if (
        "billing_cycle_weeks" in payload
        and payload["billing_cycle_weeks"] != class_.billing_cycle_weeks
    ):
        raise ValueError(
            "Thời lượng gói được cố định trong biểu mẫu này. Hãy dùng chức năng "
            "điều chỉnh thời lượng gói để xem trước ảnh hưởng học phí"
        )
    billing_fields = {"type", "billing_cycle_months"}
    if class_.start_date is not None and class_.start_date <= today:
        changed_billing_fields = {
            field
            for field in billing_fields & payload.keys()
            if payload[field] != getattr(class_, field)
        }
        if changed_billing_fields:
            raise ValueError(
                "Hình thức đóng học phí và thời lượng gói được cố định sau khi lớp bắt đầu"
            )

    next_billing_cycle = payload.get(
        "billing_cycle_months",
        class_.billing_cycle_months,
    )
    next_billing_cycle_weeks = payload.get(
        "billing_cycle_weeks",
        class_.billing_cycle_weeks,
    )
    next_start_date = payload.get("start_date", class_.start_date)
    next_end_date = payload.get("end_date", class_.end_date)
    if changing_end_date and next_end_date is not None:
        await _validate_end_date_against_enrollments(
            db,
            class_id=class_.id,
            end_date=next_end_date,
        )
        if class_.identity_scheme != "LEGACY":
            impact = await _end_date_impact(db, class_, next_end_date)
            if impact["protected_count"] > 0:
                raise ValueError(
                    "Không thể rút ngắn ngày học cuối cùng vì còn khoản học phí đã "
                    "báo, đã nộp hoặc đã hoàn ngoài thời hạn mới; khoản này cần "
                    "review/refund"
                )
            fingerprint = _end_date_preview_fingerprint(
                class_id=str(class_.id),
                version=class_.version,
                previous_end_date=class_.end_date,
                next_end_date=next_end_date,
                affected_student_count=impact["affected_student_count"],
                mutable_count=impact["mutable_count"],
                protected_count=impact["protected_count"],
            )
            if not expected_fingerprint or not hmac.compare_digest(
                fingerprint, expected_fingerprint
            ):
                raise ValueError(
                    "Dữ liệu ngày kết thúc vừa được cập nhật. Vui lòng tải lại rồi thử lại"
                )
    validate_class_configuration(
        class_type=next_type,
        billing_cycle_months=next_billing_cycle,
        billing_cycle_weeks=next_billing_cycle_weeks,
        start_date=next_start_date,
        end_date=next_end_date,
    )

    # Canonicalize schedule TRƯỚC setattr: JSONB không chấp nhận UUID object,
    # và mọi query sau đó (autoflush) phải thấy dữ liệu JSON-safe.
    if "schedule" in payload and payload["schedule"] is not None:
        canonical_schedule = normalize_schedule_assignments(
            payload["schedule"],
            teacher_ids,
            assistant_ids,
        )
        if canonical_schedule and canonical_schedule.slots:
            teacher_ids = _schedule_teacher_ids(canonical_schedule)
        payload["schedule"] = (
            canonical_schedule.model_dump(mode="json") if canonical_schedule else None
        )
    elif teacher_ids_was_set or assistant_ids_was_set:
        # A membership-only patch may add standby staff, but it cannot remove
        # or change the role of somebody still assigned to a canonical slot.
        # Fail as a business error before the deferred DB projection guard.
        normalize_schedule_assignments(
            class_.schedule,
            teacher_ids,
            assistant_ids,
        )

    for field, value in payload.items():
        setattr(class_, field, value)

    _synchronize_identity_metadata(class_)
    _validate_effective_identity(class_, allow_legacy=True)
    if class_.identity_scheme == "LEGACY" and ("identity_scheme" in payload):
        _validate_effective_identity(class_)
    await _ensure_unique_class_identity(
        db,
        identity_scheme=class_.identity_scheme,
        class_category=class_.class_category,
        name=class_.name,
        grade_level=class_.grade_level,
        academic_year_start=class_.academic_year_start,
        start_date=class_.start_date,
        exclude_id=class_.id,
    )

    if (
        teacher_ids_was_set
        or assistant_ids_was_set
        or "schedule" in payload
        or "start_date" in payload
        or "end_date" in payload
    ):
        # Xung đột được kiểm tra lại cho mọi lớp (kể cả sắp mở): backend là
        # nguồn xác nhận cuối cùng, không tin response availability trước đó.
        next_schedule = payload.get("schedule", class_.schedule)
        await _validate_staff_schedule_availability(
            db,
            class_id=class_.id,
            teacher_ids=teacher_ids,
            assistant_ids=assistant_ids,
            schedule=next_schedule,
            start_date=next_start_date,
            end_date=next_end_date,
        )

    if teacher_ids_was_set or assistant_ids_was_set or "schedule" in payload:
        await _sync_class_staff(
            db,
            class_,
            teacher_ids=teacher_ids,
            assistant_ids=assistant_ids,
            actor_user_id=actor_user_id,
        )
    if "schedule" in payload:
        await sync_class_slots(
            db,
            class_,
            class_.schedule,
            actor_user_id=actor_user_id,
            reason="Cập nhật giáo viên theo từng buổi",
        )

    if changing_end_date and class_.identity_scheme != "LEGACY":
        await _reconcile_class_fee_records_after_end_date_change(db, class_)
    elif {
        "base_fee",
        "type",
        "billing_cycle_months",
        "billing_cycle_weeks",
    } & payload.keys():
        await _reconcile_current_class_fees(db, class_)

    if identity_was_changed and class_.identity_scheme != "LEGACY":
        _append_lifecycle_event(
            db,
            class_id=class_.id,
            event_type="identity_configured",
            next_end_date=class_.end_date,
        )
    if changing_end_date and class_.identity_scheme != "LEGACY":
        _append_lifecycle_event(
            db,
            class_id=class_.id,
            event_type="end_date_changed",
            previous_end_date=previous_end_date,
            next_end_date=class_.end_date,
            reason=end_date_reason,
            actor_user_id=actor_user_id,
        )
    if "schedule" in payload:
        _append_lifecycle_event(
            db,
            class_id=class_.id,
            event_type="schedule_changed",
            reason=(
                f"Trước: {previous_schedule_summary or 'không có'}; "
                f"Sau: {_schedule_summary(class_.schedule) or 'không có'}"
            ),
            actor_user_id=actor_user_id,
        )

    await _commit_class_changes(db)
    await db.refresh(class_)
    _clear_dependent_caches()
    return class_


async def update_class_end_date(
    db: AsyncSession,
    id: UUID,
    data: ClassEndDateUpdate,
    *,
    actor_user_id: str | None,
) -> Class | None:
    """Update the final teaching day with server-time, financial and race checks.

    The caller must confirm an end-date preview first: `expected_version` and
    `expected_fingerprint` are checked under the class row lock, and the
    impact is recomputed inside this transaction (TOCTOU protection). A stale
    version or fingerprint raises a conflict (409).
    """

    class_ = await get_class(db, id, for_update=True)
    if class_ is None:
        return None
    if class_.version != data.expected_version:
        raise ValueError("Dữ liệu lớp vừa được cập nhật. Vui lòng tải lại rồi thử lại")
    if not _can_edit_end_date(class_, business_today()):
        raise ValueError("Ngày kết thúc đã bị khóa")
    if class_.start_date is None or class_.end_date is None:
        raise ValueError("Lớp chưa hoàn tất dữ liệu ngày học")

    if data.end_date <= class_.start_date:
        raise ValueError("Ngày kết thúc mới phải sau ngày bắt đầu")
    await _validate_end_date_against_enrollments(
        db,
        class_id=class_.id,
        end_date=data.end_date,
    )
    impact = await _end_date_impact(db, class_, data.end_date)
    if impact["protected_count"] > 0:
        raise ValueError(
            "Không thể rút ngắn ngày học cuối cùng vì còn khoản học phí đã báo, "
            "đã nộp hoặc đã hoàn ngoài thời hạn mới; khoản này cần review/refund"
        )
    expected_fingerprint = _end_date_preview_fingerprint(
        class_id=str(class_.id),
        version=class_.version,
        previous_end_date=class_.end_date,
        next_end_date=data.end_date,
        affected_student_count=impact["affected_student_count"],
        mutable_count=impact["mutable_count"],
        protected_count=impact["protected_count"],
    )
    if not hmac.compare_digest(expected_fingerprint, data.expected_fingerprint):
        raise ValueError(
            "Dữ liệu ngày kết thúc vừa được cập nhật. Vui lòng tải lại rồi thử lại"
        )

    teacher_ids = await _get_class_teacher_ids(db, class_)
    assistant_ids = await _get_class_assistant_ids(db, class_)
    await _validate_staff_schedule_availability(
        db,
        class_id=class_.id,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        schedule=class_.schedule,
        start_date=class_.start_date,
        end_date=data.end_date,
    )

    previous_end_date = class_.end_date
    class_.end_date = data.end_date
    class_.version += 1
    await _reconcile_class_fee_records_after_end_date_change(db, class_)
    _append_lifecycle_event(
        db,
        class_id=class_.id,
        event_type="end_date_changed",
        previous_end_date=previous_end_date,
        next_end_date=data.end_date,
        reason=data.reason,
        actor_user_id=actor_user_id,
    )
    await _commit_class_changes(db)
    await db.refresh(class_)
    _clear_dependent_caches()
    return class_


async def _end_date_impact(
    db: AsyncSession,
    class_: Class,
    end_date: date,
) -> dict[str, int]:
    """Impact counts of an end-date change using the canonical classification."""
    affected_student_count = int(
        await db.scalar(
            select(func.count(Enrollment.id)).where(
                Enrollment.class_id == class_.id,
                Enrollment.status != "cancelled",
            )
        )
        or 0
    )
    records = list(
        (
            await db.scalars(
                select(FeeRecord)
                .join(Enrollment, Enrollment.id == FeeRecord.enrollment_id)
                .where(
                    Enrollment.class_id == class_.id,
                    FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
                )
            )
        ).all()
    )
    mutable_count = 0
    protected_count = 0
    for record in records:
        category = classify_fee_record_for_end_date_change(record, end_date)
        if category == "MUTABLE_AFFECTED":
            mutable_count += 1
        elif category == "PROTECTED_AFFECTED":
            protected_count += 1
    return {
        "affected_student_count": affected_student_count,
        "mutable_count": mutable_count,
        "protected_count": protected_count,
    }


def _end_date_preview_fingerprint(
    *,
    class_id: str,
    version: int,
    previous_end_date: date,
    next_end_date: date,
    affected_student_count: int,
    mutable_count: int,
    protected_count: int,
) -> str:
    canonical = "|".join(
        (
            class_id,
            str(version),
            previous_end_date.isoformat(),
            next_end_date.isoformat(),
            str(affected_student_count),
            str(mutable_count),
            str(protected_count),
        )
    )
    return sha256(canonical.encode("utf-8")).hexdigest()


async def preview_class_end_date(
    db: AsyncSession,
    id: UUID,
    data: ClassEndDatePreviewRequest,
) -> ClassEndDatePreviewResponse | None:
    """Validate an end-date draft and return its operational impact without writing."""

    class_ = await get_class(db, id)
    if class_ is None:
        return None
    if class_.version != data.expected_version:
        raise ValueError("Dữ liệu lớp vừa được cập nhật. Vui lòng tải lại rồi thử lại")
    if not _can_edit_end_date(class_, business_today()):
        raise ValueError("Ngày kết thúc đã bị khóa")
    if class_.start_date is None or class_.end_date is None:
        raise ValueError("Lớp chưa hoàn tất dữ liệu ngày học")

    if data.end_date <= class_.start_date:
        raise ValueError("Ngày kết thúc mới phải sau ngày bắt đầu")
    await _validate_end_date_against_enrollments(
        db,
        class_id=class_.id,
        end_date=data.end_date,
    )
    teacher_ids = await _get_class_teacher_ids(db, class_)
    assistant_ids = await _get_class_assistant_ids(db, class_)
    await _validate_staff_schedule_availability(
        db,
        class_id=class_.id,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        schedule=class_.schedule,
        start_date=class_.start_date,
        end_date=data.end_date,
    )

    impact = await _end_date_impact(db, class_, data.end_date)
    total_days = (data.end_date - class_.start_date).days
    weeks = get_class_course_weeks(class_) if class_.type == "COURSE" else None
    return ClassEndDatePreviewResponse(
        previous_end_date=class_.end_date,
        next_end_date=data.end_date,
        total_weeks=total_days // 7 if class_.type == "COURSE" else None,
        package_count=(total_days // (weeks * 7)) if weeks else None,
        affected_student_count=impact["affected_student_count"],
        mutable_fee_record_count=impact["mutable_count"],
        protected_fee_record_count=impact["protected_count"],
        version=class_.version,
        preview_fingerprint=_end_date_preview_fingerprint(
            class_id=str(class_.id),
            version=class_.version,
            previous_end_date=class_.end_date,
            next_end_date=data.end_date,
            affected_student_count=impact["affected_student_count"],
            mutable_count=impact["mutable_count"],
            protected_count=impact["protected_count"],
        ),
        preview_expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )


def _start_date_preview_fingerprint(
    *,
    class_id: str,
    version: int,
    previous_start_date: date,
    next_start_date: date,
    affected_enrollment_count: int,
    protected_fee_record_count: int,
    blocking_history_count: int,
    affected_enrollments: list[dict[str, object]] | None = None,
    class_patch_hash: str | None = None,
) -> str:
    payload = {
        "class_id": str(class_id),
        "version": int(version),
        "previous_start_date": previous_start_date.isoformat(),
        "next_start_date": next_start_date.isoformat(),
        "affected_enrollment_count": int(affected_enrollment_count),
        "protected_fee_record_count": int(protected_fee_record_count),
        "blocking_history_count": int(blocking_history_count),
        "affected_enrollments": [
            {
                "enrollment_id": str(item.get("enrollment_id")),
                "new_enrollment_date": str(item.get("new_enrollment_date")),
                "recommended_decision": str(item.get("recommended_decision")),
            }
            for item in (affected_enrollments or [])
        ],
        "class_patch_hash": class_patch_hash,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return sha256(canonical.encode("utf-8")).hexdigest()


async def _start_date_impact(
    db: AsyncSession,
    class_: Class,
    next_start_date: date,
    *,
    default_decision: str | None = None,
    enrollment_decisions: dict[UUID, str] | None = None,
) -> dict[str, object]:
    from app.models.staff_attendance import StaffAttendanceEntry
    from app.services.billing_decision_service import (
        compute_billing_decisions_for_enrollment,
    )
    from app.services.fee_reconciliation import is_fee_record_protected

    can_apply = True
    blocking_reason = None
    earliest_historical_activity_date = None

    if next_start_date > class_.start_date:
        att_entry = await db.scalar(
            select(StaffAttendanceEntry)
            .where(
                StaffAttendanceEntry.occurrence_class_id == class_.id,
                StaffAttendanceEntry.reversed_at.is_(None),
                func.date(StaffAttendanceEntry.occurrence_start_at) < next_start_date,
            )
            .order_by(StaffAttendanceEntry.occurrence_start_at.asc())
            .limit(1)
        )
        if att_entry is not None:
            can_apply = False
            att_date = att_entry.occurrence_start_at.date()
            earliest_historical_activity_date = att_date
            blocking_reason = (
                f"Không thể dời ngày bắt đầu lớp về {next_start_date.strftime('%d/%m/%Y')} "
                f"vì lớp đã có hoạt động điểm danh giáo viên/trợ giảng vào ngày {att_date.strftime('%d/%m/%Y')}."
            )

        adj_entry = await db.scalar(
            select(ClassScheduleAdjustment)
            .where(
                ClassScheduleAdjustment.class_id == class_.id,
                ClassScheduleAdjustment.affected_from < next_start_date,
                ClassScheduleAdjustment.status != "CANCELLED",
            )
            .order_by(ClassScheduleAdjustment.affected_from.asc())
            .limit(1)
        )
        if adj_entry is not None:
            adj_date = adj_entry.affected_from
            if (
                earliest_historical_activity_date is None
                or adj_date < earliest_historical_activity_date
            ):
                can_apply = False
                earliest_historical_activity_date = adj_date
                blocking_reason = (
                    f"Không thể dời ngày bắt đầu lớp về {next_start_date.strftime('%d/%m/%Y')} "
                    f"vì lớp đã có hoạt động điều chỉnh lịch học vào ngày {adj_date.strftime('%d/%m/%Y')}."
                )

    enrollments = list(
        (
            await db.scalars(
                select(Enrollment)
                .where(
                    Enrollment.class_id == class_.id,
                    Enrollment.status != "cancelled",
                )
                .options(
                    selectinload(Enrollment.student),
                    selectinload(Enrollment.fee_records),
                    selectinload(Enrollment.billing_anchor_revisions),
                )
                .order_by(Enrollment.id.asc())
            )
        )
        .unique()
        .all()
    )

    affected_impacts: list[dict[str, object]] = []
    protected_count = 0
    today = business_today()

    for enr in enrollments:
        enr_date = enr.enrollment_date
        must_change = enr_date is not None and enr_date < next_start_date
        if must_change or (
            next_start_date < class_.start_date and enr_date == class_.start_date
        ):
            active_fees = [
                f for f in enr.fee_records if f.status not in ("VOID", "SUPERSEDED")
            ]
            enr_protected = [f for f in active_fees if is_fee_record_protected(f)]
            protected_count += len(enr_protected)

            new_enr_date = next_start_date
            effective_fee = (
                int(enr.custom_fee)
                if enr.custom_fee is not None
                else int(class_.base_fee)
            )
            weeks = (
                int(class_.billing_cycle_weeks) if class_.billing_cycle_weeks else None
            )

            decisions = compute_billing_decisions_for_enrollment(
                old_enrollment_date=enr_date or class_.start_date,
                new_enrollment_date=new_enr_date,
                billing_type=class_.type,
                cycle_weeks=weeks,
                effective_fee=effective_fee,
                fee_records=active_fees,
                today=today,
            )

            rec_decision = next(
                (d.decision_code.value for d in decisions if d.recommended),
                "REANCHOR_NEXT_BOUNDARY",
            )
            chosen_decision = None
            if enrollment_decisions and UUID(str(enr.id)) in enrollment_decisions:
                chosen_decision = enrollment_decisions[UUID(str(enr.id))]
            elif default_decision:
                chosen_decision = default_decision

            affected_impacts.append(
                {
                    "enrollment_id": str(enr.id),
                    "student_id": str(enr.student.id) if enr.student else "",
                    "student_name": enr.student.full_name if enr.student else "",
                    "class_id": str(class_.id),
                    "class_name": class_.name,
                    "old_enrollment_date": enr_date.isoformat() if enr_date else None,
                    "new_enrollment_date": new_enr_date.isoformat(),
                    "must_change": must_change,
                    "decisions": [d.model_dump() for d in decisions],
                    "recommended_decision": chosen_decision or rec_decision,
                    "protected_fee_count": len(enr_protected),
                    "mutable_fee_count": len(active_fees) - len(enr_protected),
                }
            )

    return {
        "can_apply": can_apply,
        "blocking_reason": blocking_reason,
        "earliest_historical_activity_date": earliest_historical_activity_date,
        "affected_enrollment_count": len(affected_impacts),
        "protected_fee_record_count": protected_count,
        "blocking_history_count": len(affected_impacts) + protected_count,
        "affected_enrollments": affected_impacts,
    }


async def preview_class_start_date(
    db: AsyncSession,
    id: UUID,
    data: ClassStartDatePreviewRequest,
) -> ClassStartDatePreviewResponse | None:
    class_ = await get_class(db, id)
    if class_ is None:
        return None
    if class_.version != data.expected_version:
        raise ValueError("Dữ liệu lớp vừa được cập nhật. Vui lòng tải lại rồi thử lại")
    if class_.start_date is None or class_.identity_scheme == "LEGACY":
        raise ValueError("Lớp chưa hoàn tất dữ liệu ngày bắt đầu")
    if class_.cancelled_at or class_.stopped_at or class_.completed_at:
        raise ValueError("Ngày bắt đầu của lớp đã ngừng hoặc đã hủy không thể thay đổi")

    teacher_ids = await _get_class_teacher_ids(db, class_)
    assistant_ids = await _get_class_assistant_ids(db, class_)
    await _validate_staff_schedule_availability(
        db,
        class_id=class_.id,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        schedule=class_.schedule,
        start_date=data.start_date,
        end_date=None,
    )
    impact = await _start_date_impact(
        db,
        class_,
        data.start_date,
        default_decision=data.default_decision,
        enrollment_decisions=data.enrollment_decisions,
    )

    class_patch_hash = None
    if data.class_patch is not None:
        patch_dict = (
            data.class_patch
            if isinstance(data.class_patch, dict)
            else data.class_patch.model_dump(exclude_unset=True)
        )
        class_patch_hash = sha256(
            json.dumps(patch_dict, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()

    fingerprint = _start_date_preview_fingerprint(
        class_id=class_.id,
        version=class_.version,
        previous_start_date=class_.start_date,
        next_start_date=data.start_date,
        affected_enrollment_count=int(impact["affected_enrollment_count"]),
        protected_fee_record_count=int(impact["protected_fee_record_count"]),
        blocking_history_count=int(impact["blocking_history_count"]),
        affected_enrollments=impact["affected_enrollments"],  # type: ignore[arg-type]
        class_patch_hash=class_patch_hash,
    )
    return ClassStartDatePreviewResponse(
        previous_start_date=class_.start_date,
        next_start_date=data.start_date,
        moves_earlier=data.start_date < class_.start_date,
        creates_retroactive_fees=False,
        version=class_.version,
        preview_fingerprint=fingerprint,
        preview_expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        **impact,  # type: ignore[arg-type]
    )


async def update_class_start_date(
    db: AsyncSession,
    id: UUID,
    data: ClassStartDateUpdate,
    *,
    actor_user_id: str | None,
) -> Class | None:
    class_ = await get_class(db, id, for_update=True)
    if class_ is None:
        return None

    request_id = data.request_id or uuid4()
    request_key = str(request_id)

    from app.models.start_date_change_command import (
        StartDateChangeCommandItem,
        StartDateChangeCommandRecord,
    )

    existing_cmd = await db.scalar(
        select(StartDateChangeCommandRecord).where(
            StartDateChangeCommandRecord.request_id == request_key
        )
    )
    if existing_cmd is not None and existing_cmd.state == "COMPLETED":
        return class_

    preview = await preview_class_start_date(
        db,
        id,
        ClassStartDatePreviewRequest(
            start_date=data.start_date,
            expected_version=data.expected_version,
            default_decision=data.default_decision,
            enrollment_decisions=data.enrollment_decisions,
            class_patch=data.class_patch,
        ),
    )
    assert preview is not None
    if not preview.can_apply:
        raise ValueError(
            preview.blocking_reason or "Không thể dời ngày bắt đầu của lớp học"
        )
    if not hmac.compare_digest(preview.preview_fingerprint, data.expected_fingerprint):
        raise ValueError(
            "Dữ liệu ngày bắt đầu vừa được cập nhật. Vui lòng tải lại rồi thử lại"
        )

    if data.class_patch is not None:
        patch_dict = (
            data.class_patch
            if isinstance(data.class_patch, dict)
            else data.class_patch.model_dump(exclude_unset=True)
        )
        patch_copy = dict(patch_dict)
        patch_copy.pop("start_date", None)
        patch_copy.pop("start_date_change_reason", None)
        patch_copy.pop("expected_version", None)
        patch_copy.pop("expected_fingerprint", None)
        if patch_copy:
            patch_schema = ClassUpdate(**patch_copy)
            await update_class(db, id, patch_schema, actor_user_id=actor_user_id)

    payload_hash = sha256(
        json.dumps(
            {
                "request_id": request_key,
                "class_id": str(class_.id),
                "start_date": data.start_date.isoformat(),
                "reason": data.reason,
            },
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()

    command_record = StartDateChangeCommandRecord(
        workspace_id=class_.workspace_id,
        request_id=request_key,
        subject_type="CLASS",
        class_id=str(class_.id),
        old_date=class_.start_date,
        new_date=data.start_date,
        payload_hash=payload_hash,
        preview_fingerprint=data.expected_fingerprint,
        state="PENDING",
        item_count=len(preview.affected_enrollments),
        reason=data.reason,
        actor_user_id=actor_user_id,
    )
    db.add(command_record)
    await db.flush()

    override_by_enr = {}
    for ov in data.enrollment_overrides:
        enr_id = ov.get("enrollment_id")
        if enr_id:
            override_by_enr[str(enr_id)] = ov

    from app.services.billing_decision_service import (
        compute_billing_decisions_for_enrollment,
    )
    from app.services.fee_reconciliation import (
        is_fee_record_mutable,
        is_fee_record_protected,
    )
    from app.services.payment_scaffold_service import (
        revoke_open_payment_requests_for_fee_records,
    )

    today = business_today()
    for item in preview.affected_enrollments:
        enr_id = item["enrollment_id"]
        enrollment = await db.scalar(
            select(Enrollment)
            .where(Enrollment.id == enr_id)
            .options(
                selectinload(Enrollment.fee_records),
                selectinload(Enrollment.billing_anchor_revisions),
            )
            .with_for_update()
        )
        if enrollment is None:
            continue

        ov = override_by_enr.get(enr_id, {})
        decision_code = (
            ov.get("decision_code")
            or data.default_decision
            or item.get("recommended_decision")
            or "REANCHOR_NEXT_BOUNDARY"
        )
        selected_hist = ov.get("selected_historical_cycles")
        new_enr_date = data.start_date
        old_enr_date = enrollment.enrollment_date or class_.start_date

        active_fees = [
            f for f in enrollment.fee_records if f.status not in ("VOID", "SUPERSEDED")
        ]
        protected_fees = [f for f in active_fees if is_fee_record_protected(f)]
        mutable_fees = [f for f in active_fees if is_fee_record_mutable(f)]

        decisions = compute_billing_decisions_for_enrollment(
            old_enrollment_date=old_enr_date,
            new_enrollment_date=new_enr_date,
            billing_type=class_.type,
            cycle_weeks=class_.billing_cycle_weeks,
            effective_fee=int(
                enrollment.custom_fee
                if enrollment.custom_fee is not None
                else class_.base_fee
            ),
            fee_records=active_fees,
            today=today,
        )
        chosen_opt = next(
            (d for d in decisions if d.decision_code.value == decision_code), None
        )
        if chosen_opt is None:
            chosen_opt = next(
                d
                for d in decisions
                if d.decision_code.value == "REANCHOR_NEXT_BOUNDARY"
            )

        if mutable_fees and chosen_opt.superseded_fee_count > 0:
            await revoke_open_payment_requests_for_fee_records(
                db,
                [f.id for f in mutable_fees],
                actor_id=actor_user_id,
                reason="Ngày bắt đầu lớp học đã thay đổi",
            )
            for f in mutable_fees:
                f.status = "SUPERSEDED"
                f.superseded_at = datetime.now(timezone.utc)

        prev_revision_id = enrollment.current_billing_revision_id
        for r in enrollment.billing_anchor_revisions:
            if r.state == "PENDING":
                r.state = "SUPERSEDED"
                r.resolved_at = datetime.now(timezone.utc)
                r.resolution_note = "Thay thế bởi dời ngày bắt đầu lớp học"

        enrollment.enrollment_date = new_enr_date
        enrollment.billing_anchor_version = (enrollment.billing_anchor_version or 0) + 1

        seq_no = int(enrollment.billing_anchor_version)
        revision = BillingAnchorRevision(
            workspace_id=class_.workspace_id,
            enrollment_id=enrollment.id,
            sequence_no=seq_no,
            previous_anchor_date=old_enr_date,
            anchor_date=new_enr_date,
            effective_on=today,
            generation_floor=chosen_opt.coverage_start,
            first_anchor_cycle_no=chosen_opt.first_anchor_cycle_no,
            next_due_date=chosen_opt.due_date,
            change_kind="CLASS_START_DATE_CHANGE",
            decision_code=decision_code,
            previous_enrollment_date=old_enr_date,
            next_enrollment_date=new_enr_date,
            skipped_anchor_cycle_count=chosen_opt.skipped_cycle_count,
            selected_historical_cycles=selected_hist,
            billing_type_snapshot=class_.type,
            billing_cycle_months_snapshot=class_.billing_cycle_months or 1,
            billing_cycle_weeks_snapshot=class_.billing_cycle_weeks,
            state="PENDING",
            reason=data.reason,
            request_id=str(uuid4()),
            actor_user_id=actor_user_id,
        )
        db.add(revision)
        await db.flush()

        enrollment.current_billing_revision_id = revision.id

        cmd_item = StartDateChangeCommandItem(
            workspace_id=class_.workspace_id,
            command_id=command_record.id,
            enrollment_id=enrollment.id,
            old_enrollment_date=old_enr_date,
            new_enrollment_date=new_enr_date,
            decision_code=decision_code,
            previous_billing_revision_id=prev_revision_id,
            next_billing_revision_id=revision.id,
            first_anchor_cycle_no=chosen_opt.first_anchor_cycle_no,
            selected_historical_cycles=selected_hist,
            protected_fee_count=len(protected_fees),
            superseded_fee_count=len(mutable_fees)
            if chosen_opt.superseded_fee_count > 0
            else 0,
            skipped_cycle_count=chosen_opt.skipped_cycle_count,
        )
        db.add(cmd_item)

    previous = class_.start_date
    class_.start_date = data.start_date
    class_.version += 1

    command_record.state = "COMPLETED"
    command_record.completed_at = datetime.now(timezone.utc)

    _append_lifecycle_event(
        db,
        class_id=class_.id,
        event_type="start_date_changed",
        previous_start_date=previous,
        next_start_date=data.start_date,
        reason=data.reason,
        actor_user_id=actor_user_id,
    )
    await _commit_class_changes(db)
    await db.refresh(class_)
    _clear_dependent_caches()
    return class_


async def _stop_impact(
    db: AsyncSession, class_: Class, stopped_on: date
) -> dict[str, int]:
    active_enrollment_rows = list(
        (
            await db.scalars(
                select(Enrollment).where(
                    Enrollment.class_id == class_.id,
                    Enrollment.status != "cancelled",
                    or_(
                        Enrollment.ended_on.is_(None), Enrollment.ended_on > stopped_on
                    ),
                )
            )
        ).all()
    )
    active_enrollments = len(active_enrollment_rows)
    unresolved = int(
        await db.scalar(
            select(func.count(ClassSessionException.id)).where(
                ClassSessionException.class_id == class_.id,
                ClassSessionException.status.in_(
                    ("MAKEUP_PENDING", "MAKEUP_SCHEDULED")
                ),
            )
        )
        or 0
    )
    records = list(
        (
            await db.scalars(
                select(FeeRecord)
                .join(Enrollment, Enrollment.id == FeeRecord.enrollment_id)
                .where(
                    Enrollment.class_id == class_.id,
                    FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
                )
            )
        ).all()
    )
    from app.services.fee_reconciliation import is_fee_record_protected

    mutable_future = 0
    for record in records:
        anchor = record.coverage_start or record.base_due_date or record.due_date
        if (
            anchor is not None
            and anchor >= stopped_on
            and not is_fee_record_protected(record)
        ):
            mutable_future += 1
    return {
        "active_enrollment_count": active_enrollments,
        "future_mutable_fee_record_count": mutable_future,
        "retained_fee_record_count": len(records) - mutable_future,
        "unresolved_makeup_count": unresolved,
        "final_fee_count": sum(
            1
            for enrollment in active_enrollment_rows
            if enrollment.enrollment_date is not None
            and enrollment.enrollment_date < stopped_on
        ),
        "final_package_review_count": sum(
            1
            for enrollment in active_enrollment_rows
            if class_.type == "COURSE"
            and enrollment.enrollment_date is not None
            and enrollment.enrollment_date < stopped_on
            and (stopped_on - enrollment.enrollment_date).days
            % (max(int(class_.billing_cycle_weeks or 1), 1) * 7)
            != 0
        ),
    }


def _stop_preview_fingerprint(
    *, class_id: str, version: int, stopped_on: date, impact: dict[str, int]
) -> str:
    canonical = "|".join(
        [class_id, str(version), stopped_on.isoformat()]
        + [str(impact[key]) for key in sorted(impact)]
    )
    return sha256(canonical.encode("utf-8")).hexdigest()


async def preview_class_stop(
    db: AsyncSession,
    id: UUID,
    data: ClassStopPreviewRequest,
) -> ClassStopPreviewResponse | None:
    class_ = await get_class(db, id)
    if class_ is None:
        return None
    if class_.version != data.expected_version:
        raise ValueError("Dữ liệu lớp vừa được cập nhật. Vui lòng tải lại rồi thử lại")
    if (
        class_.cancelled_at
        or class_.stopped_at
        or class_.completed_at
        or not class_.is_active
    ):
        raise ValueError("Lớp đã ngừng hoặc đã hủy")
    stopped_on = business_today()
    impact = await _stop_impact(db, class_, stopped_on)
    return ClassStopPreviewResponse(
        stopped_on=stopped_on,
        version=class_.version,
        preview_fingerprint=_stop_preview_fingerprint(
            class_id=class_.id,
            version=class_.version,
            stopped_on=stopped_on,
            impact=impact,
        ),
        preview_expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        **impact,
    )


async def stop_class(
    db: AsyncSession,
    id: UUID,
    data: ClassStopRequest,
    *,
    actor_user_id: str | None,
) -> Class | None:
    class_ = await get_class(db, id, for_update=True)
    if class_ is None:
        return None
    existing = await db.scalar(
        select(ClassLifecycleEvent).where(
            ClassLifecycleEvent.class_id == class_.id,
            ClassLifecycleEvent.event_type == "stopped",
            ClassLifecycleEvent.request_id == str(data.request_id),
        )
    )
    if existing is not None and class_.stopped_at is not None:
        return class_
    preview = await preview_class_stop(
        db, id, ClassStopPreviewRequest(expected_version=data.expected_version)
    )
    assert preview is not None
    if preview.unresolved_makeup_count:
        raise ValueError(
            "Lớp còn buổi học bù chưa hoàn tất. Vui lòng xử lý trước khi ngừng lớp"
        )
    if not hmac.compare_digest(preview.preview_fingerprint, data.expected_fingerprint):
        raise ValueError("Dữ liệu lớp vừa được cập nhật. Vui lòng tải lại rồi thử lại")

    await _lock_enrolled_students(db, class_.id)
    enrollment_result = await db.execute(
        select(Enrollment)
        .where(
            Enrollment.class_id == class_.id,
            Enrollment.status != "cancelled",
            or_(
                Enrollment.ended_on.is_(None),
                Enrollment.ended_on > preview.stopped_on,
            ),
        )
        .order_by(Enrollment.id.asc())
        .with_for_update()
    )
    now = datetime.now(timezone.utc)
    for enrollment in enrollment_result.scalars().unique().all():
        enrollment.class_ = class_
        never_started = bool(
            enrollment.enrollment_date is not None
            and enrollment.enrollment_date > preview.stopped_on
        )
        if not never_started:
            await ensure_final_cycle_for_stop(
                db, enrollment, stopped_on=preview.stopped_on
            )
        await close_enrollment_financial_projection(
            db,
            enrollment,
            actor_user_id=actor_user_id,
            reason=(
                "Hủy ghi danh vì lớp ngừng trước ngày bắt đầu"
                if never_started
                else data.reason
            ),
            close_on=(
                enrollment.enrollment_date if never_started else preview.stopped_on
            ),
        )
        await close_enrollment_slot_selections(
            db,
            enrollment,
            ended_on=(
                enrollment.enrollment_date if never_started else preview.stopped_on
            ),
        )
        enrollment.status = "cancelled" if never_started else "completed"
        enrollment.ended_on = None if never_started else preview.stopped_on
        enrollment.ended_at = now
        enrollment.end_reason = (
            "Hủy ghi danh vì lớp ngừng trước ngày bắt đầu"
            if never_started
            else "Lớp ngừng hoạt động"
        )

    class_.is_active = False
    class_.stopped_on = preview.stopped_on
    class_.stopped_at = now
    class_.stopped_reason = data.reason
    class_.version += 1
    _append_lifecycle_event(
        db,
        class_id=class_.id,
        event_type="stopped",
        reason=data.reason,
        actor_user_id=actor_user_id,
        request_id=str(data.request_id),
    )
    await _commit_class_changes(db)
    await db.refresh(class_)
    _clear_dependent_caches()
    return class_


async def complete_expired_classes(db: AsyncSession) -> int:
    """Compatibility no-op: open-ended classes never expire automatically."""

    return 0


async def _lock_enrolled_students(
    db: AsyncSession,
    class_id: str,
) -> list[Student]:
    student_ids_result = await db.execute(
        select(Enrollment.student_id)
        .where(
            Enrollment.class_id == class_id,
            enrollment_current_or_scheduled_predicate(),
        )
        .order_by(Enrollment.student_id.asc())
    )
    student_ids = list(dict.fromkeys(student_ids_result.scalars().all()))
    if not student_ids:
        return []

    students_result = await db.execute(
        select(Student)
        .where(Student.id.in_(student_ids))
        .order_by(Student.id.asc())
        .with_for_update()
    )
    return list(students_result.scalars().unique().all())


async def delete_class(
    db: AsyncSession,
    id: UUID,
    *,
    actor_user_id: str | None = None,
) -> Class | None:
    """Cancel a class operationally without deleting historical records."""

    class_ = await get_class(db, id, for_update=True)
    if class_ is None:
        return None
    if class_.completed_at is not None:
        raise ValueError("Lớp đã hoàn tất không thể hủy")
    unresolved = await db.scalar(
        select(func.count(ClassSessionException.id)).where(
            ClassSessionException.class_id == class_.id,
            ClassSessionException.status.in_(["MAKEUP_PENDING", "MAKEUP_SCHEDULED"]),
        )
    )
    if unresolved:
        raise ValueError(
            "Lớp còn buổi học bù chưa hoàn tất. Vui lòng xử lý xong các buổi học bù trước khi hủy lớp"
        )

    await _lock_enrolled_students(db, class_.id)
    enrollment_result = await db.execute(
        select(Enrollment)
        .where(
            Enrollment.class_id == class_.id,
            enrollment_current_or_scheduled_predicate(),
        )
        .order_by(Enrollment.id)
        .with_for_update()
    )
    affected_enrollments = list(enrollment_result.scalars().unique().all())
    class_.is_active = False
    class_.cancelled_at = datetime.now(timezone.utc)
    class_.cancelled_reason = "Đã xoá lớp khỏi vận hành"
    today = business_today()
    for enrollment in affected_enrollments:
        close_on = max(enrollment.enrollment_date or today, today)
        await close_enrollment_financial_projection(
            db,
            enrollment,
            actor_user_id=actor_user_id,
            reason="Lớp đã bị hủy",
            close_on=close_on,
        )
        await close_enrollment_slot_selections(db, enrollment, ended_on=close_on)
        enrollment.status = "cancelled"
        enrollment.ended_on = close_on
        enrollment.ended_at = datetime.now(timezone.utc)
        enrollment.end_reason = "Lớp đã bị hủy"
    _append_lifecycle_event(
        db,
        class_id=class_.id,
        event_type="cancelled",
        previous_end_date=class_.end_date,
        next_end_date=class_.end_date,
        reason=class_.cancelled_reason,
        actor_user_id=actor_user_id,
    )
    await db.commit()
    await db.refresh(class_)
    _clear_dependent_caches()
    return class_
