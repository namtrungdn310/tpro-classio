from datetime import date, timedelta
from types import SimpleNamespace

from app.core.student_lifecycle import derive_student_list_state


def test_active_profile_without_current_class_is_unassigned_even_with_history() -> None:
    student = SimpleNamespace(
        status="active",
        enrollments=[
            SimpleNamespace(status="completed", class_=SimpleNamespace()),
            SimpleNamespace(status="cancelled", class_=SimpleNamespace()),
        ],
    )

    assert derive_student_list_state(student) == "UNASSIGNED"


def test_active_profile_with_operational_membership_is_current() -> None:
    class_ = SimpleNamespace(
        identity_scheme="ACADEMIC_YEAR",
        is_active=True,
        cancelled_at=None,
        completed_at=None,
        start_date=date.today() - timedelta(days=1),
        end_date=date.today() + timedelta(days=1),
    )
    student = SimpleNamespace(
        status="active",
        enrollments=[SimpleNamespace(status="active", class_=class_)],
    )

    assert derive_student_list_state(student) == "CURRENT"


def test_archived_profile_is_stopped_regardless_of_membership_history() -> None:
    student = SimpleNamespace(status="archived", enrollments=[])

    assert derive_student_list_state(student) == "STOPPED"
