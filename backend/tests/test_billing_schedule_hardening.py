"""Regression tests for the TPRO schedule-change invariants (no database)."""

from datetime import date
from types import SimpleNamespace as N

import pytest

from app.core.billing_change_plan import BillingPlanError, FeeSnapshot, Interval
from app.services.billing_schedule_change_service import build_plan_for_strategy


def context():
    return (
        N(
            id="student-enrollment",
            enrollment_date=date(2026, 9, 1),
            ended_on=None,
            custom_fee=None,
            class_=N(base_fee=900000, stopped_on=None, start_date=date(2026, 1, 1)),
        ),
        N(
            anchor_date=date(2026, 9, 1),
            billing_type_snapshot="MONTHLY",
            billing_cycle_weeks_snapshot=None,
        ),
    )


def build(
    *, status="PAID", first_cycle=0, anchor=date(2026, 9, 15), strategy="KEEP_CURRENT"
):
    enrollment, revision = context()
    fee = FeeSnapshot(
        "old",
        Interval(date(2026, 9, 1), date(2026, 10, 1)),
        900000,
        status,
        status == "PAID",
        "original",
        is_paid=status == "PAID",
        has_settlement=status == "PAID",
    )
    plan, _ = build_plan_for_strategy(
        enrollment=enrollment,
        revision=revision,
        snapshots=(fee,),
        anchor_date=anchor,
        expected_version=1,
        strategy=strategy,
        first_cycle=first_cycle,
        gap_policy="WAIVE",
        reason="Kiểm tra giữ kỳ",
        today=date(2026, 9, 11),
    )
    return plan, fee


@pytest.mark.parametrize("status", ["PAID", "UNPAID"])
def test_keep_never_truncates_or_replaces_current_fee(status):
    with pytest.raises(BillingPlanError, match="giao với khoản được giữ"):
        build(status=status)


@pytest.mark.parametrize("status", ["PAID", "UNPAID"])
def test_keep_later_cycle_preserves_original_snapshot(status):
    plan, fee = build(status=status, first_cycle=1)
    assert plan.keep_ids == ("old",)
    assert not plan.supersede_ids
    assert fee.coverage.end == date(2026, 10, 1)
    assert plan.charges[0].coverage.start == date(2026, 10, 15)


@pytest.mark.parametrize("anchor", [date(2025, 12, 31), date(2026, 1, 1)])
def test_anchor_must_be_after_class_start(anchor):
    with pytest.raises(BillingPlanError) as exc:
        build(anchor=anchor)
    assert exc.value.code == "BILLING_ANCHOR_BEFORE_CLASS"


def test_anchor_before_admission_is_a_calendar_reference_not_debt():
    plan, _ = build(anchor=date(2026, 2, 15), first_cycle=8)
    assert plan.anchor == date(2026, 2, 15)
    assert len(plan.charges) == 1
    assert plan.charges[0].coverage.start == date(2026, 10, 15)


def test_invalid_extreme_date_is_a_business_error():
    with pytest.raises(BillingPlanError) as exc:
        build(anchor=date(9999, 12, 31))
    assert exc.value.code == "BILLING_DATE_OUT_OF_RANGE"


def test_far_future_is_a_bounded_schedule_not_hundreds_of_invoices():
    plan, _ = build(anchor=date(2046, 9, 15), strategy="CONTINUE_OLD_UNTIL_NEW")
    assert len(plan.charges) == 1
    assert len(plan.scheduled_segments) == 1
    assert plan.scheduled_segments[0].coverage == Interval(
        date(2026, 10, 1), date(2046, 9, 1)
    )


def test_segment_iterator_is_bounded_by_the_requested_window():
    from app.services.billing_segment_service import segment_spans

    segment = {
        "coverage": {"start": "2026-10-01", "end": "2046-09-01"},
        "anchor": "2026-09-01",
        "billing_type": "MONTHLY",
        "cycle_weeks": None,
    }
    assert list(segment_spans(segment, date(2026, 10, 15))) == [
        Interval(date(2026, 10, 1), date(2026, 11, 1))
    ]


def test_one_off_deadline_does_not_move_the_next_cycle():
    from app.core.billing import get_enrollment_next_fee_due

    enrollment, revision = context()
    (
        enrollment.status,
        enrollment.current_billing_revision,
        enrollment.current_billing_revision_id,
    ) = "active", revision, "rev"
    revision.first_anchor_cycle_no, revision.state = 0, "CONFIRMED"
    enrollment.fee_records = [
        N(
            status="PAID",
            cycle_no=0,
            anchor_cycle_no=0,
            billing_revision_id="rev",
            base_due_date=date(2026, 9, 1),
            adjusted_due_date=date(2026, 9, 21),
            collection_due_offset_days=20,
        )
    ]
    assert get_enrollment_next_fee_due(enrollment, date(2026, 9, 22))[0] == date(
        2026, 10, 1
    )


def test_preview_accepts_custom_apply_date_but_rejects_ambiguous_selection():
    from pydantic import ValidationError
    from app.schemas.billing_schedule_change import BillingSchedulePreviewRequest

    data = dict(
        anchor_date="2026-09-15",
        expected_version=1,
        strategy="CONTINUE_OLD_UNTIL_NEW",
        apply_from_date="2027-01-01",
    )
    assert BillingSchedulePreviewRequest(**data).apply_from_date == date(2027, 1, 1)
    with pytest.raises(ValidationError):
        BillingSchedulePreviewRequest(**data, first_cycle=0)


def test_package_duration_change_respects_the_accepted_future_floor():
    from app.services.class_billing_cycle_service import _impact_for_enrollment

    enrollment, revision = context()
    enrollment.current_billing_revision, enrollment.fee_records = revision, []
    revision.billing_type_snapshot, revision.billing_cycle_weeks_snapshot = "COURSE", 4
    revision.generation_floor = date(2027, 9, 1)
    revision.waived_intervals = [{"start": "2027-09-01", "end": "2027-09-15"}]
    impact = _impact_for_enrollment(
        enrollment, previous_weeks=4, today=date(2026, 9, 12)
    )
    assert impact.transition_on == date(2027, 9, 15)
