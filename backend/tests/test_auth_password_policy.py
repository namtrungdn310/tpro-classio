import pytest

from app.schemas.auth import validate_password_strength


def test_password_policy_accepts_required_character_groups() -> None:
    assert validate_password_strength("Abcdef1!") == "Abcdef1!"


@pytest.mark.parametrize(
    ("password", "expected_message"),
    [
        ("Abcd1!", "ít nhất 8 ký tự"),
        ("abcdef1!", "chữ in hoa"),
        ("Abcdefg!", "chữ số"),
        ("Abcdefg1", "ký tự đặc biệt"),
    ],
)
def test_password_policy_rejects_missing_requirements(
    password: str,
    expected_message: str,
) -> None:
    with pytest.raises(ValueError, match=expected_message):
        validate_password_strength(password)
