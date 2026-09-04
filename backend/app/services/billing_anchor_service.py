from datetime import date, datetime, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.billing_schedule import (
    adjusted_due_after_deferral,
    cycle_base_due_date,
    cycle_coverage_interval,
    first_actionable_cycle,
    period_key,
)
from app.core.business_time import business_today
from app.models.billing_anchor_revision import BillingAnchorRevision
from app.models.class_billing_cycle_revision import ClassBillingCycleRevision
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.schemas.billing_anchor import (
    BillingAnchorImpactResponse,
    BillingReviewFeeResponse,
    BillingReviewListResponse,
    BillingReviewResolveRequest,
    BillingReviewResponse,
)


def _billing_type(enrollment: Enrollment) -> str:
    revision = enrollment.__dict__.get("current_billing_revision")
    if revision is not None and getattr(revision, "billing_type_snapshot", None):
        return revision.billing_type_snapshot
    return enrollment.class_.type


def _cycle_weeks(enrollment: Enrollment) -> int | None:
    if _billing_type(enrollment) != "COURSE":
        return None
    revision = enrollment.__dict__.get("current_billing_revision")
    if revision is not None and getattr(revision, "billing_cycle_weeks_snapshot", None):
        return max(int(revision.billing_cycle_weeks_snapshot), 1)
    return max(int(enrollment.class_.billing_cycle_weeks or 1), 1)


def _is_protected(record: FeeRecord) -> bool:
    return bool(
        record.status == "PAID"
        or record.notified_at is not None
        or int(record.refunded_amount or 0) > 0
    )


async def _resolve_class_cycle_revision_if_complete(
    db: AsyncSession,
    class_revision_id: str,
    *,
    actor_user_id: str | None,
) -> None:
    await db.flush()
    pending = await db.scalar(
        select(BillingAnchorRevision.id).where(
            BillingAnchorRevision.class_billing_cycle_revision_id == class_revision_id,
            BillingAnchorRevision.state == "PENDING",
        )
    )
    if pending is not None:
        return
    class_revision = await db.get(
        ClassBillingCycleRevision,
        class_revision_id,
        with_for_update=True,
    )
    if class_revision is None or class_revision.state != "PENDING":
        return
    class_revision.state = "CONFIRMED"
    class_revision.resolved_by = actor_user_id
    class_revision.resolved_at = datetime.now(timezone.utc)
    class_revision.resolution_note = (
        "Đã kiểm tra toàn bộ lịch thu sau khi đổi thời lượng gói"
    )


async def ensure_initial_billing_revision(
    db: AsyncSession,
    enrollment: Enrollment,
    *,
    actor_user_id: str | None = None,
    force_review: bool = False,
    change_kind: str | None = None,
    reason: str | None = None,
) -> BillingAnchorRevision:
    """Create the confirmed baseline used by all newly created enrollments."""

    current = enrollment.__dict__.get("current_billing_revision")
    if current is not None:
        return current
    if enrollment.current_billing_revision_id:
        loaded = await db.get(
            BillingAnchorRevision, enrollment.current_billing_revision_id
        )
        if loaded is not None:
            enrollment.current_billing_revision = loaded
            return loaded
    if enrollment.enrollment_date is None:
        raise ValueError("enrollment date is required for billing")
    now = datetime.now(timezone.utc)
    today = business_today()
    billing_type = enrollment.class_.type
    cycle_weeks = (
        max(int(enrollment.class_.billing_cycle_weeks or 1), 1)
        if billing_type == "COURSE"
        else None
    )
    first_cycle = first_actionable_cycle(
        enrollment.enrollment_date,
        billing_type,
        cycle_weeks,
        today=today,
    )
    next_due = cycle_base_due_date(
        enrollment.enrollment_date,
        billing_type,
        cycle_weeks,
        first_cycle,
    )
    needs_review = force_review or enrollment.enrollment_date < today
    revision = BillingAnchorRevision(
        enrollment_id=enrollment.id,
        sequence_no=int(enrollment.billing_anchor_version or 0),
        previous_anchor_date=None,
        anchor_date=enrollment.enrollment_date,
        effective_on=today if needs_review else enrollment.enrollment_date,
        generation_floor=max(today, enrollment.enrollment_date),
        first_anchor_cycle_no=first_cycle,
        next_due_date=next_due,
        change_kind=change_kind
        or ("INITIAL_BACKDATED" if enrollment.enrollment_date < today else "INITIAL"),
        billing_type_snapshot=billing_type,
        billing_cycle_months_snapshot=enrollment.class_.billing_cycle_months,
        billing_cycle_weeks_snapshot=(
            enrollment.class_.billing_cycle_weeks
            if enrollment.class_.type == "COURSE"
            else None
        ),
        state="PENDING" if needs_review else "CONFIRMED",
        reason=reason
        or (
            "Rà soát lịch thu do ngày ghi danh ở quá khứ"
            if enrollment.enrollment_date < today
            else "Khởi tạo lịch thu khi ghi danh"
        ),
        request_id=str(uuid4()),
        actor_user_id=actor_user_id,
        resolved_at=None if needs_review else now,
        resolution_note=None if needs_review else "Lịch thu ban đầu",
    )
    db.add(revision)
    await db.flush()
    enrollment.current_billing_revision_id = revision.id
    enrollment.current_billing_revision = revision
    await db.flush()
    return revision


async def reanchor_enrollment_billing(
    db: AsyncSession,
    enrollment: Enrollment,
    *,
    new_anchor: date,
    reason: str,
    actor_user_id: str | None,
    request_id: UUID | None = None,
    expected_version: int | None = None,
    decision_code: str | None = None,
    selected_historical_cycles: list[int] | None = None,
    command_item_id: str | None = None,
) -> BillingAnchorImpactResponse:
    """Atomically replace mutable projection and create one reviewable charge."""

    if enrollment.enrollment_date is None:
        enrollment.enrollment_date = new_anchor
        revision = await ensure_initial_billing_revision(db, enrollment)
        start, end = cycle_coverage_interval(
            revision.anchor_date,
            _billing_type(enrollment),
            _cycle_weeks(enrollment),
            revision.first_anchor_cycle_no,
        )
        return BillingAnchorImpactResponse(
            enrollment_id=UUID(enrollment.id),
            previous_date=enrollment.enrollment_date,
            next_date=new_anchor,
            next_due_date=revision.next_due_date,
            coverage_start=start,
            coverage_end=end,
            superseded_fee_count=0,
            protected_fee_count=0,
            skipped_cycle_count=0,
            review_id=None,
        )
    if new_anchor == enrollment.enrollment_date:
        revision = await ensure_initial_billing_revision(db, enrollment)
        start, end = cycle_coverage_interval(
            revision.anchor_date,
            _billing_type(enrollment),
            _cycle_weeks(enrollment),
            revision.first_anchor_cycle_no,
        )
        return BillingAnchorImpactResponse(
            enrollment_id=UUID(enrollment.id),
            previous_date=enrollment.enrollment_date,
            next_date=new_anchor,
            next_due_date=revision.next_due_date,
            coverage_start=start,
            coverage_end=end,
            superseded_fee_count=0,
            protected_fee_count=0,
            skipped_cycle_count=0,
            review_id=None,
        )
    if (
        expected_version is not None
        and expected_version != enrollment.billing_anchor_version
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ngày bắt đầu vừa được thay đổi. Vui lòng tải lại rồi thử lại.",
        )
    if enrollment.class_.start_date and new_anchor < enrollment.class_.start_date:
        raise HTTPException(
            status_code=422,
            detail="Ngày bắt đầu của học viên không được trước ngày lớp bắt đầu",
        )
    if enrollment.class_.stopped_on and new_anchor >= enrollment.class_.stopped_on:
        raise HTTPException(
            status_code=422,
            detail="Ngày bắt đầu phải trước ngày lớp ngừng hoạt động",
        )

    request_key = str(request_id or uuid4())
    existing = await db.scalar(
        select(BillingAnchorRevision).where(
            BillingAnchorRevision.request_id == request_key
        )
    )
    if existing is not None:
        start, end = cycle_coverage_interval(
            existing.anchor_date,
            existing.billing_type_snapshot,
            _cycle_weeks(enrollment),
            existing.first_anchor_cycle_no,
        )
        return BillingAnchorImpactResponse(
            enrollment_id=UUID(enrollment.id),
            previous_date=existing.previous_anchor_date or existing.anchor_date,
            next_date=existing.anchor_date,
            next_due_date=existing.next_due_date,
            coverage_start=start,
            coverage_end=end,
            superseded_fee_count=0,
            protected_fee_count=0,
            skipped_cycle_count=existing.first_anchor_cycle_no,
            review_id=UUID(existing.id),
        )

    from app.services.fee_reconciliation import (
        is_fee_record_mutable,
        is_fee_record_protected,
    )
    from app.services.billing_decision_service import (
        compute_billing_decisions_for_enrollment,
    )

    records = list(
        (
            await db.scalars(
                select(FeeRecord)
                .where(
                    FeeRecord.enrollment_id == enrollment.id,
                    FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
                )
                .order_by(FeeRecord.cycle_no)
                .with_for_update()
            )
        ).all()
    )
    protected = [record for record in records if is_fee_record_protected(record)]
    mutable = [record for record in records if is_fee_record_mutable(record)]
    protected_through = max(
        (
            record.coverage_end
            for record in protected
            if record.coverage_end is not None
        ),
        default=None,
    )
    today = business_today()
    weeks = _cycle_weeks(enrollment)

    effective_fee = (
        int(enrollment.custom_fee)
        if enrollment.custom_fee is not None
        else int(enrollment.class_.base_fee)
    )
    decisions = compute_billing_decisions_for_enrollment(
        old_enrollment_date=enrollment.enrollment_date,
        new_enrollment_date=new_anchor,
        billing_type=_billing_type(enrollment),
        cycle_weeks=weeks,
        effective_fee=effective_fee,
        fee_records=records,
        today=today,
    )
    chosen_opt = None
    if decision_code:
        chosen_opt = next(
            (d for d in decisions if d.decision_code.value == decision_code), None
        )
    if chosen_opt is None:
        chosen_opt = next((d for d in decisions if d.recommended), decisions[0])

    anchor_cycle = chosen_opt.first_anchor_cycle_no
    coverage_start = chosen_opt.coverage_start
    coverage_end = chosen_opt.coverage_end
    due = chosen_opt.due_date

    from app.services.fee_operation_service import (
        append_fee_operation,
        snapshot_fee_record,
    )
    from app.services.payment_scaffold_service import (
        revoke_open_payment_requests_for_fee_records,
    )

    if mutable and chosen_opt.superseded_fee_count > 0:
        await revoke_open_payment_requests_for_fee_records(
            db,
            [record.id for record in mutable],
            actor_id=actor_user_id,
            reason="Ngày bắt đầu học đã thay đổi; lịch thu cũ không còn hiệu lực",
        )
        before = [snapshot_fee_record(record) for record in mutable]
        now = datetime.now(timezone.utc)
        for record in mutable:
            record.status = "SUPERSEDED"
            record.superseded_at = now
            record.voided_at = now
    else:
        before = []
        now = datetime.now(timezone.utc)

    pending_revisions = list(
        (
            await db.scalars(
                select(BillingAnchorRevision)
                .where(
                    BillingAnchorRevision.enrollment_id == enrollment.id,
                    BillingAnchorRevision.state == "PENDING",
                )
                .with_for_update()
            )
        ).all()
    )
    affected_class_revisions = {
        old_revision.class_billing_cycle_revision_id
        for old_revision in pending_revisions
        if old_revision.class_billing_cycle_revision_id
    }
    for old_revision in pending_revisions:
        old_revision.state = "SUPERSEDED"
        old_revision.resolved_at = now
        old_revision.resolution_note = "Được thay bằng lần sửa ngày bắt đầu mới hơn"
    for class_revision_id in affected_class_revisions:
        await _resolve_class_cycle_revision_if_complete(
            db, class_revision_id, actor_user_id=actor_user_id
        )

    sequence = int(enrollment.billing_anchor_version or 0) + 1
    revision = BillingAnchorRevision(
        enrollment_id=enrollment.id,
        sequence_no=sequence,
        previous_anchor_date=enrollment.enrollment_date,
        anchor_date=new_anchor,
        effective_on=today,
        generation_floor=max(today, protected_through) if protected_through else today,
        first_anchor_cycle_no=anchor_cycle,
        next_due_date=due,
        change_kind="ENROLLMENT_DATE_CHANGE",
        decision_code=chosen_opt.decision_code.value,
        previous_enrollment_date=enrollment.enrollment_date,
        next_enrollment_date=new_anchor,
        skipped_anchor_cycle_count=chosen_opt.skipped_cycle_count,
        selected_historical_cycles=selected_historical_cycles,
        start_date_command_item_id=command_item_id,
        billing_type_snapshot=_billing_type(enrollment),
        billing_cycle_months_snapshot=(
            enrollment.current_billing_revision.billing_cycle_months_snapshot
            if enrollment.__dict__.get("current_billing_revision") is not None
            else enrollment.class_.billing_cycle_months
        ),
        billing_cycle_weeks_snapshot=weeks,
        state="PENDING",
        reason=reason,
        request_id=request_key,
        actor_user_id=actor_user_id,
    )
    db.add(revision)
    await db.flush()

    global_cycle = (
        int(
            await db.scalar(
                select(func.coalesce(func.max(FeeRecord.cycle_no), -1)).where(
                    FeeRecord.enrollment_id == enrollment.id
                )
            )
            or 0
        )
        + 1
    )
    from app.services.credit_service import enrollment_total_deferral_days

    deferral = await enrollment_total_deferral_days(db, enrollment.id)
    amount = (
        int(enrollment.custom_fee)
        if enrollment.custom_fee is not None
        else int(enrollment.class_.base_fee)
    )
    new_record = FeeRecord(
        enrollment_id=enrollment.id,
        billing_revision_id=revision.id,
        anchor_cycle_no=anchor_cycle,
        review_required=True,
        period=period_key(due) or "0000-00",
        due_date=due,
        cycle_no=global_cycle,
        base_due_date=due,
        adjusted_due_date=adjusted_due_after_deferral(due, deferral),
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        origin="ANCHOR_RECALCULATION",
        enrollment_date_snapshot=new_anchor,
        class_name_snapshot=enrollment.class_.name,
        class_type_snapshot=_billing_type(enrollment),
        billing_cycle_months_snapshot=(revision.billing_cycle_months_snapshot),
        billing_cycle_weeks_snapshot=weeks,
        base_amount=amount,
        discount_amount=0,
        status="UNPAID",
    )
    db.add(new_record)
    await db.flush()
    for record in mutable:
        record.superseded_by_record_id = new_record.id

    enrollment.enrollment_date = new_anchor
    enrollment.current_billing_revision_id = revision.id
    enrollment.current_billing_revision = revision
    enrollment.billing_anchor_version = sequence
    await db.flush()
    if mutable:
        await append_fee_operation(
            db,
            action="anchor_recalculation",
            before=before,
            # The revision row is the append-only audit record for the newly
            # generated charge.  This fee operation records the one-to-one
            # transition of the old mutable charges, so before/after must stay
            # aligned for a trustworthy audit trail.
            after=[snapshot_fee_record(record) for record in mutable],
            actor_id=actor_user_id,
            reason=reason,
            origin="system",
        )
    return BillingAnchorImpactResponse(
        enrollment_id=UUID(enrollment.id),
        previous_date=revision.previous_anchor_date or new_anchor,
        next_date=new_anchor,
        next_due_date=due,
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        superseded_fee_count=len(mutable),
        protected_fee_count=len(protected),
        skipped_cycle_count=anchor_cycle,
        review_id=UUID(revision.id),
    )


def _review_response(revision: BillingAnchorRevision) -> BillingReviewResponse:
    enrollment = revision.enrollment
    student = enrollment.student
    class_ = enrollment.class_
    fees = []
    for record in sorted(revision.fee_records, key=lambda row: row.cycle_no):
        cancellable = bool(
            record.status == "UNPAID"
            and record.notified_at is None
            and int(record.refunded_amount or 0) == 0
        )
        blocked_reason = None
        if not cancellable:
            blocked_reason = "Khoản đã báo hoặc có giao dịch; hãy dùng luồng sửa sai"
        fees.append(
            BillingReviewFeeResponse(
                id=UUID(record.id),
                due_date=record.adjusted_due_date or record.due_date,
                coverage_start=record.coverage_start,
                coverage_end=record.coverage_end,
                amount=int(record.final_amount),
                status=record.status,
                cancellable=cancellable,
                blocked_reason=blocked_reason,
                is_final_cycle=record.is_final_cycle,
            )
        )
    return BillingReviewResponse(
        id=UUID(revision.id),
        enrollment_id=UUID(enrollment.id),
        student_id=UUID(student.id),
        student_name=student.full_name,
        student_code=student.student_code,
        class_id=UUID(class_.id),
        class_name=class_.name,
        change_kind=(
            "PACKAGE_DURATION_CHANGE"
            if revision.change_kind == "PACKAGE_DURATION_CHANGE"
            else "ENROLLMENT_DATE_CHANGE"
        ),
        class_billing_cycle_revision_id=(
            UUID(revision.class_billing_cycle_revision_id)
            if revision.class_billing_cycle_revision_id
            else None
        ),
        previous_date=revision.previous_anchor_date,
        next_date=revision.anchor_date,
        previous_weeks=(
            revision.class_billing_cycle_revision.previous_weeks
            if getattr(revision, "class_billing_cycle_revision", None) is not None
            else None
        ),
        next_weeks=(
            revision.billing_cycle_weeks_snapshot
            if revision.change_kind == "PACKAGE_DURATION_CHANGE"
            else None
        ),
        next_due_date=revision.next_due_date,
        state=revision.state,
        reason=revision.reason,
        created_at=revision.created_at,
        fees=fees,
    )


async def list_billing_reviews(
    db: AsyncSession,
    *,
    state: str = "PENDING",
) -> BillingReviewListResponse:
    result = await db.execute(
        select(BillingAnchorRevision)
        .where(BillingAnchorRevision.state == state)
        .options(
            selectinload(BillingAnchorRevision.enrollment).selectinload(
                Enrollment.student
            ),
            selectinload(BillingAnchorRevision.enrollment).selectinload(
                Enrollment.class_
            ),
            selectinload(BillingAnchorRevision.fee_records),
            selectinload(BillingAnchorRevision.class_billing_cycle_revision),
        )
        .order_by(BillingAnchorRevision.created_at.desc())
    )
    revisions = list(result.scalars().unique().all())
    reviews = [_review_response(revision) for revision in revisions]
    return BillingReviewListResponse(reviews=reviews, pending_count=len(reviews))


async def resolve_billing_review(
    db: AsyncSession,
    review_id: UUID,
    payload: BillingReviewResolveRequest,
    *,
    actor_user_id: str | None,
) -> BillingReviewResponse | None:
    revision = await db.scalar(
        select(BillingAnchorRevision)
        .where(BillingAnchorRevision.id == str(review_id))
        .options(
            selectinload(BillingAnchorRevision.enrollment).selectinload(
                Enrollment.student
            ),
            selectinload(BillingAnchorRevision.enrollment).selectinload(
                Enrollment.class_
            ),
            selectinload(BillingAnchorRevision.fee_records),
            selectinload(BillingAnchorRevision.class_billing_cycle_revision),
        )
        .with_for_update()
    )
    if revision is None:
        return None
    if revision.state != "PENDING":
        return _review_response(revision)

    selected = {str(record_id) for record_id in payload.fee_record_ids}
    if payload.decision == "WAIVE_CHARGE":
        if not payload.reason:
            raise HTTPException(status_code=422, detail="Hủy khoản thu phải có lý do")
        if not selected:
            raise HTTPException(status_code=422, detail="Hãy chọn khoản thu cần hủy")
        records = [record for record in revision.fee_records if record.id in selected]
        if len(records) != len(selected):
            raise HTTPException(
                status_code=409, detail="Danh sách khoản thu đã thay đổi"
            )
        if any(
            record.status != "UNPAID"
            or record.notified_at is not None
            or int(record.refunded_amount or 0) > 0
            for record in records
        ):
            raise HTTPException(
                status_code=409,
                detail="Chỉ có thể hủy khoản chưa báo và chưa có giao dịch",
            )
        now = datetime.now(timezone.utc)
        for record in records:
            record.status = "VOID"
            record.voided_at = now
            record.review_required = False
            record.note = payload.reason
    else:
        for record in revision.fee_records:
            if record.status == "UNPAID":
                record.review_required = False

    revision.state = "CONFIRMED"
    revision.resolved_by = actor_user_id
    revision.resolved_at = datetime.now(timezone.utc)
    revision.resolution_note = payload.reason or "Đã xác nhận lịch thu mới"
    if revision.class_billing_cycle_revision_id:
        await _resolve_class_cycle_revision_if_complete(
            db,
            revision.class_billing_cycle_revision_id,
            actor_user_id=actor_user_id,
        )
    await db.commit()
    # The flush used to resolve the parent class revision can expire fee rows on
    # databases with server-side update triggers. Reload the complete aggregate
    # explicitly after commit so response serialization never performs implicit
    # async IO (which would raise MissingGreenlet under asyncpg).
    resolved_revision = await db.scalar(
        select(BillingAnchorRevision)
        .where(BillingAnchorRevision.id == str(review_id))
        .options(
            selectinload(BillingAnchorRevision.enrollment).selectinload(
                Enrollment.student
            ),
            selectinload(BillingAnchorRevision.enrollment).selectinload(
                Enrollment.class_
            ),
            selectinload(BillingAnchorRevision.fee_records),
            selectinload(BillingAnchorRevision.class_billing_cycle_revision),
        )
    )
    if resolved_revision is None:  # pragma: no cover - protected by FK/audit rules
        return None
    return _review_response(resolved_revision)
