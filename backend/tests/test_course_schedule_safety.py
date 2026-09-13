"""COURSE safety regressions; fake data only, never the configured database."""

import json
from datetime import date, timedelta
from types import SimpleNamespace as N
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.billing_change_plan import BillingPlanError, FeeSnapshot, Interval
from app.core.billing_schedule import cycle_coverage_interval
from app.services.billing_schedule_change_service import (
    build_plan_for_strategy,
    waiver_scope,
)
from app.services.billing_segment_service import materialize_retained_segments


def context(weeks=4):
    return (
        N(
            id="fixture",
            enrollment_date=date(2026, 9, 1),
            ended_on=None,
            custom_fee=None,
            class_=N(
                base_fee=2800000,
                start_date=date(2026, 1, 1),
                stopped_on=None,
                name="Fixture",
            ),
        ),
        N(
            anchor_date=date(2026, 9, 1),
            billing_type_snapshot="COURSE",
            billing_cycle_weeks_snapshot=weeks,
            scheduled_segments=[],
            waived_intervals=[],
        ),
    )


def plan(e, r, fees, anchor, **kwargs):
    return build_plan_for_strategy(
        enrollment=e,
        revision=r,
        snapshots=fees,
        anchor_date=anchor,
        expected_version=1,
        strategy=kwargs.pop("strategy", "CONTINUE_OLD_UNTIL_NEW"),
        today=date(2026, 9, 12),
        gap_policy="WAIVE",
        reason="Sửa mốc nhập nhầm",
        **kwargs,
    )[0]


@pytest.mark.parametrize("weeks", [1, 3, 4, 6, 8, 12, 52])
def test_course_cycles_keep_exact_weeks_across_leap_and_year_end(weeks):
    for anchor in (
        date(2024, 2, 29),
        date(2026, 1, 31),
        date(2026, 8, 31),
        date(2026, 12, 31),
    ):
        for n in range(100):
            lo, hi = cycle_coverage_interval(anchor, "COURSE", weeks, n)
            assert (hi - lo).days == weeks * 7
            assert hi == cycle_coverage_interval(anchor, "COURSE", weeks, n + 1)[0]


@pytest.mark.parametrize("weeks", [1, 3, 4, 6, 12])
@pytest.mark.parametrize("status", ["UNPAID", "PAID"])
def test_mistaken_future_anchor_correctable_only_after_explicit_consent(weeks, status):
    e, r = context(weeks)
    # A paid/current package must be kept, even when replacing future waivers.
    lo, hi = cycle_coverage_interval(r.anchor_date, "COURSE", weeks, 0)
    old = FeeSnapshot("old", Interval(lo, hi), 2800000, status, status == "PAID", "v1")
    first = plan(e, r, (old,), date(2027, 10, 17))
    r.anchor_date = first.anchor
    r.generation_floor = first.charges[0].coverage.start
    r.scheduled_segments = json.loads(
        json.dumps(
            [
                {
                    "coverage": {"start": s.coverage.start, "end": s.coverage.end},
                    "anchor": s.anchor,
                    "billing_type": s.billing_type,
                    "cycle_weeks": s.cycle_weeks,
                    "amount": s.amount,
                }
                for s in first.scheduled_segments
            ],
            default=str,
        )
    )
    r.waived_intervals = [
        {"start": str(s.start), "end": str(s.end)} for s in first.waived_intervals
    ]
    assert r.waived_intervals
    original_waivers = list(r.waived_intervals)
    fees = (old,) + tuple(
        FeeSnapshot(f"future-{i}", c.coverage, c.amount, "UNPAID", False, "v2")
        for i, c in enumerate(first.charges)
    )
    unchanged_policy = plan(e, r, fees, date(2026, 9, 15))
    assert unchanged_policy.charges[0].coverage.start.year == 2027
    corrected = plan(e, r, fees, date(2026, 9, 15), replace_future_waivers=True)
    assert corrected.charges[0].coverage.start.year == 2026
    assert corrected.replaced_waived_intervals == tuple(
        s for s in first.waived_intervals if s.start > date(2026, 9, 12)
    )
    assert corrected.retained_waived_intervals == tuple(
        s for s in first.waived_intervals if s.start <= date(2026, 9, 12)
    )
    assert r.waived_intervals == original_waivers
    if status == "PAID" or hi > date(2026, 9, 12):
        assert "old" in corrected.keep_ids
    assert not any(
        s.overlaps(c.coverage)
        for s in corrected.waived_intervals
        for c in corrected.charges
    )


def test_future_consent_never_removes_started_waivers_or_void_decisions():
    e, r = context()
    r.generation_floor = date(2027, 1, 1)
    r.waived_intervals = [
        {"start": "2026-09-01", "end": "2026-09-20"},
        {"start": "2026-12-01", "end": "2027-01-01"},
    ]
    kept, replaceable = waiver_scope(r, date(2026, 9, 12), replace_future=True)
    assert kept == (Interval(date(2026, 9, 1), date(2026, 9, 20)),)
    assert len(replaceable) == 1
    void = FeeSnapshot(
        "void",
        Interval(date(2026, 10, 1), date(2026, 11, 1)),
        2800000,
        "VOID",
        False,
        "v1",
    )
    with pytest.raises(BillingPlanError, match="đã huỷ"):
        plan(
            e,
            r,
            (void,),
            date(2026, 9, 25),
            strategy="FROM_CYCLE",
            first_cycle=0,
            replace_future_waivers=True,
        )
    r.generation_floor = date(2026, 9, 1)
    with pytest.raises(BillingPlanError, match="Không còn"):
        waiver_scope(r, date(2026, 9, 12), replace_future=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("weeks", [1, 3, 4, 6, 12])
async def test_retained_final_course_caps_coverage_not_package_price(
    monkeypatch, weeks
):
    e, r = context(weeks)
    start = date(2026, 9, 29)
    end = start + timedelta(weeks=weeks)
    e.class_.stopped_on = start + timedelta(days=3)
    r.id = "revision"
    r.scheduled_segments = [
        {
            "coverage": {"start": str(start), "end": str(end)},
            "anchor": str(start),
            "billing_type": "COURSE",
            "cycle_weeks": weeks,
            "amount": 2800000,
        }
    ]
    db = N(
        scalars=AsyncMock(return_value=N(all=lambda: [])),
        scalar=AsyncMock(return_value=0),
        add=Mock(),
        flush=AsyncMock(),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )
    rows = await materialize_retained_segments(db, e, r, up_to=end)
    assert len(rows) == 1
    assert rows[0].coverage_end == e.class_.stopped_on
    assert rows[0].base_amount == 2800000


def test_explicit_plan_stop_cap_does_not_discount_final_course():
    e, r = context()
    e.class_.stopped_on = date(2026, 9, 22)
    result = plan(e, r, (), date(2026, 9, 15), strategy="FROM_CYCLE", first_cycle=0)
    assert result.charges[0].coverage.end == date(2026, 9, 22)
    assert result.charges[0].amount == 2800000
