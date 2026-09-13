"""Per-enrollment service pause commands; no class/staff attendance mutation."""

from datetime import date, datetime, timezone
from uuid import UUID, uuid4
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value
from app.core.business_time import business_today
from app.core.class_lifecycle import is_operational_class
from app.core.suspension_days import PauseInterval, preservation_change
from app.core.workspace import get_workspace_id
from app.models.enrollment_suspension import EnrollmentSuspension, SuspensionCommand
from app.models.enrollment_service_credit_event import EnrollmentServiceCreditEvent
from app.models.makeup import ClassScheduleAdjustment
from app.schemas.enrollment_suspension import (
    EnrollmentSuspensionPreview,
    EnrollmentSuspensionList,
)
from app.services.billing_schedule_change_service import load_billing_context, digest
from app.services.credit_service import (
    apply_individual_credit_delta,
    enrollment_total_deferral_days,
    pending_service_credits,
)
from app.services.suspension_billing_plan import plan_credit_delta_target
from app.services.suspension_union_service import (
    effective_preservation,
    load_pause_intervals,
)

NULL_ACTOR = "00000000-0000-0000-0000-000000000000"


def _row_snapshot(row):
    return (
        {}
        if row is None
        else {
            "id": str(row.id),
            "version": row.version,
            "status": row.status,
            "suspended_from": row.suspended_from.isoformat(),
            "resume_on": row.resume_on.isoformat(),
            "reason": row.reason,
        }
    )


async def prepare_individual_suspension(db, enrollment_id, data, *, lock=False):
    enrollment, records, fee_snapshots = await load_billing_context(
        db, enrollment_id, lock=lock
    )
    set_committed_value(enrollment, "fee_records", records)
    from app.services.suspension_payment_protection import (
        attach_suspension_payment_protection,
    )

    await attach_suspension_payment_protection(db, [enrollment])
    row = None
    if data.suspension_id:
        row = await db.scalar(
            select(EnrollmentSuspension)
            .where(
                EnrollmentSuspension.id == str(data.suspension_id),
                EnrollmentSuspension.enrollment_id == str(enrollment_id),
            )
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise HTTPException(404, "Không tìm thấy lần hoãn của lượt học này")
        if row.status == "CANCELLED":
            raise HTTPException(409, "Lần hoãn đã hủy. Hãy tạo lần hoãn mới nếu cần.")
    elif data.action == "CANCEL":
        raise HTTPException(422, "Chọn lần hoãn cần hủy")
    if not 0 < (data.resume_on - data.suspended_from).days <= 120:
        raise HTTPException(
            422, "Ngày học lại phải sau ngày bắt đầu nghỉ, tối đa 120 ngày mỗi lần"
        )
    if data.action == "CANCEL" and (
        data.suspended_from != row.suspended_from or data.resume_on != row.resume_on
    ):
        raise HTTPException(
            409, "Khoảng nghỉ đã thay đổi. Hãy tải lại lần hoãn cần hủy."
        )
    if data.action != "CANCEL":
        if enrollment.status != "active" or not is_operational_class(enrollment.class_):
            raise HTTPException(
                409, "Chỉ hoãn riêng cho lượt học và lớp đang hoạt động"
            )
        floor = max(
            d for d in (enrollment.enrollment_date, enrollment.class_.start_date) if d
        )
        stops = [d for d in (enrollment.ended_on, enrollment.class_.stopped_on) if d]
        if data.suspended_from < floor or (stops and data.resume_on > min(stops)):
            raise HTTPException(
                422, "Khoảng nghỉ phải nằm trong thời gian học viên theo học lớp này"
            )
    legacy = await db.scalar(
        select(ClassScheduleAdjustment.id)
        .where(
            ClassScheduleAdjustment.class_id == enrollment.class_id,
            ClassScheduleAdjustment.status == "OPEN",
            ClassScheduleAdjustment.adjustment_kind == "LEGACY_REVIEW",
            ClassScheduleAdjustment.affected_from < data.resume_on,
            ClassScheduleAdjustment.affected_through >= data.suspended_from,
        )
        .limit(1)
    )
    if legacy:
        raise HTTPException(
            409,
            "Lớp có lần hoãn cũ chưa xác định được ngày bảo lưu. Cần kiểm tra dữ liệu đó trước.",
        )
    other = await load_pause_intervals(
        db, enrollment, exclude_individual=data.suspension_id
    )
    old_interval = [PauseInterval(row.suspended_from, row.resume_on)] if row else []
    new_interval = (
        []
        if data.action == "CANCEL"
        else [PauseInterval(data.suspended_from, data.resume_on)]
    )
    before = effective_preservation(enrollment, [*other, *old_interval])
    after = effective_preservation(enrollment, [*other, *new_interval])
    change = preservation_change(before, after)
    # Move only the end date on corrections. Moving a whole interval can have
    # equal duration but different fee boundaries; use cancel + a new preview.
    if row and data.action == "SAVE" and data.suspended_from != row.suspended_from:
        raise HTTPException(
            422,
            "Muốn sửa ngày bắt đầu nghỉ: hủy lần nhập nhầm, rồi tạo khoảng nghỉ đúng để xem đầy đủ tác động.",
        )
    days = change.delta_days
    # A pause preserves the whole agreed interval at its first editable renewal.
    # Extending the same pause must not suddenly allocate at its later end date.
    affected_from = data.suspended_from
    if days < 0:
        affected_from = max(affected_from, business_today())
    target = (
        await plan_credit_delta_target(db, enrollment, affected_from, days)
        if days
        else None
    )
    old_due = new_due = None
    warnings = []
    if target:
        shift = await enrollment_total_deferral_days(
            db,
            enrollment.id,
            coverage_start=target.coverage_start,
            include_unallocated=target.record is None,
        )
        if shift + days < 0:
            raise HTTPException(
                409,
                "Ngày bảo lưu cũ chưa được đối soát đủ. Cần kiểm tra lịch thu trước khi rút ngắn hoặc hủy.",
            )
        from datetime import timedelta

        old_due = (
            (target.record.adjusted_due_date or target.base_due_date)
            if target.record
            else target.base_due_date + timedelta(days=shift)
        )
        new_due = old_due + timedelta(days=days)
        if new_due < business_today():
            warnings.append(
                "Ngày thu sau điều chỉnh đã qua; khoản này có thể hiện quá hạn."
            )
    protected = sum(1 for r in fee_snapshots if r.notified or r.protected)
    if protected:
        warnings.append(
            "Giữ nguyên các khoản đã báo thu hoặc có giao dịch; chỉ điều chỉnh kỳ còn được phép sửa."
        )
    if days and target is None:
        warnings.append(
            "Chưa có kỳ thu phù hợp. Ghi nhận số ngày chờ bù trừ, không tự sửa khoản đã chốt."
        )
    late = data.suspended_from < business_today()
    if late:
        warnings.append(
            "Ghi nhận muộn: không thay đổi lịch dạy, chấm công hoặc giao dịch đã ghi nhận."
        )
    events = (
        (
            await db.scalars(
                select(EnrollmentServiceCreditEvent)
                .where(
                    EnrollmentServiceCreditEvent.enrollment_id == enrollment.id,
                )
                .options(selectinload(EnrollmentServiceCreditEvent.allocations))
                .execution_options(populate_existing=True)
            )
        )
        .unique()
        .all()
    )
    history = sorted(
        (
            str(e.id),
            e.event_type,
            e.credit_days,
            sorted(str(a.id) for a in e.allocations),
        )
        for e in events
    )
    state = {
        "before": _row_snapshot(row),
        "credits": history,
        "members": (enrollment.status, enrollment.enrollment_date, enrollment.ended_on),
        "class": (
            enrollment.class_.start_date,
            enrollment.class_.stopped_on,
            str(enrollment.class_.updated_at),
        ),
        "revision": str(enrollment.current_billing_revision_id),
        "other": [(i.start, i.end) for i in other],
        "fees": [s.financial_version for s in fee_snapshots],
    }
    result = EnrollmentSuspensionPreview(
        enrollment_id=enrollment.id,
        suspension_id=row.id if row else None,
        student_name=enrollment.student.full_name,
        class_name=enrollment.class_.name,
        suspended_from=data.suspended_from,
        resume_on=data.resume_on,
        calendar_days=(data.resume_on - data.suspended_from).days,
        previous_preserved_days=sum(i.days for i in before),
        preserved_days=sum(i.days for i in after),
        delta_days=days,
        overlap_or_waived_days=0
        if not new_interval
        else (
            (data.resume_on - data.suspended_from).days
            - sum(i.days for i in after)
            + sum(i.days for i in effective_preservation(enrollment, other))
        ),
        target_coverage_start=target.coverage_start if target else None,
        old_due_date=old_due,
        new_due_date=new_due,
        pending_days=days if not target else 0,
        protected_count=protected,
        late_report=late,
        fingerprint="",
        warnings=warnings,
    )
    result.fingerprint = digest(
        {
            "state": state,
            "draft": data.model_dump(
                mode="json", exclude={"request_id", "expected_fingerprint", "reason"}
            ),
            "result": result.model_dump(mode="json"),
        }
    )
    return result, enrollment, row, state, affected_from


async def apply_individual_suspension(db, enrollment_id, data, *, actor_id=None):
    if not data.reason.strip():
        raise HTTPException(422, "Vui lòng ghi rõ lý do tạm nghỉ hoặc điều chỉnh")
    actor = str(actor_id) if actor_id else NULL_ACTOR
    payload = {
        "enrollment_id": str(enrollment_id),
        **data.model_dump(mode="json", exclude={"request_id", "expected_fingerprint"}),
    }
    # Serialize request identity first (also across different memberships).
    await db.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"suspension-command:{get_workspace_id()}:{actor}:{data.request_id}"},
    )
    existing = await db.scalar(
        select(SuspensionCommand).where(
            SuspensionCommand.actor_id == actor,
            SuspensionCommand.request_id == str(data.request_id),
        )
    )
    if existing:
        if existing.payload != payload:
            raise HTTPException(409, "Mã xác nhận này đã được dùng cho dữ liệu khác")
        return EnrollmentSuspensionPreview.model_validate(existing.result)
    (
        preview,
        enrollment,
        row,
        before,
        affected_from,
    ) = await prepare_individual_suspension(db, enrollment_id, data, lock=True)
    if data.expected_fingerprint != preview.fingerprint:
        raise HTTPException(
            409,
            "Lịch nghỉ hoặc học phí vừa thay đổi. Hãy xem lại tác động rồi xác nhận.",
        )
    command_id = str(uuid4())
    if row is None:
        row = EnrollmentSuspension(
            enrollment_id=str(enrollment_id),
            suspended_from=data.suspended_from,
            resume_on=data.resume_on,
            reason=data.reason.strip(),
        )
        db.add(row)
    else:
        row.resume_on = data.resume_on
        row.reason = data.reason.strip()
        row.status = "CANCELLED" if data.action == "CANCEL" else "ACTIVE"
        row.version += 1
        row.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await apply_individual_credit_delta(
        db,
        enrollment,
        days=preview.delta_days,
        affected_from=affected_from,
        overlap_end=data.resume_on,
        request_id=data.request_id,
        command_id=command_id,
        actor_id=actor_id,
        reason=f"Điều chỉnh bảo lưu hoãn riêng: {data.reason.strip()}",
    )
    preview.suspension_id = UUID(str(row.id))
    # JSON serializable immutable evidence, including the original grant IDs.
    import json

    db.add(
        SuspensionCommand(
            id=command_id,
            enrollment_suspension_id=row.id,
            request_id=str(data.request_id),
            actor_id=actor,
            payload=payload,
            result=preview.model_dump(mode="json"),
            before_snapshot=json.loads(json.dumps(before, default=str)),
        )
    )
    await db.commit()
    return preview


async def list_individual_suspensions(
    db, enrollment_id, *, year=None, offset=0, limit=20
):
    # This lookup establishes both membership existence and workspace boundary.
    await load_billing_context(db, enrollment_id)
    filters = [EnrollmentSuspension.enrollment_id == str(enrollment_id)]
    if year is not None:
        filters += [
            EnrollmentSuspension.suspended_from < date(year + 1, 1, 1),
            EnrollmentSuspension.resume_on > date(year, 1, 1),
        ]
    total = await db.scalar(
        select(func.count()).select_from(EnrollmentSuspension).where(*filters)
    )
    rows = (
        await db.scalars(
            select(EnrollmentSuspension)
            .where(*filters)
            .order_by(
                EnrollmentSuspension.suspended_from.desc(),
                EnrollmentSuspension.id.desc(),
            )
            .offset(offset)
            .limit(limit)
        )
    ).all()
    pending = sum(
        days for _, days in await pending_service_credits(db, str(enrollment_id))
    )
    return EnrollmentSuspensionList(
        items=rows, total=int(total or 0), pending_days=pending
    )
