from datetime import date
from typing import Final

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.billing import (
    get_enrollment_due_date_in_month,
    get_enrollment_fee_amount,
)
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord


_NOT_LOADED: Final = object()


async def lock_fee_period(db: AsyncSession, period: str) -> None:
    """Serialize fee generation with enrollment-driven reconciliation."""

    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:lock_key))"),
        {"lock_key": f"fee-sync:{period}"},
    )


def is_fee_record_protected(record: FeeRecord) -> bool:
    """Notified and paid records are immutable business history."""

    return record.status == "PAID" or record.notified_at is not None


async def reconcile_fee_record_for_period(
    db: AsyncSession,
    enrollment: Enrollment,
    period: str,
    reference_date: date,
    *,
    existing_record: FeeRecord | None | object = _NOT_LOADED,
) -> bool:
    """Make an unprotected fee record match one enrollment's billing schedule.

    A notified or paid record is deliberately left untouched. Its amount and date
    are facts that must not be rewritten when an enrollment is edited later.
    """

    if existing_record is _NOT_LOADED:
        current_record = await db.scalar(
            select(FeeRecord).where(
                FeeRecord.enrollment_id == enrollment.id,
                FeeRecord.period == period,
            )
        )
    else:
        current_record = existing_record

    class_ = getattr(enrollment, "class_", None)
    is_chargeable = (
        enrollment.status == "active" and class_ is not None and bool(class_.is_active)
    )
    due_date = (
        get_enrollment_due_date_in_month(enrollment, reference_date)
        if is_chargeable
        else None
    )

    if due_date is None:
        if current_record is not None and not is_fee_record_protected(current_record):
            await db.delete(current_record)
            return True
        return False

    base_amount = get_enrollment_fee_amount(enrollment)
    if current_record is None:
        db.add(
            FeeRecord(
                enrollment_id=enrollment.id,
                period=period,
                due_date=due_date,
                enrollment_date_snapshot=enrollment.enrollment_date,
                base_amount=base_amount,
                discount_amount=0,
                status="UNPAID",
            )
        )
        return True

    if is_fee_record_protected(current_record):
        return False

    changed = False
    if int(current_record.base_amount) != base_amount:
        current_record.base_amount = base_amount
        changed = True
    if current_record.due_date != due_date:
        current_record.due_date = due_date
        changed = True
    if current_record.enrollment_date_snapshot != enrollment.enrollment_date:
        current_record.enrollment_date_snapshot = enrollment.enrollment_date
        changed = True

    return changed
