"""Read-only impact preview for assign/supplement/transfer commands."""

import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.billing_schedule import (
    cycle_base_due_date,
    cycle_coverage_interval,
    first_actionable_cycle,
)
from app.core.business_time import business_today
from app.core.class_lifecycle import operational_class_predicate
from app.models.class_ import Class
from app.models.class_schedule_slot import ClassScheduleSlot
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.student import Student
from app.schemas.student import (
    StudentMembershipPreviewRequest,
    StudentMembershipPreviewResponse,
    StudentMembershipPreviewWarning,
    StudentMembershipSourceImpact,
    StudentMembershipTargetImpact,
)
from app.services.enrollment_guard import ensure_enrollment_allowed
from app.services.enrollment_service import (
    _ensure_student_schedule_available,
    resolve_enrollment_date,
)
from app.services.fee_reconciliation import is_fee_record_protected


def _conflict(code: str, message: str, **context: object) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": code, "message": message, **context},
        headers={"Cache-Control": "no-store"},
    )


def _preview_hash(payload: dict[str, object]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def preview_student_membership(
    db: AsyncSession,
    student_id: UUID,
    request: StudentMembershipPreviewRequest,
) -> StudentMembershipPreviewResponse | None:
    """Validate and price a membership command without writing any row."""

    student = await db.scalar(select(Student).where(Student.id == str(student_id)))
    if student is None:
        return None
    if student.status == "archived":
        raise _conflict(
            "STUDENT_ARCHIVED", "Hãy khôi phục hồ sơ trước khi thay đổi lớp"
        )
    if student.updated_at != request.expected_updated_at:
        raise _conflict(
            "STUDENT_CHANGED",
            "Hồ sơ vừa được thay đổi. Vui lòng tải lại trước khi tiếp tục.",
        )

    class_ids = sorted({str(target.class_id) for target in request.targets})
    classes = list(
        (
            await db.scalars(
                select(Class)
                .where(Class.id.in_(class_ids), operational_class_predicate())
                .order_by(Class.id)
            )
        ).all()
    )
    class_by_id = {class_.id: class_ for class_ in classes}
    if len(class_by_id) != len(class_ids):
        raise _conflict(
            "TARGET_CLASS_UNAVAILABLE",
            "Một lớp được chọn không còn mở để ghi danh.",
        )

    source: Enrollment | None = None
    if request.source_enrollment_id is not None:
        source = await db.scalar(
            select(Enrollment)
            .where(
                Enrollment.id == str(request.source_enrollment_id),
                Enrollment.student_id == str(student_id),
            )
            .options(selectinload(Enrollment.class_))
        )
        if source is None or source.status != "active" or source.ended_on is not None:
            raise _conflict(
                "SOURCE_MEMBERSHIP_CHANGED",
                "Lớp nguồn của học viên không còn hợp lệ.",
            )

    today = business_today()
    warnings: list[StudentMembershipPreviewWarning] = []
    target_impacts: list[StudentMembershipTargetImpact] = []
    fingerprint_targets: list[dict[str, object]] = []
    source_impact: StudentMembershipSourceImpact | None = None
    protected_overlap_count = 0

    resolved_targets: list[tuple[object, Class, date, list[str]]] = []
    for target in request.targets:
        class_ = class_by_id[str(target.class_id)]
        resolved = resolve_enrollment_date(class_, target.enrollment_date)
        await ensure_enrollment_allowed(db, class_, resolved)
        if source is not None:
            if source.class_id == class_.id:
                raise _conflict(
                    "TRANSFER_SAME_CLASS",
                    "Lớp đích phải khác lớp nguồn.",
                    class_id=class_.id,
                )
            if source.enrollment_date is None or resolved <= source.enrollment_date:
                raise _conflict(
                    "TRANSFER_BEFORE_SOURCE_START",
                    "Ngày chuyển lớp phải sau ngày bắt đầu của lớp nguồn.",
                    class_id=class_.id,
                    field="enrollment_date",
                )

        target_end = class_.stopped_on or date.max
        duplicate = await db.scalar(
            select(Enrollment.id).where(
                Enrollment.student_id == str(student_id),
                Enrollment.class_id == class_.id,
                Enrollment.status != "cancelled",
                Enrollment.enrollment_date < target_end,
                or_(Enrollment.ended_on.is_(None), Enrollment.ended_on > resolved),
                *(
                    [Enrollment.id != source.id]
                    if source is not None
                    else []
                ),
            )
        )
        if duplicate is not None:
            raise _conflict(
                "TARGET_ALREADY_ACTIVE",
                "Học viên đã có khoảng học còn hiệu lực trong lớp này.",
                class_id=class_.id,
            )

        selected_ids = (
            [str(slot_id) for slot_id in target.selected_slot_ids]
            if target.selected_slot_ids is not None
            else list(
                (
                    await db.scalars(
                        select(ClassScheduleSlot.id).where(
                            ClassScheduleSlot.class_id == class_.id,
                            ClassScheduleSlot.effective_from <= resolved,
                            or_(
                                ClassScheduleSlot.effective_until.is_(None),
                                ClassScheduleSlot.effective_until > resolved,
                            ),
                        )
                    )
                ).all()
            )
        )
        if target.selected_slot_ids is not None:
            valid_count = await db.scalar(
                select(func.count(ClassScheduleSlot.id))
                .where(
                    ClassScheduleSlot.id.in_(selected_ids),
                    ClassScheduleSlot.class_id == class_.id,
                    ClassScheduleSlot.effective_from <= resolved,
                    or_(
                        ClassScheduleSlot.effective_until.is_(None),
                        ClassScheduleSlot.effective_until > resolved,
                    ),
                )
            )
            # The full cardinality is checked by the shared schedule guard.
            if int(valid_count or 0) != len(set(selected_ids)):
                raise _conflict(
                    "SLOT_NOT_EFFECTIVE_ON_DATE",
                    "Buổi học được chọn không có hiệu lực tại ngày bắt đầu.",
                    class_id=class_.id,
                )
        await _ensure_student_schedule_available(
            db,
            student_id=str(student_id),
            class_=class_,
            selected_slot_ids=selected_ids,
            enrollment_id=None,
            effective_from=resolved,
            excluded_enrollment_ids={source.id} if source is not None else None,
        )
        resolved_targets.append((target, class_, resolved, selected_ids))

    target_slot_objs_by_class: dict[str, list[ClassScheduleSlot]] = {}
    for target, class_, resolved, selected_ids in resolved_targets:
        slots = list(
            (
                await db.scalars(
                    select(ClassScheduleSlot).where(
                        ClassScheduleSlot.id.in_(selected_ids),
                        ClassScheduleSlot.class_id == class_.id,
                    )
                )
            ).all()
        )
        target_slot_objs_by_class[class_.id] = slots

    # Kiểm tra xung đột lịch học giữa chính các lớp đích đang chọn
    for i in range(len(resolved_targets)):
        for j in range(i + 1, len(resolved_targets)):
            _, class_i, start_i, _ = resolved_targets[i]
            _, class_j, start_j, _ = resolved_targets[j]

            end_i = class_i.stopped_on or date.max
            end_j = class_j.stopped_on or date.max

            # 1. Khoảng ghi danh của hai lớp có giao nhau
            if start_i < end_j and start_j < end_i:
                slots_i = target_slot_objs_by_class.get(class_i.id, [])
                slots_j = target_slot_objs_by_class.get(class_j.id, [])
                for s_i in slots_i:
                    slot_i_end = s_i.effective_until or date.max
                    for s_j in slots_j:
                        slot_j_end = s_j.effective_until or date.max
                        # 2. Khoảng hiệu lực của hai slot có giao nhau
                        if s_i.effective_from < slot_j_end and s_j.effective_from < slot_i_end:
                            # 3. Cùng thứ trong tuần
                            if s_i.weekday == s_j.weekday:
                                # 4. Giờ học giao nhau (strict < để 2 ca liền kề không bị coi là trùng)
                                if s_i.local_start < s_j.local_end and s_j.local_start < s_i.local_end:
                                    raise HTTPException(
                                        status_code=status.HTTP_409_CONFLICT,
                                        detail={
                                            "code": "TARGET_SCHEDULE_CONFLICT",
                                            "message": (
                                                f"Buổi {s_i.weekday} {s_i.local_start:%H:%M}–{s_i.local_end:%H:%M} "
                                                f"của lớp {class_i.name} trùng lịch với lớp {class_j.name}"
                                            ),
                                            "class_id": class_i.id,
                                            "conflicting_class_id": class_j.id,
                                        },
                                        headers={"Cache-Control": "no-store"},
                                    )

    source_records: list[FeeRecord] = []
    if source is not None:
        transfer_on = resolved_targets[0][2]
        source_records = list(
            (
                await db.scalars(
                    select(FeeRecord).where(
                        FeeRecord.enrollment_id == source.id,
                        FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
                    )
                )
            ).all()
        )
        mutable_count = sum(
            1
            for record in source_records
            if not is_fee_record_protected(record)
            and (record.coverage_start or record.base_due_date or record.due_date)
            >= transfer_on
        )
        protected_overlap_count = sum(
            1
            for record in source_records
            if is_fee_record_protected(record)
            and (record.coverage_end is None or record.coverage_end > transfer_on)
        )
        source_impact = StudentMembershipSourceImpact(
            enrollment_id=UUID(source.id),
            class_id=UUID(source.class_id),
            class_name=source.class_.name,
            ends_on=transfer_on,
            mutable_fee_count=mutable_count,
            protected_fee_count=protected_overlap_count,
        )
        if protected_overlap_count:
            warnings.append(
                StudentMembershipPreviewWarning(
                    code="PROTECTED_FEE_OVERLAP",
                    message=(
                        "Lớp nguồn có khoản đã báo hoặc có giao dịch giao với ngày chuyển; "
                        "học phí lớp đích sẽ chờ rà soát."
                    ),
                    class_id=UUID(source.class_id),
                )
            )

    for target, class_, resolved, selected_ids in resolved_targets:
        if target.enrollment_date is None:  # guarded by schema; keeps type explicit
            raise AssertionError("preview target date was not validated")
        billing_type = class_.type
        weeks = (
            max(int(class_.billing_cycle_weeks or 1), 1)
            if billing_type == "COURSE"
            else None
        )
        anchor_cycle = first_actionable_cycle(
            resolved, billing_type, weeks, today=today
        )
        due = cycle_base_due_date(resolved, billing_type, weeks, anchor_cycle)
        coverage_start, coverage_end = cycle_coverage_interval(
            resolved, billing_type, weeks, anchor_cycle
        )
        review_required = resolved < today or protected_overlap_count > 0
        amount = int(target.custom_fee) if target.custom_fee is not None else int(class_.base_fee)
        target_impacts.append(
            StudentMembershipTargetImpact(
                class_id=UUID(class_.id),
                class_name=class_.name,
                requested_start=target.enrollment_date,
                resolved_start=resolved,
                effective_fee=amount,
                billing_type=billing_type,
                billing_cycle_weeks=weeks,
                first_due_date=due,
                coverage_start=coverage_start,
                coverage_end=coverage_end,
                skipped_cycle_count=anchor_cycle,
                review_required=review_required,
            )
        )
        if anchor_cycle:
            warnings.append(
                StudentMembershipPreviewWarning(
                    code="HISTORICAL_CYCLES_SKIPPED",
                    message=f"Đã bỏ qua {anchor_cycle} kỳ lịch sử; không tự động truy thu.",
                    class_id=UUID(class_.id),
                )
            )
        if resolved > today:
            warnings.append(
                StudentMembershipPreviewWarning(
                    code="FUTURE_START",
                    message=f"Học viên sẽ bắt đầu lớp từ {resolved:%d/%m/%Y}.",
                    class_id=UUID(class_.id),
                )
            )
        slots_snapshot = [
            {
                "slot_id": str(s.id),
                "version": getattr(s, "version", 1),
                "weekday": s.weekday,
                "local_start": str(s.local_start),
                "local_end": str(s.local_end),
                "effective_from": str(s.effective_from),
                "effective_until": str(s.effective_until) if s.effective_until else None,
            }
            for s in sorted(target_slot_objs_by_class.get(class_.id, []), key=lambda x: str(x.id))
        ]
        fingerprint_targets.append(
            {
                "class_id": class_.id,
                "requested_start": target.enrollment_date,
                "resolved_start": resolved,
                "custom_fee": target.custom_fee,
                "selected_slot_ids": sorted(selected_ids),
                "slots_snapshot": slots_snapshot,
                "class_start": class_.start_date,
                "class_stopped_on": class_.stopped_on,
                "base_fee": int(class_.base_fee),
                "billing_type": billing_type,
                "billing_cycle_weeks": weeks,
                "first_due_date": due,
                "coverage_start": coverage_start,
                "coverage_end": coverage_end,
                "skipped_cycle_count": anchor_cycle,
                "review_required": review_required,
                "effective_fee": amount,
            }
        )

    enrollment_update_impacts: list[dict[str, object]] = []
    fingerprint_updates: list[dict[str, object]] = []
    if request.enrollment_updates:
        from app.services.billing_decision_service import compute_billing_decisions_for_enrollment
        for upd in request.enrollment_updates:
            enr = await db.scalar(
                select(Enrollment)
                .where(Enrollment.id == str(upd.enrollment_id), Enrollment.student_id == str(student_id))
                .options(
                    selectinload(Enrollment.class_),
                    selectinload(Enrollment.fee_records).selectinload(FeeRecord.payments),
                    selectinload(Enrollment.billing_anchor_revisions),
                )
            )
            if enr is None or enr.status != "active":
                continue
            active_fees = [f for f in enr.fee_records if f.status not in ("VOID", "SUPERSEDED")]
            protected_fees = [f for f in active_fees if is_fee_record_protected(f)]
            current_protected_fees = [
                f for f in protected_fees
                if f.coverage_end is None or f.coverage_end >= today
            ]

            resolved_enr_date = enr.enrollment_date
            if upd.enrollment_date is not None:
                resolved_enr_date = resolve_enrollment_date(enr.class_, upd.enrollment_date)
                await ensure_enrollment_allowed(db, enr.class_, resolved_enr_date)

            effective_fee = (
                int(upd.custom_fee)
                if upd.custom_fee is not None
                else (int(enr.custom_fee) if enr.custom_fee is not None else int(enr.class_.base_fee))
            )

            decisions = compute_billing_decisions_for_enrollment(
                old_enrollment_date=enr.enrollment_date or enr.class_.start_date or resolved_enr_date,
                new_enrollment_date=resolved_enr_date,
                billing_type=enr.class_.type,
                cycle_weeks=enr.class_.billing_cycle_weeks,
                effective_fee=effective_fee,
                fee_records=active_fees,
                today=today,
            )
            rec_dec = next((d.decision_code.value for d in decisions if d.recommended), "REANCHOR_NEXT_BOUNDARY")
            enrollment_update_impacts.append(
                {
                    "enrollment_id": str(enr.id),
                    "student_id": str(student_id),
                    "student_name": student.full_name,
                    "class_id": str(enr.class_id),
                    "class_name": enr.class_.name,
                    "old_enrollment_date": enr.enrollment_date.isoformat() if enr.enrollment_date else None,
                    "new_enrollment_date": resolved_enr_date.isoformat(),
                    "must_change": False,
                    "decisions": [d.model_dump(mode="json") for d in decisions],
                    "recommended_decision": upd.decision_code or rec_dec,
                    "protected_fee_count": len(current_protected_fees),
                    "mutable_fee_count": len(active_fees) - len(protected_fees),
                }
            )
            fingerprint_updates.append(
                {
                    "enrollment_id": str(enr.id),
                    "requested_date": upd.enrollment_date.isoformat() if upd.enrollment_date else None,
                    "resolved_date": resolved_enr_date.isoformat(),
                    "custom_fee": upd.custom_fee,
                    "selected_slot_ids": sorted(str(s) for s in (upd.selected_slot_ids or [])),
                    "decision_code": upd.decision_code or rec_dec,
                    "selected_historical_cycles": sorted(upd.selected_historical_cycles or []),
                    "version": enr.billing_anchor_version,
                }
            )

    source_records_snapshot = [
        {
            "id": str(r.id),
            "status": r.status,
            "final_amount": int(r.final_amount) if r.final_amount is not None else None,
            "paid_amount": int(r.paid_amount) if r.paid_amount is not None else None,
            "refunded_amount": int(r.refunded_amount) if r.refunded_amount is not None else None,
            "notified_at": r.notified_at.isoformat() if r.notified_at else None,
            "due_date": str(r.due_date) if r.due_date else None,
            "base_due_date": str(r.base_due_date) if r.base_due_date else None,
            "coverage_start": str(r.coverage_start) if r.coverage_start else None,
            "coverage_end": str(r.coverage_end) if r.coverage_end else None,
            "is_protected": is_fee_record_protected(r),
        }
        for r in sorted(source_records, key=lambda x: str(x.id))
    ]

    fingerprint_dict: dict[str, object] = {
        "business_today": today,
        "student_id": str(student_id),
        "student_updated_at": student.updated_at,
        "mode": request.mode,
        "source": {
            "id": source.id,
            "status": source.status,
            "enrollment_date": source.enrollment_date,
            "ended_on": source.ended_on,
            "billing_anchor_version": source.billing_anchor_version,
            "ends_on": transfer_on,
            "mutable_fee_count": mutable_count,
            "protected_fee_count": protected_overlap_count,
            "records": source_records_snapshot,
        }
        if source is not None
        else None,
        "targets": sorted(fingerprint_targets, key=lambda x: str(x["class_id"])),
        "protected_overlap_count": protected_overlap_count,
    }
    if fingerprint_updates:
        fingerprint_dict["enrollment_updates"] = sorted(fingerprint_updates, key=lambda x: str(x["enrollment_id"]))

    fingerprint = _preview_hash(fingerprint_dict)
    return StudentMembershipPreviewResponse(
        preview_fingerprint=fingerprint,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        student_updated_at=student.updated_at,
        targets=target_impacts,
        source=source_impact,
        warnings=warnings,
        enrollment_updates=enrollment_update_impacts,
    )
