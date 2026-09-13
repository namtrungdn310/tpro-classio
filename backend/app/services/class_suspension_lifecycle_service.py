"""Correct a whole-class pause without rewriting receipts, fees or attendance."""

from datetime import date, datetime, timedelta, timezone
import json
from uuid import UUID, uuid4
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value
from app.core.business_time import BUSINESS_TIMEZONE, business_today
from app.core.class_lifecycle import is_operational_class
from app.core.suspension_days import PauseInterval, preservation_change
from app.core.workspace import get_workspace_id
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.student import Student
from app.models.staff import StaffMember
from app.models.enrollment_suspension import SuspensionCommand
from app.models.enrollment_service_credit_event import EnrollmentServiceCreditEvent
from app.models.makeup import ClassScheduleAdjustment, ClassSessionException
from app.models.staff_attendance import StaffAttendanceEntry
from app.schemas.suspension import ClassSuspensionChangePreview
from app.services.billing_schedule_change_service import load_billing_context, digest
from app.services.credit_service import (
    apply_individual_credit_delta,
    enrollment_total_deferral_days,
)
from app.services.effective_occurrence_service import expand_effective_occurrences
from app.services.suspension_billing_plan import plan_credit_delta_target
from app.services.suspension_union_service import (
    effective_preservation,
    load_pause_intervals,
)
from app.services.suspension_service import (
    snapshot_suspended_occurrences,
    _load_active_enrollments,
)


async def prepare_class_suspension_change(
    db, class_id, adjustment_id, data, *, lock=False
):
    query = (
        select(Class)
        .where(Class.id == str(class_id))
        .execution_options(populate_existing=True)
    )
    class_ = await db.scalar(query.with_for_update() if lock else query)
    if class_ is None:
        raise HTTPException(404, "Không tìm thấy lớp học")
    adjustment = await db.scalar(
        select(ClassScheduleAdjustment)
        .where(
            ClassScheduleAdjustment.id == str(adjustment_id),
            ClassScheduleAdjustment.class_id == class_.id,
            ClassScheduleAdjustment.adjustment_kind == "CLASS_SUSPENSION",
        )
        .execution_options(populate_existing=True)
    )
    if adjustment is None:
        raise HTTPException(
            404, "Không tìm thấy lần hoãn lớp đủ thông tin để điều chỉnh"
        )
    if adjustment.status != "OPEN":
        raise HTTPException(409, "Lần hoãn này đã đóng hoặc hủy")
    old_end = adjustment.affected_through + timedelta(days=1)
    new_end = adjustment.affected_from if data.cancel else data.resume_on
    if not data.reason.strip():
        raise HTTPException(422, "Vui lòng ghi rõ lý do điều chỉnh")
    if data.cancel and data.resume_on != old_end:
        raise HTTPException(
            409, "Khoảng nghỉ đã thay đổi. Hãy tải lại lần hoãn cần hủy."
        )
    if not data.cancel and not 0 < (new_end - adjustment.affected_from).days <= 120:
        raise HTTPException(
            422, "Ngày học lại phải sau ngày nghỉ, tối đa 120 ngày mỗi lần"
        )
    if class_.stopped_on and new_end > class_.stopped_on:
        raise HTTPException(422, "Ngày học lại vượt ngày ngừng lớp")
    if new_end > old_end and not is_operational_class(class_):
        raise HTTPException(409, "Không thể gia hạn hoãn cho lớp đã ngừng hoạt động")
    start = datetime.combine(
        min(old_end, new_end), datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    end = datetime.combine(
        max(old_end, new_end), datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    blocked, additions, restorations = [], [], []
    overlaps = (
        await db.scalar(
            select(ClassScheduleAdjustment.id)
            .where(
                ClassScheduleAdjustment.class_id == class_.id,
                ClassScheduleAdjustment.id != adjustment.id,
                ClassScheduleAdjustment.status == "OPEN",
                ClassScheduleAdjustment.adjustment_kind != "OCCURRENCE",
                ClassScheduleAdjustment.affected_from < new_end,
                ClassScheduleAdjustment.affected_through >= adjustment.affected_from,
            )
            .limit(1)
        )
        if not data.cancel
        else None
    )
    if overlaps:
        blocked.append(
            "Khoảng nghỉ mới giao với lần hoãn khác của lớp. Hãy kiểm tra lần hoãn đó trước."
        )
    now = datetime.now(timezone.utc)
    if new_end > old_end:
        occurrences = await expand_effective_occurrences(
            db, class_, range_start=start, range_end=end
        )
        additions = [o for o in occurrences if o.kind == "REGULAR"]
        if any(o.kind == "MAKEUP" for o in occurrences):
            blocked.append(
                "Khoảng gia hạn có buổi bù đã xếp. Cần dời hoặc bỏ lịch bù trước."
            )
        if any(
            o.original_start_at <= now or not o.source_slot_id or not o.teacher_ids
            for o in additions
        ):
            blocked.append(
                "Không tự hoãn thêm buổi đã bắt đầu hoặc thiếu lịch/phân công chuẩn."
            )
    elif new_end < old_end:
        restorations = list(
            (
                await db.scalars(
                    select(ClassSessionException)
                    .where(
                        ClassSessionException.adjustment_id == adjustment.id,
                        ClassSessionException.original_start_at >= start,
                        ClassSessionException.original_start_at < end,
                        ClassSessionException.status != "RESTORED",
                    )
                    .options(selectinload(ClassSessionException.staff_snapshots))
                    .execution_options(populate_existing=True)
                )
            )
            .unique()
            .all()
        )
        from app.services.schedule_slot_service import expand_class_occurrences

        originals = {
            o.key: o
            for o in await expand_class_occurrences(
                db,
                class_,
                range_start=start,
                range_end=end,
            )
        }
        from app.core.occurrence import occurrence_key

        for x in restorations:
            if (
                x.status != "MAKEUP_PENDING"
                or x.original_start_at <= now
                or not x.source_slot_id
            ):
                blocked.append(
                    "Có buổi đã qua, đã xếp/học bù hoặc thiếu lịch chuẩn. Cần kiểm tra buổi đó trước khi rút ngắn hoặc hủy hoãn lớp."
                )
                continue
            original = originals.get(
                occurrence_key(str(class_.id), x.original_start_at)
            )
            if (
                original is None
                or str(original.source_slot_id) != str(x.source_slot_id)
                or original.original_end_at != x.original_end_at
                or set(original.teacher_ids)
                != {str(s.staff_id) for s in x.staff_snapshots if s.role == "TEACHER"}
                or set(original.assistant_ids)
                != {str(s.staff_id) for s in x.staff_snapshots if s.role == "ASSISTANT"}
            ):
                blocked.append(
                    "Lịch hoặc phân công buổi gốc đã thay đổi. Cần đối chiếu lịch trước khi khôi phục buổi này."
                )
    if start < end and await db.scalar(
        select(StaffAttendanceEntry.id)
        .where(
            StaffAttendanceEntry.occurrence_class_id == class_.id,
            StaffAttendanceEntry.occurrence_start_at >= start,
            StaffAttendanceEntry.occurrence_start_at < end,
            StaffAttendanceEntry.reversed_at.is_(None),
        )
        .limit(1)
    ):
        blocked.append(
            "Phạm vi điều chỉnh có chấm công. Không tự thay đổi lịch sử; kiểm tra chấm công trước."
        )
    enrollments = await _load_active_enrollments(
        db,
        class_.id,
        suspended_from=adjustment.affected_from,
        resume_on=max(old_end, new_end),
    )
    if lock and enrollments:
        await db.scalars(
            select(Student)
            .where(Student.id.in_([e.student_id for e in enrollments]))
            .order_by(Student.id)
            .with_for_update()
        )
        await db.scalars(
            select(Enrollment)
            .where(Enrollment.id.in_([e.id for e in enrollments]))
            .order_by(Enrollment.id)
            .with_for_update()
        )
    summaries, plans, state = [], [], []
    for member in enrollments:
        enrollment, records, snapshots = await load_billing_context(
            db, UUID(str(member.id)), lock=lock
        )
        set_committed_value(enrollment, "fee_records", records)
        from app.services.suspension_payment_protection import (
            attach_suspension_payment_protection,
        )

        await attach_suspension_payment_protection(db, [enrollment])
        other = await load_pause_intervals(db, enrollment, exclude_class=adjustment.id)
        before = effective_preservation(
            enrollment, [*other, PauseInterval(adjustment.affected_from, old_end)]
        )
        after = effective_preservation(
            enrollment,
            other
            if data.cancel
            else [*other, PauseInterval(adjustment.affected_from, new_end)],
        )
        days = preservation_change(before, after).delta_days
        affected_from = (
            max(adjustment.affected_from, business_today())
            if days < 0
            else adjustment.affected_from
        )
        target = (
            await plan_credit_delta_target(db, enrollment, affected_from, days)
            if days
            else None
        )
        old_due = new_due = None
        if target:
            shift = await enrollment_total_deferral_days(
                db,
                enrollment.id,
                coverage_start=target.coverage_start,
                include_unallocated=target.record is None,
            )
            if shift + days < 0:
                blocked.append(
                    f"Ngày bảo lưu của {enrollment.student.full_name} cần đối soát trước khi điều chỉnh."
                )
            old_due = (
                (target.record.adjusted_due_date or target.base_due_date)
                if target.record
                else target.base_due_date + timedelta(days=shift)
            )
            new_due = old_due + timedelta(days=days)
        summaries.append(
            dict(
                enrollment_id=enrollment.id,
                student_name=enrollment.student.full_name,
                overlap_days=days,
                old_due_date=old_due,
                new_due_date=new_due,
                target_coverage_start=target.coverage_start if target else None,
                pending_days=days if target is None else 0,
            )
        )
        events = (
            (
                await db.scalars(
                    select(EnrollmentServiceCreditEvent)
                    .where(EnrollmentServiceCreditEvent.enrollment_id == enrollment.id)
                    .options(selectinload(EnrollmentServiceCreditEvent.allocations))
                )
            )
            .unique()
            .all()
        )
        state.append(
            dict(
                id=enrollment.id,
                membership=(
                    enrollment.enrollment_date,
                    enrollment.ended_on,
                    enrollment.status,
                ),
                revision=enrollment.current_billing_revision_id,
                intervals=[(i.start, i.end) for i in other],
                fees=[s.financial_version for s in snapshots],
                credits=[(e.id, [a.id for a in e.allocations]) for e in events],
            )
        )
        plans.append((enrollment, days, affected_from))
    if restorations:
        # Same staff-row serialization as scheduling a makeup. Lock after all
        # membership/financial rows, then recheck competing class schedules.
        staff_ids = sorted(
            {str(s.staff_id) for x in restorations for s in x.staff_snapshots}
        )
        if lock and staff_ids:
            await db.scalars(
                select(StaffMember)
                .where(StaffMember.id.in_(staff_ids))
                .order_by(StaffMember.id)
                .with_for_update()
            )
        from app.services.class_conflict_service import check_makeup_conflicts

        for x in restorations:
            if await check_makeup_conflicts(
                db,
                class_id=class_.id,
                replacement_start_at=x.original_start_at,
                replacement_end_at=x.original_end_at,
                teacher_ids=[
                    s.staff_id for s in x.staff_snapshots if s.role == "TEACHER"
                ],
                assistant_ids=[
                    s.staff_id for s in x.staff_snapshots if s.role == "ASSISTANT"
                ],
                exclude_exception_id=x.id,
            ):
                blocked.append(
                    "Buổi gốc cần khôi phục bị trùng lịch nhân sự hoặc lịch lớp. Hãy giải quyết xung đột trước."
                )
    before_snapshot = dict(
        adjustment=dict(
            id=adjustment.id,
            version=adjustment.version,
            start=adjustment.affected_from,
            end=old_end,
            status=adjustment.status,
        ),
        members=state,
    )
    preview = ClassSuspensionChangePreview(
        adjustment_id=adjustment.id,
        previous_resume_on=old_end,
        resume_on=data.resume_on,
        cancel=data.cancel,
        restore_count=len(restorations),
        suspend_count=len(additions),
        member_summary=summaries,
        fingerprint="",
        blocked_reasons=list(dict.fromkeys(blocked)),
    )
    preview.fingerprint = digest(
        dict(
            state=before_snapshot,
            preview=preview.model_dump(mode="json"),
            reason=data.reason.strip(),
            class_updated=class_.updated_at,
            additions=[
                (o.key, o.slot_version, o.teacher_ids, o.assistant_ids)
                for o in additions
            ],
            restorations=[(x.id, x.version) for x in restorations],
        )
    )
    return preview, adjustment, additions, restorations, plans, before_snapshot


async def apply_class_suspension_change(
    db, class_id, adjustment_id, data, *, actor_id=None
):
    actor = str(actor_id) if actor_id else "00000000-0000-0000-0000-000000000000"
    payload = dict(
        class_id=str(class_id),
        adjustment_id=str(adjustment_id),
        **data.model_dump(mode="json", exclude={"expected_fingerprint", "request_id"}),
    )
    await db.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"suspension-command:{get_workspace_id()}:{actor}:{data.request_id}"},
    )
    receipt = await db.scalar(
        select(SuspensionCommand).where(
            SuspensionCommand.actor_id == actor,
            SuspensionCommand.request_id == str(data.request_id),
        )
    )
    if receipt:
        if receipt.payload != payload:
            raise HTTPException(409, "Mã xác nhận đã được dùng cho dữ liệu khác")
        return ClassSuspensionChangePreview.model_validate(receipt.result)
    (
        preview,
        adjustment,
        additions,
        restorations,
        plans,
        before,
    ) = await prepare_class_suspension_change(
        db, class_id, adjustment_id, data, lock=True
    )
    if preview.fingerprint != data.expected_fingerprint:
        raise HTTPException(
            409, "Lịch nghỉ, lịch học hoặc học phí vừa thay đổi. Hãy xem lại tác động."
        )
    if preview.blocked_reasons:
        raise HTTPException(409, preview.blocked_reasons[0])
    command_id = str(uuid4())
    # CLOSED is the existing batch lifecycle enum; the immutable command keeps
    # the explicit cancellation reason/action (do not widen makeup statuses).
    adjustment.status = "CLOSED" if data.cancel else "OPEN"
    if not data.cancel:
        adjustment.affected_through = data.resume_on - timedelta(days=1)
    adjustment.reason_note = data.reason.strip()
    adjustment.version += 1
    adjustment.updated_at = datetime.now(timezone.utc)
    from app.services.class_makeup_service import _append_event

    for x in restorations:
        x.status = "RESTORED"
        x.restored_at = datetime.now(timezone.utc)
        x.restored_by = actor_id
        x.version += 1
        _append_event(
            db,
            exception_id=x.id,
            event_type="original-restored",
            old_payload={"status": "MAKEUP_PENDING"},
            new_payload={"status": "RESTORED", "source": "CLASS_SUSPENSION_CORRECTION"},
            actor_user_id=actor_id,
            request_id=str(data.request_id),
        )
    await db.flush()
    await snapshot_suspended_occurrences(
        db,
        class_id,
        adjustment,
        additions,
        actor_user_id=actor_id,
        request_id=data.request_id,
    )
    audit = ([], [])
    for enrollment, days, affected_from in plans:
        await apply_individual_credit_delta(
            db,
            enrollment,
            days=days,
            affected_from=affected_from,
            overlap_end=data.resume_on,
            request_id=data.request_id,
            command_id=command_id,
            actor_id=actor_id,
            reason=data.reason.strip(),
            audit_collector=audit,
        )
    if audit[0]:
        from app.services.fee_operation_service import append_fee_operation

        await append_fee_operation(
            db,
            action="due_date_change",
            before=audit[0],
            after=audit[1],
            actor_id=actor_id,
            request_id=data.request_id,
            origin="application",
            reason=f"Điều chỉnh hoãn lớp: {data.reason.strip()}",
        )
    db.add(
        SuspensionCommand(
            id=command_id,
            class_adjustment_id=adjustment.id,
            actor_id=actor,
            request_id=str(data.request_id),
            payload=payload,
            result=preview.model_dump(mode="json"),
            before_snapshot=json.loads(json.dumps(before, default=str)),
        )
    )
    await db.commit()
    return preview


async def list_class_suspensions(db, class_id, *, year, offset=0, limit=10):
    if await db.get(Class, str(class_id)) is None:
        raise HTTPException(404, "Không tìm thấy lớp học")
    filters = [
        ClassScheduleAdjustment.class_id == str(class_id),
        ClassScheduleAdjustment.adjustment_kind == "CLASS_SUSPENSION",
        ClassScheduleAdjustment.affected_from < date(year + 1, 1, 1),
        ClassScheduleAdjustment.affected_through >= date(year, 1, 1),
    ]
    rows = (
        (
            await db.scalars(
                select(ClassScheduleAdjustment)
                .where(*filters)
                .order_by(
                    ClassScheduleAdjustment.affected_from.desc(),
                    ClassScheduleAdjustment.id.desc(),
                )
                .offset(offset)
                .limit(limit)
            )
        )
        .unique()
        .all()
    )
    total = await db.scalar(
        select(func.count()).select_from(ClassScheduleAdjustment).where(*filters)
    )
    return dict(
        total=int(total or 0),
        items=[
            dict(
                id=r.id,
                suspended_from=r.affected_from,
                resume_on=r.affected_through + timedelta(days=1),
                status=r.status,
                version=r.version,
                reason=r.reason_note or r.reason_code,
            )
            for r in rows
        ],
    )
