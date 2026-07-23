from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.staff import StaffCreate, StaffResponse, StaffUpdate


def test_staff_create_trims_name_and_normalizes_vietnam_phone() -> None:
    payload = StaffCreate(
        full_name="  Cô Hạnh  ",
        staff_type="TEACHER",
        zalo_name="  Cô Hạnh  ",
        phone="+84 (912) 345-678",
    )

    assert payload.full_name == "Cô Hạnh"
    assert payload.zalo_name == "Cô Hạnh"
    assert payload.phone == "0912345678"


def test_staff_create_rejects_blank_name() -> None:
    with pytest.raises(ValidationError):
        StaffCreate(
            full_name="   ",
            staff_type="TEACHER",
            zalo_name="Cô Hạnh",
            phone="0912345678",
        )


@pytest.mark.parametrize(
    ("zalo_name", "phone"),
    [("", ""), ("Cô Hạnh", ""), ("", "0912345678")],
)
def test_staff_create_requires_contact(
    zalo_name: str,
    phone: str,
) -> None:
    with pytest.raises(ValidationError):
        StaffCreate(
            full_name="Cô Hạnh",
            staff_type="TEACHER",
            zalo_name=zalo_name,
            phone=phone,
        )


@pytest.mark.parametrize("field", ["full_name", "staff_type", "is_active"])
def test_staff_update_rejects_null_for_required_columns(field: str) -> None:
    with pytest.raises(ValidationError):
        StaffUpdate.model_validate({field: None})


@pytest.mark.parametrize(
    "phone",
    ["abc0912345678", "091234567a", "0123456789"],
)
def test_staff_phone_rejects_letters_and_invalid_mobile_prefix(phone: str) -> None:
    with pytest.raises(ValidationError):
        StaffCreate(
            full_name="Cô Hạnh",
            staff_type="TEACHER",
            zalo_name="Cô Hạnh",
            phone=phone,
        )


@pytest.mark.parametrize(
    ("zalo_name", "phone"),
    [("Cô Hạnh", None), (None, "0912345678")],
)
def test_staff_create_requires_complete_contact_pair(
    zalo_name: str | None,
    phone: str | None,
) -> None:
    with pytest.raises(ValidationError):
        StaffCreate(
            full_name="Cô Hạnh",
            staff_type="TEACHER",
            zalo_name=zalo_name,
            phone=phone,
        )


def test_staff_response_accepts_complete_contact_pair() -> None:
    response = StaffResponse.model_validate(
        {
            "id": uuid4(),
            "full_name": "Cô Hạnh",
            "staff_type": "TEACHER",
            "zalo_name": "Cô Hạnh",
            "phone": "0912345678",
            "is_active": True,
            "created_at": "2026-07-16T00:00:00Z",
            "updated_at": "2026-07-16T00:00:00Z",
        }
    )

    assert response.zalo_name == "Cô Hạnh"
    assert response.phone == "0912345678"
