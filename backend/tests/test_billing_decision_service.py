from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock

from app.models.fee_record import FeeRecord
from app.schemas.billing_decision import BillingDecisionCode
from app.services.billing_decision_service import (
    compute_billing_decisions_for_enrollment,
    cycle_covering_date,
)


def test_canonical_monthly_dates_on_backdate() -> None:
    # Business date: 2026-08-20
    # Monthly student changed anchor to: 2025-08-01
    today = date(2026, 8, 20)
    anchor = date(2025, 8, 1)

    curr_cycle = cycle_covering_date(anchor, "MONTHLY", None, today)
    assert curr_cycle == 12  # 12 months = 2026-08-01

    decisions = compute_billing_decisions_for_enrollment(
        old_enrollment_date=date(2026, 8, 1),
        new_enrollment_date=anchor,
        billing_type="MONTHLY",
        cycle_weeks=None,
        effective_fee=1_000_000,
        fee_records=[],
        today=today,
    )

    by_code = {d.decision_code: d for d in decisions}

    # REANCHOR_CURRENT_CYCLE must cover 2026-08-01
    curr = by_code[BillingDecisionCode.REANCHOR_CURRENT_CYCLE]
    assert curr.first_anchor_cycle_no == 12
    assert curr.coverage_start == date(2026, 8, 1)
    assert curr.coverage_end == date(2026, 9, 1)
    assert curr.due_date == date(2026, 8, 1)

    # REANCHOR_NEXT_BOUNDARY must be 2026-09-01
    nxt = by_code[BillingDecisionCode.REANCHOR_NEXT_BOUNDARY]
    assert nxt.first_anchor_cycle_no == 13
    assert nxt.coverage_start == date(2026, 9, 1)
    assert nxt.coverage_end == date(2026, 10, 1)
    assert nxt.due_date == date(2026, 9, 1)


def test_canonical_course_package_dates() -> None:
    # Business date: 2026-08-20
    # 4-week package (28 days) starting 2026-08-01
    today = date(2026, 8, 20)
    anchor = date(2026, 8, 1)

    curr_cycle = cycle_covering_date(anchor, "COURSE", 4, today)
    assert curr_cycle == 0  # 2026-08-01 to 2026-08-29

    decisions = compute_billing_decisions_for_enrollment(
        old_enrollment_date=date(2026, 8, 10),
        new_enrollment_date=anchor,
        billing_type="COURSE",
        cycle_weeks=4,
        effective_fee=2_000_000,
        fee_records=[],
        today=today,
    )

    by_code = {d.decision_code: d for d in decisions}

    curr = by_code[BillingDecisionCode.REANCHOR_CURRENT_CYCLE]
    assert curr.first_anchor_cycle_no == 0
    assert curr.coverage_start == date(2026, 8, 1)
    assert curr.coverage_end == date(2026, 8, 29)
    assert curr.due_date == date(2026, 8, 1)

    # Next boundary MUST be 2026-08-29 (not 2026-09-26!)
    nxt = by_code[BillingDecisionCode.REANCHOR_NEXT_BOUNDARY]
    assert nxt.first_anchor_cycle_no == 1
    assert nxt.coverage_start == date(2026, 8, 29)
    assert nxt.coverage_end == date(2026, 9, 26)
    assert nxt.due_date == date(2026, 8, 29)


def test_future_start_date_does_not_create_overdue() -> None:
    today = date(2026, 8, 20)
    future_anchor = date(2026, 9, 15)

    decisions = compute_billing_decisions_for_enrollment(
        old_enrollment_date=date(2026, 9, 1),
        new_enrollment_date=future_anchor,
        billing_type="MONTHLY",
        cycle_weeks=None,
        effective_fee=1_200_000,
        fee_records=[],
        today=today,
    )

    by_code = {d.decision_code: d for d in decisions}
    nxt = by_code[BillingDecisionCode.REANCHOR_NEXT_BOUNDARY]
    assert nxt.first_anchor_cycle_no == 0
    assert nxt.due_date == date(2026, 9, 15)
    assert nxt.coverage_start == date(2026, 9, 15)
    assert nxt.due_date >= today


def test_protected_fee_recommends_keep_current_then_reanchor() -> None:
    today = date(2026, 8, 20)
    paid_fee = MagicMock(spec=FeeRecord)
    paid_fee.status = "PAID"
    paid_fee.notified_at = None
    paid_fee.paid_date = date(2026, 8, 5)
    paid_fee.paid_amount = Decimal("1000000")
    paid_fee.refunded_amount = Decimal("0")
    paid_fee.coverage_start = date(2026, 8, 1)
    paid_fee.coverage_end = date(2026, 9, 1)
    paid_fee.payments = []

    decisions = compute_billing_decisions_for_enrollment(
        old_enrollment_date=date(2026, 8, 1),
        new_enrollment_date=date(2026, 8, 10),
        billing_type="MONTHLY",
        cycle_weeks=None,
        effective_fee=1_000_000,
        fee_records=[paid_fee],
        today=today,
    )

    by_code = {d.decision_code: d for d in decisions}
    tr = by_code[BillingDecisionCode.KEEP_CURRENT_THEN_REANCHOR]
    assert tr.allowed is True
    assert tr.recommended is True
    assert tr.protected_fee_count == 1
    # Next cycle should start after protected coverage end (2026-09-01)
    assert tr.coverage_start >= date(2026, 9, 1)


def test_past_completed_fee_does_not_block_reanchor_current_cycle() -> None:
    # Today is 2026-09-03.
    # Student started on 2026-08-04, changing to 2026-08-05.
    # Past fee was PAID for August (ended 2026-08-31).
    # Current September cycle has NO protected fee.
    today = date(2026, 9, 3)
    past_fee = MagicMock(spec=FeeRecord)
    past_fee.status = "PAID"
    past_fee.notified_at = None
    past_fee.paid_date = date(2026, 8, 5)
    past_fee.paid_amount = Decimal("850000")
    past_fee.refunded_amount = Decimal("0")
    past_fee.coverage_start = date(2026, 8, 1)
    past_fee.coverage_end = date(2026, 8, 31)
    past_fee.payments = []

    decisions = compute_billing_decisions_for_enrollment(
        old_enrollment_date=date(2026, 8, 4),
        new_enrollment_date=date(2026, 8, 5),
        billing_type="MONTHLY",
        cycle_weeks=None,
        effective_fee=850_000,
        fee_records=[past_fee],
        today=today,
    )

    by_code = {d.decision_code: d for d in decisions}
    # Because past fee ended before today and current cycle has no protected fee:
    # KEEP_CURRENT_THEN_REANCHOR should NOT be recommended!
    keep_curr = by_code[BillingDecisionCode.KEEP_CURRENT_THEN_REANCHOR]
    assert keep_curr.recommended is False

    # A reanchor option (next boundary or current) must be recommended
    reanchor_next = by_code[BillingDecisionCode.REANCHOR_NEXT_BOUNDARY]
    assert reanchor_next.recommended is True
