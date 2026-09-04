"""Shared open-ended lifecycle rules for every class consumer.

The planned start date opens the class.  No planned end date closes it: a
management command writes ``stopped_on``/``stopped_at`` explicitly.  Legacy
``completed_at`` rows remain readable during the expand/cutover migration.
"""

from datetime import date
from typing import Any

from sqlalchemy import and_, or_

from app.core.business_time import business_today
from app.models.class_ import Class


def effective_class_status(
    class_: Any,
    *,
    today: date | None = None,
) -> str:
    """Return the only lifecycle label consumers should display."""
    reference = today or business_today()
    if getattr(class_, "cancelled_at", None) is not None:
        return "CANCELLED"
    if getattr(class_, "stopped_at", None) is not None or getattr(
        class_, "completed_at", None
    ) is not None:
        return "STOPPED"
    if not bool(getattr(class_, "is_active", False)):
        return "CANCELLED"
    if (
        getattr(class_, "identity_scheme", "LEGACY") == "LEGACY"
        or getattr(class_, "start_date", None) is None
    ):
        return "LEGACY"
    if reference < class_.start_date:
        return "SCHEDULED"
    return "ACTIVE"


def is_operational_class(class_: Any, *, today: date | None = None) -> bool:
    return effective_class_status(class_, today=today) in {
        "LEGACY",
        "SCHEDULED",
        "ACTIVE",
    }


def is_active_class_today(class_: Any, *, today: date | None = None) -> bool:
    return effective_class_status(class_, today=today) in {"LEGACY", "ACTIVE"}


def operational_class_predicate(today: date | None = None):
    return and_(
        Class.is_active.is_(True),
        Class.cancelled_at.is_(None),
        or_(
            Class.identity_scheme == "LEGACY",
            and_(
                Class.completed_at.is_(None),
                Class.stopped_at.is_(None),
                Class.start_date.is_not(None),
            ),
        ),
    )


def active_class_today_predicate(today: date | None = None):
    reference = today or business_today()
    return and_(
        Class.is_active.is_(True),
        Class.cancelled_at.is_(None),
        or_(
            Class.identity_scheme == "LEGACY",
            and_(
                Class.completed_at.is_(None),
                Class.stopped_at.is_(None),
                Class.start_date <= reference,
            ),
        ),
    )
