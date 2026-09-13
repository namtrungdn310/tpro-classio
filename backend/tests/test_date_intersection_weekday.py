from datetime import date

from app.services.class_conflict_service import _date_intersection_contains_weekday

# 2026-01-05 = Thứ 2 (Monday), 2026-01-06 = Thứ 3, 2026-01-11 = Chủ Nhật.


def test_no_intersection_is_false() -> None:
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1),
            date(2026, 1, 10),
            date(2026, 1, 11),
            date(2026, 1, 20),
            "Thứ 2",
        )
        is False
    )


def test_adjacent_ranges_do_not_conflict() -> None:
    # Inclusive endpoints: [1,10] và [11,20] không giao.
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1),
            date(2026, 1, 10),
            date(2026, 1, 11),
            date(2026, 1, 20),
            "Thứ 2",
        )
        is False
    )


def test_long_overlap_with_matching_weekday_conflicts() -> None:
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1),
            date(2026, 3, 31),
            date(2026, 1, 15),
            date(2026, 6, 30),
            "Thứ 2",
        )
        is True
    )


def test_boundary_day_matching_weekday_conflicts() -> None:
    # 2026-01-05 là Thứ 2; giao đúng ngày đó.
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1),
            date(2026, 1, 5),
            date(2026, 1, 5),
            date(2026, 1, 31),
            "Thứ 2",
        )
        is True
    )


def test_boundary_day_wrong_weekday_is_not_a_conflict() -> None:
    # 2026-01-06 là Thứ 3; slot Thứ 2 không xảy ra trong giao 1 ngày.
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1),
            date(2026, 1, 6),
            date(2026, 1, 6),
            date(2026, 1, 31),
            "Thứ 2",
        )
        is False
    )


def test_short_intersection_1_to_6_days_checks_each_weekday() -> None:
    # Giao 1 ngày (2026-01-06 = Thứ 3) → slot Thứ 3 conflict, slot Thứ 2 không.
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1),
            date(2026, 1, 6),
            date(2026, 1, 6),
            date(2026, 1, 31),
            "Thứ 3",
        )
        is True
    )
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1),
            date(2026, 1, 6),
            date(2026, 1, 6),
            date(2026, 1, 31),
            "Thứ 2",
        )
        is False
    )
    # Giao 6 ngày 05..10 = Thứ 2..Thứ 7 → chứa đủ weekday của đoạn, không có Chủ Nhật.
    for day in ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"]:
        assert (
            _date_intersection_contains_weekday(
                date(2026, 1, 1),
                date(2026, 1, 10),
                date(2026, 1, 5),
                date(2026, 1, 10),
                day,
            )
            is True
        )
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1),
            date(2026, 1, 10),
            date(2026, 1, 5),
            date(2026, 1, 10),
            "Chủ Nhật",
        )
        is False
    )


def test_requested_range_inside_existing_range() -> None:
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1),
            date(2026, 3, 31),
            date(2026, 1, 15),
            date(2026, 1, 20),
            "Thứ 6",
        )
        is True
    )
    # Khoảng yêu cầu 15..17 (Thứ 5..Chủ Nhật): Thứ 4 không có trong giao.
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1),
            date(2026, 3, 31),
            date(2026, 1, 15),
            date(2026, 1, 17),
            "Thứ 4",
        )
        is False
    )


def test_existing_range_inside_requested_range() -> None:
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 15),
            date(2026, 1, 17),
            date(2026, 1, 1),
            date(2026, 3, 31),
            "Thứ 4",
        )
        is False
    )
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 15),
            date(2026, 1, 17),
            date(2026, 1, 1),
            date(2026, 3, 31),
            "Thứ 6",
        )
        is True
    )


def test_unbounded_existing_start_matches_any_weekday() -> None:
    # Intersection = [01-05, 01-10] (Thứ 2..Thứ 7); Chủ Nhật không nằm trong.
    assert (
        _date_intersection_contains_weekday(
            None, date(2026, 1, 10), date(2026, 1, 5), date(2026, 1, 10), "Thứ 2"
        )
        is True
    )
    assert (
        _date_intersection_contains_weekday(
            None, date(2026, 1, 10), date(2026, 1, 5), date(2026, 1, 10), "Chủ Nhật"
        )
        is False
    )
    # Cả hai start đều NULL → giao trải vô hạn → mọi weekday xảy ra.
    assert (
        _date_intersection_contains_weekday(
            None, date(2026, 1, 10), None, date(2026, 1, 20), "Chủ Nhật"
        )
        is True
    )


def test_unbounded_existing_end_matches_any_weekday() -> None:
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 1), None, date(2026, 1, 15), date(2026, 1, 20), "Thứ 2"
        )
        is True
    )


def test_unbounded_requested_start_with_bounded_existing() -> None:
    assert (
        _date_intersection_contains_weekday(
            date(2026, 1, 5), date(2026, 1, 10), None, date(2026, 1, 20), "Thứ 4"
        )
        is True
    )


def test_both_unbounded_is_true() -> None:
    assert (
        _date_intersection_contains_weekday(None, None, None, None, "Chủ Nhật") is True
    )


def test_leap_year_february_29_weekday() -> None:
    # 2024-02-29 là Thứ 5 (leap year).
    assert (
        _date_intersection_contains_weekday(
            date(2024, 2, 1),
            date(2024, 2, 29),
            date(2024, 2, 29),
            date(2024, 3, 31),
            "Thứ 5",
        )
        is True
    )
    assert (
        _date_intersection_contains_weekday(
            date(2024, 2, 1),
            date(2024, 2, 29),
            date(2024, 2, 29),
            date(2024, 3, 31),
            "Thứ 4",
        )
        is False
    )


def test_end_of_month_and_year_boundaries() -> None:
    # 2026-12-31 là Thứ 5; slot Thứ 5 giao đúng ngày cuối năm → conflict;
    # slot Thứ 4 không nằm trong giao 1 ngày đó.
    assert (
        _date_intersection_contains_weekday(
            date(2026, 12, 1),
            date(2026, 12, 31),
            date(2026, 12, 31),
            date(2027, 1, 31),
            "Thứ 5",
        )
        is True
    )
    assert (
        _date_intersection_contains_weekday(
            date(2026, 12, 1),
            date(2026, 12, 31),
            date(2026, 12, 31),
            date(2027, 1, 31),
            "Thứ 4",
        )
        is False
    )
    # 2026-04-30 là Thứ 5 (cuối tháng): slot Thứ 4 không nằm trong giao 1 ngày.
    assert (
        _date_intersection_contains_weekday(
            date(2026, 4, 1),
            date(2026, 4, 30),
            date(2026, 4, 30),
            date(2026, 5, 31),
            "Thứ 4",
        )
        is False
    )


def test_weekday_mapping_matches_python_weekday() -> None:
    # Kiểm tra mapping cố định: Thứ 2=0 .. Chủ Nhật=6 theo date.weekday().
    days = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"]
    expected = [date(2026, 1, d).weekday() for d in range(5, 12)]
    assert expected == [0, 1, 2, 3, 4, 5, 6]
    for day in days:
        assert (
            _date_intersection_contains_weekday(
                date(2026, 1, 5),
                date(2026, 1, 11),
                date(2026, 1, 5),
                date(2026, 1, 11),
                day,
            )
            is True
        )
