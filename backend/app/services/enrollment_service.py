from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.class_ import Class
from app.models.class_schedule_slot import ClassScheduleSlot
from app.models.enrollment import Enrollment
from app.models.enrollment_slot_selection import EnrollmentSlotSelection
from app.models.fee_record import FeeRecord
from app.models.student import Student
from app.schemas.enrollment import (
    EnrollmentCreate,
    EnrollmentResponse,
    EnrollmentScheduleSlotResponse,
    EnrollmentUpdate,
)
from app.core.billing import (
    get_billing_period_key,
    get_enrollment_fee_amount,
)
from app.core.billing_schedule import month_end
from app.core.business_time import business_today
from app.core.enrollment_lifecycle import effective_enrollment_state
from app.core.class_lifecycle import (
    is_operational_class,
    operational_class_predicate,
)
from app.services.fee_cycle_service import (
    create_cycle_zero,
    ensure_enrollment_cycles,
)
from app.services.enrollment_guard import ensure_enrollment_allowed


async def close_enrollment_financial_projection(
    db: AsyncSession,
    enrollment: Enrollment,
    *,
    actor_user_id: str | None,
    reason: str,
    close_on: date | None = None,
) -> None:
    """Close mutable fees and revoke stale QR references for a membership.

    Notified/paid rows remain immutable history.  Unnotified unpaid rows are
    marked VOID, never deleted.  Everything runs in the caller's transaction.
    """

    from app.services.fee_operation_service import (
        append_fee_operation,
        snapshot_fee_record,
    )
    from app.services.fee_reconciliation import is_fee_record_protected
    from app.services.payment_scaffold_service import (
        revoke_open_payment_requests_for_fee_records,
    )

    records = list(
        (
            await db.scalars(
                select(FeeRecord)
                .where(
                    FeeRecord.enrollment_id == enrollment.id,
                    FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
                )
                .with_for_update()
            )
        ).all()
    )
    if not records:
        return

    mutable = [
        record
        for record in records
        if not is_fee_record_protected(record)
        and (
            close_on is None
            or (record.coverage_start or record.base_due_date or record.due_date)
            >= close_on
        )
    ]
    if not mutable:
        return
    # A notified unpaid row remains a real debt after the membership closes,
    # so its exact payment request/QR must remain usable. Revoke only requests
    # whose underlying mutable fee row is about to become VOID.
    await revoke_open_payment_requests_for_fee_records(
        db,
        [record.id for record in mutable],
        actor_id=actor_user_id,
        reason=reason,
    )
    before = [snapshot_fee_record(record) for record in mutable]
    now = datetime.now(timezone.utc)
    for record in mutable:
        record.status = "VOID"
        record.voided_at = now
    await db.flush()
    await append_fee_operation(
        db,
        action="sync_void",
        before=before,
        after=[snapshot_fee_record(record) for record in mutable],
        actor_id=actor_user_id,
        reason=reason,
        origin="system",
    )


def _clear_dependent_caches() -> None:
    return None


def _to_response(
    enrollment: Enrollment,
    *,
    selected_slots: list[ClassScheduleSlot] | None = None,
) -> EnrollmentResponse:
    return EnrollmentResponse(
        id=enrollment.id,
        student_id=enrollment.student_id,
        class_id=enrollment.class_id,
        custom_fee=int(enrollment.custom_fee)
        if enrollment.custom_fee is not None
        else None,
        status=enrollment.status,
        enrollment_date=enrollment.enrollment_date,
        ended_on=enrollment.ended_on,
        effective_state=effective_enrollment_state(enrollment),
        billing_anchor_version=int(enrollment.billing_anchor_version or 0),
        ended_at=enrollment.ended_at,
        end_reason=enrollment.end_reason,
        selected_slot_ids=[
            UUID(selection.slot_id)
            for selection in (enrollment.slot_selections or [])
            if selection.effective_until is None
        ],
        selected_slots=[
            EnrollmentScheduleSlotResponse(
                id=UUID(slot.id),
                weekday=slot.weekday,
                local_start=slot.local_start,
                local_end=slot.local_end,
            )
            for slot in (selected_slots or [])
        ],
        class_name=enrollment.class_.name if enrollment.class_ else "",
        class_category=enrollment.class_.class_category if enrollment.class_ else None,
        class_grade_mode=enrollment.class_.grade_mode if enrollment.class_ else None,
        class_grade_level=enrollment.class_.grade_level if enrollment.class_ else None,
        class_start_date=enrollment.class_.start_date if enrollment.class_ else None,
        class_end_date=None,
        previous_class_id=(
            UUID(enrollment.class_.previous_class_id)
            if enrollment.class_ and enrollment.class_.previous_class_id
            else None
        ),
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


async def _reconcile_current_fee_records(
    db: AsyncSession,
    enrollments: list[Enrollment],
) -> None:
    """R6: lazily materialize future cycles up to the current business month."""
    today = business_today()
    up_to = month_end(today)
    for enrollment in enrollments:
        if enrollment.status != "active":
            continue
        await ensure_enrollment_cycles(db, enrollment, up_to=up_to)


def resolve_enrollment_date(class_: Class, requested: date | None) -> date:
    """Resolve one enrollment's own date inside its class boundary."""

    today = business_today()
    if class_.identity_scheme not in {"ACADEMIC_YEAR", "INTAKE"}:
        return requested or today
    if class_.start_date is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lớp học chưa có ngày bắt đầu hợp lệ",
        )
    resolved = requested or max(today, class_.start_date)
    if resolved < class_.start_date or (
        class_.stopped_on is not None and resolved >= class_.stopped_on
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Ngày bắt đầu của học viên phải từ ngày lớp bắt đầu và trước "
                "ngày lớp ngừng hoạt động"
            ),
        )
    return resolved


async def _create_slot_selections(
    db: AsyncSession,
    enrollment: Enrollment,
    class_: Class,
    selected_slot_ids: list[str] | None,
    *,
    actor_user_id: str | None = None,
    effective_from: date | None = None,
    known_active_slot_ids: list[str] | None = None,
    excluded_enrollment_ids: set[str] | None = None,
) -> None:
    """Tạo selection effective-dated cho enrollment (1..4 unique slot cùng
    lớp, effective tại enrollment date). Mặc định: toàn bộ slot đang hiệu lực."""
    reference = effective_from or enrollment.enrollment_date or business_today()
    active_slots = (
        known_active_slot_ids
        if known_active_slot_ids is not None
        else list(
            (
                await db.scalars(
                    select(ClassScheduleSlot.id).where(
                        ClassScheduleSlot.class_id == class_.id,
                        ClassScheduleSlot.effective_from <= reference,
                        (ClassScheduleSlot.effective_until.is_(None))
                        | (ClassScheduleSlot.effective_until > reference),
                    )
                )
            ).all()
        )
    )
    # ``None`` means legacy/default behaviour (select every active slot).
    # An explicit empty list is different: it is an invalid entitlement and
    # must never silently fall back to all sessions after an admin unchecks
    # every box.
    requested = (
        [str(slot_id) for slot_id in active_slots]
        if selected_slot_ids is None
        else list(dict.fromkeys(selected_slot_ids))
    )
    unknown = [slot_id for slot_id in requested if slot_id not in set(active_slots)]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Buổi học được chọn không thuộc lớp hoặc không còn hiệu lực tại ngày ghi danh",
        )
    if not active_slots:
        # Legacy/JSON-only class chưa có canonical slots (giai đoạn chuyển):
        # không có selection nào để tạo — eligibility fallback toàn bộ.
        return
    if not requested:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Ghi danh cần chọn ít nhất một buổi học",
        )
    await _ensure_student_schedule_available(
        db,
        student_id=str(enrollment.student_id),
        class_=class_,
        selected_slot_ids=requested,
        enrollment_id=str(enrollment.id),
        effective_from=reference,
        excluded_enrollment_ids=excluded_enrollment_ids,
    )
    for slot_id in requested:
        db.add(
            EnrollmentSlotSelection(
                enrollment_id=enrollment.id,
                slot_id=slot_id,
                effective_from=reference,
                actor_user_id=actor_user_id,
            )
        )
    await db.flush()


async def _ensure_student_schedule_available(
    db: AsyncSession,
    *,
    student_id: str,
    class_: Class,
    selected_slot_ids: list[str],
    enrollment_id: str | None,
    effective_from: date,
    excluded_enrollment_ids: set[str] | None = None,
) -> None:
    """Reject recurring sessions that overlap another active enrollment.

    Slot selections are an attendance entitlement, so the check is performed
    at the same boundary as the effective-dated selection write.  It protects
    direct API callers as well as the student and continuation screens.
    """

    if not selected_slot_ids or class_.start_date is None:
        return
    target_end = class_.stopped_on or date.max
    target_result = await db.execute(
        select(ClassScheduleSlot).where(
            ClassScheduleSlot.id.in_(selected_slot_ids),
            ClassScheduleSlot.class_id == class_.id,
            ClassScheduleSlot.effective_from <= effective_from,
            (ClassScheduleSlot.effective_until.is_(None))
            | (ClassScheduleSlot.effective_until > effective_from),
        )
    )
    target_slots = target_result.scalars().all()
    if len(target_slots) != len(set(selected_slot_ids)):
        return
    target_ranges = [
        (slot.weekday, slot.local_start, slot.local_end) for slot in target_slots
    ]
    query = (
        select(
            Class.name,
            ClassScheduleSlot.weekday,
            ClassScheduleSlot.local_start,
            ClassScheduleSlot.local_end,
        )
        # The selected columns include ClassScheduleSlot, so SQLAlchemy would
        # otherwise infer it as the left-most FROM and only append Enrollment
        # later as a comma-separated table.  Anchor the membership chain at
        # Enrollment explicitly; every following JOIN then has a valid source.
        .select_from(Enrollment)
        .join(Class, Class.id == Enrollment.class_id)
        .join(
            EnrollmentSlotSelection,
            EnrollmentSlotSelection.enrollment_id == Enrollment.id,
        )
        .join(
            ClassScheduleSlot,
            ClassScheduleSlot.id == EnrollmentSlotSelection.slot_id,
        )
        .where(
            Enrollment.student_id == student_id,
            Enrollment.status != "cancelled",
            Class.cancelled_at.is_(None),
            Class.start_date.is_not(None),
            Class.stopped_at.is_(None),
            Enrollment.enrollment_date < target_end,
            or_(Enrollment.ended_on.is_(None), Enrollment.ended_on > effective_from),
            EnrollmentSlotSelection.effective_from < target_end,
            (EnrollmentSlotSelection.effective_until.is_(None))
            | (EnrollmentSlotSelection.effective_until > effective_from),
            ClassScheduleSlot.effective_from < target_end,
            (ClassScheduleSlot.effective_until.is_(None))
            | (ClassScheduleSlot.effective_until > effective_from),
        )
    )
    if enrollment_id is not None:
        query = query.where(Enrollment.id != enrollment_id)
    if excluded_enrollment_ids:
        query = query.where(Enrollment.id.notin_(sorted(excluded_enrollment_ids)))
    rows = (await db.execute(query)).all()
    for class_name, weekday, start, end in rows:
        for target_day, target_start, target_end in target_ranges:
            if weekday == target_day and start < target_end and target_start < end:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Buổi {weekday} {target_start:%H:%M}–{target_end:%H:%M} "
                        f"trùng lịch với lớp {class_name}"
                    ),
                )


async def _replace_slot_selections(
    db: AsyncSession,
    enrollment: Enrollment,
    class_: Class,
    selected_slot_ids: list[str],
    *,
    actor_user_id: str | None = None,
) -> None:
    """Replace active selections without rewriting historical periods."""

    if not selected_slot_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Ghi danh cần chọn ít nhất một buổi học",
        )

    effective_from = max(
        enrollment.enrollment_date or business_today(), business_today()
    )
    current = list(
        (
            await db.scalars(
                select(EnrollmentSlotSelection)
                .where(
                    EnrollmentSlotSelection.enrollment_id == enrollment.id,
                    EnrollmentSlotSelection.effective_until.is_(None),
                )
                .with_for_update()
            )
        ).all()
    )
    current_ids = {selection.slot_id for selection in current}
    requested_ids = set(selected_slot_ids)
    if current_ids == requested_ids:
        return

    # A selection created for today has not become a historical interval yet;
    # remove it instead of creating an invalid zero-day half-open range.
    for selection in current:
        if selection.effective_from >= effective_from:
            await db.delete(selection)
        else:
            selection.effective_until = effective_from

    await db.flush()
    await _create_slot_selections(
        db,
        enrollment,
        class_,
        selected_slot_ids,
        actor_user_id=actor_user_id,
        effective_from=effective_from,
    )


async def close_enrollment_slot_selections(
    db: AsyncSession,
    enrollment: Enrollment,
    *,
    ended_on: date,
) -> None:
    """Close entitlement ranges at the same exclusive membership boundary."""

    selections = list(
        (
            await db.scalars(
                select(EnrollmentSlotSelection)
                .where(
                    EnrollmentSlotSelection.enrollment_id == enrollment.id,
                    EnrollmentSlotSelection.effective_until.is_(None),
                )
                .with_for_update()
            )
        ).all()
    )
    for selection in selections:
        selection.effective_until = max(selection.effective_from, ended_on)
    if selections:
        await db.flush()


async def realign_open_slot_selections(
    db: AsyncSession,
    enrollment: Enrollment,
    class_: Class,
    *,
    previous_start: date,
    next_start: date,
) -> None:
    """Keep current attendance entitlements aligned with an edited start date."""

    selections = list(
        (
            await db.scalars(
                select(EnrollmentSlotSelection)
                .where(
                    EnrollmentSlotSelection.enrollment_id == enrollment.id,
                    EnrollmentSlotSelection.effective_until.is_(None),
                )
                .with_for_update()
            )
        ).all()
    )
    if not selections:
        return
    slot_ids = [selection.slot_id for selection in selections]
    valid_ids = set(
        (
            await db.scalars(
                select(ClassScheduleSlot.id).where(
                    ClassScheduleSlot.id.in_(slot_ids),
                    ClassScheduleSlot.class_id == class_.id,
                    ClassScheduleSlot.effective_from <= next_start,
                    or_(
                        ClassScheduleSlot.effective_until.is_(None),
                        ClassScheduleSlot.effective_until > next_start,
                    ),
                )
            )
        ).all()
    )
    if valid_ids != set(slot_ids):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "SLOT_NOT_EFFECTIVE_ON_DATE",
                "message": (
                    "Lịch học hiện tại không có hiệu lực tại ngày bắt đầu mới; "
                    "vui lòng chọn lại buổi học."
                ),
                "class_id": str(class_.id),
            },
        )
    await _ensure_student_schedule_available(
        db,
        student_id=str(enrollment.student_id),
        class_=class_,
        selected_slot_ids=slot_ids,
        enrollment_id=str(enrollment.id),
        effective_from=next_start,
    )
    for selection in selections:
        # Only the initial open range can safely move backwards. A later range
        # represents a real schedule revision and must be reselected explicitly.
        if (
            next_start < selection.effective_from
            and selection.effective_from != previous_start
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "SLOT_HISTORY_REVIEW_REQUIRED",
                    "message": "Lịch học đã từng thay đổi; vui lòng chọn lại buổi học.",
                    "class_id": str(class_.id),
                },
            )
        selection.effective_from = next_start
    await db.flush()


async def enroll_locked_student(
    db: AsyncSession,
    *,
    student: Student,
    class_: Class,
    custom_fee: int | None,
    enrollment_date: date | None,
    selected_slot_ids: list[str] | None = None,
    actor_user_id: str | None = None,
    known_new_class: bool = False,
    known_active_slot_ids: list[str] | None = None,
    excluded_conflict_enrollment_ids: set[str] | None = None,
    billing_review_required: bool = False,
    billing_change_kind: str | None = None,
    billing_reason: str | None = None,
) -> Enrollment:
    """Create one membership period inside the caller's transaction.

    The caller must lock the class and student in that order before invoking
    this helper. A learner returning to the same class receives a fresh row so
    the previous dates and fee-record foreign keys remain historical facts.
    No commit or cache mutation happens here.
    """

    if not known_new_class:
        existing_active = await db.scalar(
            select(Enrollment)
            .where(
                Enrollment.student_id == student.id,
                Enrollment.class_id == class_.id,
                Enrollment.status == "active",
            )
            .with_for_update(),
        )
        if existing_active is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Học viên đã có trong lớp này",
            )

    resolved_date = resolve_enrollment_date(class_, enrollment_date)
    if not known_new_class:
        await ensure_enrollment_allowed(db, class_, resolved_date)

    enrollment = Enrollment(
        student_id=student.id,
        class_id=class_.id,
        custom_fee=custom_fee,
        enrollment_date=resolved_date,
    )
    db.add(enrollment)
    await db.flush()
    enrollment.class_ = class_

    # R6: cycle 0 tạo cùng transaction ghi danh (due = enrollment date,
    # UNPAID, unnotified) + các cycle tương lai trong tháng hiện tại.
    await create_cycle_zero(
        db,
        enrollment,
        assume_new=known_new_class,
        actor_user_id=actor_user_id,
        force_review=billing_review_required,
        change_kind=billing_change_kind,
        reason=billing_reason,
    )
    await ensure_enrollment_cycles(
        db,
        enrollment,
        up_to=month_end(business_today()),
        known_max_cycle=0 if known_new_class else None,
    )
    await _create_slot_selections(
        db,
        enrollment,
        class_,
        selected_slot_ids,
        actor_user_id=actor_user_id,
        known_active_slot_ids=known_active_slot_ids,
        excluded_enrollment_ids=excluded_conflict_enrollment_ids,
    )
    return enrollment


async def create_enrollment(
    db: AsyncSession,
    data: EnrollmentCreate,
) -> EnrollmentResponse:
    class_ = await db.scalar(
        select(Class)
        .where(
            Class.id == str(data.class_id),
            operational_class_predicate(),
        )
        .with_for_update()
    )
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học đang hoạt động",
        )
    if class_.identity_scheme == "LEGACY":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lớp cũ cần hoàn tất thông tin trước khi thêm học viên",
        )

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

    enrollment = await enroll_locked_student(
        db,
        student=student,
        class_=class_,
        custom_fee=data.custom_fee,
        enrollment_date=data.enrollment_date,
        selected_slot_ids=(
            [str(slot_id) for slot_id in data.selected_slot_ids]
            if data.selected_slot_ids is not None
            else None
        ),
        actor_user_id=None,
    )
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
    enrollments = list(result.scalars().all())
    selection_ids_by_enrollment: dict[str, list[str]] = {}
    slot_ids: set[str] = set()
    for enrollment in enrollments:
        selections = list(enrollment.slot_selections or [])
        if enrollment.status == "active":
            selections = [
                selection
                for selection in selections
                if selection.effective_until is None
            ]
        enrollment_slot_ids = list(
            dict.fromkeys(selection.slot_id for selection in selections)
        )
        selection_ids_by_enrollment[enrollment.id] = enrollment_slot_ids
        slot_ids.update(enrollment_slot_ids)

    slots_by_id: dict[str, ClassScheduleSlot] = {}
    if slot_ids:
        slots = list(
            (
                await db.scalars(
                    select(ClassScheduleSlot).where(ClassScheduleSlot.id.in_(slot_ids))
                )
            ).all()
        )
        slots_by_id = {slot.id: slot for slot in slots}

    return [
        _to_response(
            enrollment,
            selected_slots=[
                slots_by_id[slot_id]
                for slot_id in selection_ids_by_enrollment[enrollment.id]
                if slot_id in slots_by_id
            ],
        )
        for enrollment in enrollments
    ]


async def update_enrollment(
    db: AsyncSession,
    id: UUID,
    data: EnrollmentUpdate,
    *,
    actor_user_id: str | None = None,
) -> EnrollmentResponse | None:
    enrollment = await _get_enrollment(db, id)
    if enrollment is None:
        return None
    if enrollment.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Không thể chỉnh sửa một lớp học đã ngừng của học viên",
        )
    if (
        enrollment.class_ is None
        or enrollment.class_.identity_scheme == "LEGACY"
        or not is_operational_class(enrollment.class_)
    ):
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
    if (
        enrollment.class_ is None
        or enrollment.class_.identity_scheme == "LEGACY"
        or not is_operational_class(enrollment.class_)
    ):
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
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Ngày bắt đầu không được để trống",
            )
        resolved_date = resolve_enrollment_date(
            enrollment.class_,
            data.enrollment_date,
        )
        # Keep the class lock order deterministic before checking an active
        # suspension.  The date-only edit is a new membership boundary and
        # must obey the same guard as initial enrollment.
        await db.scalar(
            select(Class.id).where(Class.id == enrollment.class_id).with_for_update()
        )
        await ensure_enrollment_allowed(db, enrollment.class_, resolved_date)
        if resolved_date != enrollment.enrollment_date:
            from app.services.billing_anchor_service import reanchor_enrollment_billing

            previous_start = enrollment.enrollment_date
            await reanchor_enrollment_billing(
                db,
                enrollment,
                new_anchor=resolved_date,
                reason=(
                    data.billing_change_reason
                    or "Điều chỉnh ngày bắt đầu từ hồ sơ học viên"
                ),
                actor_user_id=actor_user_id,
                request_id=data.billing_request_id,
                expected_version=data.expected_billing_version,
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
        if data.selected_slot_ids is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Danh sách buổi học không được để trống",
            )
        await _replace_slot_selections(
            db,
            enrollment,
            enrollment.class_,
            [str(slot_id) for slot_id in data.selected_slot_ids],
        )

    await _reconcile_current_fee_records(db, [enrollment])
    await db.commit()
    _clear_dependent_caches()

    updated = await _get_enrollment(db, id)
    if updated is None:
        return None

    return _to_response(updated)


async def drop_enrollment(
    db: AsyncSession,
    id: UUID,
    *,
    actor_user_id: str | None = None,
) -> EnrollmentResponse | None:
    enrollment_snapshot = await _get_enrollment(db, id)
    if enrollment_snapshot is None:
        return None

    # Keep the same class -> student -> enrollment lock order used by
    # enrollment creation and class deletion to avoid cross-operation deadlocks.
    await db.scalar(
        select(Class.id)
        .where(Class.id == enrollment_snapshot.class_id)
        .with_for_update()
    )
    student_exists = await db.scalar(
        select(Student.id)
        .where(Student.id == enrollment_snapshot.student_id)
        .with_for_update()
    )
    if student_exists is None:
        return None

    enrollment = await _get_enrollment(db, id, for_update=True)
    if enrollment is None:
        return None

    if enrollment.status == "active":
        today = business_today()
        from app.services.fee_cycle_service import ensure_final_cycle_for_stop

        never_started = bool(
            enrollment.enrollment_date is not None
            and enrollment.enrollment_date > today
        )
        if not never_started:
            await ensure_final_cycle_for_stop(db, enrollment, stopped_on=today)
        enrollment.status = "cancelled" if never_started else "dropped"
        enrollment.ended_on = None if never_started else today
        enrollment.ended_at = datetime.now(timezone.utc)
        enrollment.end_reason = (
            "Hủy ghi danh trước ngày bắt đầu" if never_started else "Học viên rời lớp"
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

    await db.commit()
    _clear_dependent_caches()

    dropped = await _get_enrollment(db, id)
    if dropped is None:
        return None

    return _to_response(dropped)
