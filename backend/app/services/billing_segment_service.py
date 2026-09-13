"""Materialize only the due window of an explicitly retained old schedule."""

from datetime import date, timedelta

from sqlalchemy import func, select

from app.core.billing_change_plan import Interval, price_transition, uncovered_intervals
from app.core.billing_schedule import cycle_coverage_interval, period_key
from app.models.fee_record import FeeRecord
from app.services.billing_decision_service import cycle_covering_date


def segment_spans(segment: dict, up_to: date):
    start = date.fromisoformat(segment["coverage"]["start"])
    end = date.fromisoformat(segment["coverage"]["end"])
    anchor = date.fromisoformat(segment["anchor"])
    kind, weeks = segment["billing_type"], segment["cycle_weeks"]
    cycle = cycle_covering_date(anchor, kind, weeks, start)
    while start < end and start <= up_to:
        lo, hi = cycle_coverage_interval(anchor, kind, weeks, cycle)
        lo, hi = max(lo, start), min(hi, end)
        if lo >= end or lo > up_to:
            break
        if lo < hi:
            yield Interval(lo, hi)
        cycle += 1
        start = hi


async def materialize_retained_segments(
    db, enrollment, revision, *, up_to, stop_on=None
):
    segments = getattr(revision, "scheduled_segments", None)
    if not isinstance(segments, list) or not segments:
        return []
    from app.services.credit_service import enrollment_total_deferral_days

    records = list(
        (
            await db.scalars(
                select(FeeRecord).where(
                    FeeRecord.enrollment_id == enrollment.id,
                    FeeRecord.status != "SUPERSEDED",
                )
            )
        ).all()
    )
    covered = [
        Interval(r.coverage_start, r.coverage_end)
        for r in records
        if r.coverage_start and r.coverage_end
    ]
    covered.extend(
        Interval(date.fromisoformat(s["start"]), date.fromisoformat(s["end"]))
        for s in (getattr(revision, "waived_intervals", None) or [])
    )
    next_no = (
        int(
            await db.scalar(
                select(func.coalesce(func.max(FeeRecord.cycle_no), -1)).where(
                    FeeRecord.enrollment_id == enrollment.id,
                )
            )
        )
        + 1
    )
    stop = min(
        [d for d in (enrollment.ended_on, enrollment.class_.stopped_on, stop_on) if d],
        default=None,
    )
    created = []
    for segment in segments:
        anchor = date.fromisoformat(segment["anchor"])
        kind, weeks = segment["billing_type"], segment["cycle_weeks"]
        for span in segment_spans(segment, up_to):
            if stop and span.start >= stop:
                break
            for gap in uncovered_intervals(span, tuple(covered)):
                if stop and gap.start >= stop:
                    continue
                # Stopping service caps coverage, not the agreed package price.
                # Price the original unpaid portion before applying the stop cap.
                billed_amount = price_transition(
                    gap, anchor, kind, weeks, segment["amount"]
                )
                if stop and gap.end > stop:
                    gap = Interval(gap.start, stop)
                shift = await enrollment_total_deferral_days(
                    db, enrollment.id, coverage_start=gap.start
                )
                record = FeeRecord(
                    enrollment_id=enrollment.id,
                    billing_revision_id=revision.id,
                    cycle_no=next_no,
                    anchor_cycle_no=None,
                    period=period_key(gap.start),
                    base_due_date=gap.start,
                    due_date=gap.start,
                    adjusted_due_date=gap.start + timedelta(days=shift),
                    coverage_start=gap.start,
                    coverage_end=gap.end,
                    base_amount=billed_amount,
                    discount_amount=0,
                    status="UNPAID",
                    review_required=False,
                    origin="EXPLICIT_BILLING_CHANGE",
                    billing_anchor_date_snapshot=anchor,
                    admission_date_snapshot=enrollment.enrollment_date,
                    enrollment_date_snapshot=enrollment.enrollment_date,
                    class_name_snapshot=enrollment.class_.name,
                    class_type_snapshot=kind,
                    billing_cycle_months_snapshot=1,
                    billing_cycle_weeks_snapshot=weeks,
                )
                db.add(record)
                created.append(record)
                covered.append(gap)
                next_no += 1
    if created:
        await db.flush()
    return created
