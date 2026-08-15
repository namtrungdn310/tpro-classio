"""State-machine and derived-status tests for make-up exceptions."""

from datetime import datetime, timezone

import pytest

from app.models.makeup import ClassSessionException
from app.core.makeup_state import (
    ALLOWED_TRANSITIONS,
    derived_display_status,
    validate_transition,
)
from app.schemas.makeup import MakeupDomainError


def _exception(status: str, replacement_end_at: datetime | None = None):
    return ClassSessionException(
        id="e-1",
        adjustment_id="a-1",
        class_id="c-1",
        original_start_at=datetime(2026, 9, 7, 11, 0, tzinfo=timezone.utc),
        original_end_at=datetime(2026, 9, 7, 12, 30, tzinfo=timezone.utc),
        status=status,
        replacement_start_at=None,
        replacement_end_at=replacement_end_at,
        version=1,
    )


def test_allowed_transitions_are_exact() -> None:
    assert ALLOWED_TRANSITIONS == {
        "MAKEUP_PENDING": {"MAKEUP_SCHEDULED", "RESTORED"},
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


def test_valid_transitions_pass() -> None:
    for current, target in [
        ("MAKEUP_PENDING", "MAKEUP_SCHEDULED"),
        ("MAKEUP_PENDING", "RESTORED"),
        ("MAKEUP_SCHEDULED", "MAKEUP_PENDING"),
        ("MAKEUP_SCHEDULED", "MAKEUP_COMPLETED"),
        ("MAKEUP_SCHEDULED", "MAKEUP_SCHEDULED"),
        ("MAKEUP_SCHEDULED", "RESTORED"),
    ]:
        validate_transition(current, target)


@pytest.mark.parametrize(
    "current,target",
    [
        ("MAKEUP_COMPLETED", "MAKEUP_PENDING"),
        ("MAKEUP_COMPLETED", "MAKEUP_SCHEDULED"),
        ("MAKEUP_PENDING", "MAKEUP_COMPLETED"),
        ("RESTORED", "MAKEUP_SCHEDULED"),
        ("CANCELLED", "MAKEUP_PENDING"),
        ("MAKEUP_PENDING", "CANCELLED"),
    ],
)
def test_invalid_transitions_rejected(current: str, target: str) -> None:
    with pytest.raises(MakeupDomainError) as exc_info:
        validate_transition(current, target)
    assert exc_info.value.code == "INVALID_TRANSITION"


def test_future_scheduled_makeup_displays_scheduled() -> None:
    exception = _exception(
        "MAKEUP_SCHEDULED",
        replacement_end_at=datetime(2026, 10, 1, 12, 30, tzinfo=timezone.utc),
    )
    assert (
        derived_display_status(
            exception, now=datetime(2026, 9, 20, tzinfo=timezone.utc)
        )
        == "MAKEUP_SCHEDULED"
    )


def test_past_scheduled_makeup_displays_awaiting_confirmation_without_persist() -> None:
    exception = _exception(
        "MAKEUP_SCHEDULED",
        replacement_end_at=datetime(2026, 9, 10, 12, 30, tzinfo=timezone.utc),
    )
    assert (
        derived_display_status(
            exception, now=datetime(2026, 9, 11, tzinfo=timezone.utc)
        )
        == "AWAITING_CONFIRMATION"
    )
    # Trạng thái persisted KHÔNG đổi (derived-only).
    assert exception.status == "MAKEUP_SCHEDULED"


def test_pending_and_completed_display_persisted_status() -> None:
    now = datetime(2026, 9, 11, tzinfo=timezone.utc)
    assert (
        derived_display_status(_exception("MAKEUP_PENDING"), now=now)
        == "MAKEUP_PENDING"
    )
    assert (
        derived_display_status(_exception("MAKEUP_COMPLETED"), now=now)
        == "MAKEUP_COMPLETED"
    )
    assert derived_display_status(_exception("RESTORED"), now=now) == "RESTORED"
