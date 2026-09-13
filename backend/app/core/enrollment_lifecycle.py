"""Canonical effective-date rules for student class memberships.

``status`` records the lifecycle outcome while the date interval records when
the learner actually belongs to the class.  Keeping these concerns separate
is essential for a transfer scheduled in the future: the source row may have
already been marked ``dropped`` for audit purposes, but it remains effective
until ``ended_on``.
"""

from datetime import date
from typing import Any, Literal

from sqlalchemy import and_, or_

from app.core.business_time import business_today
from app.models.enrollment import Enrollment


EnrollmentEffectiveState = Literal["SCHEDULED", "CURRENT", "ENDED", "CANCELLED"]


def effective_enrollment_state(
    enrollment: Any,
    *,
    reference: date | None = None,
) -> EnrollmentEffectiveState:
    day = reference or business_today()
    if getattr(enrollment, "status", None) == "cancelled":
        return "CANCELLED"
    lifecycle_status = getattr(enrollment, "status", None)
    started_on = getattr(enrollment, "enrollment_date", None)
    ended_on = getattr(enrollment, "ended_on", None)
    if lifecycle_status in {"dropped", "completed"} and ended_on is None:
        return "ENDED"
    if started_on is None:
        return "ENDED" if getattr(enrollment, "status", None) != "active" else "CURRENT"
    if ended_on is not None and day >= ended_on:
        return "ENDED"
    if day < started_on:
        return "SCHEDULED"
    return "CURRENT"


def enrollment_effective_on(enrollment: Any, reference: date) -> bool:
    return effective_enrollment_state(enrollment, reference=reference) == "CURRENT"


def enrollment_visible_current_or_scheduled(
    enrollment: Any,
    *,
    reference: date | None = None,
) -> bool:
    return effective_enrollment_state(enrollment, reference=reference) in {
        "CURRENT",
        "SCHEDULED",
    }


def enrollment_effective_predicate(reference: date | None = None):
    """SQL predicate for a membership effective on ``reference``."""

    day = reference or business_today()
    return and_(
        Enrollment.status != "cancelled",
        or_(Enrollment.status == "active", Enrollment.ended_on > day),
        Enrollment.enrollment_date.is_not(None),
        Enrollment.enrollment_date <= day,
        or_(Enrollment.ended_on.is_(None), Enrollment.ended_on > day),
    )


def enrollment_current_or_scheduled_predicate(reference: date | None = None):
    """SQL predicate for rows that have not ended, including future starts."""

    day = reference or business_today()
    return and_(
        Enrollment.status != "cancelled",
        or_(Enrollment.status == "active", Enrollment.ended_on > day),
        or_(Enrollment.ended_on.is_(None), Enrollment.ended_on > day),
    )
