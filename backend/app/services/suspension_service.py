"""Whole-class service preservation with a read-only, stale-safe preview."""

from datetime import datetime, timedelta, timezone
import hashlib
import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_, select, text
from sqlalchemy.orm import raiseload, selectinload

from app.core.business_time import BUSINESS_TIMEZONE, business_today
from app.core.class_lifecycle import is_operational_class
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.enrollment_service_credit_event import EnrollmentServiceCreditEvent
from app.models.fee_record import FeeRecord
from app.models.makeup import (
    ClassScheduleAdjustment,
    ClassSessionException,
    ClassSessionStaffSnapshot,
)
from app.models.staff import StaffMember
from app.models.staff_attendance import StaffAttendanceEntry
from app.models.student import Student
from app.schemas.suspension import SuspensionPreviewResponse
from app.services.credit_service import (
    grant_whole_class_credit,
)
from app.services.effective_occurrence_service import expand_effective_occurrences
from app.services.fee_reconciliation import is_fee_record_protected
from app.services.suspension_billing_plan import plan_renewal_target

NULL_ACTOR = "00000000-0000-0000-0000-000000000000"


def _digest(payload):
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False).encode()
    ).hexdigest()


async def _load_active_enrollments(db, class_id, *, suspended_from, resume_on):
    rows = await db.scalars(
        select(Enrollment)
        .where(
            Enrollment.class_id == class_id,
            Enrollment.status != "cancelled",
            Enrollment.enrollment_date < resume_on,
            or_(Enrollment.ended_on.is_(None), Enrollment.ended_on > suspended_from),
        )
        .options(
            raiseload("*"),
            selectinload(Enrollment.fee_records).selectinload(FeeRecord.payments),
            selectinload(Enrollment.class_).raiseload("*"),
            selectinload(Enrollment.current_billing_revision),
            selectinload(Enrollment.student).raiseload("*"),
        )
        .order_by(Enrollment.id)
        .execution_options(populate_existing=True)
    )
    enrollments = list(rows.unique().all())
    from app.services.suspension_payment_protection import (
        attach_suspension_payment_protection,
    )

    await attach_suspension_payment_protection(db, enrollments)
    return enrollments


def _validate_dates(class_, data):
    if data.resume_on <= data.suspended_from:
        raise HTTPException(422, "Ngày học lại phải sau ngày bắt đầu nghỉ")
    if data.suspended_from < business_today():
        raise HTTPException(422, "Chỉ có thể hoãn lớp từ hôm nay trở đi")
    if (data.resume_on - data.suspended_from).days > 120:
        raise HTTPException(422, "Khoảng hoãn tối đa là 120 ngày")
    if not is_operational_class(class_):
        raise HTTPException(409, "Chỉ lớp đang hoạt động hoặc sắp mở mới có thể hoãn")
    if class_.start_date and data.suspended_from < class_.start_date:
        raise HTTPException(422, "Ngày bắt đầu nghỉ nằm ngoài phạm vi lớp")
    if class_.stopped_on and data.resume_on > class_.stopped_on:
        raise HTTPException(422, "Ngày học lại phải trước hoặc đúng ngày ngừng lớp")


async def _build_preview(db, class_, data):
    _validate_dates(class_, data)
    enrollments = await _load_active_enrollments(
        db,
        str(class_.id),
        suspended_from=data.suspended_from,
        resume_on=data.resume_on,
    )
    start = datetime.combine(
        data.suspended_from, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    end = datetime.combine(
        data.resume_on, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    occurrences = await expand_effective_occurrences(
        db, class_, range_start=start, range_end=end
    )
    blocked = []
    overlaps = (
        (
            await db.scalars(
                select(ClassScheduleAdjustment)
                .options(raiseload("*"))
                .where(
                    ClassScheduleAdjustment.class_id == class_.id,
                    ClassScheduleAdjustment.status == "OPEN",
                    ClassScheduleAdjustment.adjustment_kind != "OCCURRENCE",
                    ClassScheduleAdjustment.affected_from < data.resume_on,
                    ClassScheduleAdjustment.affected_through >= data.suspended_from,
                )
            )
        )
        .unique()
        .all()
    )
    if overlaps:
        blocked.append(
            "Lớp đã có khoảng nghỉ giao nhau. Hãy kiểm tra lần hoãn hiện có trước."
        )
    if any(o.kind == "MAKEUP" for o in occurrences):
        blocked.append(
            "Có buổi bù đã xếp trong khoảng nghỉ. Hãy dời hoặc bỏ lịch buổi bù đó trước."
        )
    regular = [o for o in occurrences if o.kind == "REGULAR"]
    now = datetime.now(timezone.utc)
    if any(o.original_start_at <= now for o in regular):
        blocked.append(
            "Khoảng nghỉ chứa buổi đã bắt đầu. Hãy chọn ngày sau buổi đó; không tự đổi lịch sử chấm công."
        )
    attendance = (
        await db.scalars(
            select(StaffAttendanceEntry.id).where(
                StaffAttendanceEntry.occurrence_class_id == class_.id,
                StaffAttendanceEntry.occurrence_start_at >= start,
                StaffAttendanceEntry.occurrence_start_at < end,
                StaffAttendanceEntry.reversed_at.is_(None),
            )
        )
    ).all()
    if attendance:
        blocked.append(
            "Khoảng nghỉ có buổi đã chấm công. Cần kiểm tra chấm công trước khi xác nhận hoãn."
        )
    if any(not o.source_slot_id or not o.teacher_ids for o in regular):
        blocked.append(
            "Có buổi thiếu lịch hoặc phân công giáo viên chuẩn. Hãy kiểm tra lịch lớp trước."
        )

    events = (
        (
            await db.scalars(
                select(EnrollmentServiceCreditEvent)
                .where(
                    EnrollmentServiceCreditEvent.enrollment_id.in_(
                        [e.id for e in enrollments]
                    ),
                )
                .options(selectinload(EnrollmentServiceCreditEvent.allocations))
            )
        )
        .unique()
        .all()
        if enrollments
        else []
    )
    from app.services.suspension_union_service import load_pause_intervals_bulk
    from app.services.credit_service import deferral_from_events

    pauses = await load_pause_intervals_bulk(db, enrollments)
    events_by_member = {}
    for event in events:
        events_by_member.setdefault(str(event.enrollment_id), []).append(event)
    members, protected, targets, state = [], 0, 0, []
    for enrollment in enrollments:
        from app.services.suspension_union_service import added_class_days

        days = await added_class_days(
            db,
            enrollment,
            data.suspended_from,
            data.resume_on,
            existing=pauses[str(enrollment.id)],
        )
        target = plan_renewal_target(enrollment, data.suspended_from) if days else None
        old_due = None
        if target:
            targets += 1
            if target.record:
                old_due = target.record.adjusted_due_date or target.base_due_date
            else:
                shift = deferral_from_events(
                    events_by_member.get(str(enrollment.id), []),
                    target.coverage_start,
                    include_unallocated=True,
                )
                old_due = target.base_due_date + timedelta(days=shift)
        protected += sum(
            1
            for r in enrollment.fee_records
            if r.cycle_no > 0
            and r.coverage_start
            and r.coverage_start >= data.suspended_from
            and r.status not in ("VOID", "SUPERSEDED")
            and is_fee_record_protected(r)
        )
        members.append(
            {
                "enrollment_id": enrollment.id,
                "student_name": enrollment.student.full_name,
                "overlap_days": days,
                "target_coverage_start": target.coverage_start if target else None,
                "old_due_date": old_due,
                "new_due_date": old_due + timedelta(days=days) if old_due else None,
                "pending_days": days if target is None else 0,
            }
        )
        rev = enrollment.current_billing_revision
        state.append(
            {
                "id": enrollment.id,
                "start": enrollment.enrollment_date,
                "end": enrollment.ended_on,
                "status": enrollment.status,
                "payment_requests": enrollment.suspension_payment_snapshot,
                "revision": rev.id if rev else None,
                "revision_state": rev.state if rev else None,
                "segments": rev.scheduled_segments if rev else [],
                "waivers": rev.waived_intervals if rev else [],
                "fees": sorted(
                    (
                        str(r.id),
                        str(r.updated_at),
                        r.status,
                        str(r.notified_at),
                        str(r.adjusted_due_date),
                        str(r.coverage_start),
                        str(r.coverage_end),
                        str(r.paid_amount),
                        str(r.refunded_amount),
                        r.review_required,
                        sorted(str(p.id) for p in r.payments),
                    )
                    for r in enrollment.fee_records
                ),
            }
        )
    fingerprint = _digest(
        {
            "class": (
                class_.id,
                str(class_.updated_at),
                class_.start_date,
                class_.stopped_on,
                class_.schedule,
            ),
            "dates": (data.suspended_from, data.resume_on),
            "members": members,
            "state": state,
            "occurrences": [
                (
                    o.key,
                    o.source_slot_id,
                    o.slot_version,
                    o.teacher_ids,
                    o.assistant_ids,
                )
                for o in regular
            ],
            "credits": sorted(
                (str(e.id), sorted(str(a.id) for a in e.allocations)) for e in events
            ),
            "blocked": blocked,
        }
    )
    return (
        SuspensionPreviewResponse(
            class_id=class_.id,
            suspended_from=data.suspended_from,
            resume_on=data.resume_on,
            credit_days=(data.resume_on - data.suspended_from).days,
            member_summary=members,
            target_cycle_count=targets,
            protected_case_count=protected,
            fingerprint=fingerprint,
            occurrence_count=len(regular),
            blocked_reasons=blocked,
        ),
        enrollments,
        regular,
    )


async def preview_suspension(db, class_id, data):
    class_ = await db.get(Class, str(class_id), options=[raiseload("*")])
    if class_ is None:
        raise HTTPException(404, "Không tìm thấy lớp học")
    preview, _, _ = await _build_preview(db, class_, data)
    return preview


async def create_suspension(db, class_id, data, *, actor_user_id=None):
    actor = str(actor_user_id) if actor_user_id else NULL_ACTOR
    payload = data.model_dump(
        mode="json", exclude={"request_id", "expected_fingerprint"}
    )
    from app.core.workspace import get_workspace_id

    await db.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {
            "key": f"class-suspension-request:{get_workspace_id()}:{actor}:{data.request_id}"
        },
    )
    class_ = await db.scalar(
        select(Class)
        .options(raiseload("*"))
        .where(Class.id == str(class_id))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if class_ is None:
        raise HTTPException(404, "Không tìm thấy lớp học")
    # Replay before today's date/state validation, including after the pause ends.
    existing = await db.scalar(
        select(ClassScheduleAdjustment).where(
            ClassScheduleAdjustment.created_by == actor,
            ClassScheduleAdjustment.request_id == str(data.request_id),
        )
    )
    if existing is not None:
        if (
            str(existing.class_id) != str(class_id)
            or existing.create_payload != payload
            or not existing.create_result
        ):
            raise HTTPException(
                409,
                "Mã yêu cầu đã được dùng với dữ liệu khác hoặc thuộc lần hoãn cũ. Hãy tải lại để kiểm tra.",
            )
        return SuspensionPreviewResponse.model_validate(existing.create_result)
    if data.reason_code == "OTHER" and not (data.reason_note or "").strip():
        raise HTTPException(422, "Vui lòng nhập ghi chú khi chọn lý do khác")
    # Same lock order as billing/transfer: class -> students -> enrollment -> fees.
    student_ids = select(Enrollment.student_id).where(
        Enrollment.class_id == str(class_id)
    )
    await db.scalars(
        select(Student)
        .where(Student.id.in_(student_ids))
        .order_by(Student.id)
        .with_for_update()
    )
    await db.scalars(
        select(Enrollment)
        .where(Enrollment.class_id == str(class_id))
        .order_by(Enrollment.id)
        .with_for_update()
    )
    enrollment_ids = select(Enrollment.id).where(Enrollment.class_id == str(class_id))
    await db.scalars(
        select(FeeRecord)
        .where(FeeRecord.enrollment_id.in_(enrollment_ids))
        .order_by(FeeRecord.id)
        .with_for_update()
    )
    preview, enrollments, occurrences = await _build_preview(db, class_, data)
    if (
        data.expected_fingerprint is not None
        and data.expected_fingerprint != preview.fingerprint
    ):
        raise HTTPException(
            409,
            "Lịch học hoặc học phí vừa thay đổi. Vui lòng xem lại tác động rồi xác nhận.",
        )
    if preview.blocked_reasons:
        raise HTTPException(409, preview.blocked_reasons[0])
    adjustment = ClassScheduleAdjustment(
        class_id=str(class_id),
        adjustment_kind="CLASS_SUSPENSION",
        reason_code=data.reason_code,
        reason_note=(data.reason_note or "").strip() or None,
        affected_from=data.suspended_from,
        affected_through=data.resume_on - timedelta(days=1),
        status="OPEN",
        created_by=actor,
        request_id=str(data.request_id),
        create_payload=payload,
    )
    db.add(adjustment)
    await db.flush()
    await snapshot_suspended_occurrences(
        db,
        class_id,
        adjustment,
        occurrences,
        actor_user_id=actor_user_id,
        request_id=data.request_id,
    )
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
    preview.adjustment_id = UUID(str(adjustment.id))
    adjustment.create_result = preview.model_dump(mode="json")
    await db.commit()
    return preview


async def snapshot_suspended_occurrences(
    db, class_id, adjustment, occurrences, *, actor_user_id, request_id
):
    """Canonical snapshots shared by initial pauses and their extensions."""
    from app.services.class_makeup_service import (
        _append_event,
        _eligible_students,
        _snapshot_students,
    )

    staff_ids = sorted(
        {sid for o in occurrences for sid in o.teacher_ids + o.assistant_ids}
    )
    staff_by_id = (
        {
            str(s.id): s
            for s in (
                await db.scalars(
                    select(StaffMember)
                    .where(StaffMember.id.in_(staff_ids))
                    .order_by(StaffMember.id)
                    .with_for_update()
                )
            ).all()
        }
        if staff_ids
        else {}
    )
    for occurrence in occurrences:
        exception = ClassSessionException(
            adjustment_id=adjustment.id,
            class_id=str(class_id),
            original_start_at=occurrence.original_start_at,
            original_end_at=occurrence.original_end_at,
            original_timezone=BUSINESS_TIMEZONE.key,
            status="MAKEUP_PENDING",
            source_slot_id=occurrence.source_slot_id,
        )
        db.add(exception)
        await db.flush()
        for role, ids in (
            ("TEACHER", occurrence.teacher_ids),
            ("ASSISTANT", occurrence.assistant_ids),
        ):
            for sid in ids:
                staff = staff_by_id.get(sid)
                if staff is None or not staff.is_active:
                    raise HTTPException(
                        409,
                        "Phân công nhân sự vừa thay đổi. Hãy kiểm tra lại lịch lớp.",
                    )
                db.add(
                    ClassSessionStaffSnapshot(
                        exception_id=exception.id,
                        staff_id=sid,
                        role=role,
                        display_name_snapshot=staff.full_name,
                        source_slot_key=occurrence.source_slot_key,
                        source_slot_id=occurrence.source_slot_id,
                    )
                )
        eligible = await _eligible_students(
            db, str(class_id), occurrence.original_start_at, occurrence.source_slot_id
        )
        await _snapshot_students(db, exception, eligible, class_id=str(class_id))
        _append_event(
            db,
            exception_id=exception.id,
            event_type="batch-created",
            old_payload=None,
            new_payload={"status": "MAKEUP_PENDING", "source": "CLASS_SUSPENSION"},
            actor_user_id=actor_user_id,
            request_id=str(request_id),
        )
