from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.student import StudentEnrollmentInfo, StudentResponse, StudentUpdate
from app.services.student_service import redact_student_hidden_fields


def _student_response() -> StudentResponse:
    return StudentResponse(
        id=uuid4(),
        full_name="Nguyễn Minh Anh",
        birth_date=date(2012, 4, 3),
        school="THCS Trưng Vương",
        parent_name=None,
        parent_phone="0912345678",
        parent_zalo="Mẹ Minh Anh",
        student_phone="0987654321",
        student_zalo="Minh Anh",
        notes="Cần hỗ trợ phát âm",
        hidden_fields=[
            "birth_date",
            "student_contact",
            "enrollment_date",
            "custom_fee",
        ],
        status="active",
        classes=[],
        active_enrollments=[
            StudentEnrollmentInfo(
                id=uuid4(),
                class_id=uuid4(),
                class_name="6C1",
                custom_fee=750_000,
                effective_fee=750_000,
                enrollment_date=date(2026, 7, 1),
                status="active",
            )
        ],
        created_at=datetime.now(timezone.utc),
    )


def test_redaction_hides_selected_fields_without_mutating_admin_response() -> None:
    admin_response = _student_response()

    viewer_response = redact_student_hidden_fields(admin_response)

    assert viewer_response.birth_date is None
    assert viewer_response.student_phone is None
    assert viewer_response.student_zalo is None
    assert viewer_response.active_enrollments[0].enrollment_date is None
    assert viewer_response.active_enrollments[0].custom_fee is None
    assert viewer_response.school == "THCS Trưng Vương"
    assert admin_response.birth_date == date(2012, 4, 3)
    assert admin_response.active_enrollments[0].custom_fee == 750_000


def test_hidden_fields_are_allowlisted_and_deduplicated() -> None:
    payload = StudentUpdate(hidden_fields=["school", "school", "notes"])

    assert payload.hidden_fields == ["school", "notes"]


def test_student_update_rejects_null_hidden_fields() -> None:
    with pytest.raises(ValidationError):
        StudentUpdate(hidden_fields=None)
