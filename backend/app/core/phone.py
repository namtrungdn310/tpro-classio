import re

VIETNAM_MOBILE_PHONE_PATTERN = re.compile(
    r"^0(?:3|5|7|8|9)\d{8}$",
)


def normalize_vietnam_phone(value: str | None) -> str | None:
    if value is None:
        return None

    digits_only = "".join(character for character in value if character.isdigit())
    if not digits_only:
        return None

    if digits_only.startswith("84"):
        digits_only = f"0{digits_only[2:]}"

    return digits_only


def is_valid_vietnam_mobile_phone(value: str | None) -> bool:
    normalized = normalize_vietnam_phone(value)
    if normalized is None:
        return False

    return bool(VIETNAM_MOBILE_PHONE_PATTERN.fullmatch(normalized))
