"""Class postponement / make-up commands and read models (migration 053).

Financial isolation: this module never touches fee records, fee operations,
payments or the reconciliation service. Every mutation revalidates canonical
state inside its own transaction, uses optimistic versioning plus ordered
row locks, writes append-only audit events and recomputes the operational
end date. Idempotent replays return the original result deterministically.
"""

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.business_time import BUSINESS_TIMEZONE, business_today
from app.core.class_lifecycle import effective_class_status
from app.core.makeup_state import (
    derived_display_status,
    validate_transition,
)
from app.core.occurrence import (
    Occurrence,
    apply_exceptions,
    occurrence_key,
    slot_key,
    slot_duration_minutes,
)
from app.models.class_ import Class
from app.models.class_teacher import ClassTeacher
from app.models.enrollment import Enrollment
from app.models.enrollment_slot_selection import EnrollmentSlotSelection
from app.models.makeup import (
    ClassScheduleAdjustment,
    ClassScheduleAdjustmentEvent,
    ClassSessionException,
    ClassSessionStaffSnapshot,
    ClassSessionStudentSnapshot,
)
from app.models.staff import StaffMember
from app.models.student import Student
from app.schemas.class_ import ClassSchedule
from app.schemas.makeup import (
    BILLING_IMPACT_NONE,
    AdjustmentStatus,
    ClassAdjustmentListResponse,
    ClassOccurrenceListResponse,
    ClassScheduleAdjustmentResponse,
    ClassSessionExceptionResponse,
    EligibleStudentSummary,
    ExceptionCommandResponse,
    MakeupDomainError,
    MakeupSchedulePreviewRequest,
    MakeupSchedulePreviewResponse,
    MakeupScheduleRequest,
    MakeupUnscheduleRequest,
    MakeupCompleteRequest,
    OccurrenceResponse,
    PostponementCreateRequest,
    PostponementCreateResponse,
    PostponementOccurrenceOption,
    PostponementPreviewRequest,
    PostponementPreviewResponse,
    RestoreOriginalRequest,
    StaffSnapshotResponse,
)
from app.services.class_conflict_service import (
    check_makeup_conflicts,
    inherited_staff_active,
)
from app.services.schedule_slot_service import expand_class_occurrences

NULL_ACTOR_UUID = "00000000-0000-0000-0000-000000000000"


def _actor_id(actor_user_id: str | None) -> str:
    """created_by là NOT NULL nhưng không FK profiles (account deletion); dùng
    sentinel UUID cho hệ thống/worker (actor None)."""
    return str(actor_user_id) if actor_user_id else NULL_ACTOR_UUID


# ---------------------------------------------------------------------------
# Response builders
# ---------------------------------------------------------------------------


def _staff_snapshot_response(
    snapshot: ClassSessionStaffSnapshot,
) -> StaffSnapshotResponse:
    return StaffSnapshotResponse(
        staff_id=UUID(str(snapshot.staff_id)),
        role=snapshot.role,
        display_name=snapshot.display_name_snapshot,
        source_slot_key=snapshot.source_slot_key,
    )


def _exception_response(
    exception: ClassSessionException,
    *,
    eligible_count: int | None = None,
    now: datetime | None = None,
) -> ClassSessionExceptionResponse:
    return ClassSessionExceptionResponse(
        id=UUID(str(exception.id)),
        adjustment_id=UUID(str(exception.adjustment_id)),
        class_id=UUID(str(exception.class_id)),
        original_start_at=exception.original_start_at,
        original_end_at=exception.original_end_at,
        original_timezone=exception.original_timezone,
        status=exception.status,
        display_status=derived_display_status(exception, now=now),
        replacement_start_at=exception.replacement_start_at,
        replacement_end_at=exception.replacement_end_at,
        completed_at=exception.completed_at,
        restored_at=exception.restored_at,
        version=exception.version,
        staff=[
            _staff_snapshot_response(snapshot) for snapshot in exception.staff_snapshots
        ],
        eligible_student_count=(
            len(exception.student_snapshots)
            if eligible_count is None
            else eligible_count
        ),
        billing_impact=BILLING_IMPACT_NONE,
        created_at=exception.created_at,
        updated_at=exception.updated_at,
    )


def _adjustment_response(
    adjustment: ClassScheduleAdjustment,
) -> ClassScheduleAdjustmentResponse:
    return ClassScheduleAdjustmentResponse(
        id=UUID(str(adjustment.id)),
        class_id=UUID(str(adjustment.class_id)),
        reason_code=adjustment.reason_code,
        reason_note=adjustment.reason_note,
        affected_from=adjustment.affected_from,
        affected_through=adjustment.affected_through,
        status=adjustment.status,
        created_by=UUID(str(adjustment.created_by)),
        request_id=UUID(str(adjustment.request_id)),
        version=adjustment.version,
        created_at=adjustment.created_at,
        updated_at=adjustment.updated_at,
    )


def _occurrence_response(
    occurrence: Occurrence,
    *,
    today: date,
) -> OccurrenceResponse:
    adjustable = (
        occurrence.kind == "REGULAR" and occurrence.original_start_at.date() >= today
    )
    return OccurrenceResponse(
        key=occurrence.key,
        kind=occurrence.kind,
        original_start_at=occurrence.original_start_at,
        original_end_at=occurrence.original_end_at,
        source_slot_key=occurrence.source_slot_key,
        teacher_ids=[UUID(staff_id) for staff_id in occurrence.teacher_ids],
        assistant_ids=[UUID(staff_id) for staff_id in occurrence.assistant_ids],
        exception_id=(
            UUID(str(occurrence.exception_id))
            if occurrence.exception_id is not None
            else None
        ),
        status=occurrence.status,
        replacement_start_at=occurrence.replacement_start_at,
        replacement_end_at=occurrence.replacement_end_at,
        adjustable=adjustable,
        already_adjusted=occurrence.exception_id is not None,
        passed=occurrence.original_start_at.date() < today,
    )


async def _load_exception_with_snapshots(
    db: AsyncSession,
    exception_id: str,
    *,
    for_update: bool = False,
) -> ClassSessionException | None:
    statement = (
        select(ClassSessionException)
        .where(ClassSessionException.id == exception_id)
        .options(
            selectinload(ClassSessionException.staff_snapshots),
            selectinload(ClassSessionException.student_snapshots),
        )
    )
    if for_update:
        statement = statement.with_for_update()
    result = await db.execute(statement)
    return result.scalar_one_or_none()


async def _load_class_for_update(db: AsyncSession, class_id: str) -> Class | None:
    statement = (
        select(Class)
        .where(Class.id == class_id)
        .options(
            selectinload(Class.teacher_links).selectinload(ClassTeacher.teacher),
            selectinload(Class.enrollments),
        )
        .with_for_update()
    )
    result = await db.execute(statement)
    return result.scalar_one_or_none()


async def _replay_postponement(
    db: AsyncSession,
    adjustment: ClassScheduleAdjustment,
    data: PostponementCreateRequest,
    *,
    today: date,
) -> PostponementCreateResponse | None:
    """Idempotent replay: same (created_by, request_id) returns the stored
    batch IF the payload matches; a different payload is a deterministic
    conflict."""
    exceptions = await _load_exceptions_for_adjustment(db, adjustment.id)
    stored_originals = sorted(
        item.original_start_at.astimezone(timezone.utc).isoformat()
        for item in exceptions
    )
    requested_originals = sorted(
        item.astimezone(timezone.utc).isoformat() for item in data.original_start_at
    )
    payload_matches = (
        adjustment.reason_code == data.reason_code
        and (adjustment.reason_note or "").strip() == (data.reason_note or "").strip()
        and stored_originals == requested_originals
    )
    if not payload_matches:
        raise MakeupDomainError(
            "REQUEST_ALREADY_PROCESSED",
            "Yêu cầu này đã được xử lý với dữ liệu khác. Vui lòng kiểm tra lại",
        )
    return PostponementCreateResponse(
        adjustment=_adjustment_response(adjustment),
        exceptions=[_exception_response(item) for item in exceptions],
        billing_impact=BILLING_IMPACT_NONE,
    )


async def _load_exceptions_for_adjustment(
    db: AsyncSession,
    adjustment_id: str,
) -> list[ClassSessionException]:
    result = await db.execute(
        select(ClassSessionException)
        .where(ClassSessionException.adjustment_id == adjustment_id)
        .options(
            selectinload(ClassSessionException.staff_snapshots),
            selectinload(ClassSessionException.student_snapshots),
        )
        .order_by(ClassSessionException.original_start_at.asc())
    )
    return list(result.scalars().unique().all())


def _weekday_name(value: datetime) -> str:
    return {
        0: "Thứ 2",
        1: "Thứ 3",
        2: "Thứ 4",
        3: "Thứ 5",
        4: "Thứ 6",
        5: "Thứ 7",
        6: "Chủ Nhật",
    }[value.weekday()]


async def _eligible_students(
    db: AsyncSession,
    class_id: str,
    original_start_at: datetime,
    source_slot_id: str | None = None,
) -> list[EligibleStudentSummary]:
    """Snapshot eligibility theo membership + slot selection tại ngày
    ORIGINAL (local date). Khi occurrence có source_slot_id, chỉ học viên có
    selection hiệu lực cho slot đó mới eligible (R6-D09)."""
    original_local_date = original_start_at.astimezone(BUSINESS_TIMEZONE).date()
    statement = (
        select(Enrollment, Student.full_name)
        .join(Student, Student.id == Enrollment.student_id)
        .where(
            Enrollment.class_id == class_id,
            Enrollment.status == "active",
            Enrollment.enrollment_date.is_not(None),
            Enrollment.enrollment_date <= original_local_date,
        )
        .order_by(Enrollment.enrollment_date.asc(), Enrollment.created_at.asc())
    )
    if source_slot_id is not None:
        statement = statement.join(
            EnrollmentSlotSelection,
            (EnrollmentSlotSelection.enrollment_id == Enrollment.id)
            & (EnrollmentSlotSelection.slot_id == source_slot_id),
        ).where(
            EnrollmentSlotSelection.effective_from <= original_local_date,
            (EnrollmentSlotSelection.effective_until.is_(None))
            | (EnrollmentSlotSelection.effective_until > original_local_date),
        )
    result = await db.execute(statement)
    summaries: list[EligibleStudentSummary] = []
    for enrollment, student_name in result.all():
        ended_at = enrollment.ended_at
        if ended_at is not None:
            ended_local = ended_at.astimezone(BUSINESS_TIMEZONE).date()
            if ended_local < original_local_date:
                continue
        summaries.append(
            EligibleStudentSummary(
                student_id=UUID(str(enrollment.student_id)),
                student_name=student_name,
                enrolled_at=enrollment.enrollment_date,
            )
        )
    return summaries


async def _snapshot_students(
    db: AsyncSession,
    exception: ClassSessionException,
    summaries: list[EligibleStudentSummary],
    *,
    class_id: str,
) -> None:
    result = await db.execute(
        select(Enrollment).where(
            Enrollment.class_id == class_id,
            Enrollment.status == "active",
        )
    )
    enrollment_by_student = {
        str(enrollment.student_id): enrollment for enrollment in result.scalars()
    }
    for summary in summaries:
        enrollment = enrollment_by_student.get(str(summary.student_id))
        if enrollment is None:
            continue
        db.add(
            ClassSessionStudentSnapshot(
                exception_id=exception.id,
                student_id=str(summary.student_id),
                enrollment_id=enrollment.id,
                student_name_snapshot=summary.student_name,
                enrolled_at_snapshot=enrollment.enrollment_date,
                enrollment_end_snapshot=(
                    enrollment.ended_at.astimezone(BUSINESS_TIMEZONE).date()
                    if enrollment.ended_at is not None
                    else None
                ),
                eligibility_status="ELIGIBLE",
            )
        )


def _append_event(
    db: AsyncSession,
    *,
    exception_id: str,
    event_type: str,
    old_payload: dict | None,
    new_payload: dict | None,
    actor_user_id: str | None,
    request_id: str,
) -> ClassScheduleAdjustmentEvent:
    event = ClassScheduleAdjustmentEvent(
        exception_id=exception_id,
        event_type=event_type,
        old_payload=old_payload,
        new_payload=new_payload,
        actor_user_id=actor_user_id,
        request_id=request_id,
    )
    db.add(event)
    return event


async def _find_replayed_exception_command(
    db: AsyncSession,
    *,
    exception_id: str,
    event_type: str,
    request_id: str,
) -> ClassSessionException | None:
    """Idempotent replay cho exception command: event trùng (exception, type,
    request_id) -> trả về exception hiện tại."""
    event_id = await db.scalar(
        select(ClassScheduleAdjustmentEvent.id).where(
            ClassScheduleAdjustmentEvent.exception_id == exception_id,
            ClassScheduleAdjustmentEvent.event_type == event_type,
            ClassScheduleAdjustmentEvent.request_id == request_id,
        )
    )
    if event_id is None:
        return None
    return await _load_exception_with_snapshots(db, exception_id)


# ---------------------------------------------------------------------------
# Preview (read-only)
# ---------------------------------------------------------------------------


async def preview_postponement(
    db: AsyncSession,
    class_id: UUID,
    data: PostponementPreviewRequest,
) -> PostponementPreviewResponse:
    class_ = await db.get(Class, str(class_id))
    if class_ is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy lớp học")
    today = business_today()
    range_start = datetime.combine(
        data.from_date, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    range_end = datetime.combine(
        data.to_date + timedelta(days=1), datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    exceptions = await _load_exceptions_for_class(
        db,
        str(class_id),
        data.from_date,
        data.to_date + timedelta(days=1),
    )
    adjusted_originals = {
        item.original_start_at.astimezone(timezone.utc)
        for item in exceptions
        if item.status != "RESTORED"
    }
    occurrences = await expand_class_occurrences(
        db,
        class_,
        range_start=range_start,
        range_end=range_end,
    )
    options: list[PostponementOccurrenceOption] = []
    for occurrence in occurrences:
        already = occurrence.original_start_at in adjusted_originals
        passed = (
            occurrence.original_start_at.astimezone(BUSINESS_TIMEZONE).date() < today
        )
        options.append(
            PostponementOccurrenceOption(
                key=occurrence.key,
                original_start_at=occurrence.original_start_at,
                original_end_at=occurrence.original_end_at,
                source_slot_key=occurrence.source_slot_key,
                teacher_ids=[UUID(item) for item in occurrence.teacher_ids],
                assistant_ids=[UUID(item) for item in occurrence.assistant_ids],
                adjustable=not already and not passed,
                already_adjusted=already,
                passed=passed,
            )
        )
    return PostponementPreviewResponse(
        class_id=class_id,
        occurrences=options,
        billing_impact=BILLING_IMPACT_NONE,
    )


async def _load_exceptions_for_class(
    db: AsyncSession,
    class_id: str,
    from_date: date,
    to_date: date,
) -> list[ClassSessionException]:
    result = await db.execute(
        select(ClassSessionException)
        .where(
            ClassSessionException.class_id == class_id,
            ClassSessionException.original_start_at
            >= datetime.combine(from_date, datetime.min.time(), tzinfo=timezone.utc),
            ClassSessionException.original_start_at
            < datetime.combine(to_date, datetime.min.time(), tzinfo=timezone.utc),
        )
        .options(
            selectinload(ClassSessionException.staff_snapshots),
            selectinload(ClassSessionException.student_snapshots),
        )
        .order_by(ClassSessionException.original_start_at.asc())
    )
    return list(result.scalars().unique().all())


# ---------------------------------------------------------------------------
# Postponement (create batch)
# ---------------------------------------------------------------------------


async def create_postponement(
    db: AsyncSession,
    class_id: UUID,
    data: PostponementCreateRequest,
    *,
    actor_user_id: str | None,
    now: datetime | None = None,
) -> PostponementCreateResponse:
    today = business_today()
    now = now or datetime.now(timezone.utc)
    class_ = await _load_class_for_update(db, str(class_id))
    if class_ is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy lớp học")
    if class_.completed_at is not None or class_.cancelled_at is not None:
        raise MakeupDomainError(
            "INVALID_TRANSITION",
            "Không thể hoãn buổi học của lớp đã hoàn tất hoặc đã hủy",
        )
    if not class_.is_active:
        raise MakeupDomainError(
            "INVALID_TRANSITION", "Không thể hoãn buổi học của lớp không hoạt động"
        )
    if not class_.schedule:
        raise MakeupDomainError(
            "OCCURRENCE_NOT_FOUND",
            "Lớp chưa có lịch học tuần nên không xác định được buổi học cụ thể",
        )

    existing = await db.scalar(
        select(ClassScheduleAdjustment).where(
            ClassScheduleAdjustment.created_by == _actor_id(actor_user_id),
            ClassScheduleAdjustment.request_id == str(data.request_id),
        )
    )
    if existing is not None:
        return await _replay_postponement(db, existing, data, today=today)

    schedule = ClassSchedule.model_validate(class_.schedule)
    adjusted_originals = set(
        (
            await db.scalars(
                select(ClassSessionException.original_start_at).where(
                    ClassSessionException.class_id == class_.id,
                    ClassSessionException.status != "RESTORED",
                )
            )
        ).all()
    )
    valid_occurrences: list[Occurrence] = []
    for original_start_at in data.original_start_at:
        original_start_at = original_start_at.astimezone(timezone.utc)
        if not data.retrospective and original_start_at <= now:
            raise MakeupDomainError(
                "OCCURRENCE_NOT_FOUND",
                "Chỉ có thể hoãn buổi học trong tương lai; buổi đã qua cần dùng chức năng ghi nhận buổi đã hoãn",
            )
        if original_start_at in adjusted_originals:
            raise MakeupDomainError(
                "OCCURRENCE_ALREADY_ADJUSTED",
                "Một buổi học đã được hoãn không thể hoãn lần nữa",
            )
        found = _match_template_occurrence(
            class_,
            schedule,
            original_start_at,
        )
        if found is None:
            raise MakeupDomainError(
                "OCCURRENCE_NOT_FOUND",
                "Buổi học không tồn tại trong lịch tuần của lớp",
            )
        valid_occurrences.append(found)

    affected_dates = [
        item.original_start_at.astimezone(BUSINESS_TIMEZONE).date()
        for item in valid_occurrences
    ]
    adjustment = ClassScheduleAdjustment(
        class_id=class_.id,
        reason_code=data.reason_code,
        reason_note=(data.reason_note or "").strip() or None,
        affected_from=min(affected_dates),
        affected_through=max(affected_dates),
        status="OPEN",
        created_by=_actor_id(actor_user_id),
        request_id=str(data.request_id),
    )
    db.add(adjustment)
    await db.flush()

    staff_ids: list[str] = []
    for occurrence in valid_occurrences:
        staff_ids.extend(occurrence.teacher_ids)
        staff_ids.extend(occurrence.assistant_ids)
    staff_ids = list(dict.fromkeys(staff_ids))
    staff_by_id: dict[str, StaffMember] = {}
    if staff_ids:
        result = await db.execute(
            select(StaffMember)
            .where(StaffMember.id.in_(staff_ids))
            .order_by(StaffMember.id.asc())
            .with_for_update()
        )
        staff_by_id = {str(staff.id): staff for staff in result.scalars().all()}

    created_exceptions: list[ClassSessionException] = []
    for occurrence in valid_occurrences:
        exception = ClassSessionException(
            adjustment_id=adjustment.id,
            class_id=class_.id,
            original_start_at=occurrence.original_start_at,
            original_end_at=occurrence.original_end_at,
            original_timezone=BUSINESS_TIMEZONE.key,
            status="MAKEUP_PENDING",
        )
        db.add(exception)
        await db.flush()
        for staff_id in occurrence.teacher_ids:
            staff = staff_by_id.get(staff_id)
            db.add(
                ClassSessionStaffSnapshot(
                    exception_id=exception.id,
                    staff_id=staff_id,
                    role="TEACHER",
                    display_name_snapshot=(
                        staff.full_name if staff is not None else "Nhân sự đã gỡ"
                    ),
                    source_slot_key=occurrence.source_slot_key,
                )
            )
        for staff_id in occurrence.assistant_ids:
            staff = staff_by_id.get(staff_id)
            db.add(
                ClassSessionStaffSnapshot(
                    exception_id=exception.id,
                    staff_id=staff_id,
                    role="ASSISTANT",
                    display_name_snapshot=(
                        staff.full_name if staff is not None else "Nhân sự đã gỡ"
                    ),
                    source_slot_key=occurrence.source_slot_key,
                )
            )
        eligible = await _eligible_students(
            db,
            class_.id,
            occurrence.original_start_at,
            source_slot_id=occurrence.source_slot_id,
        )
        await _snapshot_students(db, exception, eligible, class_id=class_.id)
        _append_event(
            db,
            exception_id=exception.id,
            event_type="batch-created",
            old_payload=None,
            new_payload={
                "status": "MAKEUP_PENDING",
                "original_start_at": occurrence.original_start_at.isoformat(),
                "retrospective": data.retrospective,
            },
            actor_user_id=actor_user_id,
            request_id=str(data.request_id),
        )
        created_exceptions.append(exception)

    if data.schedule_now:
        for exception in created_exceptions:
            candidate = await _find_first_free_candidate(
                db,
                class_=class_,
                exception=exception,
                now=now,
            )
            if candidate is None:
                continue
            await _apply_schedule_transition(
                db,
                class_=class_,
                exception=exception,
                replacement_start_at=candidate,
                actor_user_id=actor_user_id,
                request_id=str(data.request_id),
                event_type="scheduled",
            )
    await db.commit()

    exceptions = await _load_exceptions_for_adjustment(db, adjustment.id)
    return PostponementCreateResponse(
        adjustment=_adjustment_response(adjustment),
        exceptions=[_exception_response(item) for item in exceptions],
        billing_impact=BILLING_IMPACT_NONE,
    )


def _match_template_occurrence(
    class_: Class,
    schedule: ClassSchedule,
    original_start_at: datetime,
) -> Occurrence | None:
    """Tìm đúng occurrence trong weekly template theo (weekday, start time)."""
    local = original_start_at.astimezone(BUSINESS_TIMEZONE)
    weekday_name = _weekday_name(local)
    local_time = local.strftime("%H:%M")
    for slot in schedule.slots:
        if slot.day != weekday_name or slot.start != local_time:
            continue
        return Occurrence(
            class_id=class_.id,
            key=occurrence_key(class_.id, original_start_at),
            kind="REGULAR",
            original_start_at=original_start_at,
            original_end_at=original_start_at
            + timedelta(minutes=slot_duration_minutes(slot.start, slot.end)),
            source_slot_key=slot_key(slot.day, slot.start, slot.end),
            teacher_ids=[str(item) for item in slot.teacher_ids],
            assistant_ids=[str(item) for item in slot.assistant_ids],
        )
    return None


async def _find_first_free_candidate(
    db: AsyncSession,
    *,
    class_: Class,
    exception: ClassSessionException,
    now: datetime,
) -> datetime | None:
    """'Xếp bù ngay': thử cùng khung giờ trong 7 ngày kế tiếp, chọn ngày đầu
    tiên không xung đột (kiểm tra lại trong transaction)."""
    local_start = exception.original_start_at.astimezone(BUSINESS_TIMEZONE)
    duration = exception.original_end_at - exception.original_start_at
    for offset in range(1, 8):
        candidate_local = local_start + timedelta(days=offset)
        if candidate_local.hour * 60 + candidate_local.minute < 7 * 60:
            continue
        candidate_start = candidate_local.astimezone(timezone.utc)
        candidate_end = candidate_start + duration
        if candidate_start <= now:
            continue
        conflicts = await check_makeup_conflicts(
            db,
            class_id=class_.id,
            replacement_start_at=candidate_start,
            replacement_end_at=candidate_end,
            teacher_ids=[snapshot.staff_id for snapshot in exception.staff_snapshots],
            assistant_ids=[
                snapshot.staff_id
                for snapshot in exception.staff_snapshots
                if snapshot.role == "ASSISTANT"
            ],
            exclude_exception_id=exception.id,
        )
        if not conflicts:
            return candidate_start
    return None


async def _apply_schedule_transition(
    db: AsyncSession,
    *,
    class_: Class,
    exception: ClassSessionException,
    replacement_start_at: datetime,
    actor_user_id: str | None,
    request_id: str,
    event_type: str = "scheduled",
    old_payload: dict | None = None,
) -> None:
    """Áp dụng transition -> MAKEUP_SCHEDULED với mọi guard (duration, after
    original, conflict, staff active). Được dùng bởi schedule_now và
    schedule_makeup sau khi lock + version check."""
    replacement_start_at = replacement_start_at.astimezone(timezone.utc)
    if replacement_start_at <= exception.original_start_at:
        raise MakeupDomainError(
            "MAKEUP_DURATION_MISMATCH", "Buổi bù phải được xếp sau buổi gốc"
        )
    duration = exception.original_end_at - exception.original_start_at
    replacement_end_at = replacement_start_at + duration
    teacher_ids = [
        snapshot.staff_id
        for snapshot in exception.staff_snapshots
        if snapshot.role == "TEACHER"
    ]
    assistant_ids = [
        snapshot.staff_id
        for snapshot in exception.staff_snapshots
        if snapshot.role == "ASSISTANT"
    ]
    conflicts = await check_makeup_conflicts(
        db,
        class_id=exception.class_id,
        replacement_start_at=replacement_start_at,
        replacement_end_at=replacement_end_at,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        exclude_exception_id=exception.id,
    )
    if conflicts:
        first = conflicts[0]
        raise MakeupDomainError(first.code, first.message)
    _active, inactive_staff = await inherited_staff_active(
        db, [*teacher_ids, *assistant_ids]
    )
    if inactive_staff:
        names = ", ".join(item["display_name"] for item in inactive_staff)
        raise MakeupDomainError(
            "STAFF_INACTIVE",
            f"Nhân sự {names} đã ngừng hoạt động. Không thể xếp buổi bù cho buổi học này",
        )
    exception.status = "MAKEUP_SCHEDULED"
    exception.replacement_start_at = replacement_start_at
    exception.replacement_end_at = replacement_end_at
    exception.version += 1
    _append_event(
        db,
        exception_id=exception.id,
        event_type=event_type,
        old_payload=old_payload or {"status": "MAKEUP_PENDING"},
        new_payload={
            "status": "MAKEUP_SCHEDULED",
            "replacement_start_at": replacement_start_at.isoformat(),
            "replacement_end_at": replacement_end_at.isoformat(),
        },
        actor_user_id=actor_user_id,
        request_id=request_id,
    )


# ---------------------------------------------------------------------------
# Make-up schedule / unschedule / complete / restore
# ---------------------------------------------------------------------------


async def preview_makeup_schedule(
    db: AsyncSession,
    exception_id: UUID,
    data: MakeupSchedulePreviewRequest,
) -> MakeupSchedulePreviewResponse:
    exception = await _load_exception_with_snapshots(db, str(exception_id))
    if exception is None:
        raise MakeupDomainError(
            "OCCURRENCE_NOT_FOUND", "Không tìm thấy buổi học cần xếp bù"
        )
    if exception.status not in ("MAKEUP_PENDING", "MAKEUP_SCHEDULED"):
        raise MakeupDomainError(
            "INVALID_TRANSITION", "Buổi học này không thể xếp lịch bù"
        )
    replacement_start_at = data.replacement_start_at.astimezone(timezone.utc)
    duration = exception.original_end_at - exception.original_start_at
    replacement_end_at = replacement_start_at + duration
    if replacement_start_at <= exception.original_start_at:
        raise MakeupDomainError(
            "MAKEUP_DURATION_MISMATCH",
            "Buổi bù phải được xếp sau buổi gốc",
        )
    teacher_ids = [
        snapshot.staff_id
        for snapshot in exception.staff_snapshots
        if snapshot.role == "TEACHER"
    ]
    assistant_ids = [
        snapshot.staff_id
        for snapshot in exception.staff_snapshots
        if snapshot.role == "ASSISTANT"
    ]
    conflicts = await check_makeup_conflicts(
        db,
        class_id=exception.class_id,
        replacement_start_at=replacement_start_at,
        replacement_end_at=replacement_end_at,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        exclude_exception_id=exception.id,
    )
    active_staff, inactive_staff = await inherited_staff_active(
        db, [*teacher_ids, *assistant_ids]
    )
    inactive_snapshots = [
        snapshot
        for snapshot in exception.staff_snapshots
        if snapshot.staff_id in {item["staff_id"] for item in inactive_staff}
    ]
    return MakeupSchedulePreviewResponse(
        exception_id=exception_id,
        original_start_at=exception.original_start_at,
        original_end_at=exception.original_end_at,
        duration_minutes=int(duration.total_seconds() // 60),
        replacement_start_at=replacement_start_at,
        replacement_end_at=replacement_end_at,
        staff=[_staff_snapshot_response(item) for item in exception.staff_snapshots],
        eligible_student_count=len(exception.student_snapshots),
        conflicts=conflicts,
        staff_inactive=[_staff_snapshot_response(item) for item in inactive_snapshots],
        can_schedule=not conflicts and not inactive_snapshots,
        billing_impact=BILLING_IMPACT_NONE,
    )


async def schedule_makeup(
    db: AsyncSession,
    exception_id: UUID,
    data: MakeupScheduleRequest,
    *,
    actor_user_id: str | None,
) -> ExceptionCommandResponse:
    exception = await _load_exception_with_snapshots(db, str(exception_id))
    if exception is None:
        raise MakeupDomainError(
            "OCCURRENCE_NOT_FOUND", "Không tìm thấy buổi học cần xếp bù"
        )
    replay = await _find_replayed_exception_command(
        db,
        exception_id=str(exception_id),
        event_type="scheduled",
        request_id=str(data.request_id),
    )
    if replay is not None:
        return await _exception_command_response(db, replay)

    class_ = await _load_class_for_update(db, exception.class_id)
    if class_ is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy lớp học")
    exception = await _load_exception_with_snapshots(
        db, str(exception_id), for_update=True
    )
    if exception is None:
        raise MakeupDomainError(
            "OCCURRENCE_NOT_FOUND", "Không tìm thấy buổi học cần xếp bù"
        )
    if exception.version != data.expected_version:
        raise MakeupDomainError(
            "CLASS_VERSION_CONFLICT",
            "Dữ liệu buổi học vừa được cập nhật. Vui lòng tải lại rồi thử lại",
        )
    validate_transition(exception.status, "MAKEUP_SCHEDULED")
    if exception.status == "MAKEUP_COMPLETED":
        raise MakeupDomainError(
            "INVALID_TRANSITION", "Buổi bù đã hoàn tất không thể đổi lịch"
        )
    replacement_start_at = data.replacement_start_at.astimezone(timezone.utc)
    event_type = "scheduled" if exception.status == "MAKEUP_PENDING" else "rescheduled"
    old_payload = {
        "status": exception.status,
        "replacement_start_at": (
            exception.replacement_start_at.isoformat()
            if exception.replacement_start_at
            else None
        ),
    }
    await _apply_schedule_transition(
        db,
        class_=class_,
        exception=exception,
        replacement_start_at=replacement_start_at,
        actor_user_id=actor_user_id,
        request_id=str(data.request_id),
        event_type=event_type,
        old_payload=old_payload,
    )
    await db.commit()
    return await _exception_command_response(db, exception)


async def unschedule_makeup(
    db: AsyncSession,
    exception_id: UUID,
    data: MakeupUnscheduleRequest,
    *,
    actor_user_id: str | None,
) -> ExceptionCommandResponse:
    exception = await _load_exception_with_snapshots(db, str(exception_id))
    if exception is None:
        raise MakeupDomainError(
            "OCCURRENCE_NOT_FOUND", "Không tìm thấy buổi học cần hủy xếp lịch bù"
        )
    replay = await _find_replayed_exception_command(
        db,
        exception_id=str(exception_id),
        event_type="unscheduled",
        request_id=str(data.request_id),
    )
    if replay is not None:
        return await _exception_command_response(db, replay)

    class_ = await _load_class_for_update(db, exception.class_id)
    if class_ is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy lớp học")
    exception = await _load_exception_with_snapshots(
        db, str(exception_id), for_update=True
    )
    if exception is None:
        raise MakeupDomainError(
            "OCCURRENCE_NOT_FOUND", "Không tìm thấy buổi học cần hủy xếp lịch bù"
        )
    if exception.version != data.expected_version:
        raise MakeupDomainError(
            "CLASS_VERSION_CONFLICT",
            "Dữ liệu buổi học vừa được cập nhật. Vui lòng tải lại rồi thử lại",
        )
    validate_transition(exception.status, "MAKEUP_PENDING")
    old_payload = {
        "status": exception.status,
        "replacement_start_at": (
            exception.replacement_start_at.isoformat()
            if exception.replacement_start_at
            else None
        ),
    }
    exception.status = "MAKEUP_PENDING"
    exception.replacement_start_at = None
    exception.replacement_end_at = None
    exception.version += 1
    _append_event(
        db,
        exception_id=exception.id,
        event_type="unscheduled",
        old_payload=old_payload,
        new_payload={"status": "MAKEUP_PENDING"},
        actor_user_id=actor_user_id,
        request_id=str(data.request_id),
    )
    await db.commit()
    return await _exception_command_response(db, exception)


async def complete_makeup(
    db: AsyncSession,
    exception_id: UUID,
    data: MakeupCompleteRequest,
    *,
    actor_user_id: str | None,
    now: datetime | None = None,
) -> ExceptionCommandResponse:
    exception = await _load_exception_with_snapshots(db, str(exception_id))
    if exception is None:
        raise MakeupDomainError(
            "OCCURRENCE_NOT_FOUND", "Không tìm thấy buổi học cần xác nhận"
        )
    replay = await _find_replayed_exception_command(
        db,
        exception_id=str(exception_id),
        event_type="completed",
        request_id=str(data.request_id),
    )
    if replay is not None:
        return await _exception_command_response(db, replay)

    class_ = await _load_class_for_update(db, exception.class_id)
    if class_ is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy lớp học")
    exception = await _load_exception_with_snapshots(
        db, str(exception_id), for_update=True
    )
    if exception is None:
        raise MakeupDomainError(
            "OCCURRENCE_NOT_FOUND", "Không tìm thấy buổi học cần xác nhận"
        )
    if exception.version != data.expected_version:
        raise MakeupDomainError(
            "CLASS_VERSION_CONFLICT",
            "Dữ liệu buổi học vừa được cập nhật. Vui lòng tải lại rồi thử lại",
        )
    validate_transition(exception.status, "MAKEUP_COMPLETED")
    now = now or datetime.now(timezone.utc)
    if exception.replacement_end_at is None or now < exception.replacement_end_at:
        raise MakeupDomainError(
            "MAKEUP_NOT_FINISHED",
            "Buổi bù chưa kết thúc. Chỉ xác nhận khi buổi bù đã diễn ra xong",
        )
    old_payload = {"status": exception.status}
    exception.status = "MAKEUP_COMPLETED"
    exception.completed_at = now
    exception.completed_by = actor_user_id
    exception.version += 1
    _append_event(
        db,
        exception_id=exception.id,
        event_type="completed",
        old_payload=old_payload,
        new_payload={
            "status": "MAKEUP_COMPLETED",
            "completed_at": now.isoformat(),
        },
        actor_user_id=actor_user_id,
        request_id=str(data.request_id),
    )
    await db.commit()
    return await _exception_command_response(db, exception)


async def restore_original_session(
    db: AsyncSession,
    exception_id: UUID,
    data: RestoreOriginalRequest,
    *,
    actor_user_id: str | None,
    now: datetime | None = None,
) -> ExceptionCommandResponse:
    exception = await _load_exception_with_snapshots(db, str(exception_id))
    if exception is None:
        raise MakeupDomainError(
            "OCCURRENCE_NOT_FOUND", "Không tìm thấy buổi học cần khôi phục"
        )
    replay = await _find_replayed_exception_command(
        db,
        exception_id=str(exception_id),
        event_type="original-restored",
        request_id=str(data.request_id),
    )
    if replay is not None:
        return await _exception_command_response(db, replay)

    class_ = await _load_class_for_update(db, exception.class_id)
    if class_ is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy lớp học")
    exception = await _load_exception_with_snapshots(
        db, str(exception_id), for_update=True
    )
    if exception is None:
        raise MakeupDomainError(
            "OCCURRENCE_NOT_FOUND", "Không tìm thấy buổi học cần khôi phục"
        )
    if exception.version != data.expected_version:
        raise MakeupDomainError(
            "CLASS_VERSION_CONFLICT",
            "Dữ liệu buổi học vừa được cập nhật. Vui lòng tải lại rồi thử lại",
        )
    validate_transition(exception.status, "RESTORED")
    now = now or datetime.now(timezone.utc)
    if exception.original_start_at <= now:
        raise MakeupDomainError(
            "RESTORE_NOT_ALLOWED",
            "Không thể khôi phục buổi gốc đã qua. Dùng ghi nhận buổi đã hoãn nếu cần",
        )
    # Buổi gốc phải còn trống trên lịch hiệu lực (không buổi bù nào khác trùng).
    conflicts = await check_makeup_conflicts(
        db,
        class_id=exception.class_id,
        replacement_start_at=exception.original_start_at,
        replacement_end_at=exception.original_end_at,
        teacher_ids=[
            snapshot.staff_id
            for snapshot in exception.staff_snapshots
            if snapshot.role == "TEACHER"
        ],
        assistant_ids=[
            snapshot.staff_id
            for snapshot in exception.staff_snapshots
            if snapshot.role == "ASSISTANT"
        ],
        exclude_exception_id=exception.id,
    )
    if conflicts:
        raise MakeupDomainError(
            "RESTORE_NOT_ALLOWED",
            "Không thể khôi phục buổi gốc vì khung giờ đã bị buổi khác chiếm",
        )
    old_payload = {
        "status": exception.status,
        "replacement_start_at": (
            exception.replacement_start_at.isoformat()
            if exception.replacement_start_at
            else None
        ),
    }
    exception.status = "RESTORED"
    exception.replacement_start_at = None
    exception.replacement_end_at = None
    exception.restored_at = now
    exception.restored_by = actor_user_id
    exception.version += 1
    _append_event(
        db,
        exception_id=exception.id,
        event_type="original-restored",
        old_payload=old_payload,
        new_payload={"status": "RESTORED", "restored_at": now.isoformat()},
        actor_user_id=actor_user_id,
        request_id=str(data.request_id),
    )
    await db.commit()
    return await _exception_command_response(db, exception)


# ---------------------------------------------------------------------------
# Read models
# ---------------------------------------------------------------------------


async def _exception_command_response(
    db: AsyncSession,
    exception: ClassSessionException,
) -> ExceptionCommandResponse:
    class_ = await db.get(Class, exception.class_id)
    if class_ is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy lớp học")
    refreshed = await _load_exception_with_snapshots(db, exception.id)
    if refreshed is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy buổi học")
    return ExceptionCommandResponse(
        exception=_exception_response(refreshed),
        effective_status=effective_class_status(class_),
        billing_impact=BILLING_IMPACT_NONE,
    )


async def get_class_effective_occurrences(
    db: AsyncSession,
    class_id: UUID,
    from_date: date,
    to_date: date,
) -> ClassOccurrenceListResponse:
    class_ = await db.get(Class, str(class_id))
    if class_ is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy lớp học")
    range_start = datetime.combine(
        from_date, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    range_end = datetime.combine(
        to_date + timedelta(days=1), datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    exceptions = await _load_exceptions_for_class(
        db,
        str(class_id),
        from_date,
        to_date + timedelta(days=1),
    )
    exception_payloads: list[dict] = []
    for item in exceptions:
        exception_payloads.append(
            {
                "id": item.id,
                "status": item.status,
                "original_start_at": item.original_start_at,
                "original_end_at": item.original_end_at,
                "replacement_start_at": item.replacement_start_at,
                "replacement_end_at": item.replacement_end_at,
                "source_slot_key": (
                    item.staff_snapshots[0].source_slot_key
                    if item.staff_snapshots
                    else ""
                ),
                "staff_snapshots": [
                    {
                        "staff_id": snapshot.staff_id,
                        "role": snapshot.role,
                    }
                    for snapshot in item.staff_snapshots
                ],
            }
        )
    regular = await expand_class_occurrences(
        db,
        class_,
        range_start=range_start,
        range_end=range_end,
    )
    effective = apply_exceptions(regular, exception_payloads, class_id=str(class_.id))
    today = business_today()
    return ClassOccurrenceListResponse(
        class_id=class_id,
        occurrences=[_occurrence_response(item, today=today) for item in effective],
    )


async def list_class_adjustments(
    db: AsyncSession,
    class_id: UUID,
    *,
    status: AdjustmentStatus | None = None,
    cursor: str | None = None,
    limit: int = 20,
) -> ClassAdjustmentListResponse:
    bounded_limit = max(1, min(limit, 50))
    class_ = await db.get(Class, str(class_id))
    if class_ is None:
        raise MakeupDomainError("OCCURRENCE_NOT_FOUND", "Không tìm thấy lớp học")
    statement = (
        select(ClassScheduleAdjustment)
        .where(ClassScheduleAdjustment.class_id == str(class_id))
        .options(
            selectinload(ClassScheduleAdjustment.exceptions).selectinload(
                ClassSessionException.staff_snapshots
            ),
            selectinload(ClassScheduleAdjustment.exceptions).selectinload(
                ClassSessionException.student_snapshots
            ),
        )
        .order_by(
            ClassScheduleAdjustment.created_at.desc(),
            ClassScheduleAdjustment.id.desc(),
        )
        .limit(bounded_limit + 1)
    )
    if status is not None:
        statement = statement.where(ClassScheduleAdjustment.status == status)
    if cursor is not None:
        try:
            cursor_datetime = datetime.fromisoformat(cursor)
        except ValueError as exc:
            raise MakeupDomainError(
                "OCCURRENCE_NOT_FOUND", "Con trỏ phân trang không hợp lệ"
            ) from exc
        statement = statement.where(
            ClassScheduleAdjustment.created_at <= cursor_datetime
        )
    result = await db.execute(statement)
    adjustments = list(result.scalars().unique().all())
    adjustments = adjustments[:bounded_limit]
    exceptions: list[ClassSessionException] = []
    for adjustment in adjustments:
        exceptions.extend(adjustment.exceptions)
    return ClassAdjustmentListResponse(
        adjustments=[_adjustment_response(item) for item in adjustments],
        exceptions=[_exception_response(item) for item in exceptions],
    )


async def get_class_session_exception(
    db: AsyncSession,
    exception_id: UUID,
) -> ClassSessionExceptionResponse | None:
    exception = await _load_exception_with_snapshots(db, str(exception_id))
    if exception is None:
        return None
    return _exception_response(exception)


async def get_effective_occurrences_for_range(
    db: AsyncSession,
    from_date: date,
    to_date: date,
    *,
    max_classes: int = 400,
) -> list[ClassOccurrenceListResponse]:
    """Effective occurrences của mọi lớp operational trong khoảng ngày (dashboard
    board). Bounded theo max_classes + range; mỗi lớp expand riêng (không N+1
    theo query: 1 query classes + 1 query exceptions batch)."""
    range_start = datetime.combine(
        from_date, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    range_end = datetime.combine(
        to_date + timedelta(days=1), datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    classes_result = await db.execute(
        select(Class)
        .where(
            Class.is_active.is_(True),
            Class.cancelled_at.is_(None),
            Class.completed_at.is_(None),
            Class.schedule.is_not(None),
            Class.identity_scheme != "LEGACY",
            or_(
                Class.start_date.is_(None),
                Class.start_date <= range_end.date(),
            ),
            or_(
                Class.end_date.is_(None),
                Class.end_date >= from_date,
            ),
        )
        .order_by(Class.id.asc())
        .limit(max_classes)
    )
    classes = list(classes_result.scalars().unique().all())
    if not classes:
        return []

    exceptions_result = await db.execute(
        select(ClassSessionException)
        .where(
            ClassSessionException.class_id.in_([class_.id for class_ in classes]),
            ClassSessionException.original_start_at < range_end,
            ClassSessionException.original_end_at >= range_start,
        )
        .options(
            selectinload(ClassSessionException.staff_snapshots),
            selectinload(ClassSessionException.student_snapshots),
        )
        .order_by(ClassSessionException.original_start_at.asc())
    )
    exceptions_by_class: dict[str, list[ClassSessionException]] = {}
    for exception in exceptions_result.scalars().unique().all():
        exceptions_by_class.setdefault(str(exception.class_id), []).append(exception)

    today = business_today()
    results: list[ClassOccurrenceListResponse] = []
    for class_ in classes:
        exception_payloads: list[dict] = []
        for item in exceptions_by_class.get(class_.id, []):
            exception_payloads.append(
                {
                    "id": item.id,
                    "status": item.status,
                    "original_start_at": item.original_start_at,
                    "original_end_at": item.original_end_at,
                    "replacement_start_at": item.replacement_start_at,
                    "replacement_end_at": item.replacement_end_at,
                    "source_slot_key": (
                        item.staff_snapshots[0].source_slot_key
                        if item.staff_snapshots
                        else ""
                    ),
                    "staff_snapshots": [
                        {
                            "staff_id": snapshot.staff_id,
                            "role": snapshot.role,
                        }
                        for snapshot in item.staff_snapshots
                    ],
                }
            )
        regular = await expand_class_occurrences(
            db,
            class_,
            range_start=range_start,
            range_end=range_end,
        )
        effective = apply_exceptions(regular, exception_payloads, class_id=class_.id)
        results.append(
            ClassOccurrenceListResponse(
                class_id=UUID(str(class_.id)),
                occurrences=[
                    _occurrence_response(item, today=today) for item in effective
                ],
            )
        )
    return results
