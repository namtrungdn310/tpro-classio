from typing import Final

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fee_record import FeeRecord

_NOT_LOADED: Final = object()


async def lock_fee_period(db: AsyncSession, period: str) -> None:
    """Serialize fee generation with enrollment-driven reconciliation."""

    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:lock_key))"),
        {"lock_key": f"fee-sync:{period}"},
    )


def is_fee_record_protected(record: FeeRecord) -> bool:
    """Canonical domain predicate defining protected fee records.

    Protected fees represent immutable business history and cannot be mutated,
    voided, or superseded by start date changes:
    - Paid in full or in part (status == 'PAID', paid_amount > 0, or paid_date set)
    - Notified to parent/student (notified_at set)
    - Refunded in full or in part (refunded_amount > 0 or status in REFUNDED/PARTIALLY_REFUNDED)
    - Has associated payments or transactions
    """
    if record.status == "PAID":
        return True
    if record.notified_at is not None:
        return True
    if record.paid_date is not None:
        return True
    if record.paid_amount is not None and record.paid_amount > 0:
        return True
    if record.refunded_amount is not None and record.refunded_amount > 0:
        return True
    if getattr(record, "status", None) in ("REFUNDED", "PARTIALLY_REFUNDED"):
        return True
    if "payments" in getattr(record, "__dict__", {}) and bool(
        record.__dict__["payments"]
    ):
        return True
    return False


def is_fee_record_mutable(record: FeeRecord) -> bool:
    """A fee is mutable if and only if it is UNPAID and unnotified with zero transactions."""
    return record.status == "UNPAID" and not is_fee_record_protected(record)
