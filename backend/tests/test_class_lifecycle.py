from datetime import date
from types import SimpleNamespace

from app.core.class_lifecycle import (
    effective_class_status,
    is_active_class_today,
    is_operational_class,
)


def make_class(**overrides):
    values = {
        "identity_scheme": "ACADEMIC_YEAR",
        "is_active": True,
        "start_date": date(2026, 8, 1),
        "end_date": date(2027, 5, 31),
        "cancelled_at": None,
        "completed_at": None,
        "stopped_at": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_structured_class_remains_active_after_legacy_planned_end() -> None:
    class_ = make_class()

    assert effective_class_status(class_, today=date(2026, 7, 31)) == "SCHEDULED"
    assert is_operational_class(class_, today=date(2026, 7, 31))
    assert not is_active_class_today(class_, today=date(2026, 7, 31))

    assert effective_class_status(class_, today=date(2027, 5, 31)) == "ACTIVE"
    assert is_active_class_today(class_, today=date(2027, 5, 31))

    assert effective_class_status(class_, today=date(2027, 6, 1)) == "ACTIVE"
    assert is_operational_class(class_, today=date(2027, 6, 1))


def test_legacy_class_stays_operational_until_explicitly_configured() -> None:
    class_ = make_class(
        identity_scheme="LEGACY",
        start_date=None,
        end_date=None,
    )

    assert effective_class_status(class_, today=date(2030, 1, 1)) == "LEGACY"
    assert is_operational_class(class_, today=date(2030, 1, 1))
    assert is_active_class_today(class_, today=date(2030, 1, 1))


def test_cancelled_and_stopped_markers_take_precedence() -> None:
    assert (
        effective_class_status(
            make_class(cancelled_at=object(), completed_at=object()),
            today=date(2026, 9, 1),
        )
        == "CANCELLED"
    )
    assert (
        effective_class_status(
            make_class(completed_at=object()),
            today=date(2026, 9, 1),
        )
        == "STOPPED"
    )


def test_explicit_stop_closes_open_ended_class() -> None:
    class_ = make_class(stopped_at=object(), is_active=False)

    assert effective_class_status(class_, today=date(2027, 6, 1)) == "STOPPED"
    assert is_operational_class(class_, today=date(2027, 6, 1)) is False


def test_still_active_before_planned_end() -> None:
    class_ = make_class()
    assert effective_class_status(class_, today=date(2027, 5, 30)) == "ACTIVE"


def test_scheduled_before_start() -> None:
    class_ = make_class()
    assert effective_class_status(class_, today=date(2026, 7, 1)) == "SCHEDULED"
