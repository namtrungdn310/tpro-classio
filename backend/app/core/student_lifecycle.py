"""Canonical student profile list-state rules.

The read filter and the response projector must share this contract.  Keeping
them here prevents a cancelled membership from being queried in one scope and
then labelled as another scope by the response serializer.
"""

from typing import Literal

from sqlalchemy import and_

from app.core.class_lifecycle import is_operational_class, operational_class_predicate
from app.models.enrollment import Enrollment
from app.models.student import Student


StudentListStateValue = Literal["UNASSIGNED", "CURRENT", "STOPPED"]


def derive_student_list_state(student: Student) -> StudentListStateValue:
    if student.status == "archived":
        return "STOPPED"

    has_current = any(
        enrollment.status == "active"
        and enrollment.class_ is not None
        and enrollment.class_.identity_scheme != "LEGACY"
        and is_operational_class(enrollment.class_)
        for enrollment in student.enrollments
    )
    if has_current:
        return "CURRENT"

    # Enrollment history is metadata, not a public list state. An active
    # profile without an operational membership always belongs to the same
    # "Chưa xếp lớp" queue, whether it is new or has studied before.
    return "UNASSIGNED"


def student_list_state_filter(list_state: StudentListStateValue):
    """Return the SQL predicate matching :func:`derive_student_list_state`."""

    current_enrollment = Student.enrollments.any(
        and_(
            Enrollment.status == "active",
            Enrollment.class_.has(operational_class_predicate()),
        )
    )
    if list_state == "STOPPED":
        return Student.status == "archived"
    if list_state == "CURRENT":
        return and_(Student.status == "active", current_enrollment)
    return and_(
        Student.status == "active",
        ~current_enrollment,
    )
