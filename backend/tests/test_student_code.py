"""R6-D04/V04 — pure student-code contract (test.md §6.5 known vectors)."""

import pytest

from app.core.student_code import (
    CODE_LENGTH,
    SERIAL_MAX,
    SERIAL_MIN,
    STUDENT_CODE_PREFIX,
    code_from_serial,
    display_code,
    luhn_check_digit,
    normalize_search_input,
    validate_code,
)


@pytest.mark.parametrize(
    ("serial", "check", "code"),
    [
        (1, 8, "TP000000018"),
        (12_345_678, 2, "TP123456782"),
        (99_999_999, 8, "TP999999998"),
    ],
)
def test_known_vectors(serial: int, check: int, code: str) -> None:
    assert luhn_check_digit(f"{serial:08d}") == check
    assert code_from_serial(serial) == code
    assert validate_code(code) == code
    assert validate_code(f" {code} ") == code


@pytest.mark.parametrize(
    "code",
    [
        "XP000000018",
        "TP00000001",
        "TP0000000180",
        "TP000000018extra",
        "TP000000008",  # wrong checksum (1 vs 8)
        "TP00000001A",
        "TP00000001-",
        "TP０00000018",  # fullwidth digit
        "TP٠٠00000018",  # arabic-indic digit
        "TP०000000018",  # devanagari digit
        "TP000000000",  # serial zero + wrong check
        "tP000000018",
    ],
)
def test_validate_rejects_invalid_codes(code: str) -> None:
    with pytest.raises(ValueError):
        validate_code(code)


def test_serial_range_rejected() -> None:
    with pytest.raises(ValueError):
        code_from_serial(0)
    with pytest.raises(ValueError):
        code_from_serial(SERIAL_MAX + 1)
    with pytest.raises(ValueError):
        code_from_serial(-1)
    # Cận dưới và cận trên hợp lệ.
    assert code_from_serial(SERIAL_MIN).startswith(STUDENT_CODE_PREFIX)
    assert len(code_from_serial(SERIAL_MAX)) == CODE_LENGTH


def test_display_round_trip() -> None:
    assert display_code("TP000000018") == "TP-0000-0001-8"
    assert display_code("TP123456782") == "TP-1234-5678-2"
    # Display form phải round-trip được qua normalizer.
    assert normalize_search_input(display_code("TP000000018")) == "TP000000018"


def test_normalize_search_input() -> None:
    assert normalize_search_input(" tp-0000-0001-8 ") == "TP000000018"
    assert normalize_search_input("TP000000018") == "TP000000018"
    assert normalize_search_input("tp 0000 0001 8") == "TP000000018"
    # Homoglyph fullwidth KHÔNG được biến thành mã hợp lệ.
    assert normalize_search_input("TP０００0000018") == "TP０００0000018"
    with pytest.raises(ValueError):
        validate_code(normalize_search_input("TP０００0000018"))


def test_luhn_serial_specific() -> None:
    # Check digit thay đổi đúng theo từng serial.
    assert luhn_check_digit("00000002") == 6
    assert luhn_check_digit("00000010") == 9
    assert luhn_check_digit("99999999") == 8


def test_code_not_a_date_dependency() -> None:
    # Contract không phụ thuộc ngày/giờ.
    assert code_from_serial(42) == "TP00000042" + str(luhn_check_digit("00000042"))
