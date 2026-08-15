from datetime import date
from types import SimpleNamespace

from app.core.billing import (
    NEXT_FEE_DUE_NONE,
    NEXT_FEE_DUE_OVERDUE,
    NEXT_FEE_DUE_UPCOMING,
    get_class_next_fee_due,
    get_enrollment_next_fee_due,
)

TODAY = date(2026, 8, 1)


def make_class(**overrides):
    values = {
        "type": "MONTHLY",
        "base_fee": 750_000,
        "billing_cycle_months": 1,
        "billing_cycle_weeks": None,
        "start_date": date(2026, 6, 1),
        "end_date": date(2027, 6, 1),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def make_enrollment(
    class_, enrollment_date, status="active", fee_records=None, custom_fee=None
):
    return SimpleNamespace(
        class_=class_,
        enrollment_date=enrollment_date,
        status=status,
        fee_records=fee_records or [],
        custom_fee=custom_fee,
    )


def make_record(period, due_date, cycle_no, status="UNPAID", refunded_amount=0):
    return SimpleNamespace(
        period=period,
        due_date=due_date,
        cycle_no=cycle_no,
        status=status,
        refunded_amount=refunded_amount,
    )


def test_class_without_students_has_no_next_fee_due():
    due_date, state = get_class_next_fee_due(make_class(), [], TODAY)
    assert due_date is None
    assert state == NEXT_FEE_DUE_NONE


def test_dropped_enrollment_is_ignored():
    class_ = make_class()
    enrollments = [
        make_enrollment(class_, date(2026, 6, 6), status="dropped"),
    ]
    due_date, state = get_class_next_fee_due(class_, enrollments, TODAY)
    assert due_date is None
    assert state == NEXT_FEE_DUE_NONE


def test_unsynced_enrollment_cycle_zero_is_overdue():
    """R6: cycle 0 đến hạn ngay enrollment date."""
    class_ = make_class()
    enrollment = make_enrollment(class_, date(2026, 6, 6))
    due_date, state = get_enrollment_next_fee_due(enrollment, TODAY)
    assert state == NEXT_FEE_DUE_OVERDUE
    assert due_date == date(2026, 6, 6)


def test_monthly_current_period_paid_next_period_upcoming():
    class_ = make_class()
    enrollment = make_enrollment(
        class_,
        date(2026, 6, 6),
        fee_records=[make_record("2026-07", date(2026, 7, 6), 1, status="PAID")],
    )
    due_date, state = get_enrollment_next_fee_due(enrollment, TODAY)
    assert state == NEXT_FEE_DUE_UPCOMING
    assert due_date == date(2026, 8, 6)


def test_unpaid_record_overdue_wins_over_upcoming_period():
    class_ = make_class()
    enrollment = make_enrollment(
        class_,
        date(2026, 6, 6),
        fee_records=[make_record("2026-07", date(2026, 7, 6), 1, status="UNPAID")],
    )
    due_date, state = get_enrollment_next_fee_due(enrollment, TODAY)
    assert state == NEXT_FEE_DUE_OVERDUE
    assert due_date == date(2026, 7, 6)


def test_upcoming_unpaid_record_is_reported():
    class_ = make_class()
    enrollment = make_enrollment(
        class_,
        date(2026, 6, 6),
        fee_records=[
            make_record("2026-07", date(2026, 7, 6), 1, status="PAID"),
            make_record("2026-08", date(2026, 8, 6), 2, status="UNPAID"),
        ],
    )
    due_date, state = get_enrollment_next_fee_due(enrollment, TODAY)
    assert state == NEXT_FEE_DUE_UPCOMING
    assert due_date == date(2026, 8, 6)


def test_refunded_period_does_not_reopen_or_shift_schedule():
    class_ = make_class()
    enrollment = make_enrollment(
        class_,
        date(2026, 6, 6),
        fee_records=[
            make_record(
                "2026-07",
                date(2026, 7, 6),
                1,
                status="PAID",
                refunded_amount=750_000,
            )
        ],
    )
    due_date, state = get_enrollment_next_fee_due(enrollment, TODAY)
    assert state == NEXT_FEE_DUE_UPCOMING
    assert due_date == date(2026, 8, 6)


def test_course_paid_periods_advance_to_next_cycle():
    class_ = make_class(type="COURSE", billing_cycle_weeks=4)
    enrollment = make_enrollment(
        class_,
        date(2026, 6, 1),
        fee_records=[
            make_record("2026-06", date(2026, 6, 29), 1, status="PAID"),
            make_record("2026-07", date(2026, 7, 27), 2, status="PAID"),
        ],
    )
    due_date, state = get_enrollment_next_fee_due(enrollment, TODAY)
    assert state == NEXT_FEE_DUE_UPCOMING
    assert due_date == date(2026, 8, 24)


def test_next_due_date_never_exceeds_class_end_date():
    class_ = make_class(end_date=date(2026, 7, 20))
    enrollment = make_enrollment(
        class_,
        date(2026, 6, 6),
        fee_records=[make_record("2026-07", date(2026, 7, 6), 1, status="PAID")],
    )
    due_date, state = get_class_next_fee_due(class_, [enrollment], TODAY)
    assert due_date is None
    assert state == NEXT_FEE_DUE_NONE


def test_custom_fee_enrollment_still_computes_due_date():
    class_ = make_class()
    enrollment = make_enrollment(
        class_,
        date(2026, 6, 6),
        custom_fee=500_000,
        fee_records=[make_record("2026-07", date(2026, 7, 6), 1, status="PAID")],
    )
    due_date, state = get_enrollment_next_fee_due(enrollment, TODAY)
    assert state == NEXT_FEE_DUE_UPCOMING
    assert due_date == date(2026, 8, 6)


def test_class_aggregate_prefers_nearest_overdue():
    class_ = make_class()
    overdue = make_enrollment(
        class_,
        date(2026, 6, 6),
        fee_records=[make_record("2026-07", date(2026, 7, 6), 1, status="UNPAID")],
    )
    upcoming = make_enrollment(
        class_,
        date(2026, 7, 10),
        fee_records=[make_record("2026-07", date(2026, 7, 10), 0, status="PAID")],
    )
    due_date, state = get_class_next_fee_due(class_, [overdue, upcoming], TODAY)
    assert state == NEXT_FEE_DUE_OVERDUE
    assert due_date == date(2026, 7, 6)


def test_class_aggregate_upcoming_when_no_overdue():
    class_ = make_class()
    first = make_enrollment(
        class_,
        date(2026, 6, 20),
        fee_records=[make_record("2026-07", date(2026, 7, 20), 1, status="PAID")],
    )
    second = make_enrollment(
        class_,
        date(2026, 7, 10),
        fee_records=[make_record("2026-07", date(2026, 7, 10), 0, status="PAID")],
    )
    due_date, state = get_class_next_fee_due(class_, [first, second], TODAY)
    assert state == NEXT_FEE_DUE_UPCOMING
    assert due_date == date(2026, 8, 10)
