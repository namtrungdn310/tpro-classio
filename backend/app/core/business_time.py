from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo


BUSINESS_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def business_today(now: datetime | None = None) -> date:
    """Return the calendar date used by TPRO's Vietnam-based operations."""

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(BUSINESS_TIMEZONE).date()
