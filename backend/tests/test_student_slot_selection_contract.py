import inspect

from app.models.enrollment_slot_selection import EnrollmentSlotSelection
from app.services.student_service import _to_response, _student_response_load_options


def test_student_response_uses_canonical_slot_selection_end_column() -> None:
    source = inspect.getsource(_to_response)

    assert hasattr(EnrollmentSlotSelection, "effective_until")
    assert not hasattr(EnrollmentSlotSelection, "effective_to")
    assert "selection.effective_until is None" in source
    assert "selection.effective_to" not in source


def test_student_response_loads_current_billing_anchor_without_using_admission_date():
    from datetime import date
    from app.schemas.student import StudentEnrollmentInfo

    assert "Enrollment.current_billing_revision" in inspect.getsource(
        _student_response_load_options
    )
    src = inspect.getsource(_to_response)
    assert "current_billing_revision" in src
    assert "anchor_date" in src
    response = StudentEnrollmentInfo(
        id="11111111-1111-4111-8111-111111111111",
        class_id="22222222-2222-4222-8222-222222222222",
        class_name="6C1",
        custom_fee=None,
        effective_fee=850000,
        enrollment_date=date(2026, 8, 1),
        billing_anchor_date=date(2026, 9, 5),
        billing_anchor_version=2,
        status="active",
    )
    assert response.model_dump(mode="json")["billing_anchor_date"] == "2026-09-05"
    assert response.enrollment_date == date(2026, 8, 1)
