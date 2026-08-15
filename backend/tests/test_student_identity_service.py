from datetime import date
from uuid import uuid4

from app.models.student import Student
from app.schemas.student import StudentCreate
from app.services.student_identity_service import (
    _identity_lock_key,
    _mask_phone,
    _score_candidate,
)


def make_payload() -> StudentCreate:
    return StudentCreate(
        full_name=" Nguyễn   Minh Án ",
        class_id=uuid4(),
        enrollment_date=date(2026, 7, 29),
        birth_date=date(2014, 6, 5),
        school="THCS Chu Văn An",
        parent_zalo="Mẹ An",
        parent_phone="+84912345678",
    )


def test_identity_scoring_normalizes_name_and_phone() -> None:
    payload = make_payload()
    student = Student(
        id=str(uuid4()),
        full_name="nguyen minh an",
        birth_date=payload.birth_date,
        parent_phone="0912345678",
        status="inactive",
    )

    scored = _score_candidate(student, payload)

    assert scored is not None
    assert scored.score == 100
    assert scored.strength == "strong"


def test_identity_lock_key_is_stable_for_normalized_input() -> None:
    first = make_payload()
    second = make_payload().model_copy(
        update={
            "full_name": "nguyen minh an",
            "parent_phone": "0912345678",
        },
    )

    assert _identity_lock_key(first) == _identity_lock_key(second)


def test_mask_phone_only_exposes_last_four_digits() -> None:
    masked = _mask_phone("+84912345678")

    assert masked is not None
    assert masked.endswith("5678")
    assert "091234" not in masked
