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
    """Notified and paid records are immutable business history."""

    return record.status == "PAID" or record.notified_at is not None
