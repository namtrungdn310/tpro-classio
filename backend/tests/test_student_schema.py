from datetime import date, timedelta
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.business_time import business_today
from app.schemas.fee import FeeBatchNotifyRequest, FeeNotifyRequest
from app.schemas.student import StudentCreate, StudentUpdate


def make_student_create(**overrides: object) -> StudentCreate:
    payload: dict[str, object] = {
        "full_name": "Nguyễn Văn An",
        "class_id": uuid4(),
        "enrollment_date": date(2026, 7, 14),
        "birth_date": date(2012, 7, 14),
        "school": "THCS Chu Văn An",
        "parent_zalo": "Ba An",
        "parent_phone": "0987654321",
    }
    payload.update(overrides)
    return StudentCreate(**payload)


def test_student_create_rejects_future_birth_date() -> None:
    with pytest.raises(ValidationError):
        make_student_create(
            birth_date=business_today() + timedelta(days=1),
        )


def test_student_create_rejects_whitespace_only_name() -> None:
    with pytest.raises(ValidationError):
        make_student_create(full_name="   ")


def test_student_update_rejects_oversized_notes() -> None:
    with pytest.raises(ValidationError):
        StudentUpdate(notes="a" * 1001)


def test_student_create_accepts_bounded_profile_fields() -> None:
    payload = make_student_create(
        parent_name="Nguyễn Văn Bình",
        notes="Cần theo dõi kỹ năng nói.",
    )

    assert payload.parent_name == "Nguyễn Văn Bình"
    assert payload.notes == "Cần theo dõi kỹ năng nói."


@pytest.mark.parametrize(
    "contact_fields",
    [
        {"student_zalo": "An Zalo"},
        {"student_phone": "0912345678"},
        {"parent_zalo": "Ba An", "parent_phone": None},
        {"parent_zalo": None, "parent_phone": "0987654321"},
    ],
)
def test_student_create_rejects_incomplete_contact_pairs(
    contact_fields: dict[str, str],
) -> None:
    with pytest.raises(ValidationError):
        make_student_create(**contact_fields)


def test_student_create_accepts_complete_contact_pairs() -> None:
    payload = make_student_create(
        student_zalo="An Zalo",
        student_phone="0912345678",
    )

    assert payload.student_phone == "0912345678"
    assert payload.parent_phone == "0987654321"


@pytest.mark.parametrize(
    "field",
    ["birth_date", "school", "parent_zalo", "parent_phone", "enrollment_date"],
)
def test_student_create_requires_profile_and_parent_fields(field: str) -> None:
    with pytest.raises(ValidationError):
        make_student_create(**{field: None})


def test_student_create_keeps_student_contact_notes_and_custom_fee_optional() -> None:
    payload = make_student_create()

    assert payload.student_zalo is None
    assert payload.student_phone is None
    assert payload.notes is None
    assert payload.custom_fee is None


def test_student_update_rejects_explicitly_incomplete_contact_pair() -> None:
    with pytest.raises(ValidationError):
        StudentUpdate(student_zalo="An Zalo", student_phone=None)


def test_fee_notification_channel_is_restricted() -> None:
    with pytest.raises(ValidationError):
        FeeNotifyRequest(channel="email")


def test_fee_notification_message_has_safe_size_limit() -> None:
    with pytest.raises(ValidationError):
        FeeNotifyRequest(message="x" * 2001)


def test_fee_notification_message_is_required() -> None:
    with pytest.raises(ValidationError):
        FeeNotifyRequest()
    with pytest.raises(ValidationError):
        FeeBatchNotifyRequest(record_ids=[uuid4()])


@pytest.mark.parametrize("schema", [FeeNotifyRequest, FeeBatchNotifyRequest])
def test_fee_notification_message_is_normalized_and_cannot_be_blank(schema) -> None:
    payload_data = {"message": "  Nội dung thông báo\r\n  "}
    if schema is FeeBatchNotifyRequest:
        payload_data["record_ids"] = [uuid4()]

    payload = schema(**payload_data)
    assert payload.message == "Nội dung thông báo"

    blank_data = {"message": " \r\n\t "}
    if schema is FeeBatchNotifyRequest:
        blank_data["record_ids"] = [uuid4()]
    with pytest.raises(ValidationError):
        schema(**blank_data)
