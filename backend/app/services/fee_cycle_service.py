"""Fee-cycle generator (R6-D06, dev.md §7.2).

Creates the first actionable cycle inside the enrollment transaction and
lazily materializes future cycles for a bounded window. Cycle existence = `coverage_start <
class.end_date`; base due always derives from the enrollment anchor; period
is a derived reporting bucket. Never retro-charges cycle 0 for legacy
enrollments (gap is intended). Idempotent under an advisory lock + the
`(enrollment_id, cycle_no)` unique index.
"""

from datetime import date, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.billing_schedule import (
    course_cycle_containing,
    cycle_base_due_date,
    cycle_coverage_interval,
    cycle_exists,
    first_monthly_cycle_on_or_after,
    period_key,
)
from app.core.business_time import business_today
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.billing_anchor_revision import BillingAnchorRevision

CYCLE_ORIGIN_GENERATOR = "CYCLE_GENERATOR"
CYCLE_ORIGIN_LEGACY_BACKFILL = "LEGACY_BACKFILL"


async def lock_enrollment_cycle_identity(db: AsyncSession, enrollment_id: str) -> None:
    """Serialize cycle generation per enrollment (advisory xact lock)."""
    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:lock_key))"),
        {"lock_key": f"fee-cycle:{enrollment_id}"},
    )


def _enrollment_cycle_weeks(enrollment: Enrollment) -> int | None:
    revision = enrollment.__dict__.get("current_billing_revision")
    if revision is not None and getattr(revision, "billing_type_snapshot", None) == "COURSE":
        return max(int(revision.billing_cycle_weeks_snapshot or 1), 1)
    class_ = getattr(enrollment, "class_", None)
    if class_ is None:
        return None
    if class_.type == "COURSE":
        return max(int(class_.billing_cycle_weeks or 1), 1)
    return None


def _enrollment_billing_type(enrollment: Enrollment) -> str:
    revision = enrollment.__dict__.get("current_billing_revision")
    if revision is not None and getattr(revision, "billing_type_snapshot", None):
        return revision.billing_type_snapshot
    return enrollment.class_.type


async def create_cycle_zero(
    db: AsyncSession,
    enrollment: Enrollment,
    *,
    assume_new: bool = False,
    actor_user_id: str | None = None,
    force_review: bool = False,
    change_kind: str | None = None,
    reason: str | None = None,
) -> FeeRecord:
    """Create the first actionable charge inside the enrollment transaction.

    The row keeps global ``cycle_no=0`` for a new membership, while
    ``anchor_cycle_no`` may skip historical anchors. This prevents a backdated
    membership from silently materialising years of debt.
    """
    if not assume_new:
        await lock_enrollment_cycle_identity(db, enrollment.id)
        existing = await db.scalar(
            select(FeeRecord).where(
                FeeRecord.enrollment_id == enrollment.id,
                FeeRecord.cycle_no == 0,
            )
        )
        if existing is not None:
            return existing

    from app.services.billing_anchor_service import ensure_initial_billing_revision

    revision = await ensure_initial_billing_revision(
        db,
        enrollment,
        actor_user_id=actor_user_id,
        force_review=force_review,
        change_kind=change_kind,
        reason=reason,
    )
    enrollment_date = enrollment.enrollment_date or date.today()
    amount = int(enrollment.custom_fee) if enrollment.custom_fee is not None else 0
    class_ = getattr(enrollment, "class_", None)
    if class_ is not None:
        amount = (
            int(enrollment.custom_fee)
            if enrollment.custom_fee is not None
            else int(class_.base_fee)
        )
    anchor_cycle = int(revision.first_anchor_cycle_no or 0)
    billing_type = _enrollment_billing_type(enrollment) if class_ is not None else "MONTHLY"
    cycle_weeks = _enrollment_cycle_weeks(enrollment)
    due = cycle_base_due_date(enrollment_date, billing_type, cycle_weeks, anchor_cycle)
    coverage_start, coverage_end = cycle_coverage_interval(
        enrollment_date, billing_type, cycle_weeks, anchor_cycle
    )
    record = FeeRecord(
        enrollment_id=enrollment.id,
        billing_revision_id=revision.id,
        anchor_cycle_no=anchor_cycle,
        review_required=revision.state == "PENDING",
        period=period_key(due) or "0000-00",
        due_date=due,
        cycle_no=0,
        base_due_date=due,
        adjusted_due_date=due,
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        origin=("INITIAL_BACKDATED" if anchor_cycle > 0 or due < business_today() else CYCLE_ORIGIN_GENERATOR),
        enrollment_date_snapshot=enrollment_date,
        class_name_snapshot=class_.name if class_ is not None else None,
        class_type_snapshot=(
            _enrollment_billing_type(enrollment) if class_ is not None else "MONTHLY"
        ),
        billing_cycle_months_snapshot=(
            revision.billing_cycle_months_snapshot
            if revision is not None
            else class_.billing_cycle_months if class_ is not None else 1
        ),
        billing_cycle_weeks_snapshot=_enrollment_cycle_weeks(enrollment),
        base_amount=amount,
        discount_amount=0,
        status="UNPAID",
    )
    db.add(record)
    await db.flush()
    return record


async def ensure_enrollment_cycles(
    db: AsyncSession,
    enrollment: Enrollment,
    *,
    up_to: date,
    known_max_cycle: int | None = None,
) -> list[FeeRecord]:
    """Materialize missing future cycles whose coverage starts <= `up_to`.

    Caller must hold the enrollment row lock (or the class lock) before
    invoking this helper. Legacy enrollments (no cycle 0) continue from
    `max(cycle_no) + 1`; cycle 0 is never generated here.
    """
    if enrollment.status != "active":
        return []
    class_ = getattr(enrollment, "class_", None)
    if class_ is None or enrollment.enrollment_date is None:
        return []
    if not bool(getattr(class_, "is_active", True)) or class_.cancelled_at is not None:
        return []

    if known_max_cycle is None:
        await lock_enrollment_cycle_identity(db, enrollment.id)
        max_cycle = await db.scalar(
            select(func.max(FeeRecord.cycle_no)).where(
                FeeRecord.enrollment_id == enrollment.id,
                FeeRecord.cycle_no.is_not(None),
            )
        )
        next_cycle = (max_cycle if max_cycle is not None else 0) + 1
    else:
        next_cycle = known_max_cycle + 1

    revision: BillingAnchorRevision | None = None
    if enrollment.current_billing_revision_id:
        revision = await db.get(
            BillingAnchorRevision, enrollment.current_billing_revision_id
        )
    if revision is not None:
        if revision.state == "PENDING":
            return []
        max_anchor_cycle = await db.scalar(
            select(func.max(FeeRecord.anchor_cycle_no)).where(
                FeeRecord.billing_revision_id == revision.id,
                FeeRecord.status != "SUPERSEDED",
            )
        )
        next_anchor_cycle = (
            int(max_anchor_cycle) + 1
            if max_anchor_cycle is not None
            else revision.first_anchor_cycle_no
        )
        schedule_anchor = revision.anchor_date
    else:
        next_anchor_cycle = next_cycle
        schedule_anchor = enrollment.enrollment_date

    billing_type = (
        revision.billing_type_snapshot if revision is not None else class_.type
    )
    cycle_weeks = (
        max(int(revision.billing_cycle_weeks_snapshot or 1), 1)
        if revision is not None and revision.billing_type_snapshot == "COURSE"
        else _enrollment_cycle_weeks(enrollment)
    )
    amount = (
        int(enrollment.custom_fee)
        if enrollment.custom_fee is not None
        else int(class_.base_fee)
    )
    created: list[FeeRecord] = []
    while True:
        coverage_start, coverage_end = cycle_coverage_interval(
            schedule_anchor,
            billing_type,
            cycle_weeks,
            next_anchor_cycle,
        )
        if not cycle_exists(coverage_start, class_.stopped_on):
            break
        if coverage_start > up_to:
            break
        due = cycle_base_due_date(
            schedule_anchor,
            billing_type,
            cycle_weeks,
            next_anchor_cycle,
        )
        # R6-D12: adjusted due kế thừa cumulative deferral (service credit)
        # từ ledger — generator không bao giờ chain adjusted date gây drift.
        from app.core.billing_schedule import adjusted_due_after_deferral
        from app.services.credit_service import enrollment_total_deferral_days

        deferral = await enrollment_total_deferral_days(db, enrollment.id)
        record = FeeRecord(
            enrollment_id=enrollment.id,
            billing_revision_id=revision.id if revision is not None else None,
            anchor_cycle_no=next_anchor_cycle,
            period=period_key(due) or "0000-00",
            due_date=due,
            cycle_no=next_cycle,
            base_due_date=due,
            adjusted_due_date=adjusted_due_after_deferral(due, deferral),
            coverage_start=coverage_start,
            coverage_end=coverage_end,
            origin=CYCLE_ORIGIN_GENERATOR,
            enrollment_date_snapshot=schedule_anchor,
            class_name_snapshot=class_.name,
            class_type_snapshot=billing_type,
            billing_cycle_months_snapshot=(
                revision.billing_cycle_months_snapshot
                if revision is not None
                else class_.billing_cycle_months
            ),
            billing_cycle_weeks_snapshot=cycle_weeks,
            base_amount=amount,
            discount_amount=0,
            status="UNPAID",
        )
        db.add(record)
        created.append(record)
        next_cycle += 1
        next_anchor_cycle += 1
    if created:
        await db.flush()
    return created


def cycle_protected(record: FeeRecord) -> bool:
    """Protected = notified or paid history; never rewritten or voided."""
    return record.status == "PAID" or record.notified_at is not None


def is_cycle_record(record: FeeRecord) -> bool:
    return record.cycle_no is not None


async def ensure_final_cycle_for_stop(
    db: AsyncSession,
    enrollment: Enrollment,
    *,
    stopped_on: date,
) -> FeeRecord | None:
    """Materialise and retain the cycle containing the final active day."""

    if enrollment.enrollment_date is None or stopped_on <= enrollment.enrollment_date:
        return None
    await lock_enrollment_cycle_identity(db, enrollment.id)
    revision: BillingAnchorRevision | None = None
    if enrollment.current_billing_revision_id:
        revision = await db.get(BillingAnchorRevision, enrollment.current_billing_revision_id)
    anchor = revision.anchor_date if revision is not None else enrollment.enrollment_date
    last_active = stopped_on - timedelta(days=1)
    if anchor > last_active:
        return None
    weeks = (
        max(int(revision.billing_cycle_weeks_snapshot or 1), 1)
        if revision is not None and revision.billing_type_snapshot == "COURSE"
        else _enrollment_cycle_weeks(enrollment)
    )
    billing_type = (
        revision.billing_type_snapshot if revision is not None else enrollment.class_.type
    )
    if billing_type == "COURSE":
        anchor_cycle = course_cycle_containing(anchor, weeks or 1, last_active)
    else:
        anchor_cycle = first_monthly_cycle_on_or_after(anchor, last_active)
        if cycle_base_due_date(anchor, "MONTHLY", None, anchor_cycle) > last_active:
            anchor_cycle = max(0, anchor_cycle - 1)

    existing = await db.scalar(
        select(FeeRecord).where(
            FeeRecord.enrollment_id == enrollment.id,
            FeeRecord.billing_revision_id == (revision.id if revision else None),
            FeeRecord.anchor_cycle_no == anchor_cycle,
            FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
        )
    )
    reason = f"Kỳ cuối trước khi lớp ngừng từ {stopped_on.strftime('%d/%m/%Y')}"
    if existing is not None:
        existing.is_final_cycle = True
        existing.final_cycle_reason = reason
        return existing

    max_cycle = await db.scalar(
        select(func.max(FeeRecord.cycle_no)).where(
            FeeRecord.enrollment_id == enrollment.id
        )
    )
    global_cycle = (int(max_cycle) if max_cycle is not None else -1) + 1
    due = cycle_base_due_date(anchor, billing_type, weeks, anchor_cycle)
    coverage_start, coverage_end = cycle_coverage_interval(
        anchor, billing_type, weeks, anchor_cycle
    )
    from app.core.billing_schedule import adjusted_due_after_deferral
    from app.services.credit_service import enrollment_total_deferral_days

    deferral = await enrollment_total_deferral_days(db, enrollment.id)
    amount = (
        int(enrollment.custom_fee)
        if enrollment.custom_fee is not None
        else int(enrollment.class_.base_fee)
    )
    record = FeeRecord(
        enrollment_id=enrollment.id,
        billing_revision_id=revision.id if revision else None,
        anchor_cycle_no=anchor_cycle,
        review_required=bool(revision and revision.state == "PENDING"),
        is_final_cycle=True,
        final_cycle_reason=reason,
        period=period_key(due) or "0000-00",
        due_date=due,
        cycle_no=global_cycle,
        base_due_date=due,
        adjusted_due_date=adjusted_due_after_deferral(due, deferral),
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        origin="FINAL_CYCLE",
        enrollment_date_snapshot=anchor,
        class_name_snapshot=enrollment.class_.name,
        class_type_snapshot=billing_type,
        billing_cycle_months_snapshot=(
            revision.billing_cycle_months_snapshot
            if revision is not None
            else enrollment.class_.billing_cycle_months
        ),
        billing_cycle_weeks_snapshot=weeks,
        base_amount=amount,
        discount_amount=0,
        status="UNPAID",
    )
    db.add(record)
    await db.flush()
    return record
