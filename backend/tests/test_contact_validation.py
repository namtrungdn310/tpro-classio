import pytest

from app.core.contact import validate_complete_contact_pair


@pytest.mark.parametrize(
    ("zalo_name", "phone", "message"),
    [
        ("An Zalo", None, "Vui lòng nhập số điện thoại học viên."),
        (None, "0912345678", "Vui lòng nhập tên Zalo học viên."),
    ],
)
def test_incomplete_contact_messages_are_concise(
    zalo_name: str | None,
    phone: str | None,
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        validate_complete_contact_pair(
            zalo_name=zalo_name,
            phone=phone,
            owner="học viên",
        )
