"""Read-only renewal selection shared by suspension preview and allocation."""

from dataclasses import dataclass
from datetime import date

from app.core.billing_change_plan import Interval, uncovered_intervals
from app.core.billing_schedule import cycle_base_due_date
from app.services.billing_decision_service import cycle_covering_date
from app.services.billing_segment_service import segment_spans
from app.services.suspension_payment_protection import is_suspension_fee_protected


@dataclass(frozen=True)
class RenewalTarget:
    coverage_start: date
    base_due_date: date
    record: object | None = None


def plan_renewal_target(enrollment, affected_from: date) -> RenewalTarget | None:
    """No generation on preview. Search by coverage, never by global cycle id.

    Use the same generation floor, retained segments and service stop as the
    cycle generator. A pending anchor leaves preservation awaiting review.
    """
    revision = enrollment.__dict__.get("current_billing_revision")
    if revision is not None and revision.state == "PENDING":
        return None
    records = [r for r in enrollment.fee_records if r.status != "SUPERSEDED"]
    candidates = [
        RenewalTarget(
            r.coverage_start, r.base_due_date or r.due_date or r.coverage_start, r
        )
        for r in records
        if r.cycle_no is not None
        and r.cycle_no > 0
        and r.coverage_start
        and r.coverage_start >= affected_from
        and r.status == "UNPAID"
        and not r.review_required
        and not is_suspension_fee_protected(enrollment, r)
    ]
    class_ = enrollment.class_
    stop = min([d for d in (class_.stopped_on, enrollment.ended_on) if d], default=None)
    if enrollment.status == "active" and class_.is_active and not class_.cancelled_at:
        kind = revision.billing_type_snapshot if revision else class_.type
        weeks = (
            (
                int(
                    (revision.billing_cycle_weeks_snapshot or 1)
                    if revision
                    else (class_.billing_cycle_weeks or 1)
                )
                or 1
            )
            if kind == "COURSE"
            else None
        )
        anchor = revision.anchor_date if revision else enrollment.enrollment_date
        if anchor is not None:
            if revision:
                generation_floor = max(
                    int(revision.first_anchor_cycle_no),
                    max(
                        [
                            r.anchor_cycle_no
                            for r in records
                            if r.billing_revision_id == revision.id
                            and r.anchor_cycle_no is not None
                        ],
                        default=-1,
                    )
                    + 1,
                )
            else:
                generation_floor = (
                    max(
                        [r.cycle_no for r in records if r.cycle_no is not None],
                        default=0,
                    )
                    + 1
                )
            cycle = max(
                generation_floor,
                cycle_covering_date(anchor, kind, weeks, affected_from),
            )
            lo = cycle_base_due_date(anchor, kind, weeks, cycle)
            if lo < affected_from:
                lo = cycle_base_due_date(anchor, kind, weeks, cycle + 1)
            # Choosing a distant pause must not pre-create years of invoices.
            # Keep preservation pending when reaching the target would require
            # a large catch-up; normal billing generation will allocate it later.
            if cycle - generation_floor < 24 and (stop is None or lo < stop):
                candidates.append(RenewalTarget(lo, lo))

        covered = tuple(
            Interval(r.coverage_start, r.coverage_end)
            for r in records
            if r.coverage_start and r.coverage_end and r.coverage_start < r.coverage_end
        )
        covered += tuple(
            Interval(date.fromisoformat(w["start"]), date.fromisoformat(w["end"]))
            for w in (getattr(revision, "waived_intervals", None) or [])
        )
        for segment in getattr(revision, "scheduled_segments", None) or []:
            for index, span in enumerate(segment_spans(segment, date.max)):
                if index >= 24:
                    break
                if stop and span.start >= stop:
                    break
                gaps = [
                    g
                    for g in uncovered_intervals(span, covered)
                    if g.start >= affected_from and (stop is None or g.start < stop)
                ]
                if gaps:
                    candidates.append(RenewalTarget(gaps[0].start, gaps[0].start))
                    break
    return min(
        candidates, key=lambda t: (t.coverage_start, t.record is None), default=None
    )


async def plan_credit_delta_target(db, enrollment, affected_from, days):
    """A reversal cannot take effect before the grant it compensates.

    Check finite ledger boundaries instead of generating years of fees. If only
    pending grants exist and no materializable target can consume them together,
    keep the correction pending too. This permits cancelling an unallocated pause.
    """
    target = plan_renewal_target(enrollment, affected_from)
    if days >= 0 or target is None:
        return target
    from sqlalchemy import func, select
    from app.models.enrollment_service_credit_event import (
        EnrollmentServiceCreditEvent as Event,
        ServiceCreditAllocation as Allocation,
    )
    from app.services.credit_service import enrollment_total_deferral_days

    boundaries = (
        await db.scalars(
            select(func.coalesce(Allocation.applies_from, Event.overlap_start))
            .select_from(Event)
            .outerjoin(Allocation, Allocation.credit_event_id == Event.id)
            .where(Event.enrollment_id == enrollment.id, Event.event_type == "GRANT")
        )
    ).all()
    floors = sorted({affected_from, *(d for d in boundaries if d >= affected_from)})
    checked = set()
    for floor in floors:
        candidate = plan_renewal_target(enrollment, floor)
        if candidate is None or candidate.coverage_start in checked:
            continue
        checked.add(candidate.coverage_start)
        balance = await enrollment_total_deferral_days(
            db,
            enrollment.id,
            coverage_start=candidate.coverage_start,
            include_unallocated=candidate.record is None,
        )
        if balance + days >= 0:
            return candidate
    return None
