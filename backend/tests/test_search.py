from app.core.search import matches_smart_search


def test_alphanumeric_query_does_not_fall_back_to_unrelated_digits() -> None:
    assert matches_smart_search("6C1", ["6C1"])
    assert not matches_smart_search(
        "6C1",
        ["6C2", "1.610.000đ", "Thứ 6 16:10"],
    )


def test_digit_only_query_still_matches_formatted_phone_number() -> None:
    assert matches_smart_search("0912 334 455", ["0912.334.455"])
