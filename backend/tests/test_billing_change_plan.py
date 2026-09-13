from dataclasses import replace
from datetime import date

import pytest

from app.core.billing_change_plan import (
    BillingPlanError,
    FeeSnapshot,
    Interval,
    build_billing_change_plan,
    uncovered_intervals,
    price_transition,
)


def fee(
    id="current",
    start=date(2026, 9, 1),
    end=date(2026, 10, 1),
    *,
    protected=False,
    status="UNPAID",
):
    return FeeSnapshot(id, Interval(start, end), 900_000, status, protected, "v1")


def plan(**overrides):
    args = dict(
        enrollment_id="minh-6c1",
        version=2,
        business_date=date(2026, 9, 6),
        anchor=date(2026, 9, 5),
        billing_type="MONTHLY",
        cycle_weeks=None,
        amount=900_000,
        first_cycle=1,
        transition_from=date(2026, 10, 1),
        fees=(fee(protected=True, status="PAID"),),
    )
    args.update(overrides)
    return build_billing_change_plan(**args)


def test_paid_current_cycle_is_preserved_and_four_day_gap_requires_decision():
    result = plan()
    assert not result.can_apply
    assert result.keep_ids == ("current",)
    assert result.supersede_ids == ()
    assert result.charges[0].coverage == Interval(date(2026, 10, 5), date(2026, 11, 5))
    assert result.gap_intervals == (Interval(date(2026, 10, 1), date(2026, 10, 5)),)


def test_explicit_waiver_is_durable_plan_data_not_a_missing_invoice():
    result = plan(gap_policy="WAIVE", reason="Không thu kỳ chuyển tiếp")
    assert result.can_apply
    assert result.waived_intervals == (Interval(date(2026, 10, 1), date(2026, 10, 5)),)
    assert len(result.charges) == 1


def test_previously_voided_interval_is_not_rebilled_as_a_bridge():
    waived = fee("waived", date(2026, 10, 1), date(2026, 10, 5), status="VOID")
    result = plan(
        fees=(fee(protected=True), waived), gap_policy="CHARGE", reason="Giữ kỳ đã huỷ"
    )
    assert result.can_apply
    assert len(result.charges) == 1
    assert result.charges[0].kind == "CYCLE"


def test_transition_prices_full_calendar_months_at_one_package_each():
    assert (
        price_transition(
            Interval(date(2026, 1, 31), date(2026, 3, 31)),
            date(2026, 3, 31),
            "MONTHLY",
            None,
            900000,
        )
        == 1800000
    )


def test_transition_week_package_uses_days_not_calendar_months():
    assert (
        price_transition(
            Interval(date(2026, 8, 1), date(2026, 8, 15)),
            date(2026, 8, 29),
            "COURSE",
            4,
            800000,
        )
        == 400000
    )


def test_bridge_uses_exact_calendar_reference_and_vnd_half_up_rounding():
    result = plan(gap_policy="CHARGE", reason="Thu bốn ngày chuyển tiếp")
    bridge, full = result.charges
    assert result.can_apply
    assert bridge.kind == "TRANSITION"
    assert bridge.amount == 120000  # 900,000 * 4 / 30 days (05/09–05/10).
    assert full.amount == 900_000
    assert not bridge.coverage.overlaps(full.coverage)


@pytest.mark.parametrize("status", ["UNPAID", "PAID"])
def test_protected_fee_cannot_be_replaced_even_if_marked_unpaid(status):
    with pytest.raises(BillingPlanError, match="giao dịch tiền") as exc:
        plan(
            fees=(fee(protected=True, status=status),), replacement_fee_ids=("current",)
        )
    assert exc.value.code == "PROTECTED_FEE"


def test_old_unpaid_debt_is_not_removed_when_replacing_future_projection():
    old = fee("old", date(2026, 7, 1), date(2026, 8, 1))
    future = fee("future", date(2026, 10, 1), date(2026, 11, 1))
    result = plan(fees=(old, future), replacement_fee_ids=("future",))
    assert result.keep_ids == ("old",)
    assert result.supersede_ids == ("future",)
    with pytest.raises(BillingPlanError) as exc:
        plan(fees=(old,), replacement_fee_ids=("old",))
    assert exc.value.code == "OUT_OF_SCOPE_DEBT"


def test_settlement_blocks_replacement_even_when_protection_flag_is_stale():
    settled = replace(fee(), has_settlement=True)
    with pytest.raises(BillingPlanError) as exc:
        plan(
            fees=(settled,),
            replacement_fee_ids=("current",),
            first_cycle=0,
            transition_from=date(2026, 9, 5),
        )
    assert exc.value.code == "PROTECTED_FEE"


@pytest.mark.parametrize(
    "anchor,end",
    [
        (date(2024, 1, 31), date(2024, 2, 29)),
        (date(2025, 1, 31), date(2025, 2, 28)),
        (date(2026, 12, 31), date(2027, 1, 31)),
    ],
)
def test_month_boundary_preview_is_exact_and_deterministic(anchor, end):
    result = plan(anchor=anchor, first_cycle=0, transition_from=anchor, fees=())
    assert result.charges[0].coverage == Interval(anchor, end)
    assert result.charges[0].amount == 900_000
    assert (
        result.fingerprint
        == plan(
            anchor=anchor, first_cycle=0, transition_from=anchor, fees=()
        ).fingerprint
    )


def test_replacing_mutable_fee_discloses_portion_before_new_anchor():
    result = plan(
        fees=(fee(),),
        replacement_fee_ids=("current",),
        first_cycle=0,
        transition_from=date(2026, 9, 5),
    )
    assert result.gap_intervals == (Interval(date(2026, 9, 1), date(2026, 9, 5)),)


def test_future_prepaid_invoice_blocks_schedule_even_beyond_first_new_cycle():
    prepaid = fee("prepaid", date(2027, 1, 1), date(2027, 2, 1), protected=True)
    with pytest.raises(BillingPlanError) as exc:
        plan(fees=(prepaid,))
    assert exc.value.code == "FUTURE_FEE_OVERLAP"


def test_interval_subtraction_preserves_holes_between_prepaid_periods():
    scope = Interval(date(2026, 9, 1), date(2026, 12, 1))
    covered = (
        Interval(date(2026, 11, 1), date(2026, 12, 15)),
        Interval(date(2026, 8, 1), date(2026, 10, 1)),
    )
    assert uncovered_intervals(scope, covered) == (
        Interval(date(2026, 10, 1), date(2026, 11, 1)),
    )


def test_fingerprint_is_order_independent_but_tracks_payment_state():
    first = fee("a", date(2026, 6, 1), date(2026, 7, 1))
    second = fee("b", date(2026, 7, 1), date(2026, 8, 1))
    left = plan(fees=(first, second))
    right = plan(fees=(second, first))
    paid = plan(fees=(replace(first, financial_version="payment-arrived"), second))
    assert left.fingerprint == right.fingerprint
    assert left.fingerprint != paid.fingerprint
    assert len(left.fingerprint) == 64


@pytest.mark.parametrize(
    "anchor,cycle,start,end",
    [
        (date(2026, 8, 1), 1, date(2026, 8, 29), date(2026, 9, 26)),
        (date(2025, 8, 1), 14, date(2026, 8, 28), date(2026, 9, 25)),
    ],
)
def test_four_week_packages_preserve_full_anchor_year(anchor, cycle, start, end):
    result = plan(
        anchor=anchor,
        billing_type="COURSE",
        cycle_weeks=4,
        first_cycle=cycle,
        transition_from=start,
        fees=(),
    )
    assert result.charges[0].coverage == Interval(start, end)
    assert result.charges[0].due_date == start


def test_remote_anchor_does_not_materialize_unselected_historical_cycles():
    result = plan(
        anchor=date(2020, 10, 5),
        first_cycle=72,
        fees=(),
        transition_from=date(2026, 10, 5),
    )
    assert len(result.charges) == 1
    assert result.charges[0].cycle_no == 72


def test_explicit_historical_cycles_are_not_limited_to_first_twelve():
    result = plan(
        anchor=date(2020, 10, 5),
        first_cycle=72,
        fees=(),
        historical_cycles=(71, 70),
        transition_from=date(2026, 10, 5),
    )
    assert [c.cycle_no for c in result.charges] == [70, 71, 72]


def test_historical_cycle_cannot_charge_paid_period_again():
    old = fee("paid", date(2026, 8, 5), date(2026, 9, 5), protected=True)
    with pytest.raises(BillingPlanError) as exc:
        plan(
            anchor=date(2026, 8, 5), first_cycle=2, historical_cycles=(0,), fees=(old,)
        )
    assert exc.value.code == "DUPLICATE_COVERAGE"


@pytest.mark.parametrize(
    "month,expected",
    [(1, date(2028, 2, 29)), (2, date(2028, 3, 31)), (3, date(2028, 4, 30))],
)
def test_month_end_never_chains_clamped_previous_boundary(month, expected):
    result = plan(
        anchor=date(2028, 1, 31), first_cycle=month, transition_from=expected, fees=()
    )
    assert result.charges[0].coverage.start == expected


@pytest.mark.parametrize(
    "changes,code",
    [
        ({"billing_type": "UNKNOWN"}, "INVALID_CADENCE"),
        ({"billing_type": "COURSE", "cycle_weeks": 0}, "INVALID_CADENCE"),
        ({"first_cycle": -1}, "INVALID_PLAN"),
        ({"replacement_fee_ids": ("missing",)}, "FEE_CHANGED"),
        ({"historical_cycles": (-1,)}, "INVALID_HISTORICAL_CYCLES"),
        ({"historical_cycles": (0, 0)}, "INVALID_HISTORICAL_CYCLES"),
        ({"gap_policy": "WAIVE"}, "REASON_REQUIRED"),
    ],
)
def test_invalid_choices_fail_closed(changes, code):
    with pytest.raises(BillingPlanError) as exc:
        plan(**changes)
    assert exc.value.code == code


def test_custom_transition_amount_overrides_calculated_prorate():
    # Gap from 01/10 to 05/10 (4 days in cycle 05/09 - 05/10 which has 30 days)
    # Default calculated: 900_000 * 4 / 30 = 120_000
    auto_result = plan(gap_policy="CHARGE", reason="Tính tự động")
    transition_charge_auto = next(
        c for c in auto_result.charges if c.kind == "TRANSITION"
    )
    assert transition_charge_auto.amount == 120_000

    # With custom_transition_amount = 200_000
    custom_result = plan(
        gap_policy="CHARGE",
        reason="Nhập phí lẻ tuỳ chỉnh",
        custom_transition_amount=200_000,
    )
    transition_charge_custom = next(
        c for c in custom_result.charges if c.kind == "TRANSITION"
    )
    assert transition_charge_custom.amount == 200_000
    assert custom_result.fingerprint != auto_result.fingerprint
