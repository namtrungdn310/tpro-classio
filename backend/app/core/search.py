from __future__ import annotations

import re
import unicodedata


def normalize_search_text(value: str | None) -> str:
    if not value:
        return ""

    normalized = unicodedata.normalize("NFD", value.strip().lower()).replace("đ", "d")
    without_marks = "".join(
        char for char in normalized if unicodedata.category(char) != "Mn"
    )
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", without_marks)).strip()


def normalize_search_digits(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def matches_smart_search(query: str | None, values: list[str | None]) -> bool:
    normalized_query = normalize_search_text(query)
    query_digits = normalize_search_digits(query)
    if not normalized_query and not query_digits:
        return True

    query_tokens = normalized_query.split()
    compact_query = normalized_query.replace(" ", "")

    for value in values:
        normalized_value = normalize_search_text(value)
        compact_value = normalized_value.replace(" ", "")
        value_digits = normalize_search_digits(value)

        if query_digits and query_digits in value_digits:
            return True
        if normalized_query and normalized_query in normalized_value:
            return True
        if compact_query and compact_query in compact_value:
            return True
        if query_tokens and all(token in normalized_value for token in query_tokens):
            return True

    return False
