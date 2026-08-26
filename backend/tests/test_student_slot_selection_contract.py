import inspect

from app.models.enrollment_slot_selection import EnrollmentSlotSelection
from app.services.student_service import _to_response


def test_student_response_uses_canonical_slot_selection_end_column() -> None:
    source = inspect.getsource(_to_response)

    assert hasattr(EnrollmentSlotSelection, "effective_until")
    assert not hasattr(EnrollmentSlotSelection, "effective_to")
    assert "selection.effective_until is None" in source
    assert "selection.effective_to" not in source
