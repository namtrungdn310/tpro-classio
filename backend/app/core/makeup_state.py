"""Canonical make-up state machine (single transition table + derived status).

Used by the make-up service and by class history display; tests import the
same functions. `AWAITING_CONFIRMATION` is derived — never persisted.
"""

from datetime import datetime, timezone
from typing import Any

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "MAKEUP_PENDING": {"MAKEUP_SCHEDULED", "RESTORED"},
    # reschedule: scheduled -> scheduled (replacement may be updated)
    "MAKEUP_SCHEDULED": {
        "MAKEUP_PENDING",
        "MAKEUP_COMPLETED",
        "MAKEUP_SCHEDULED",
        "RESTORED",
    },
    "MAKEUP_COMPLETED": set(),
    "RESTORED": set(),
    "CANCELLED": set(),
}

EXCEPTION_STATES_UNRESOLVED = ("MAKEUP_PENDING", "MAKEUP_SCHEDULED")


def validate_transition(current: str, target: str) -> None:
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        from app.schemas.makeup import MakeupDomainError

        raise MakeupDomainError(
            "INVALID_TRANSITION",
            "Trạng thái buổi học hiện tại không cho phép thao tác này",
        )


def derived_display_status(
    exception: Any,
    *,
    now: datetime | None = None,
) -> str:
    """AWAITING_CONFIRMATION là trạng thái DERIVED (không persist):
    MAKEUP_SCHEDULED và now >= replacement_end_at."""
    reference = now or datetime.now(timezone.utc)
    if exception.status == "MAKEUP_SCHEDULED":
        if (
            exception.replacement_end_at is not None
            and reference >= exception.replacement_end_at
        ):
            return "AWAITING_CONFIRMATION"
        return "MAKEUP_SCHEDULED"
    return exception.status
