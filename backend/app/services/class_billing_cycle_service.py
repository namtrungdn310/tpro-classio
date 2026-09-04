from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.billing_schedule import (
    adjusted_due_after_deferral,
    cycle_coverage_interval,
    period_key,
)
from app.core.business_time import business_today
from app.models.billing_anchor_revision import BillingAnchorRevision
from app.models.class_ import Class
from app.models.class_billing_cycle_revision import ClassBillingCycleRevision
from app.models.class_lifecycle_event import ClassLifecycleEvent
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.payment_request import PaymentRequest, PaymentRequestItem
from app.schemas.class_ import (
    ClassBillingCyclePreviewRequest,
    ClassBillingCyclePreviewResponse,
    ClassBillingCycleStudentImpact,
    ClassBillingCycleUpdate,
    ClassBillingCycleUpdateResponse,
)
from app.services.credit_service import enrollment_total_deferral_days
from app.services.fee_operation_service import (
    append_fee_operation,
    snapshot_fee_record,
)
from app.services.payment_scaffold_service import (
    revoke_open_payment_requests_for_fee_records,
)


@dataclass
class _EnrollmentImpact:
    enrollment: Enrollment
    transition_on: date
    previous_next_due_date: date
    protected: list[FeeRecord]
    supersedable: list[FeeRecord]


def _is_protected(record: FeeRecord) -> bool:
    return bool(
        record.status == "PAID"
        or record.notified_at is not None
        or int(record.refunded_amount or 0) > 0
    )


def _old_weeks(enrollment: Enrollment, fallback: int) -> int:
    revision = enrollment.current_billing_revision
    if revision is not None and revision.billing_type_snapshot == "COURSE":
        return max(int(revision.billing_cycle_weeks_snapshot or fallback), 1)
    return max(int(fallback), 1)


def _old_anchor(enrollment: Enrollment) -> date:
    revision = enrollment.current_billing_revision
    if revision is not None:
        return revision.anchor_date
    if enrollment.enrollment_date is None:
        raise ValueError("Học viên chưa có ngày bắt đầu")
    return enrollment.enrollment_date


def _next_boundary(anchor: date, weeks: int, today: date) -> date:
    if anchor > today:
        return anchor
    package_days = weeks * 7
    package_no = (today - anchor).days // package_days
    return anchor + timedelta(days=(package_no + 1) * package_days)


def _impact_for_enrollment(
    enrollment: Enrollment,
    *,
    previous_weeks: int,
    today: date,
) -> _EnrollmentImpact:
    records = [
        record
        for record in enrollment.fee_records
        if record.status not in {"VOID", "SUPERSEDED"}
    ]
    protected = [record for record in records if _is_protected(record)]
    transition = _next_boundary(
        _old_anchor(enrollment),
        _old_weeks(enrollment, previous_weeks),
        today,
    )
    protected_through = max(
        (record.coverage_end for record in protected if record.coverage_end),
        default=None,
    )
    if protected_through is not None and protected_through > transition:
        transition = protected_through

    supersedable = [
        record
        for record in records
        if not _is_protected(record)
        and (record.coverage_start or record.base_due_date or record.due_date)
        is not None
        and (record.coverage_start or record.base_due_date or record.due_date)
        >= transition
    ]
    previous_next = min(
        (
            record.adjusted_due_date or record.due_date
            for record in records
            if (record.adjusted_due_date or record.due_date) is not None
            and (record.adjusted_due_date or record.due_date) >= today
        ),
        default=transition,
    )
    return _EnrollmentImpact(
        enrollment=enrollment,
        transition_on=transition,
        previous_next_due_date=previous_next,
        protected=protected,
        supersedable=supersedable,
    )


async def _load_class(
    db: AsyncSession,
    class_id: UUID,
    *,
    lock: bool,
) -> Class | None:
    statement = (
        select(Class)
        .where(Class.id == str(class_id))
        .options(
            selectinload(Class.enrollments).selectinload(Enrollment.student),
            selectinload(Class.enrollments).selectinload(Enrollment.fee_records),
            selectinload(Class.enrollments).selectinload(
                Enrollment.current_billing_revision
            ),
        )
    )
    if lock:
        statement = statement.with_for_update()
    return (await db.execute(statement)).scalars().unique().one_or_none()


def _validate_change(class_: Class, request: ClassBillingCyclePreviewRequest) -> None:
    if class_.version != request.expected_version:
        raise ValueError("Dữ liệu lớp vừa được cập nhật. Vui lòng tải lại rồi thử lại")
    if class_.type != "COURSE":
        raise ValueError("Chỉ lớp thu học phí theo gói mới có thời lượng gói")
    if (
        not class_.is_active
        or class_.cancelled_at is not None
        or class_.completed_at is not None
        or class_.stopped_at is not None
    ):
        raise ValueError("Không thể đổi thời lượng gói của lớp đã ngừng hoặc đã hủy")
    if int(class_.billing_cycle_weeks or 0) == request.billing_cycle_weeks:
        raise ValueError("Thời lượng gói mới đang trùng với thời lượng hiện tại")


def _fingerprint(
    class_: Class,
    *,
    next_weeks: int,
    impacts: list[_EnrollmentImpact],
) -> str:
    payload = {
        "class_id": class_.id,
        "version": class_.version,
        "previous_weeks": class_.billing_cycle_weeks,
        "next_weeks": next_weeks,
        "enrollments": [
            {
                "id": impact.enrollment.id,
                "billing_anchor_version": impact.enrollment.billing_anchor_version,
                "transition_on": impact.transition_on.isoformat(),
                "protected": sorted(record.id for record in impact.protected),
                "supersedable": sorted(record.id for record in impact.supersedable),
            }
            for impact in sorted(impacts, key=lambda value: value.enrollment.id)
        ],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _build_preview(
    db: AsyncSession,
    class_: Class,
    request: ClassBillingCyclePreviewRequest,
) -> tuple[ClassBillingCyclePreviewResponse, list[_EnrollmentImpact]]:
    _validate_change(class_, request)
    active = [row for row in class_.enrollments if row.status == "active"]
    enrollment_ids = [row.id for row in active]
    pending_count = 0
    if enrollment_ids:
        pending_count = int(
            await db.scalar(
                select(func.count(BillingAnchorRevision.id)).where(
                    BillingAnchorRevision.enrollment_id.in_(enrollment_ids),
                    BillingAnchorRevision.state == "PENDING",
                )
            )
            or 0
        )
    if pending_count:
        raise ValueError(
            "Lớp còn lịch thu đang chờ kiểm tra. Hãy xử lý xong trước khi đổi thời lượng gói"
        )

    today = business_today()
    previous_weeks = max(int(class_.billing_cycle_weeks or 1), 1)
    impacts = [
        _impact_for_enrollment(
            enrollment,
            previous_weeks=previous_weeks,
            today=today,
        )
        for enrollment in active
        if enrollment.enrollment_date is not None
    ]
    mutable_ids = [record.id for impact in impacts for record in impact.supersedable]
    open_request_count = 0
    if mutable_ids:
        open_request_count = int(
            await db.scalar(
                select(func.count(func.distinct(PaymentRequest.id)))
                .join(
                    PaymentRequestItem,
                    PaymentRequestItem.payment_request_id == PaymentRequest.id,
                )
                .where(
                    PaymentRequest.status == "OPEN",
                    PaymentRequestItem.fee_record_id.in_(mutable_ids),
                )
            )
            or 0
        )
    periods = sorted(
        {
            record.period
            for impact in impacts
            for record in impact.supersedable
            if record.period
        }
        | {impact.transition_on.strftime("%Y-%m") for impact in impacts}
    )
    students = [
        ClassBillingCycleStudentImpact(
            enrollment_id=impact.enrollment.id,
            student_id=impact.enrollment.student_id,
            student_name=impact.enrollment.student.full_name,
            student_code=impact.enrollment.student.student_code,
            transition_on=impact.transition_on,
            previous_next_due_date=impact.previous_next_due_date,
            next_due_date=impact.transition_on,
            protected_fee_count=len(impact.protected),
            superseded_fee_count=len(impact.supersedable),
        )
        for impact in impacts
    ]
    preview = ClassBillingCyclePreviewResponse(
        class_id=class_.id,
        previous_weeks=previous_weeks,
        next_weeks=request.billing_cycle_weeks,
        affected_enrollment_count=len(impacts),
        retained_current_cycle_count=sum(
            1
            for impact in impacts
            if impact.enrollment.enrollment_date <= today < impact.transition_on
        ),
        superseded_fee_count=len(mutable_ids),
        protected_fee_count=sum(len(impact.protected) for impact in impacts),
        open_payment_request_count=open_request_count,
        pending_review_count=len(impacts),
        affected_periods=periods,
        students=students,
        version=class_.version,
        preview_fingerprint=_fingerprint(
            class_, next_weeks=request.billing_cycle_weeks, impacts=impacts
        ),
        preview_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    return preview, impacts


async def preview_class_billing_cycle(
    db: AsyncSession,
    class_id: UUID,
    request: ClassBillingCyclePreviewRequest,
) -> ClassBillingCyclePreviewResponse | None:
    class_ = await _load_class(db, class_id, lock=False)
    if class_ is None:
        return None
    preview, _ = await _build_preview(db, class_, request)
    return preview


async def update_class_billing_cycle(
    db: AsyncSession,
    class_id: UUID,
    request: ClassBillingCycleUpdate,
    *,
    actor_user_id: str | None,
) -> ClassBillingCycleUpdateResponse | None:
    existing = await db.scalar(
        select(ClassBillingCycleRevision).where(
            ClassBillingCycleRevision.request_id == str(request.request_id)
        )
    )
    if existing is not None:
        from app.services.class_service import get_class_response

        response = await get_class_response(db, UUID(existing.class_id))
        if response is None:
            return None
        return ClassBillingCycleUpdateResponse(
            revision_id=existing.id,
            previous_weeks=existing.previous_weeks,
            next_weeks=existing.next_weeks,
            affected_enrollment_count=existing.affected_enrollment_count,
            superseded_fee_count=existing.superseded_fee_count,
            protected_fee_count=existing.protected_fee_count,
            revoked_payment_request_count=existing.revoked_payment_request_count,
            pending_review_count=(
                existing.affected_enrollment_count if existing.state == "PENDING" else 0
            ),
            affected_periods=[],
            class_=response,
        )

    class_ = await _load_class(db, class_id, lock=True)
    if class_ is None:
        return None
    preview, impacts = await _build_preview(db, class_, request)
    if preview.preview_fingerprint != request.expected_fingerprint:
        raise ValueError(
            "Dữ liệu học phí vừa được cập nhật. Vui lòng xem trước lại rồi thử lại"
        )

    now = datetime.now(timezone.utc)
    revision = ClassBillingCycleRevision(
        class_id=class_.id,
        previous_weeks=preview.previous_weeks,
        next_weeks=preview.next_weeks,
        state="PENDING" if impacts else "CONFIRMED",
        reason=request.reason,
        request_id=str(request.request_id),
        class_version_before=class_.version,
        class_version_after=class_.version + 1,
        affected_enrollment_count=len(impacts),
        superseded_fee_count=preview.superseded_fee_count,
        protected_fee_count=preview.protected_fee_count,
        effective_on=min(
            (impact.transition_on for impact in impacts), default=business_today()
        ),
        actor_user_id=actor_user_id,
        resolved_by=actor_user_id if not impacts else None,
        resolved_at=now if not impacts else None,
        resolution_note="Không có học viên đang học" if not impacts else None,
    )
    db.add(revision)
    await db.flush()

    before_snapshots = []
    after_snapshots = []
    all_mutable_ids = [
        record.id for impact in impacts for record in impact.supersedable
    ]
    revoked_count = await revoke_open_payment_requests_for_fee_records(
        db,
        all_mutable_ids,
        actor_id=actor_user_id,
        reason="Thời lượng gói đã thay đổi; lịch thu tương lai cũ không còn hiệu lực",
    )
    revision.revoked_payment_request_count = revoked_count

    for impact in impacts:
        enrollment = impact.enrollment
        before_snapshots.extend(
            snapshot_fee_record(record) for record in impact.supersedable
        )
        for record in impact.supersedable:
            record.status = "SUPERSEDED"
            record.superseded_at = now
            record.voided_at = now
        after_snapshots.extend(
            snapshot_fee_record(record) for record in impact.supersedable
        )

        sequence = int(enrollment.billing_anchor_version or 0) + 1
        anchor_revision = BillingAnchorRevision(
            enrollment_id=enrollment.id,
            sequence_no=sequence,
            previous_anchor_date=_old_anchor(enrollment),
            anchor_date=impact.transition_on,
            effective_on=business_today(),
            generation_floor=impact.transition_on,
            first_anchor_cycle_no=0,
            next_due_date=impact.transition_on,
            change_kind="PACKAGE_DURATION_CHANGE",
            billing_type_snapshot="COURSE",
            billing_cycle_months_snapshot=class_.billing_cycle_months,
            billing_cycle_weeks_snapshot=preview.next_weeks,
            class_billing_cycle_revision_id=revision.id,
            state="PENDING",
            reason=request.reason,
            request_id=str(uuid4()),
            actor_user_id=actor_user_id,
        )
        db.add(anchor_revision)
        await db.flush()

        max_cycle = await db.scalar(
            select(func.max(FeeRecord.cycle_no)).where(
                FeeRecord.enrollment_id == enrollment.id
            )
        )
        global_cycle = (int(max_cycle) if max_cycle is not None else -1) + 1
        coverage_start, coverage_end = cycle_coverage_interval(
            impact.transition_on, "COURSE", preview.next_weeks, 0
        )
        deferral = await enrollment_total_deferral_days(db, enrollment.id)
        amount = int(
            enrollment.custom_fee
            if enrollment.custom_fee is not None
            else class_.base_fee
        )
        new_record = FeeRecord(
            enrollment_id=enrollment.id,
            billing_revision_id=anchor_revision.id,
            anchor_cycle_no=0,
            review_required=True,
            period=period_key(impact.transition_on) or "0000-00",
            due_date=impact.transition_on,
            cycle_no=global_cycle,
            base_due_date=impact.transition_on,
            adjusted_due_date=adjusted_due_after_deferral(
                impact.transition_on, deferral
            ),
            coverage_start=coverage_start,
            coverage_end=coverage_end,
            origin="PACKAGE_DURATION_CHANGE",
            enrollment_date_snapshot=enrollment.enrollment_date,
            student_name_snapshot=enrollment.student.full_name,
            class_name_snapshot=class_.name,
            class_type_snapshot="COURSE",
            billing_cycle_months_snapshot=class_.billing_cycle_months,
            billing_cycle_weeks_snapshot=preview.next_weeks,
            base_amount=amount,
            discount_amount=0,
            status="UNPAID",
        )
        new_record.enrollment = enrollment
        db.add(new_record)
        await db.flush()
        for record in impact.supersedable:
            record.superseded_by_record_id = new_record.id

        before_snapshots.append(None)
        after_snapshots.append(snapshot_fee_record(new_record))
        enrollment.current_billing_revision_id = anchor_revision.id
        enrollment.current_billing_revision = anchor_revision
        enrollment.billing_anchor_version = sequence

    class_.billing_cycle_weeks = preview.next_weeks
    class_.version += 1
    db.add(
        ClassLifecycleEvent(
            class_id=class_.id,
            event_type="billing_cycle_changed",
            previous_billing_cycle_weeks=preview.previous_weeks,
            next_billing_cycle_weeks=preview.next_weeks,
            reason=request.reason,
            actor_user_id=actor_user_id,
            request_id=str(request.request_id),
            business_date=business_today(),
        )
    )
    if before_snapshots:
        await append_fee_operation(
            db,
            action="billing_cycle_change",
            before=before_snapshots,
            after=after_snapshots,
            actor_id=actor_user_id,
            request_id=request.request_id,
            reason=request.reason,
            origin="system",
        )
    await db.commit()

    from app.services.class_service import get_class_response

    response = await get_class_response(db, class_id)
    assert response is not None
    return ClassBillingCycleUpdateResponse(
        revision_id=revision.id,
        previous_weeks=preview.previous_weeks,
        next_weeks=preview.next_weeks,
        affected_enrollment_count=len(impacts),
        superseded_fee_count=preview.superseded_fee_count,
        protected_fee_count=preview.protected_fee_count,
        revoked_payment_request_count=revoked_count,
        pending_review_count=len(impacts),
        affected_periods=preview.affected_periods,
        class_=response,
    )
