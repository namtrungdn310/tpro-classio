"""Explicit tuition scheduling, independent of academic admission dates."""

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import hmac
import json
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.billing_change_plan import (
    BillingChangePlan,
    BillingPlanError,
    FeeSnapshot,
    Interval,
    ScheduledSegment,
    build_billing_change_plan,
    price_transition,
)
from app.core.billing_schedule import (
    cycle_base_due_date,
    cycle_coverage_interval,
    period_key,
)
from app.core.business_time import business_today
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.payment_request import PaymentRequest, PaymentRequestItem
from app.models.student import Student
from app.models.billing_anchor_revision import BillingAnchorRevision
from app.models.start_date_change_command import StartDateChangeCommandRecord
from app.schemas.billing_schedule_change import (
    BillingScheduleApplyRequest,
    BillingScheduleOptionsRequest,
    BillingScheduleOptionsResponse,
    BillingScheduleOptionItem,
    BillingSchedulePreviewRequest,
    BillingSchedulePreviewResponse,
    CandidateCycleChoice,
    CycleBoundaryInfo,
    DateClassification,
    FinancialStateInfo,
    HistoricalCycleItem,
)
from app.services.admission_date_service import admission_conflict
from app.services.billing_decision_service import (
    cycle_covering_date,
    next_canonical_cycle_on_or_after,
)
from app.services.independent_dates_guard import require_date_contract


def digest(value: object) -> str:
    return sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def validate_anchor_date(enrollment, anchor_date: date) -> None:
    """Validate the calendar reference, not the student's admission boundary."""
    class_start = getattr(enrollment.class_, "start_date", None)
    if isinstance(class_start, date) and anchor_date <= class_start:
        raise BillingPlanError(
            "BILLING_ANCHOR_BEFORE_CLASS",
            "Mốc thu mới phải sau ngày bắt đầu lớp học.",
        )


def validate_cycle_date(anchor, kind, weeks, cycle):
    try:
        return cycle_coverage_interval(anchor, kind, weeks, cycle)
    except (ValueError, OverflowError) as exc:
        raise BillingPlanError(
            "BILLING_DATE_OUT_OF_RANGE",
            "Kỳ được chọn vượt phạm vi ngày hệ thống hỗ trợ.",
        ) from exc


async def load_billing_context(
    db: AsyncSession,
    enrollment_id: UUID,
    *,
    lock: bool = False,
    require_contract: bool = True,
):
    if require_contract:
        require_date_contract(4, has_date_edit=False)
    identity = (
        await db.execute(
            select(Enrollment.class_id, Enrollment.student_id).where(
                Enrollment.id == str(enrollment_id)
            )
        )
    ).first()
    if identity is None:
        raise HTTPException(404, detail="Không tìm thấy lượt học")
    if lock:
        await db.execute(
            select(Class.id).where(Class.id == identity.class_id).with_for_update()
        )
        await db.execute(
            select(Student.id)
            .where(Student.id == identity.student_id)
            .with_for_update()
        )
    query = (
        select(Enrollment)
        .where(Enrollment.id == str(enrollment_id))
        .execution_options(populate_existing=True)
        .options(
            selectinload(Enrollment.class_),
            selectinload(Enrollment.student),
            selectinload(Enrollment.current_billing_revision),
        )
    )
    enrollment = await db.scalar(
        query.with_for_update().execution_options(populate_existing=True)
        if lock
        else query
    )
    if enrollment is None:
        raise HTTPException(404, detail="Không tìm thấy lượt học")
    revision = enrollment.current_billing_revision
    if (
        revision is not None
        and revision.change_kind
        in {"BILLING_SCHEDULE_CHANGE", "PACKAGE_DURATION_CHANGE"}
        and not revision.waived_intervals
        and revision.request_id
    ):
        # Older accepted plans already recorded waivers in command history.
        # Read them without rewriting an immutable historical revision.
        commands = (
            await db.scalars(
                select(StartDateChangeCommandRecord.execution_plan)
                .join(
                    BillingAnchorRevision,
                    BillingAnchorRevision.request_id
                    == StartDateChangeCommandRecord.request_id,
                )
                .where(
                    BillingAnchorRevision.enrollment_id == enrollment.id,
                    BillingAnchorRevision.sequence_no <= revision.sequence_no,
                    StartDateChangeCommandRecord.operation_kind
                    == "BILLING_SCHEDULE_CHANGE",
                    StartDateChangeCommandRecord.state == "COMPLETED",
                )
                .order_by(BillingAnchorRevision.sequence_no)
            )
        ).all()
        if commands:
            from sqlalchemy.orm.attributes import set_committed_value

            waivers = {}
            for execution_plan in commands:
                execution_plan = execution_plan or {}
                if "effective_waived_intervals" in execution_plan:
                    waivers = {
                        (s["start"], s["end"]): s
                        for s in execution_plan["effective_waived_intervals"]
                    }
                else:
                    waivers.update(
                        {
                            (s["start"], s["end"]): s
                            for s in execution_plan.get("response", {})
                            .get("plan", {})
                            .get("waived_intervals", [])
                        }
                    )
            set_committed_value(
                revision, "waived_intervals", [waivers[key] for key in sorted(waivers)]
            )
    if lock:
        from app.services.fee_cycle_service import lock_enrollment_cycle_identity

        await lock_enrollment_cycle_identity(db, enrollment.id)
    fee_query = (
        select(FeeRecord)
        .where(FeeRecord.enrollment_id == enrollment.id)
        .execution_options(populate_existing=True)
        .options(selectinload(FeeRecord.payments))
        .order_by(FeeRecord.id)
    )
    records = list(
        (
            await db.scalars(
                fee_query.with_for_update().execution_options(populate_existing=True)
                if lock
                else fee_query
            )
        ).all()
    )
    fee_ids = [record.id for record in records]
    request_query = (
        select(PaymentRequest)
        .execution_options(populate_existing=True)
        .where(
            or_(
                PaymentRequest.fee_record_id.in_(fee_ids),
                PaymentRequest.id.in_(
                    select(PaymentRequestItem.payment_request_id).where(
                        PaymentRequestItem.fee_record_id.in_(fee_ids)
                    )
                ),
            )
        )
        .order_by(PaymentRequest.id)
    )
    requests = list(
        (
            await db.scalars(
                request_query.with_for_update().execution_options(
                    populate_existing=True
                )
                if lock
                else request_query
            )
        ).all()
    )
    # Notification history applies to every grouped item; it is not settlement.
    items = (
        list(
            (
                await db.execute(
                    select(
                        PaymentRequestItem.payment_request_id,
                        PaymentRequestItem.fee_record_id,
                    ).where(
                        PaymentRequestItem.payment_request_id.in_(
                            [request.id for request in requests]
                        ),
                    )
                )
            ).all()
        )
        if requests
        else []
    )
    shared_fee_ids = {
        request.fee_record_id
        for request in requests
        if request.sent_at is not None or request.paid_at is not None
    }
    shared_request_ids = {
        request.id
        for request in requests
        if request.sent_at is not None or request.paid_at is not None
    }
    shared_fee_ids.update(
        item.fee_record_id
        for item in items
        if item.payment_request_id in shared_request_ids
    )
    settled_requests = {
        request.id
        for request in requests
        if request.paid_at is not None or request.status == "PAID"
    }
    settled_fee_ids = {
        request.fee_record_id for request in requests if request.id in settled_requests
    }
    settled_fee_ids.update(
        item.fee_record_id
        for item in items
        if item.payment_request_id in settled_requests
    )
    request_digest = digest(
        {
            "requests": [
                (
                    str(r.id),
                    r.status,
                    r.sent_at,
                    r.paid_at,
                    r.revoked_at,
                    str(r.expected_amount),
                )
                for r in requests
            ],
            "items": sorted(
                (str(item.payment_request_id), str(item.fee_record_id))
                for item in items
            ),
        }
    )
    snapshots = tuple(
        FeeSnapshot(
            id=str(record.id),
            billing_revision_id=str(record.billing_revision_id)
            if record.billing_revision_id
            else None,
            review_required=bool(record.review_required),
            notified=record.notified_at is not None or record.id in shared_fee_ids,
            coverage=Interval(record.coverage_start, record.coverage_end)
            if record.coverage_start and record.coverage_end
            else None,
            amount=int(record.final_amount),
            status=record.status,
            is_paid=(
                record.status == "PAID"
                or record.paid_date is not None
                or (record.paid_amount is not None and record.paid_amount > 0)
                or getattr(record, "status", None) in ("REFUNDED", "PARTIALLY_REFUNDED")
                or (record.refunded_amount is not None and record.refunded_amount > 0)
                or bool(record.payments)
                or record.id in settled_fee_ids
            ),
            protected=(
                record.status == "PAID"
                or record.paid_date is not None
                or (record.paid_amount is not None and record.paid_amount > 0)
                or getattr(record, "status", None) in ("REFUNDED", "PARTIALLY_REFUNDED")
                or (record.refunded_amount is not None and record.refunded_amount > 0)
                or bool(record.payments)
                or record.id in settled_fee_ids
            ),
            has_settlement=bool(record.payments) or record.id in settled_fee_ids,
            financial_version=digest(
                {
                    "updated_at": record.updated_at,
                    "review_required": bool(record.review_required),
                    "paid_amount": int(record.paid_amount or 0),
                    "paid_date": record.paid_date,
                    "refund": int(record.refunded_amount or 0),
                    "notified": record.notified_at,
                    "due": record.adjusted_due_date or record.due_date,
                    "payments": sorted(str(payment.id) for payment in record.payments),
                    "requests": request_digest,
                }
            ),
        )
        for record in records
    )
    return enrollment, records, snapshots


def pending_review_context(revision, snapshots):
    if revision.state != "PENDING":
        return None
    return {
        "id": str(revision.id),
        "change_kind": revision.change_kind,
        "reason": revision.reason,
        "created_at": revision.created_at,
        "anchor_date": revision.anchor_date,
        "fees": [
            {"id": s.id, "coverage": s.coverage, "amount": s.amount}
            for s in snapshots
            if s.active and s.billing_revision_id == str(revision.id)
        ],
    }


def compute_context_token(
    enrollment: Enrollment,
    revision: BillingAnchorRevision,
    target_anchor: date,
    today: date,
    deferral_days: int,
    snapshots: tuple[FeeSnapshot, ...],
) -> str:
    data = {
        "enrollment_id": str(enrollment.id),
        "enrollment_date": str(enrollment.enrollment_date),
        "admission_version": enrollment.admission_version,
        "billing_anchor_version": enrollment.billing_anchor_version,
        "revision_id": str(revision.id),
        "revision_sequence_no": revision.sequence_no,
        "revision_anchor_date": str(revision.anchor_date),
        "revision_state": revision.state,
        "anchor_date": str(target_anchor),
        "business_date": str(today),
        "deferral_days": deferral_days,
        "class_id": str(enrollment.class_id),
        "class_version": getattr(enrollment.class_, "version", 1),
        "class_start": str(getattr(enrollment.class_, "start_date", None)),
        "class_fee": str(getattr(enrollment.class_, "base_fee", None)),
        "custom_fee": str(enrollment.custom_fee),
        "ended_on": str(enrollment.ended_on),
        "scheduled_segments": getattr(revision, "scheduled_segments", None),
        "waived_intervals": getattr(revision, "waived_intervals", None),
        "fees": [
            (
                str(f.id),
                f.status,
                f.amount,
                str(f.coverage.start) if f.coverage else None,
                str(f.coverage.end) if f.coverage else None,
                f.protected,
                f.financial_version,
            )
            for f in sorted(snapshots, key=lambda x: x.id)
        ],
    }
    return digest(data)


def waiver_scope(revision, today: date, *, replace_future: bool = False):
    """Only explicitly replace wholly future waivers of a not-yet-active plan.

    Past/current waivers and VOID fee decisions are never revoked by this choice.
    Old revisions remain immutable; the new revision stores the effective set.
    """
    raw = getattr(revision, "waived_intervals", None)
    spans = (
        tuple(
            Interval(date.fromisoformat(s["start"]), date.fromisoformat(s["end"]))
            for s in raw
        )
        if isinstance(raw, list)
        else ()
    )
    floor = getattr(revision, "generation_floor", None)
    if not isinstance(floor, date):
        floor = getattr(revision, "effective_on", None)
    pending_cutover = isinstance(floor, date) and floor > today
    replaceable = tuple(s for s in spans if s.start > today) if pending_cutover else ()
    if replace_future and not replaceable:
        raise BillingPlanError(
            "FUTURE_WAIVER_CHANGED",
            "Không còn khoảng miễn thu tương lai có thể thay thế. Vui lòng kiểm tra lại.",
        )
    kept = tuple(s for s in spans if s not in replaceable) if replace_future else spans
    return kept, replaceable


def build_plan_for_strategy(
    *,
    enrollment: Enrollment,
    revision: BillingAnchorRevision,
    snapshots: tuple[FeeSnapshot, ...],
    anchor_date: date,
    expected_version: int,
    strategy: str,
    first_cycle: int | None = None,
    historical_cycles: tuple[int, ...] = (),
    gap_policy: Literal["REVIEW", "CHARGE", "WAIVE"] = "REVIEW",
    reason: str = "",
    today: date,
    custom_transition_amount: int | None = None,
    replace_future_waivers: bool = False,
) -> tuple[BillingChangePlan, date]:
    validate_anchor_date(enrollment, anchor_date)
    validate_cycle_date(
        anchor_date,
        revision.billing_type_snapshot,
        revision.billing_cycle_weeks_snapshot,
        first_cycle or 0,
    )
    actionable_from = (
        max(today, enrollment.enrollment_date) if enrollment.enrollment_date else today
    )
    kind = revision.billing_type_snapshot
    weeks = revision.billing_cycle_weeks_snapshot
    active = [fee for fee in snapshots if fee.active]
    if any(fee.coverage is None for fee in active):
        raise BillingPlanError(
            "UNKNOWN_COVERAGE", "Cần kiểm tra phạm vi kỳ thu cũ trước"
        )

    scheduled_segments: list[ScheduledSegment] = []
    excluded, replaceable = waiver_scope(
        revision, today, replace_future=replace_future_waivers
    )
    amount_val = int(
        enrollment.custom_fee
        if enrollment.custom_fee is not None
        else enrollment.class_.base_fee
    )

    preserved_ids: set[str] = set()
    if strategy == "KEEP_CURRENT":
        preserved = [
            fee
            for fee in active
            if fee.protected or (fee.coverage.start <= today < fee.coverage.end)
        ]
        preserved_ids = {fee.id for fee in preserved}
        if first_cycle is not None:
            cycle = first_cycle
            cycle_start, _ = cycle_coverage_interval(anchor_date, kind, weeks, cycle)
            transition = min(actionable_from, cycle_start)
        else:
            transition = max(
                [
                    actionable_from,
                    *(fee.coverage.end for fee in preserved),
                    *(span.end for span in excluded),
                    *(
                        fee.coverage.end
                        for fee in snapshots
                        if fee.status == "VOID" and fee.coverage
                    ),
                ]
            )
            cycle = next_canonical_cycle_on_or_after(
                anchor_date, kind, weeks, transition
            )
    elif strategy == "REPLACE_CURRENT":
        if first_cycle is not None:
            cycle = first_cycle
        else:
            preserved = [fee for fee in active if fee.protected]
            protected_ends = [fee.coverage.end for fee in preserved if fee.coverage]
            protected_through = max(protected_ends) if protected_ends else None
            curr_c = cycle_covering_date(revision.anchor_date, kind, weeks, today)
            curr_s, curr_e = cycle_coverage_interval(
                revision.anchor_date, kind, weeks, curr_c
            )
            if anchor_date > today:
                cycle = next_canonical_cycle_on_or_after(
                    anchor_date, kind, weeks, anchor_date
                )
            elif protected_through is not None and protected_through > curr_e:
                cycle = next_canonical_cycle_on_or_after(
                    anchor_date, kind, weeks, protected_through
                )
            elif kind == "MONTHLY":
                ref_d = curr_s or today
                cycle = max(
                    0,
                    (ref_d.year - anchor_date.year) * 12
                    + (ref_d.month - anchor_date.month),
                )
            else:
                cycle = cycle_covering_date(anchor_date, kind, weeks, curr_s or today)
        cycle_start, _ = cycle_coverage_interval(anchor_date, kind, weeks, cycle)
        transition = min(actionable_from, cycle_start)
    elif strategy == "CONTINUE_OLD_UNTIL_NEW":
        preserved = [
            fee
            for fee in active
            if fee.protected or (fee.coverage.start <= today < fee.coverage.end)
        ]
        floor = max([actionable_from, *(fee.coverage.end for fee in preserved)])
        safe_cutover = max(
            [
                floor,
                *(span.end for span in excluded),
                *(
                    fee.coverage.end
                    for fee in snapshots
                    if fee.status == "VOID" and fee.coverage
                ),
            ]
        )
        cycle = (
            first_cycle
            if first_cycle is not None
            else next_canonical_cycle_on_or_after(
                anchor_date, kind, weeks, safe_cutover
            )
        )
        cutover, _ = validate_cycle_date(anchor_date, kind, weeks, cycle)
        preserved_ids = {fee.id for fee in preserved}
        preserved_ids.update(fee.id for fee in active if fee.coverage.end <= cutover)
        inherited = getattr(revision, "scheduled_segments", None)
        if isinstance(inherited, list):
            for segment in inherited:
                seg_start = max(floor, date.fromisoformat(segment["coverage"]["start"]))
                seg_end = min(cutover, date.fromisoformat(segment["coverage"]["end"]))
                if seg_start < seg_end:
                    scheduled_segments.append(
                        ScheduledSegment(
                            Interval(seg_start, seg_end),
                            date.fromisoformat(segment["anchor"]),
                            segment["billing_type"],
                            segment["cycle_weeks"],
                            int(segment["amount"]),
                        )
                    )
        old_floor = max(floor, revision.anchor_date)
        effective_on = getattr(revision, "effective_on", None)
        if isinstance(effective_on, date):
            old_floor = max(old_floor, effective_on)
        c_old = next_canonical_cycle_on_or_after(
            revision.anchor_date, kind, weeks, old_floor
        )
        old_start, _ = validate_cycle_date(revision.anchor_date, kind, weeks, c_old)
        end_cycle = cycle_covering_date(revision.anchor_date, kind, weeks, cutover)
        old_end, _ = validate_cycle_date(revision.anchor_date, kind, weeks, end_cycle)
        if old_start < old_end <= cutover:
            scheduled_segments.append(
                ScheduledSegment(
                    Interval(old_start, old_end),
                    revision.anchor_date,
                    kind,
                    weeks,
                    amount_val,
                )
            )
        transition = floor
    elif strategy == "FROM_CYCLE":
        if first_cycle is None:
            raise BillingPlanError("CYCLE_REQUIRED", "Vui lòng chọn kỳ bắt đầu áp dụng")
        cycle = first_cycle
        start, end = cycle_coverage_interval(anchor_date, kind, weeks, cycle)
        if end <= today and not (
            len(active) == 0
            and cycle == cycle_covering_date(anchor_date, kind, weeks, today)
        ):
            raise BillingPlanError(
                "PAST_CYCLE_RESTRICTED",
                "Chọn kỳ hiện tại hoặc tương lai; kỳ quá khứ nằm trong danh sách truy thu riêng",
            )
        transition = min(actionable_from, start)
    else:
        raise BillingPlanError("INVALID_STRATEGY", "Phương án điều chỉnh không hợp lệ")

    start, end = cycle_coverage_interval(anchor_date, kind, weeks, cycle)
    if enrollment.enrollment_date and end <= enrollment.enrollment_date:
        raise BillingPlanError(
            "BILLING_BEFORE_ADMISSION", "Kỳ tính phí nằm hoàn toàn trước ngày ghi danh"
        )
    if (enrollment.ended_on and start >= enrollment.ended_on) or (
        enrollment.class_.stopped_on and start >= enrollment.class_.stopped_on
    ):
        raise BillingPlanError(
            "BILLING_AFTER_MEMBERSHIP_END", "Kỳ mới bắt đầu sau khi lượt học kết thúc"
        )

    replace_ids = tuple(
        fee.id
        for fee in active
        if not fee.protected
        and not fee.is_paid
        and not fee.has_settlement
        and fee.id not in preserved_ids
        and fee.status == "UNPAID"
        and fee.coverage.end > transition
    )

    for historical_cycle in historical_cycles:
        h_start, h_end = cycle_coverage_interval(
            anchor_date, kind, weeks, historical_cycle
        )
        if enrollment.enrollment_date and h_start < enrollment.enrollment_date:
            raise BillingPlanError(
                "BILLING_BEFORE_ADMISSION",
                "Kỳ truy thu bắt đầu trước ngày ghi danh",
            )
        if enrollment.ended_on and h_start >= enrollment.ended_on:
            raise BillingPlanError(
                "BILLING_AFTER_MEMBERSHIP_END", "Kỳ truy thu nằm sau ngày rời lớp"
            )

    plan = build_billing_change_plan(
        enrollment_id=str(enrollment.id),
        version=expected_version,
        business_date=today,
        anchor=anchor_date,
        billing_type=kind,
        cycle_weeks=weeks,
        amount=amount_val,
        first_cycle=cycle,
        transition_from=transition,
        fees=snapshots,
        replacement_fee_ids=replace_ids,
        historical_cycles=tuple(historical_cycles),
        gap_policy=gap_policy,
        reason=reason,
        transition_anchor=revision.anchor_date,
        transition_billing_type=kind,
        transition_cycle_weeks=weeks,
        custom_transition_amount=custom_transition_amount,
        scheduled_segments=tuple(scheduled_segments),
        excluded_intervals=excluded,
    )
    # A reference before admission does not buy service before admission.
    stop = min(
        [d for d in (enrollment.ended_on, enrollment.class_.stopped_on) if d],
        default=None,
    )
    clipped = []
    for charge in plan.charges:
        lo = max(
            charge.coverage.start, enrollment.enrollment_date or charge.coverage.start
        )
        hi = min(charge.coverage.end, stop or charge.coverage.end)
        if lo >= hi:
            raise BillingPlanError(
                "BILLING_AFTER_MEMBERSHIP_END",
                "Không có thời gian học hợp lệ trong kỳ đã chọn",
            )
        if (lo, hi) != (charge.coverage.start, charge.coverage.end):
            span = Interval(lo, hi)
            # Admission may prorate a partial first package. Stopping service
            # must not silently discount the agreed final package.
            amount = (
                price_transition(
                    Interval(lo, charge.coverage.end),
                    anchor_date,
                    kind,
                    weeks,
                    amount_val,
                )
                if lo != charge.coverage.start
                else charge.amount
            )
            charge = replace(charge, coverage=span, amount=amount)
        clipped.append(charge)
    plan = replace(
        plan,
        charges=tuple(clipped),
        replaced_waived_intervals=replaceable if replace_future_waivers else (),
    )
    return plan, start


def compute_candidate_cycles(
    strategy: str,
    anchor_date: date,
    kind: str,
    weeks: int | None,
    curr_start: date,
    curr_end: date,
    today: date,
    old_due_date: date,
    is_current_paid: bool,
    case_code: str,
    simulate_fn,
    default_cycle: int | None = None,
) -> list[CandidateCycleChoice]:
    choices: list[CandidateCycleChoice] = []

    if strategy == "KEEP_CURRENT":
        if case_code == "FAR_FUTURE":
            c_target = (
                default_cycle
                if default_cycle is not None
                else next_canonical_cycle_on_or_after(
                    anchor_date, kind, weeks, max(anchor_date, curr_end)
                )
            )
            c_start, c_end = cycle_coverage_interval(anchor_date, kind, weeks, c_target)
            ok, _, _, _, _, _, _, _ = simulate_fn("KEEP_CURRENT", c_target)
            if ok:
                choices.append(
                    CandidateCycleChoice(
                        cycle_no=c_target,
                        due_date=c_start,
                        coverage_start=c_start,
                        coverage_end=c_end,
                        label=c_start.strftime("%d/%m/%Y"),
                        description=f"Bắt đầu thu lại từ ngày {c_start.strftime('%d/%m/%Y')}",
                        is_default=True,
                    )
                )
            return choices

        # Candidate 1 (Canonical/Default): Next cycle starting on or after curr_end
        c_late = (
            default_cycle
            if default_cycle is not None
            else next_canonical_cycle_on_or_after(anchor_date, kind, weeks, curr_end)
        )
        s_late, e_late = cycle_coverage_interval(anchor_date, kind, weeks, c_late)
        ok_late, _, _, _, _, _, _, _ = simulate_fn("KEEP_CURRENT", c_late)
        if ok_late:
            choices.append(
                CandidateCycleChoice(
                    cycle_no=c_late,
                    due_date=s_late,
                    coverage_start=s_late,
                    coverage_end=e_late,
                    label=s_late.strftime("%d/%m/%Y"),
                    description=f"Sau khi kỳ hiện tại kết thúc trọn vẹn (kỳ mới từ {s_late.strftime('%d/%m/%Y')})",
                    is_default=True,
                )
            )

        # Candidate 2 (Early cutover): At the boundary of curr_end
        c_early = cycle_covering_date(anchor_date, kind, weeks, curr_end)
        s_early, e_early = cycle_coverage_interval(anchor_date, kind, weeks, c_early)

        # Early candidate is sensible if it starts after today, after curr_start, and differs from c_late
        if (
            s_early > today
            and s_early > curr_start
            and s_early <= curr_end
            and c_early != c_late
        ):
            ok_early, _, _, _, _, _, _, _ = simulate_fn("KEEP_CURRENT", c_early)
            if ok_early:
                choices.append(
                    CandidateCycleChoice(
                        cycle_no=c_early,
                        due_date=s_early,
                        coverage_start=s_early,
                        coverage_end=e_early,
                        label=s_early.strftime("%d/%m/%Y"),
                        description=f"Nối tiếp ngay sau hạn cũ {old_due_date.strftime('%d/%m/%Y')} (kỳ mới từ {s_early.strftime('%d/%m/%Y')})",
                        is_default=False,
                    )
                )

        if len(choices) == 1 and case_code not in ("UNCHANGED", "UNSTARTED"):
            c_next_after = c_late + 1
            s_na, e_na = cycle_coverage_interval(anchor_date, kind, weeks, c_next_after)
            ok_na, _, _, _, _, _, _, _ = simulate_fn("KEEP_CURRENT", c_next_after)
            if ok_na:
                choices.append(
                    CandidateCycleChoice(
                        cycle_no=c_next_after,
                        due_date=s_na,
                        coverage_start=s_na,
                        coverage_end=e_na,
                        label=s_na.strftime("%d/%m/%Y"),
                        description=f"Bắt đầu từ kỳ tháng tiếp theo ({s_na.strftime('%d/%m/%Y')})",
                        is_default=False,
                    )
                )

        choices.sort(key=lambda c: c.cycle_no)
        if choices and not any(c.is_default for c in choices):
            choices[0].is_default = True

    elif strategy == "REPLACE_CURRENT":
        if is_current_paid:
            return []

        if default_cycle is not None:
            c_main = default_cycle
        elif kind == "MONTHLY":
            ref_d = curr_start or today
            c_main = max(
                0,
                (ref_d.year - anchor_date.year) * 12
                + (ref_d.month - anchor_date.month),
            )
        else:
            c_main = cycle_covering_date(anchor_date, kind, weeks, curr_start or today)
        s_main, e_main = cycle_coverage_interval(anchor_date, kind, weeks, c_main)
        ok_main, _, _, _, _, _, _, _ = simulate_fn("REPLACE_CURRENT", c_main)
        if ok_main:
            choices.append(
                CandidateCycleChoice(
                    cycle_no=c_main,
                    due_date=s_main,
                    coverage_start=s_main,
                    coverage_end=e_main,
                    label=s_main.strftime("%d/%m/%Y"),
                    description=f"Đổi hạn thu kỳ này sang ngày {s_main.strftime('%d/%m/%Y')} (thay vì {old_due_date.strftime('%d/%m/%Y')})",
                    is_default=True,
                )
            )

        c_next = c_main + 1
        s_next, e_next = cycle_coverage_interval(anchor_date, kind, weeks, c_next)
        ok_next, _, _, _, _, _, _, _ = simulate_fn("REPLACE_CURRENT", c_next)
        if ok_next:
            choices.append(
                CandidateCycleChoice(
                    cycle_no=c_next,
                    due_date=s_next,
                    coverage_start=s_next,
                    coverage_end=e_next,
                    label=s_next.strftime("%d/%m/%Y"),
                    description=f"Chuyển hạn sang kỳ tiếp theo ngày {s_next.strftime('%d/%m/%Y')} (thay vì {old_due_date.strftime('%d/%m/%Y')})",
                    is_default=False,
                )
            )

        choices.sort(key=lambda c: c.cycle_no)
        if choices and not any(c.is_default for c in choices):
            choices[0].is_default = True

    elif strategy == "CONTINUE_OLD_UNTIL_NEW":
        c_target = (
            default_cycle
            if default_cycle is not None
            else next_canonical_cycle_on_or_after(
                anchor_date, kind, weeks, max(anchor_date, curr_end)
            )
        )
        if not simulate_fn(strategy, c_target)[0]:
            return choices
        s_target, e_target = cycle_coverage_interval(anchor_date, kind, weeks, c_target)
        choices.append(
            CandidateCycleChoice(
                cycle_no=c_target,
                due_date=s_target,
                coverage_start=s_target,
                coverage_end=e_target,
                label=s_target.strftime("%d/%m/%Y"),
                description=f"Tiếp tục thu theo hạn cũ, mốc mới áp dụng từ {s_target.strftime('%d/%m/%Y')}",
                is_default=True,
            )
        )

    elif strategy == "FROM_CYCLE":
        first = (
            default_cycle
            if default_cycle is not None
            else next_canonical_cycle_on_or_after(anchor_date, kind, weeks, today)
        )
        for c in range(max(0, first - 1), first + 2):
            s_c, e_c = cycle_coverage_interval(anchor_date, kind, weeks, c)
            ok_c, _, _, _, _, _, _, _ = simulate_fn("FROM_CYCLE", c)
            if ok_c:
                choices.append(
                    CandidateCycleChoice(
                        cycle_no=c,
                        due_date=s_c,
                        coverage_start=s_c,
                        coverage_end=e_c,
                        label=f"Kỳ {c + 1} ({s_c.strftime('%d/%m/%Y')})",
                        description=f"Bắt đầu chu kỳ từ {s_c.strftime('%d/%m/%Y')}",
                        is_default=(c == first),
                    )
                )

    return choices


async def analyze_billing_schedule_options(
    db: AsyncSession,
    enrollment_id: UUID,
    data: BillingScheduleOptionsRequest,
) -> BillingScheduleOptionsResponse:
    from app.services.credit_service import enrollment_total_deferral_days

    enrollment, records, snapshots = await load_billing_context(
        db, enrollment_id, lock=False
    )
    try:
        validate_anchor_date(enrollment, data.anchor_date)
        rev = enrollment.current_billing_revision
        if rev is not None:
            validate_cycle_date(
                data.anchor_date,
                rev.billing_type_snapshot,
                rev.billing_cycle_weeks_snapshot,
                1,
            )
    except BillingPlanError as exc:
        raise admission_conflict(exc.code, str(exc)) from exc
    today = business_today()
    revision = enrollment.current_billing_revision
    deferral_days = await enrollment_total_deferral_days(
        db, enrollment.id, include_unallocated=True
    )
    if revision is None:
        token = digest(
            {"enrollment_id": str(enrollment_id), "anchor_date": str(data.anchor_date)}
        )
        return BillingScheduleOptionsResponse(
            business_date=today,
            classification=DateClassification(
                time_direction="TODAY",
                distance="EXACT",
                anchor_relative="UNCHANGED",
                case_code="BLOCKED",
                summary="Chưa có lịch thu ban đầu",
            ),
            current_anchor_date=None,
            new_anchor_date=data.anchor_date,
            expected_version=enrollment.billing_anchor_version,
            financial_state=FinancialStateInfo(),
            options=[],
            is_blocked=True,
            blocked_reason="Cần kiểm tra lịch thu cũ trước khi điều chỉnh",
            context_token=token,
        )

    context_token = compute_context_token(
        enrollment, revision, data.anchor_date, today, deferral_days, snapshots
    )

    if (
        enrollment.status != "active"
        or enrollment.student.status != "active"
        or enrollment.class_.stopped_at
        or enrollment.class_.cancelled_at
    ):
        return BillingScheduleOptionsResponse(
            business_date=today,
            classification=DateClassification(
                time_direction="TODAY",
                distance="EXACT",
                anchor_relative="UNCHANGED",
                case_code="BLOCKED",
                summary="Lượt học không còn hoạt động",
            ),
            current_anchor_date=revision.anchor_date,
            new_anchor_date=data.anchor_date,
            expected_version=enrollment.billing_anchor_version,
            financial_state=FinancialStateInfo(),
            options=[],
            is_blocked=True,
            blocked_reason="Lượt học không còn hoạt động; chỉ có thể xử lý khoản thu đã phát sinh",
            context_token=context_token,
        )

    if revision.state not in {"PENDING", "CONFIRMED"}:
        return BillingScheduleOptionsResponse(
            business_date=today,
            classification=DateClassification(
                time_direction="TODAY",
                distance="EXACT",
                anchor_relative="UNCHANGED",
                case_code="BLOCKED",
                summary="Lịch thu hiện tại không còn hiệu lực",
            ),
            current_anchor_date=revision.anchor_date,
            new_anchor_date=data.anchor_date,
            expected_version=enrollment.billing_anchor_version,
            financial_state=FinancialStateInfo(),
            options=[],
            is_blocked=True,
            blocked_reason="Lịch thu hiện tại không còn hiệu lực. Vui lòng tải lại dữ liệu lượt học.",
            context_token=context_token,
        )

    if data.expected_version != enrollment.billing_anchor_version:
        return BillingScheduleOptionsResponse(
            business_date=today,
            classification=DateClassification(
                time_direction="TODAY",
                distance="EXACT",
                anchor_relative="UNCHANGED",
                case_code="BLOCKED",
                summary="Lịch thu vừa thay đổi",
            ),
            current_anchor_date=revision.anchor_date,
            new_anchor_date=data.anchor_date,
            expected_version=enrollment.billing_anchor_version,
            financial_state=FinancialStateInfo(),
            options=[],
            is_blocked=True,
            blocked_reason="Lịch thu vừa thay đổi. Vui lòng xem lại.",
            context_token=context_token,
        )

    kind = revision.billing_type_snapshot
    weeks = revision.billing_cycle_weeks_snapshot
    current_anchor = revision.anchor_date

    curr_cycle_no = cycle_covering_date(current_anchor, kind, weeks, today)
    curr_start, curr_end = cycle_coverage_interval(
        current_anchor, kind, weeks, curr_cycle_no
    )
    prev_start, prev_end = (
        cycle_coverage_interval(current_anchor, kind, weeks, curr_cycle_no - 1)
        if curr_cycle_no > 0
        else (None, None)
    )
    next_start, next_end = cycle_coverage_interval(
        current_anchor, kind, weeks, curr_cycle_no + 1
    )

    active_fees = [f for f in snapshots if f.active]
    protected_fees = [f for f in active_fees if f.protected]
    mutable_fees = [f for f in active_fees if not f.protected and f.status == "UNPAID"]
    unpaid_notified = [f for f in active_fees if f.notified and f.status == "UNPAID"]

    protected_ends = [f.coverage.end for f in protected_fees if f.coverage]
    protected_through = max(protected_ends) if protected_ends else None
    try:
        effective_waivers, replaceable_waivers = waiver_scope(
            revision, today, replace_future=data.replace_future_waivers
        )
    except BillingPlanError as exc:
        raise admission_conflict(exc.code, str(exc)) from exc
    waivers = [{"start": str(s.start), "end": str(s.end)} for s in effective_waivers]
    excluded_ends = (
        [date.fromisoformat(s["end"]) for s in waivers]
        if isinstance(waivers, list)
        else []
    )
    excluded_ends += [
        f.coverage.end for f in snapshots if f.status == "VOID" and f.coverage
    ]
    has_current_protected = any(
        f.coverage and f.coverage.start <= today < f.coverage.end
        for f in protected_fees
    )

    active_covering_today = [
        f
        for f in active_fees
        if f.coverage and f.coverage.start <= today < f.coverage.end
    ]
    if active_covering_today:
        eff_curr_start = active_covering_today[0].coverage.start
        eff_curr_end = active_covering_today[0].coverage.end
    else:
        eff_curr_start = curr_start
        eff_curr_end = curr_end

    cycle_info = CycleBoundaryInfo(
        current_cycle_no=curr_cycle_no,
        current_cycle_start=eff_curr_start,
        current_cycle_end=eff_curr_end,
        prev_cycle_start=prev_start,
        prev_cycle_end=prev_end,
        next_cycle_start=next_start,
        next_cycle_end=next_end,
        billing_type=kind,
        cycle_weeks=weeks,
    )

    if data.anchor_date == today:
        time_dir: Literal["PAST", "TODAY", "FUTURE"] = "TODAY"
    elif data.anchor_date < today:
        time_dir = "PAST"
    else:
        time_dir = "FUTURE"

    if data.anchor_date == current_anchor:
        anchor_rel: Literal["EARLIER", "LATER", "UNCHANGED"] = "UNCHANGED"
    elif data.anchor_date < current_anchor:
        anchor_rel = "EARLIER"
    else:
        anchor_rel = "LATER"

    if data.anchor_date == current_anchor:
        dist: Literal["NEAR", "FAR", "EXACT", "UNCHANGED"] = "UNCHANGED"
    elif time_dir == "TODAY":
        dist = "EXACT"
    elif time_dir == "PAST":
        dist = (
            "NEAR"
            if (prev_start is not None and data.anchor_date >= prev_start)
            else "FAR"
        )
    else:
        dist = "NEAR" if data.anchor_date < next_start else "FAR"

    financial_state = FinancialStateInfo(
        protected_through=protected_through,
        has_protected_fees=len(protected_fees) > 0,
        protected_count=len(protected_fees),
        mutable_count=len(mutable_fees),
        unpaid_notified_count=len(unpaid_notified),
        active_fees_count=len(active_fees),
    )

    is_unstarted = (
        enrollment.enrollment_date is not None and enrollment.enrollment_date > today
    ) or (
        enrollment.class_.start_date is not None
        and enrollment.class_.start_date > today
    )

    if data.anchor_date == current_anchor:
        case_code: Literal[
            "UNCHANGED",
            "UNSTARTED",
            "ACTIVE_NO_FEES",
            "NEAR_PAST",
            "FAR_PAST",
            "TODAY",
            "NEAR_FUTURE",
            "FAR_FUTURE",
            "BLOCKED",
        ] = "UNCHANGED"
        summary = "Ngày không thay đổi. Xem lịch đang áp dụng."
    elif is_unstarted:
        case_code = "UNSTARTED"
        summary = "Lượt học chưa bắt đầu. Thiết lập mốc tính phí mới từ đầu."
    elif len(active_fees) == 0:
        case_code = "ACTIVE_NO_FEES"
        summary = "Đang học nhưng chưa có khoản phí. Kỳ đầu tiên tính từ kỳ hiện tại hoặc kế tiếp."
    elif time_dir == "TODAY":
        case_code = "TODAY"
        summary = "Mốc mới đúng ngày hôm nay."
    elif time_dir == "PAST":
        if dist == "NEAR":
            case_code = "NEAR_PAST"
            summary = "Mốc mới thuộc quá khứ gần (từ đầu kỳ trước đến trước hôm nay)."
        else:
            case_code = "FAR_PAST"
            summary = "Mốc mới thuộc quá khứ xa (trước đầu kỳ liền trước)."
    else:
        if dist == "NEAR":
            case_code = "NEAR_FUTURE"
            summary = (
                "Mốc mới thuộc tương lai gần (sau hôm nay nhưng trước kỳ tiếp theo)."
            )
        else:
            case_code = "FAR_FUTURE"
            summary = "Mốc mới thuộc tương lai xa (từ đầu kỳ tiếp theo trở đi)."

    classification = DateClassification(
        time_direction=time_dir,
        distance=dist,
        anchor_relative=anchor_rel,
        case_code=case_code,
        summary=summary,
    )

    effective_amount = int(
        enrollment.custom_fee
        if enrollment.custom_fee is not None
        else enrollment.class_.base_fee
    )

    all_historical: list[HistoricalCycleItem] = []
    transition_boundary = max(today, protected_through) if protected_through else today
    historical_floor = max(
        enrollment.enrollment_date or data.anchor_date,
        data.historical_from_date or data.anchor_date,
    )
    c_cand = next_canonical_cycle_on_or_after(
        data.anchor_date, kind, weeks, historical_floor
    )
    while True:
        c_start, c_end = cycle_coverage_interval(data.anchor_date, kind, weeks, c_cand)
        if c_end > transition_boundary:
            break
        if enrollment.enrollment_date and c_start < enrollment.enrollment_date:
            c_cand += 1
            continue
        if (data.historical_from_date and c_start < data.historical_from_date) or (
            data.historical_to_date and c_end > data.historical_to_date
        ):
            c_cand += 1
            continue
        has_overlap = any(
            f.coverage is not None and f.coverage.overlaps(Interval(c_start, c_end))
            for f in snapshots
            if f.active or f.status == "VOID"
        )
        if isinstance(waivers, list):
            has_overlap = has_overlap or any(
                date.fromisoformat(s["start"]) < c_end
                and c_start < date.fromisoformat(s["end"])
                for s in waivers
            )
        if not has_overlap:
            c_due = cycle_base_due_date(data.anchor_date, kind, weeks, c_cand)
            lbl = f"Kỳ {c_start.strftime('%d/%m/%Y')} – {c_end.strftime('%d/%m/%Y')}: {effective_amount:,.0f}đ"
            all_historical.append(
                HistoricalCycleItem(
                    cycle_no=c_cand,
                    coverage_start=c_start,
                    coverage_end=c_end,
                    base_due_date=c_due,
                    amount=effective_amount,
                    label=lbl,
                )
            )
        c_cand += 1

    h_offset = data.historical_offset
    h_limit = data.historical_limit
    paginated_historical = all_historical[h_offset : h_offset + h_limit]
    has_more_h = (h_offset + h_limit) < len(all_historical)
    next_h_offset = (h_offset + h_limit) if has_more_h else None

    options: list[BillingScheduleOptionItem] = []

    def simulate_candidate(cand_strategy: str, cand_first_cycle: int | None = None):
        try:
            p, act_start = build_plan_for_strategy(
                enrollment=enrollment,
                revision=revision,
                snapshots=snapshots,
                anchor_date=data.anchor_date,
                expected_version=data.expected_version,
                strategy=cand_strategy,
                first_cycle=cand_first_cycle,
                historical_cycles=(),
                gap_policy="WAIVE",
                reason="Phân tích phương án",
                today=today,
                replace_future_waivers=data.replace_future_waivers,
            )
            return True, None, False, act_start, None, None, None, None
        except BillingPlanError as exc:
            return False, str(exc), False, None, None, None, None, None

    # Check whether current cycle has been paid to protect financial reports
    current_cycle_records = [
        r
        for r in records
        if r.status not in ("VOID", "SUPERSEDED")
        and (
            (
                r.coverage_start is not None
                and r.coverage_end is not None
                and (
                    (r.coverage_start <= today < r.coverage_end)
                    or (r.coverage_start == curr_start and r.coverage_end == curr_end)
                    or (
                        curr_start <= r.coverage_start < curr_end
                        and r.coverage_end > today
                    )
                )
            )
            or (
                r.coverage_start is None
                and (
                    curr_start
                    <= (r.adjusted_due_date or r.due_date or curr_start)
                    < curr_end
                )
            )
        )
    ]

    def record_is_paid(r: FeeRecord) -> bool:
        if getattr(r, "status", None) == "PAID":
            return True
        if getattr(r, "paid_date", None) is not None:
            return True
        paid_amt = getattr(r, "paid_amount", None)
        if paid_amt is not None and paid_amt > 0:
            return True
        if getattr(r, "status", None) in ("REFUNDED", "PARTIALLY_REFUNDED"):
            return True
        ref_amt = getattr(r, "refunded_amount", None)
        if ref_amt is not None and ref_amt > 0:
            return True
        if bool(getattr(r, "payments", None)):
            return True
        return False

    is_current_paid = any(record_is_paid(r) for r in current_cycle_records)
    current_dues = [
        r.adjusted_due_date or r.due_date
        for r in current_cycle_records
        if isinstance(r.adjusted_due_date or r.due_date, date)
    ]
    old_due_date = min(current_dues, default=curr_start)
    safe_floor = max(
        [
            eff_curr_end,
            enrollment.enrollment_date or today,
            *protected_ends,
            *excluded_ends,
        ]
    )
    c_next = next_canonical_cycle_on_or_after(data.anchor_date, kind, weeks, safe_floor)
    recurrence_description = (
        f"Các kỳ sau cách nhau {weeks} tuần ({weeks * 7} ngày)."
        if kind == "COURSE"
        else f"Các kỳ sau thu vào ngày {data.anchor_date.day:02d} hàng tháng."
    )
    if data.anchor_date > today:
        c_rep = next_canonical_cycle_on_or_after(
            data.anchor_date, kind, weeks, data.anchor_date
        )
    elif protected_through is not None and protected_through > curr_end:
        c_rep = next_canonical_cycle_on_or_after(
            data.anchor_date, kind, weeks, protected_through
        )
    elif kind == "MONTHLY":
        ref_d = curr_start or today
        c_rep = max(
            0,
            (ref_d.year - data.anchor_date.year) * 12
            + (ref_d.month - data.anchor_date.month),
        )
    else:
        c_rep = cycle_covering_date(data.anchor_date, kind, weeks, curr_start or today)

    if case_code == "UNCHANGED":
        options.append(
            BillingScheduleOptionItem(
                id="UNCHANGED",
                strategy="UNCHANGED",
                label="Xem lịch hiện tại",
                description="Lịch thu không thay đổi. Xem chi tiết các chu kỳ đang áp dụng.",
                is_recommended=True,
                is_allowed=True,
                actual_cycle_end=eff_curr_end,
                old_due_date=old_due_date,
                is_current_paid=is_current_paid,
            )
        )
    elif case_code == "UNSTARTED":
        start_cycle = next_canonical_cycle_on_or_after(
            data.anchor_date,
            kind,
            weeks,
            max(
                [
                    today,
                    enrollment.enrollment_date or today,
                    *protected_ends,
                    *excluded_ends,
                ]
            ),
        )
        cand_from = compute_candidate_cycles(
            "FROM_CYCLE",
            data.anchor_date,
            kind,
            weeks,
            curr_start,
            curr_end,
            today,
            old_due_date,
            is_current_paid,
            case_code,
            simulate_candidate,
            default_cycle=start_cycle,
        )
        ok, err, req_gap, act_start, est_amt, g_days, g_start, g_end = (
            simulate_candidate("FROM_CYCLE", start_cycle)
        )
        desc = f"Thiết lập mốc tính phí mới từ {data.anchor_date.strftime('%d/%m/%Y')}."
        if act_start and act_start != data.anchor_date:
            desc = f"Kỳ mới thực tế bắt đầu từ {act_start.strftime('%d/%m/%Y')}."
        options.append(
            BillingScheduleOptionItem(
                id="FROM_CYCLE",
                strategy="FROM_CYCLE",
                label="Chọn kỳ bắt đầu tính phí",
                description=desc,
                is_recommended=ok,
                is_allowed=ok,
                disabled_reason=err,
                suggested_first_cycle=start_cycle,
                requires_gap_policy=False,
                actual_cycle_end=eff_curr_end,
                new_due_date=data.anchor_date,
                candidate_cycles=cand_from,
            )
        )
    elif case_code == "ACTIVE_NO_FEES":
        start_cycle = (
            cycle_covering_date(data.anchor_date, kind, weeks, today)
            if time_dir == "PAST"
            else 0
        )
        c_start, c_end = cycle_coverage_interval(
            data.anchor_date, kind, weeks, start_cycle
        )
        cand_from = compute_candidate_cycles(
            "FROM_CYCLE",
            data.anchor_date,
            kind,
            weeks,
            curr_start,
            curr_end,
            today,
            old_due_date,
            is_current_paid,
            case_code,
            simulate_candidate,
        )
        ok, err, req_gap, act_start, est_amt, g_days, g_start, g_end = (
            simulate_candidate("FROM_CYCLE", start_cycle)
        )
        desc = f"Bắt đầu chu kỳ từ {c_start.strftime('%d/%m/%Y')} đến {c_end.strftime('%d/%m/%Y')}. Không tự tạo nợ quá khứ."
        if act_start and act_start != c_start:
            desc = f"Kỳ mới thực tế bắt đầu từ {act_start.strftime('%d/%m/%Y')}."
        options.append(
            BillingScheduleOptionItem(
                id="FROM_CYCLE",
                strategy="FROM_CYCLE",
                label="Tính phí từ kỳ hiện tại",
                description=desc,
                is_recommended=ok,
                is_allowed=ok,
                disabled_reason=err,
                suggested_first_cycle=start_cycle,
                requires_gap_policy=False,
                requires_historical_selection=len(all_historical) > 0,
                available_historical_cycles=paginated_historical,
                has_more_historical_cycles=has_more_h,
                total_historical_cycles_count=len(all_historical),
                historical_offset=h_offset,
                historical_limit=h_limit,
                next_historical_offset=next_h_offset,
                actual_cycle_end=eff_curr_end,
                new_due_date=c_start,
                candidate_cycles=cand_from,
            )
        )
    elif case_code in ("NEAR_PAST", "FAR_PAST"):
        cand_keep = compute_candidate_cycles(
            "KEEP_CURRENT",
            data.anchor_date,
            kind,
            weeks,
            curr_start,
            curr_end,
            today,
            old_due_date,
            is_current_paid,
            case_code,
            simulate_candidate,
            default_cycle=c_next,
        )
        def_keep_c = next((c.cycle_no for c in cand_keep if c.is_default), c_next)
        def_keep_due = cycle_coverage_interval(
            data.anchor_date, kind, weeks, def_keep_c
        )[0]
        (
            ok_keep,
            err_keep,
            req_gap_keep,
            act_start_keep,
            est_amt_keep,
            g_days_keep,
            g_start_keep,
            g_end_keep,
        ) = simulate_candidate("KEEP_CURRENT", def_keep_c)
        desc_keep = (
            f"Kỳ hiện tại vẫn giữ hạn thu {old_due_date.strftime('%d/%m/%Y')}. "
            f"Mốc mới áp dụng từ kỳ sau (hạn thu {def_keep_due.strftime('%d/%m/%Y')})."
        )
        options.append(
            BillingScheduleOptionItem(
                id="KEEP_CURRENT",
                strategy="KEEP_CURRENT",
                label="Áp dụng mốc mới từ kỳ tiếp theo",
                description=desc_keep,
                is_recommended=ok_keep,
                is_allowed=ok_keep,
                disabled_reason=err_keep,
                requires_gap_policy=False,
                requires_historical_selection=False,
                available_historical_cycles=[],
                has_more_historical_cycles=False,
                total_historical_cycles_count=0,
                historical_offset=h_offset,
                historical_limit=h_limit,
                next_historical_offset=None,
                actual_cycle_end=eff_curr_end,
                old_due_date=old_due_date,
                next_due_date=def_keep_due,
                is_current_paid=is_current_paid,
                suggested_first_cycle=def_keep_c,
                candidate_cycles=cand_keep,
            )
        )

        cand_rep = compute_candidate_cycles(
            "REPLACE_CURRENT",
            data.anchor_date,
            kind,
            weeks,
            curr_start,
            curr_end,
            today,
            old_due_date,
            is_current_paid,
            case_code,
            simulate_candidate,
            default_cycle=c_rep,
        )
        def_rep_c = next((c.cycle_no for c in cand_rep if c.is_default), c_rep)
        def_rep_due = cycle_coverage_interval(data.anchor_date, kind, weeks, def_rep_c)[
            0
        ]
        (
            ok_rep,
            err_rep,
            req_gap_rep,
            act_start_rep,
            est_amt_rep,
            g_days_rep,
            g_start_rep,
            g_end_rep,
        ) = simulate_candidate("REPLACE_CURRENT", def_rep_c)
        if is_current_paid:
            rep_allowed = False
            rep_disabled_reason = "Không khả dụng vì kỳ hiện tại đã nộp học phí, không thể thay đổi hạn thu kỳ này để tránh sai lệch báo cáo tài chính."
            desc_rep = rep_disabled_reason
        else:
            rep_allowed = ok_rep
            rep_disabled_reason = err_rep
            desc_rep = (
                (
                    f"Đổi hạn thu kỳ này sang ngày {def_rep_due.strftime('%d/%m/%Y')} "
                    f"(thay vì {old_due_date.strftime('%d/%m/%Y')}). "
                    f"{recurrence_description}"
                )
                if ok_rep
                else (err_rep or "Không thể áp dụng cho kỳ hiện tại.")
            )

        options.append(
            BillingScheduleOptionItem(
                id="REPLACE_CURRENT",
                strategy="REPLACE_CURRENT",
                label="Áp dụng mốc mới ngay kỳ hiện tại",
                description=desc_rep,
                is_recommended=False,
                is_allowed=rep_allowed,
                disabled_reason=rep_disabled_reason,
                requires_gap_policy=False,
                actual_cycle_end=eff_curr_end,
                new_due_date=def_rep_due,
                old_due_date=old_due_date,
                is_current_paid=is_current_paid,
                suggested_first_cycle=def_rep_c,
                candidate_cycles=cand_rep,
            )
        )
    elif case_code == "TODAY":
        cand_keep = compute_candidate_cycles(
            "KEEP_CURRENT",
            data.anchor_date,
            kind,
            weeks,
            curr_start,
            curr_end,
            today,
            old_due_date,
            is_current_paid,
            case_code,
            simulate_candidate,
            default_cycle=c_next,
        )
        def_keep_c = next((c.cycle_no for c in cand_keep if c.is_default), c_next)
        def_keep_due = cycle_coverage_interval(
            data.anchor_date, kind, weeks, def_keep_c
        )[0]
        (
            ok_keep,
            err_keep,
            req_gap_keep,
            act_start_keep,
            est_amt_keep,
            g_days_keep,
            g_start_keep,
            g_end_keep,
        ) = simulate_candidate("KEEP_CURRENT", def_keep_c)
        desc_keep = (
            f"Kỳ hiện tại vẫn giữ hạn thu {old_due_date.strftime('%d/%m/%Y')}. "
            f"Mốc mới áp dụng từ kỳ sau (hạn thu {def_keep_due.strftime('%d/%m/%Y')})."
        )
        options.append(
            BillingScheduleOptionItem(
                id="KEEP_CURRENT",
                strategy="KEEP_CURRENT",
                label="Áp dụng mốc mới từ kỳ tiếp theo",
                description=desc_keep,
                is_recommended=ok_keep and (is_current_paid or has_current_protected),
                is_allowed=ok_keep,
                disabled_reason=err_keep,
                requires_gap_policy=False,
                actual_cycle_end=eff_curr_end,
                old_due_date=old_due_date,
                next_due_date=def_keep_due,
                is_current_paid=is_current_paid,
                suggested_first_cycle=def_keep_c,
                candidate_cycles=cand_keep,
            )
        )

        cand_rep = compute_candidate_cycles(
            "REPLACE_CURRENT",
            data.anchor_date,
            kind,
            weeks,
            curr_start,
            curr_end,
            today,
            old_due_date,
            is_current_paid,
            case_code,
            simulate_candidate,
            default_cycle=c_rep,
        )
        def_rep_c = next((c.cycle_no for c in cand_rep if c.is_default), c_rep)
        def_rep_due = cycle_coverage_interval(data.anchor_date, kind, weeks, def_rep_c)[
            0
        ]
        (
            ok_rep,
            err_rep,
            req_gap_rep,
            act_start_rep,
            est_amt_rep,
            g_days_rep,
            g_start_rep,
            g_end_rep,
        ) = simulate_candidate("REPLACE_CURRENT", def_rep_c)
        if is_current_paid:
            rep_allowed = False
            rep_disabled_reason = "Không khả dụng vì kỳ hiện tại đã nộp học phí, không thể thay đổi hạn thu kỳ này để tránh sai lệch báo cáo tài chính."
            desc_rep = rep_disabled_reason
        else:
            rep_allowed = ok_rep
            rep_disabled_reason = err_rep
            desc_rep = (
                (
                    f"Đổi hạn thu kỳ này sang ngày {def_rep_due.strftime('%d/%m/%Y')} "
                    f"(thay vì {old_due_date.strftime('%d/%m/%Y')}). "
                    f"{recurrence_description}"
                )
                if ok_rep
                else (err_rep or "Không thể áp dụng cho kỳ hiện tại.")
            )

        options.append(
            BillingScheduleOptionItem(
                id="REPLACE_CURRENT",
                strategy="REPLACE_CURRENT",
                label="Áp dụng mốc mới ngay kỳ hiện tại",
                description=desc_rep,
                is_recommended=rep_allowed
                and not is_current_paid
                and not has_current_protected,
                is_allowed=rep_allowed,
                disabled_reason=rep_disabled_reason,
                requires_gap_policy=False,
                actual_cycle_end=eff_curr_end,
                new_due_date=def_rep_due,
                old_due_date=old_due_date,
                is_current_paid=is_current_paid,
                suggested_first_cycle=def_rep_c,
                candidate_cycles=cand_rep,
            )
        )
    elif case_code == "NEAR_FUTURE":
        cand_keep = compute_candidate_cycles(
            "KEEP_CURRENT",
            data.anchor_date,
            kind,
            weeks,
            curr_start,
            curr_end,
            today,
            old_due_date,
            is_current_paid,
            case_code,
            simulate_candidate,
            default_cycle=c_next,
        )
        def_keep_c = next((c.cycle_no for c in cand_keep if c.is_default), c_next)
        def_keep_due = cycle_coverage_interval(
            data.anchor_date, kind, weeks, def_keep_c
        )[0]
        (
            ok_keep,
            err_keep,
            req_gap_keep,
            act_start_keep,
            est_amt_keep,
            g_days_keep,
            g_start_keep,
            g_end_keep,
        ) = simulate_candidate("KEEP_CURRENT", def_keep_c)
        desc_keep = (
            f"Kỳ hiện tại vẫn giữ hạn thu {old_due_date.strftime('%d/%m/%Y')}. "
            f"Mốc mới áp dụng từ kỳ sau (hạn thu {def_keep_due.strftime('%d/%m/%Y')})."
        )
        options.append(
            BillingScheduleOptionItem(
                id="KEEP_CURRENT",
                strategy="KEEP_CURRENT",
                label="Áp dụng mốc mới từ kỳ tiếp theo",
                description=desc_keep,
                is_recommended=ok_keep,
                is_allowed=ok_keep,
                disabled_reason=err_keep,
                requires_gap_policy=False,
                actual_cycle_end=eff_curr_end,
                old_due_date=old_due_date,
                next_due_date=def_keep_due,
                is_current_paid=is_current_paid,
                suggested_first_cycle=def_keep_c,
                candidate_cycles=cand_keep,
            )
        )

        cand_rep = compute_candidate_cycles(
            "REPLACE_CURRENT",
            data.anchor_date,
            kind,
            weeks,
            curr_start,
            curr_end,
            today,
            old_due_date,
            is_current_paid,
            case_code,
            simulate_candidate,
            default_cycle=c_rep,
        )
        def_rep_c = next((c.cycle_no for c in cand_rep if c.is_default), c_rep)
        def_rep_due = cycle_coverage_interval(data.anchor_date, kind, weeks, def_rep_c)[
            0
        ]
        (
            ok_rep,
            err_rep,
            req_gap_rep,
            act_start_rep,
            est_amt_rep,
            g_days_rep,
            g_start_rep,
            g_end_rep,
        ) = simulate_candidate("REPLACE_CURRENT", def_rep_c)
        if is_current_paid:
            rep_allowed = False
            rep_disabled_reason = "Không khả dụng vì kỳ hiện tại đã nộp học phí, không thể thay đổi hạn thu kỳ này để tránh sai lệch báo cáo tài chính."
            desc_rep = rep_disabled_reason
        else:
            rep_allowed = ok_rep
            rep_disabled_reason = err_rep
            desc_rep = (
                (
                    f"Đổi hạn thu kỳ này sang ngày {def_rep_due.strftime('%d/%m/%Y')} "
                    f"(thay vì {old_due_date.strftime('%d/%m/%Y')}). "
                    f"{recurrence_description}"
                )
                if ok_rep
                else (err_rep or "Không thể áp dụng cho kỳ hiện tại.")
            )

        options.append(
            BillingScheduleOptionItem(
                id="REPLACE_CURRENT",
                strategy="REPLACE_CURRENT",
                label="Áp dụng mốc mới ngay kỳ hiện tại",
                description=desc_rep,
                is_recommended=False,
                is_allowed=rep_allowed,
                disabled_reason=rep_disabled_reason,
                requires_gap_policy=False,
                actual_cycle_end=eff_curr_end,
                new_due_date=def_rep_due,
                old_due_date=old_due_date,
                is_current_paid=is_current_paid,
                suggested_first_cycle=def_rep_c,
                candidate_cycles=cand_rep,
            )
        )
    else:  # FAR_FUTURE
        cand_cont = compute_candidate_cycles(
            "CONTINUE_OLD_UNTIL_NEW",
            data.anchor_date,
            kind,
            weeks,
            curr_start,
            curr_end,
            today,
            old_due_date,
            is_current_paid,
            case_code,
            simulate_candidate,
            default_cycle=c_next,
        )
        (
            ok_cont,
            err_cont,
            req_gap_cont,
            act_start_cont,
            est_amt_cont,
            g_days_cont,
            g_start_cont,
            g_end_cont,
        ) = simulate_candidate("CONTINUE_OLD_UNTIL_NEW")
        desc_cont = (
            f"Các kỳ trước ngày {data.anchor_date.strftime('%d/%m/%Y')} tiếp tục thu theo lịch cũ. "
            f"Mốc mới bắt đầu áp dụng từ {data.anchor_date.strftime('%d/%m/%Y')}."
        )
        options.append(
            BillingScheduleOptionItem(
                id="CONTINUE_OLD_UNTIL_NEW",
                strategy="CONTINUE_OLD_UNTIL_NEW",
                label="Tiếp tục thu theo hạn cũ đến ngày mốc mới",
                description=desc_cont,
                is_recommended=ok_cont,
                is_allowed=ok_cont,
                disabled_reason=err_cont,
                requires_gap_policy=False,
                actual_cycle_end=eff_curr_end,
                old_due_date=old_due_date,
                new_due_date=data.anchor_date,
                is_current_paid=is_current_paid,
                candidate_cycles=cand_cont,
            )
        )

        cand_pause = compute_candidate_cycles(
            "KEEP_CURRENT",
            data.anchor_date,
            kind,
            weeks,
            curr_start,
            curr_end,
            today,
            old_due_date,
            is_current_paid,
            case_code,
            simulate_candidate,
            default_cycle=c_next,
        )
        (
            ok_keep,
            err_keep,
            req_gap_keep,
            act_start_keep,
            est_amt_keep,
            g_days_keep,
            g_start_keep,
            g_end_keep,
        ) = simulate_candidate("KEEP_CURRENT")
        desc_pause = (
            f"Tạm dừng phát sinh các kỳ học phí tiếp theo cho đến {data.anchor_date.strftime('%d/%m/%Y')}. "
            f"Bắt đầu thu lại từ ngày này."
        )
        options.append(
            BillingScheduleOptionItem(
                id="KEEP_CURRENT",
                strategy="KEEP_CURRENT",
                label=f"Tạm ngưng thu cho tới ngày {data.anchor_date.strftime('%d/%m/%Y')}",
                description=desc_pause,
                is_recommended=False if ok_cont else ok_keep,
                is_allowed=ok_keep,
                disabled_reason=err_keep,
                requires_gap_policy=False,
                actual_cycle_end=eff_curr_end,
                old_due_date=old_due_date,
                new_due_date=data.anchor_date,
                is_current_paid=is_current_paid,
                candidate_cycles=cand_pause,
            )
        )

    # Render the final collection deadline, not the unadjusted schedule anchor.
    due_cache: dict[date, date] = {}
    for option in options:
        for candidate in option.candidate_cycles:
            if candidate.coverage_start not in due_cache:
                shift = await enrollment_total_deferral_days(
                    db,
                    enrollment.id,
                    coverage_start=candidate.coverage_start,
                    include_unallocated=True,
                )
                due_cache[candidate.coverage_start] = (
                    candidate.coverage_start + timedelta(days=shift)
                )
            candidate.due_date = due_cache[candidate.coverage_start]
            candidate.label = candidate.due_date.strftime("%d/%m/%Y")
            candidate.description = (
                f"Kỳ bắt đầu {candidate.coverage_start.strftime('%d/%m/%Y')}; "
                f"hạn thu thực tế {candidate.due_date.strftime('%d/%m/%Y')}"
            )
        selected = next(
            (c for c in option.candidate_cycles if c.is_default),
            next(iter(option.candidate_cycles), None),
        )
        if selected is not None:
            previous_due = option.new_due_date
            option.new_due_date = selected.due_date
            option.next_due_date = selected.due_date
            if previous_due is not None and previous_due != selected.due_date:
                option.description = option.description.replace(
                    previous_due.strftime("%d/%m/%Y"),
                    selected.due_date.strftime("%d/%m/%Y"),
                )

    rec_id = next(
        (opt.id for opt in options if opt.is_recommended and opt.is_allowed), None
    )
    if not rec_id:
        allowed_opt = next((opt for opt in options if opt.is_allowed), None)
        if allowed_opt:
            allowed_opt.is_recommended = True
            rec_id = allowed_opt.id

    all_blocked = len(options) > 0 and all(not opt.is_allowed for opt in options)
    blocked_msg = options[0].disabled_reason if (all_blocked and options) else None

    return BillingScheduleOptionsResponse(
        business_date=today,
        classification=classification,
        current_anchor_date=revision.anchor_date,
        new_anchor_date=data.anchor_date,
        expected_version=enrollment.billing_anchor_version,
        cycle_info=cycle_info,
        financial_state=financial_state,
        options=options,
        recommended_option_id=rec_id,
        is_blocked=all_blocked,
        blocked_reason=blocked_msg,
        context_token=context_token,
        pending_review=pending_review_context(revision, snapshots),
        replaceable_waived_intervals=list(replaceable_waivers),
    )


async def prepare_billing_schedule(
    db: AsyncSession,
    enrollment: Enrollment,
    snapshots: tuple[FeeSnapshot, ...],
    data: BillingSchedulePreviewRequest,
):
    from app.services.credit_service import enrollment_total_deferral_days

    revision = enrollment.current_billing_revision
    try:
        validate_anchor_date(enrollment, data.anchor_date)
    except BillingPlanError as exc:
        raise admission_conflict(exc.code, str(exc)) from exc
    if revision is None:
        raise admission_conflict(
            "BILLING_BASELINE_REQUIRED", "Cần kiểm tra lịch thu cũ trước khi điều chỉnh"
        )
    if (
        enrollment.status != "active"
        or enrollment.student.status != "active"
        or enrollment.class_.stopped_at
        or enrollment.class_.cancelled_at
    ):
        raise admission_conflict(
            "MEMBERSHIP_NOT_EDITABLE",
            "Lượt học không còn hoạt động; chỉ có thể xử lý khoản thu đã phát sinh",
        )
    if revision.state not in {"PENDING", "CONFIRMED"}:
        raise admission_conflict(
            "BILLING_SCHEDULE_CHANGED", "Lịch thu không còn hiệu lực. Vui lòng tải lại."
        )
    if revision.state == "PENDING" and (
        str(data.expected_pending_review_id) != str(revision.id)
        or data.expected_context_token is None
    ):
        raise admission_conflict(
            "BILLING_REVIEW_PENDING",
            "Vui lòng xem phương án xử lý lịch đang chờ trong lần đổi mốc này.",
        )
    if revision.state != "PENDING" and data.expected_pending_review_id is not None:
        raise admission_conflict(
            "STALE_OPTIONS_CONTEXT",
            "Lịch chờ đã được xử lý. Vui lòng xem lại phương án.",
        )
    if data.expected_version != enrollment.billing_anchor_version:
        raise admission_conflict(
            "BILLING_SCHEDULE_CHANGED", "Lịch thu vừa thay đổi. Vui lòng xem lại."
        )
    today = business_today()
    deferral = await enrollment_total_deferral_days(
        db, enrollment.id, include_unallocated=True
    )

    if data.expected_context_token is not None:
        current_token = compute_context_token(
            enrollment, revision, data.anchor_date, today, deferral, snapshots
        )
        if data.expected_context_token != current_token:
            raise admission_conflict(
                "STALE_OPTIONS_CONTEXT",
                "Dữ liệu học phí hoặc lịch thu đã thay đổi. Vui lòng xem lại phân tích phương án.",
            )

    if data.strategy == "REPLACE_CURRENT":
        curr_cycle_no = cycle_covering_date(
            revision.anchor_date,
            revision.billing_type_snapshot,
            revision.billing_cycle_weeks_snapshot,
            today,
        )
        curr_start, curr_end = cycle_coverage_interval(
            revision.anchor_date,
            revision.billing_type_snapshot,
            revision.billing_cycle_weeks_snapshot,
            curr_cycle_no,
        )

        def _snap_covers_current(snap: FeeSnapshot) -> bool:
            if snap.coverage:
                c_start, c_end = snap.coverage.start, snap.coverage.end
                if c_start <= today < c_end:
                    return True
                if c_start == curr_start and c_end == curr_end:
                    return True
                if curr_start <= c_start < curr_end and c_end > today:
                    return True
                return False
            return False

        paid_current = any(
            f.active
            and (f.is_paid or f.status == "PAID" or f.has_settlement)
            and _snap_covers_current(f)
            for f in snapshots
        )
        if paid_current:
            raise admission_conflict(
                "CURRENT_FEE_ALREADY_PAID",
                "Kỳ hiện tại đã nộp học phí, không thể thay đổi hạn thu kỳ này để tránh sai lệch báo cáo tài chính.",
            )

    try:
        first_cycle = data.first_cycle
        if data.apply_from_date is not None:
            first_cycle = next_canonical_cycle_on_or_after(
                data.anchor_date,
                revision.billing_type_snapshot,
                revision.billing_cycle_weeks_snapshot,
                data.apply_from_date,
            )
        plan, _ = build_plan_for_strategy(
            enrollment=enrollment,
            revision=revision,
            snapshots=snapshots,
            anchor_date=data.anchor_date,
            expected_version=data.expected_version,
            strategy=data.strategy,
            first_cycle=first_cycle,
            historical_cycles=tuple(data.historical_cycles),
            gap_policy="WAIVE",
            reason=data.reason,
            today=today,
            custom_transition_amount=None,
            replace_future_waivers=data.replace_future_waivers,
        )
    except BillingPlanError as exc:
        raise admission_conflict(exc.code, str(exc)) from exc

    from app.services.suspension_boundary_service import plan_waiver_preservation

    preservation = await plan_waiver_preservation(db, enrollment, plan)
    effective_charges = []
    for charge in plan.charges:
        shift = await enrollment_total_deferral_days(
            db,
            enrollment.id,
            coverage_start=charge.coverage.start,
            include_unallocated=True,
        )
        if preservation and charge.coverage.start >= date.fromisoformat(
            preservation["applies_from"]
        ):
            shift += preservation["delta_days"]
        if shift < 0:
            raise admission_conflict(
                "SUSPENSION_RECONCILIATION_REQUIRED",
                "Ngày bảo lưu cần đối chiếu trước khi áp dụng phương án này.",
            )
        effective_charges.append(
            replace(charge, due_date=charge.due_date + timedelta(days=shift))
        )
    plan = replace(
        plan,
        charges=tuple(effective_charges),
        suspension_adjustment=preservation,
        source_digest=digest(
            {
                "fees": plan.source_digest,
                "deferral": deferral,
                "revision": str(revision.id),
                "revision_state": revision.state,
                "admission_date": enrollment.enrollment_date,
                "admission_version": enrollment.admission_version,
                "class_version": enrollment.class_.version,
            }
        ),
    )
    replaced_ids = set(plan.supersede_ids)
    return BillingSchedulePreviewResponse(
        can_apply=plan.can_apply,
        preview_fingerprint=plan.fingerprint,
        current_anchor_date=revision.anchor_date,
        pending_review=pending_review_context(revision, snapshots),
        plan=plan,
        replaced_fees=[
            {"id": s.id, "coverage": s.coverage, "amount": s.amount}
            for s in sorted(
                snapshots,
                key=lambda s: (s.coverage.start if s.coverage else date.max, s.id),
            )
            if s.id in replaced_ids
        ],
    )


async def preview_billing_schedule(
    db: AsyncSession, enrollment_id: UUID, data: BillingSchedulePreviewRequest
):
    enrollment, _, snapshots = await load_billing_context(db, enrollment_id)
    return await prepare_billing_schedule(db, enrollment, snapshots, data)


async def apply_billing_schedule(
    db: AsyncSession,
    enrollment_id: UUID,
    data: BillingScheduleApplyRequest,
    *,
    actor_user_id: str,
):
    require_date_contract(4, has_date_edit=False)
    payload_hash = digest(
        {"enrollment_id": str(enrollment_id), "request": data.model_dump(mode="json")}
    )
    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"billing-command:{data.request_id}"},
    )
    previous = await db.scalar(
        select(StartDateChangeCommandRecord).where(
            StartDateChangeCommandRecord.request_id == str(data.request_id)
        )
    )
    if previous is not None:
        if (
            previous.payload_hash != payload_hash
            or previous.operation_kind != "BILLING_SCHEDULE_CHANGE"
        ):
            raise admission_conflict(
                "IDEMPOTENCY_PAYLOAD_MISMATCH", "Mã yêu cầu đã dùng cho nội dung khác"
            )
        if previous.state != "COMPLETED":
            raise admission_conflict(
                "BILLING_COMMAND_IN_PROGRESS",
                "Yêu cầu đang được xử lý; vui lòng thử lại",
            )
        return BillingSchedulePreviewResponse.model_validate(
            previous.execution_plan["response"]
        )
    enrollment, records, snapshots = await load_billing_context(
        db, enrollment_id, lock=True
    )
    preview = await prepare_billing_schedule(db, enrollment, snapshots, data)
    if not preview.can_apply:
        raise admission_conflict(
            "BILLING_GAP_REVIEW_REQUIRED", "Vui lòng chọn cách xử lý kỳ chuyển tiếp"
        )
    if not hmac.compare_digest(
        preview.preview_fingerprint, data.expected_preview_fingerprint
    ):
        raise admission_conflict(
            "STALE_BILLING_PREVIEW",
            "Khoản thu hoặc lịch học đã thay đổi. Vui lòng xem lại.",
        )
    plan = preview.plan
    old_revision = enrollment.current_billing_revision
    from app.services.fee_operation_service import (
        append_fee_operation,
        snapshot_fee_record,
    )

    replaced_records = [
        record for record in records if str(record.id) in plan.supersede_ids
    ]
    before = [snapshot_fee_record(record) for record in replaced_records]
    from app.services.payment_scaffold_service import (
        revoke_open_payment_requests_for_fee_records,
    )

    await revoke_open_payment_requests_for_fee_records(
        db, list(plan.supersede_ids), actor_id=actor_user_id, reason=data.reason
    )
    now = datetime.now(timezone.utc)
    first_charge = next(
        charge
        for charge in plan.charges
        if charge.kind == "CYCLE" and charge.cycle_no == plan.first_cycle
    )
    for record in records:
        if str(record.id) in plan.supersede_ids:
            record.status = "SUPERSEDED"
            record.superseded_at = now
    await db.flush()
    revision = BillingAnchorRevision(
        enrollment_id=enrollment.id,
        sequence_no=enrollment.billing_anchor_version + 1,
        previous_anchor_date=old_revision.anchor_date,
        anchor_date=plan.anchor,
        effective_on=first_charge.coverage.start,
        generation_floor=first_charge.coverage.start,
        first_anchor_cycle_no=plan.first_cycle,
        next_due_date=first_charge.due_date,
        scheduled_segments=preview.model_dump(mode="json")["plan"][
            "scheduled_segments"
        ],
        waived_intervals=preview.model_dump(mode="json")["plan"][
            "retained_waived_intervals"
        ]
        + preview.model_dump(mode="json")["plan"]["waived_intervals"],
        change_kind="BILLING_SCHEDULE_CHANGE",
        billing_type_snapshot=plan.billing_type,
        billing_cycle_months_snapshot=old_revision.billing_cycle_months_snapshot,
        billing_cycle_weeks_snapshot=plan.cycle_weeks,
        state="CONFIRMED",
        reason=data.reason,
        request_id=str(data.request_id),
        actor_user_id=actor_user_id,
        resolved_by=actor_user_id,
        resolved_at=now,
        resolution_note="Đã xác nhận bản xem trước",
    )
    db.add(revision)
    await db.flush()
    next_no = (
        int(
            await db.scalar(
                select(func.coalesce(func.max(FeeRecord.cycle_no), -1)).where(
                    FeeRecord.enrollment_id == enrollment.id
                )
            )
        )
        + 1
    )
    created = []
    for offset, charge in enumerate(plan.charges):
        if charge.kind == "OLD_SCHEDULE_CYCLE":
            charge_revision_id = old_revision.id
            anchor_date_snapshot = charge.anchor_date or old_revision.anchor_date
            class_type_snapshot = (
                charge.billing_type or old_revision.billing_type_snapshot
            )
            weeks_snapshot = (
                charge.cycle_weeks or old_revision.billing_cycle_weeks_snapshot
            )
            anchor_cycle_no = charge.cycle_no
            origin = "EXPLICIT_BILLING_CHANGE"
            base_due = charge.coverage.start
        elif charge.kind == "TRANSITION":
            charge_revision_id = revision.id
            anchor_date_snapshot = charge.anchor_date or old_revision.anchor_date
            class_type_snapshot = (
                charge.billing_type or old_revision.billing_type_snapshot
            )
            weeks_snapshot = (
                charge.cycle_weeks or old_revision.billing_cycle_weeks_snapshot
            )
            anchor_cycle_no = None
            origin = "BILLING_TRANSITION"
            base_due = first_charge.coverage.start
        else:
            charge_revision_id = revision.id
            anchor_date_snapshot = plan.anchor
            class_type_snapshot = plan.billing_type
            weeks_snapshot = plan.cycle_weeks
            anchor_cycle_no = charge.cycle_no
            origin = "EXPLICIT_BILLING_CHANGE"
            base_due = charge.coverage.start

        record = FeeRecord(
            enrollment_id=enrollment.id,
            billing_revision_id=charge_revision_id,
            cycle_no=next_no + offset,
            anchor_cycle_no=anchor_cycle_no,
            period=period_key(base_due),
            base_due_date=base_due,
            due_date=base_due,
            adjusted_due_date=charge.due_date,
            coverage_start=charge.coverage.start,
            coverage_end=charge.coverage.end,
            base_amount=charge.amount,
            discount_amount=0,
            origin=origin,
            status="UNPAID",
            review_required=False,
            enrollment_date_snapshot=enrollment.enrollment_date,
            admission_date_snapshot=enrollment.enrollment_date,
            billing_anchor_date_snapshot=anchor_date_snapshot,
            class_name_snapshot=enrollment.class_.name,
            student_name_snapshot=enrollment.student.full_name,
            class_type_snapshot=class_type_snapshot,
            billing_cycle_months_snapshot=old_revision.billing_cycle_months_snapshot,
            billing_cycle_weeks_snapshot=weeks_snapshot,
        )
        db.add(record)
        created.append(record)
    await db.flush()
    if plan.suspension_adjustment:
        from app.services.suspension_boundary_service import append_waiver_preservation

        await append_waiver_preservation(
            db,
            enrollment,
            plan.suspension_adjustment,
            request_id=data.request_id,
            actor_id=actor_user_id,
            reason=data.reason,
        )
    if created:
        from app.services.credit_service import allocate_pending_service_credits

        await allocate_pending_service_credits(db, enrollment.id, created)
        for record in replaced_records:
            replacement = next(
                (
                    new
                    for new in created
                    if new.coverage_start < record.coverage_end
                    and record.coverage_start < new.coverage_end
                ),
                None,
            )
            record.superseded_by_record_id = (
                replacement
                or next(
                    new for new in created if new.anchor_cycle_no == plan.first_cycle
                )
            ).id
    enrollment.current_billing_revision_id = revision.id
    enrollment.current_billing_revision = revision
    enrollment.billing_anchor_version += 1
    if old_revision.state == "PENDING":
        old_revision.state = "SUPERSEDED"
        old_revision.resolved_by = actor_user_id
        old_revision.resolved_at = now
        old_revision.resolution_note = (
            f"Đã xử lý trong lần đổi mốc; lịch thay thế {revision.id}"
        )
        for record in records:
            if (
                str(record.billing_revision_id) == str(old_revision.id)
                and record.review_required
            ):
                record.review_required = False
        if old_revision.class_billing_cycle_revision_id:
            from app.services.billing_anchor_service import (
                _resolve_class_cycle_revision_if_complete,
            )

            await _resolve_class_cycle_revision_if_complete(
                db,
                old_revision.class_billing_cycle_revision_id,
                actor_user_id=actor_user_id,
            )
    await append_fee_operation(
        db,
        action="anchor_recalculation",
        before=before + [None] * len(created),
        after=[snapshot_fee_record(record) for record in replaced_records + created],
        actor_id=actor_user_id,
        request_id=data.request_id,
        reason=data.reason,
    )
    db.add(
        StartDateChangeCommandRecord(
            request_id=str(data.request_id),
            subject_type="STUDENT",
            operation_kind="BILLING_SCHEDULE_CHANGE",
            student_id=enrollment.student_id,
            class_id=enrollment.class_id,
            old_date=old_revision.anchor_date,
            new_date=plan.anchor,
            reason=data.reason,
            payload_hash=payload_hash,
            preview_fingerprint=preview.preview_fingerprint,
            execution_plan={
                "response": preview.model_dump(mode="json"),
                "created_fee_ids": [str(record.id) for record in created],
                "revision_id": str(revision.id),
                "effective_waived_intervals": revision.waived_intervals,
            },
            state="COMPLETED",
            completed_at=now,
            item_count=0,
            actor_user_id=actor_user_id,
        )
    )
    await db.commit()
    from app.services.enrollment_service import _clear_dependent_caches

    _clear_dependent_caches()
    return preview
