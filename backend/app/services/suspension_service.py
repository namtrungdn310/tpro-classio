"""Whole-class suspension command (R6-D12).

Half-open `[suspended_from, resume_on)`; every ACTIVE enrollment receives
calendar-day membership overlap as service credit; selected sessions only
decide which occurrences need make-up. Cycle 0 never receives credit;
protected targets carry to the earliest future unprotected cycle.
"""

from datetime import datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.business_time import BUSINESS_TIMEZONE, business_today
from app.core.class_lifecycle import is_operational_class
from app.core.billing_schedule import cycle_base_due_date, cycle_exists
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.makeup import (
    ClassScheduleAdjustment,
    ClassSessionException,
)
from app.schemas.suspension import (
    SuspensionCreateRequest,
    SuspensionPreviewRequest,
    SuspensionPreviewResponse,
)
from app.services.credit_service import (
    grant_whole_class_credit,
    membership_overlap_days,
)
from app.services.schedule_slot_service import expand_class_occurrences


async def _load_active_enrollments(
    db: AsyncSession,
    class_id: str,
    *,
    suspended_from,
    resume_on,
) -> list[Enrollment]:
    result = await db.execute(
        select(Enrollment)
        .where(
            Enrollment.class_id == class_id,
            Enrollment.status != "cancelled",
            Enrollment.enrollment_date < resume_on,
            or_(Enrollment.ended_on.is_(None), Enrollment.ended_on > suspended_from),
        )
        .options(
            selectinload(Enrollment.fee_records),
            selectinload(Enrollment.class_),
            selectinload(Enrollment.current_billing_revision),
        )
    )
    return list(result.scalars().unique().all())


async def preview_suspension(
    db: AsyncSession,
    class_id: UUID,
    data: SuspensionPreviewRequest,
) -> SuspensionPreviewResponse:
    class_ = await db.get(Class, str(class_id))
    if class_ is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy lớp học")
    if data.resume_on <= data.suspended_from:
        raise HTTPException(
            status_code=422,
            detail="Ngày học lại phải sau ngày bắt đầu hoãn",
        )
    if data.suspended_from < business_today():
        raise HTTPException(
            status_code=422,
            detail="Chỉ có thể hoãn lớp từ hôm nay trở đi",
        )
    if (data.resume_on - data.suspended_from).days > 120:
        raise HTTPException(
            status_code=422,
            detail="Khoảng hoãn tối đa là 120 ngày",
        )
    if not is_operational_class(class_):
        raise HTTPException(
            status_code=409,
            detail="Chỉ lớp đang hoạt động hoặc sắp mở mới có thể hoãn",
        )
    if class_.start_date is not None and data.suspended_from < class_.start_date:
        raise HTTPException(
            status_code=422, detail="Ngày bắt đầu hoãn nằm ngoài phạm vi lớp"
        )
    if class_.stopped_on is not None and data.resume_on > class_.stopped_on + timedelta(
        days=1
    ):
        raise HTTPException(
            status_code=422, detail="Ngày học lại nằm ngoài phạm vi lớp"
        )
    enrollments = await _load_active_enrollments(
        db,
        str(class_id),
        suspended_from=data.suspended_from,
        resume_on=data.resume_on,
    )
    credit_days = (data.resume_on - data.suspended_from).days
    overlap_by_enrollment = {
        str(enrollment.id): membership_overlap_days(
            enrollment.enrollment_date,
            enrollment.ended_on,
            data.suspended_from,
            data.resume_on,
        )
        for enrollment in enrollments
    }
    member_summary = [
        {"enrollment_id": enrollment_id, "overlap_days": overlap_days}
        for enrollment_id, overlap_days in overlap_by_enrollment.items()
    ]
    target_cycles = 0
    protected_cases = 0
    for enrollment in enrollments:
        if overlap_by_enrollment.get(str(enrollment.id), 0) <= 0:
            continue
        cycles = sorted(
            (
                record
                for record in enrollment.fee_records
                if record.cycle_no is not None
                and record.cycle_no > 0
                and record.coverage_start is not None
                and record.coverage_start >= data.suspended_from
                and record.status not in ("VOID", "SUPERSEDED")
            ),
            key=lambda record: record.cycle_no,
        )
        found_target = False
        for record in cycles:
            if record.status == "PAID" or record.notified_at is not None:
                protected_cases += 1
            else:
                target_cycles += 1
                found_target = True
                break
        if not found_target:
            revision = enrollment.current_billing_revision
            billing_type = (
                revision.billing_type_snapshot
                if revision is not None
                else enrollment.class_.type
            )
            cycle_weeks = (
                int(
                    revision.billing_cycle_weeks_snapshot
                    if revision is not None
                    else enrollment.class_.billing_cycle_weeks or 1
                )
                if billing_type == "COURSE"
                else None
            )
            anchor = (
                revision.anchor_date
                if revision is not None
                else enrollment.enrollment_date
            )
            first_due = cycle_base_due_date(
                anchor,
                billing_type,
                cycle_weeks,
                1,
            )
            if cycle_exists(first_due, enrollment.class_.stopped_on):
                target_cycles += 1
    return SuspensionPreviewResponse(
        class_id=class_id,
        suspended_from=data.suspended_from,
        resume_on=data.resume_on,
        credit_days=credit_days,
        member_summary=member_summary,
        target_cycle_count=target_cycles,
        protected_case_count=protected_cases,
    )


async def create_suspension(
    db: AsyncSession,
    class_id: UUID,
    data: SuspensionCreateRequest,
    *,
    actor_user_id: str | None = None,
) -> SuspensionPreviewResponse:
    class_ = await db.get(Class, str(class_id))
    if class_ is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy lớp học")
    if data.resume_on <= data.suspended_from:
        raise HTTPException(
            status_code=422,
            detail="Ngày học lại phải sau ngày bắt đầu hoãn",
        )
    if (data.resume_on - data.suspended_from).days > 120:
        raise HTTPException(status_code=422, detail="Khoảng hoãn tối đa là 120 ngày")
    if data.suspended_from < business_today():
        raise HTTPException(
            status_code=422,
            detail="Chỉ có thể hoãn lớp từ hôm nay trở đi",
        )
    if not is_operational_class(class_):
        raise HTTPException(
            status_code=409, detail="Chỉ lớp đang hoạt động hoặc sắp mở mới có thể hoãn"
        )
    if class_.start_date is not None and data.suspended_from < class_.start_date:
        raise HTTPException(
            status_code=422, detail="Ngày bắt đầu hoãn nằm ngoài phạm vi lớp"
        )
    if class_.stopped_on is not None and data.resume_on > class_.stopped_on + timedelta(
        days=1
    ):
        raise HTTPException(
            status_code=422, detail="Ngày học lại nằm ngoài phạm vi lớp"
        )

    existing = await db.scalar(
        select(ClassScheduleAdjustment).where(
            ClassScheduleAdjustment.request_id == str(data.request_id),
        )
    )
    if existing is not None:
        if existing.class_id != str(class_id):
            raise HTTPException(
                status_code=409,
                detail="Mã yêu cầu hoãn đã được dùng cho một lớp khác",
            )
        return await preview_suspension(
            db,
            class_id,
            SuspensionPreviewRequest(
                suspended_from=data.suspended_from,
                resume_on=data.resume_on,
            ),
        )

    await db.scalar(select(Class.id).where(Class.id == str(class_id)).with_for_update())
    affected_through = data.resume_on - timedelta(days=1)
    overlapping = await db.scalar(
        select(ClassScheduleAdjustment.id)
        .where(
            ClassScheduleAdjustment.class_id == str(class_id),
            ClassScheduleAdjustment.status == "OPEN",
            ClassScheduleAdjustment.affected_from <= affected_through,
            ClassScheduleAdjustment.affected_through >= data.suspended_from,
        )
        .limit(1)
    )
    if overlapping is not None:
        raise HTTPException(
            status_code=409,
            detail="Lớp đã có khoảng hoãn giao nhau; hãy chọn khoảng khác",
        )
    enrollments = await _load_active_enrollments(
        db,
        str(class_id),
        suspended_from=data.suspended_from,
        resume_on=data.resume_on,
    )

    adjustment = ClassScheduleAdjustment(
        class_id=str(class_id),
        reason_code=data.reason_code,
        reason_note=(data.reason_note or "").strip() or None,
        affected_from=data.suspended_from,
        affected_through=affected_through,
        status="OPEN",
        created_by=actor_user_id or "00000000-0000-0000-0000-000000000000",
        request_id=str(data.request_id),
    )
    db.add(adjustment)
    await db.flush()

    # Occurrences trong [suspended_from, resume_on) → MAKEUP_PENDING.
    range_start = datetime.combine(
        data.suspended_from, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    range_end = datetime.combine(
        data.resume_on, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    occurrences = await expand_class_occurrences(
        db, class_, range_start=range_start, range_end=range_end
    )
    for occurrence in occurrences:
        if occurrence.kind != "REGULAR":
            continue
        db.add(
            ClassSessionException(
                adjustment_id=adjustment.id,
                class_id=str(class_id),
                original_start_at=occurrence.original_start_at,
                original_end_at=occurrence.original_end_at,
                original_timezone=BUSINESS_TIMEZONE.key,
                status="MAKEUP_PENDING",
                source_slot_id=occurrence.source_slot_id,
            )
        )
    await db.flush()

    await grant_whole_class_credit(
        db,
        class_id=str(class_id),
        adjustment=adjustment,
        enrollments=enrollments,
        suspended_from=data.suspended_from,
        resume_on=data.resume_on,
        request_id=data.request_id,
        actor_user_id=actor_user_id,
    )
    await db.commit()

    return await preview_suspension(
        db,
        class_id,
        SuspensionPreviewRequest(
            suspended_from=data.suspended_from,
            resume_on=data.resume_on,
        ),
    )
