"""Fee-cycle generator (R6-D06, dev.md §7.2).

Creates cycle 0 inside the enrollment transaction and lazily materializes
future cycles for a bounded window. Cycle existence = `coverage_start <
class.end_date`; base due always derives from the enrollment anchor; period
is a derived reporting bucket. Never retro-charges cycle 0 for legacy
enrollments (gap is intended). Idempotent under an advisory lock + the
`(enrollment_id, cycle_no)` unique index.
"""

from datetime import date

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.billing_schedule import (
    cycle_base_due_date,
    cycle_coverage_interval,
    cycle_exists,
    period_key,
)
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord

CYCLE_ORIGIN_GENERATOR = "CYCLE_GENERATOR"
CYCLE_ORIGIN_LEGACY_BACKFILL = "LEGACY_BACKFILL"


async def lock_enrollment_cycle_identity(db: AsyncSession, enrollment_id: str) -> None:
    """Serialize cycle generation per enrollment (advisory xact lock)."""
    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:lock_key))"),
        {"lock_key": f"fee-cycle:{enrollment_id}"},
    )


def _enrollment_cycle_weeks(enrollment: Enrollment) -> int | None:
    class_ = getattr(enrollment, "class_", None)
    if class_ is None:
        return None
    if class_.type == "COURSE":
        return max(int(class_.billing_cycle_weeks or 1), 1)
    return None


async def create_cycle_zero(
    db: AsyncSession,
    enrollment: Enrollment,
) -> FeeRecord:
    """Create cycle 0 exactly once inside the enrollment transaction.

    Idempotent: the `(enrollment_id, cycle_no)` unique index guarantees
    exactly one row even under concurrent retries; the advisory lock keeps
    the read-then-write race closed.
    """
    await lock_enrollment_cycle_identity(db, enrollment.id)
    existing = await db.scalar(
        select(FeeRecord).where(
            FeeRecord.enrollment_id == enrollment.id,
            FeeRecord.cycle_no == 0,
        )
    )
    if existing is not None:
        return existing

    enrollment_date = enrollment.enrollment_date or date.today()
    amount = int(enrollment.custom_fee) if enrollment.custom_fee is not None else 0
    class_ = getattr(enrollment, "class_", None)
    if class_ is not None:
        amount = (
            int(enrollment.custom_fee)
            if enrollment.custom_fee is not None
            else int(class_.base_fee)
        )
    coverage_start, coverage_end = cycle_coverage_interval(
        enrollment_date,
        class_.type if class_ is not None else "MONTHLY",
        _enrollment_cycle_weeks(enrollment),
        0,
    )
    record = FeeRecord(
        enrollment_id=enrollment.id,
        period=period_key(enrollment_date) or "0000-00",
        due_date=enrollment_date,
        cycle_no=0,
        base_due_date=enrollment_date,
        adjusted_due_date=enrollment_date,
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        origin=CYCLE_ORIGIN_GENERATOR,
        enrollment_date_snapshot=enrollment_date,
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

    await lock_enrollment_cycle_identity(db, enrollment.id)
    max_cycle = await db.scalar(
        select(func.max(FeeRecord.cycle_no)).where(
            FeeRecord.enrollment_id == enrollment.id,
            FeeRecord.cycle_no.is_not(None),
        )
    )
    next_cycle = (max_cycle if max_cycle is not None else 0) + 1

    billing_type = class_.type
    cycle_weeks = _enrollment_cycle_weeks(enrollment)
    amount = (
        int(enrollment.custom_fee)
        if enrollment.custom_fee is not None
        else int(class_.base_fee)
    )
    created: list[FeeRecord] = []
    while True:
        coverage_start, coverage_end = cycle_coverage_interval(
            enrollment.enrollment_date,
            billing_type,
            cycle_weeks,
            next_cycle,
        )
        if not cycle_exists(coverage_start, class_.end_date):
            break
        if coverage_start > up_to:
            break
        due = cycle_base_due_date(
            enrollment.enrollment_date,
            billing_type,
            cycle_weeks,
            next_cycle,
        )
        # R6-D12: adjusted due kế thừa cumulative deferral (service credit)
        # từ ledger — generator không bao giờ chain adjusted date gây drift.
        from app.core.billing_schedule import adjusted_due_after_deferral
        from app.services.credit_service import enrollment_total_deferral_days

        deferral = await enrollment_total_deferral_days(db, enrollment.id)
        record = FeeRecord(
            enrollment_id=enrollment.id,
            period=period_key(due) or "0000-00",
            due_date=due,
            cycle_no=next_cycle,
            base_due_date=due,
            adjusted_due_date=adjusted_due_after_deferral(due, deferral),
            coverage_start=coverage_start,
            coverage_end=coverage_end,
            origin=CYCLE_ORIGIN_GENERATOR,
            enrollment_date_snapshot=enrollment.enrollment_date,
            base_amount=amount,
            discount_amount=0,
            status="UNPAID",
        )
        db.add(record)
        created.append(record)
        next_cycle += 1
    if created:
        await db.flush()
    return created


def cycle_protected(record: FeeRecord) -> bool:
    """Protected = notified or paid history; never rewritten or voided."""
    return record.status == "PAID" or record.notified_at is not None


def is_cycle_record(record: FeeRecord) -> bool:
    return record.cycle_no is not None
