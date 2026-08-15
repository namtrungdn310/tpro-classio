"""Pure student-code contract (R6 ADR-003, dev.md §6.4).

Format v1: `TP` + 8 serial digits + 1 Luhn check digit.
Examples: serial 00000001 -> check 8 -> TP000000018; serial 12345678 ->
check 2 -> TP123456782. Display form: `TP-0000-0001-8`.

The code is a human-facing business identifier issued by the database
(sequence, NO CYCLE). It is NOT a secret, authentication factor,
authorization proof or idempotency key. UUID remains the object key.

This module has no database access; SQL and TypeScript must reproduce the
same vectors (test.md §6.5).
"""

from __future__ import annotations

import re
from typing import Final

STUDENT_CODE_PREFIX: Final = "TP"
SERIAL_MIN: Final = 1
SERIAL_MAX: Final = 99_999_999
SERIAL_DIGITS: Final = 8
CHECK_DIGITS: Final = 1
CODE_LENGTH: Final = len(STUDENT_CODE_PREFIX) + SERIAL_DIGITS + CHECK_DIGITS
FORMAT_VERSION: Final = "v1"

# Canonical shape: TP + 9 ASCII digits (8 serial + 1 check).
_CANONICAL_PATTERN = re.compile(r"^TP[0-9]{9}$")
# Display shape: TP-0000-0000-0 (grouped).
_DISPLAY_PATTERN = re.compile(r"^TP-\d{4}-\d{4}-\d$")
_ASCII_DIGITS = frozenset("0123456789")

# Unicode homoglyphs that visually impersonate ASCII digits must never
# normalize into a valid code (test.md §6.5 search normalizer rule).
_HOMOGLYPH_DIGITS = frozenset(
    "０１２３４５６７８９"  # fullwidth
    "٠١٢٣٤٥٦٧٨٩"  # arabic-indic
    "۰۱۲۳۴۵۶۷۸۹"  # extended arabic-indic
    "०१२३४५६७८९"  # devanagari
)


def luhn_check_digit(serial_digits: str) -> int:
    """Luhn check digit over the 8 serial digits.

    Digits are processed from the rightmost; every second digit (positions
    0, 2, 4, 6 counting from the right) is doubled with digit-sum folding.
    """
    total = 0
    for index, char in enumerate(reversed(serial_digits)):
        digit = ord(char) - 48
        if index % 2 == 0:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return (10 - (total % 10)) % 10


def code_from_serial(serial: int) -> str:
    """Build the canonical code from a serial number."""
    if serial < SERIAL_MIN or serial > SERIAL_MAX:
        raise ValueError("serial out of range")
    serial_digits = f"{serial:0{SERIAL_DIGITS}d}"
    check = luhn_check_digit(serial_digits)
    return f"{STUDENT_CODE_PREFIX}{serial_digits}{check}"


def validate_code(code: str) -> str:
    """Validate a canonical code; return it trimmed.

    Rejects: wrong prefix/length, non-ASCII digits, Unicode homoglyphs,
    serial 0 / out-of-range serial, wrong Luhn checksum.
    """
    normalized = code.strip()
    if len(normalized) != CODE_LENGTH or not _CANONICAL_PATTERN.match(normalized):
        raise ValueError("student code must match TP + 8 serial digits + 1 check digit")
    digits = normalized[len(STUDENT_CODE_PREFIX) :]
    if any(char in _HOMOGLYPH_DIGITS for char in digits):
        raise ValueError("student code contains non-ASCII digits")
    serial_digits = digits[:SERIAL_DIGITS]
    if serial_digits == "0" * SERIAL_DIGITS:
        raise ValueError("student serial cannot be zero")
    serial = int(serial_digits)
    if serial < SERIAL_MIN or serial > SERIAL_MAX:
        raise ValueError("student serial out of range")
    expected_check = luhn_check_digit(serial_digits)
    if int(digits[SERIAL_DIGITS]) != expected_check:
        raise ValueError("student code checksum mismatch")
    return normalized


def display_code(code: str) -> str:
    """Canonical -> grouped display form `TP-0000-0001-8` (round-trips)."""
    validated = validate_code(code)
    digits = validated[len(STUDENT_CODE_PREFIX) :]
    return f"{STUDENT_CODE_PREFIX}-{digits[0:4]}-{digits[4:8]}-{digits[8]}"


def normalize_search_input(value: str) -> str:
    """Search normalizer: trim, uppercase, drop ASCII spaces and hyphens.

    Deliberately does NOT translate Unicode homoglyphs — a fullwidth digit
    must never become a valid code via search.
    """
    stripped = value.strip().upper()
    return stripped.replace(" ", "").replace("-", "")
