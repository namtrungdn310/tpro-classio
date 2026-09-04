from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app.core.billing import NEXT_FEE_DUE_UPCOMING, get_enrollment_next_fee_due
from app.schemas.class_ import ClassBillingCyclePreviewRequest
from app.services.class_billing_cycle_service import (
    _fingerprint,
    _impact_for_enrollment,
    _validate_change,
)


def _fee(
    id_: str,
    start: date,
    end: date,
    *,
    status: str = "UNPAID",
    notified: bool = False,
):
    return SimpleNamespace(
        id=id_,
        status=status,
        notified_at=(datetime.now(timezone.utc) if notified else None),
        refunded_amount=0,
        coverage_start=start,
        coverage_end=end,
        base_due_date=start,
        adjusted_due_date=start,
        due_date=start,
        period=start.strftime("%Y-%m"),
    )


def _enrollment(records: list[SimpleNamespace]):
    return SimpleNamespace(
        id="00000000-0000-0000-0000-000000000011",
        student_id="00000000-0000-0000-0000-000000000012",
        enrollment_date=date(2026, 8, 1),
        billing_anchor_version=1,
        current_billing_revision=SimpleNamespace(
            anchor_date=date(2026, 8, 1),
            billing_type_snapshot="COURSE",
            billing_cycle_weeks_snapshot=4,
        ),
        fee_records=records,
    )


def test_duration_change_starts_at_next_package_boundary() -> None:
    enrollment = _enrollment(
        [
            _fee("current", date(2026, 8, 29), date(2026, 9, 26)),
            _fee("future", date(2026, 9, 26), date(2026, 10, 24)),
        ]
    )

    impact = _impact_for_enrollment(
        enrollment,
        previous_weeks=4,
        today=date(2026, 9, 2),
    )

    assert impact.transition_on == date(2026, 9, 26)
    assert [record.id for record in impact.supersedable] == ["future"]


def test_notified_future_package_pushes_transition_without_rewriting_it() -> None:
    enrollment = _enrollment(
        [
            _fee("current", date(2026, 8, 29), date(2026, 9, 26)),
            _fee(
                "notified",
                date(2026, 9, 26),
                date(2026, 10, 24),
                notified=True,
            ),
            _fee("mutable", date(2026, 10, 24), date(2026, 11, 21)),
        ]
    )

    impact = _impact_for_enrollment(
        enrollment,
        previous_weeks=4,
        today=date(2026, 9, 2),
    )

    assert impact.transition_on == date(2026, 10, 24)
    assert [record.id for record in impact.protected] == ["notified"]
    assert [record.id for record in impact.supersedable] == ["mutable"]


def test_preview_fingerprint_changes_with_mutable_projection() -> None:
    class_ = SimpleNamespace(
        id="00000000-0000-0000-0000-000000000021",
        version=3,
        billing_cycle_weeks=4,
    )
    enrollment = _enrollment([])
    first = _impact_for_enrollment(enrollment, previous_weeks=4, today=date(2026, 9, 2))
    original = _fingerprint(class_, next_weeks=6, impacts=[first])
    enrollment.fee_records.append(
        _fee("new-projection", date(2026, 9, 26), date(2026, 10, 24))
    )
    changed = _fingerprint(
        class_,
        next_weeks=6,
        impacts=[
            _impact_for_enrollment(enrollment, previous_weeks=4, today=date(2026, 9, 2))
        ],
    )
    assert original != changed


def test_duration_command_rejects_monthly_and_stopped_classes() -> None:
    request = ClassBillingCyclePreviewRequest(billing_cycle_weeks=6, expected_version=2)
    monthly = SimpleNamespace(
        version=2,
        type="MONTHLY",
        is_active=True,
        cancelled_at=None,
        completed_at=None,
        stopped_at=None,
        billing_cycle_weeks=None,
    )
    with pytest.raises(ValueError, match="theo gói"):
        _validate_change(monthly, request)

    stopped = SimpleNamespace(
        version=2,
        type="COURSE",
        is_active=False,
        cancelled_at=None,
        completed_at=None,
        stopped_at=datetime.now(timezone.utc),
        billing_cycle_weeks=4,
    )
    with pytest.raises(ValueError, match="đã ngừng"):
        _validate_change(stopped, request)


def test_next_due_uses_confirmed_revision_cadence_not_current_class_value() -> None:
    revision_id = "00000000-0000-0000-0000-000000000031"
    enrollment = SimpleNamespace(
        status="active",
        enrollment_date=date(2026, 8, 1),
        class_=SimpleNamespace(type="COURSE", billing_cycle_weeks=4, stopped_on=None),
        current_billing_revision_id=revision_id,
        current_billing_revision=SimpleNamespace(
            anchor_date=date(2026, 9, 26),
            billing_type_snapshot="COURSE",
            billing_cycle_weeks_snapshot=6,
        ),
        fee_records=[
            SimpleNamespace(
                cycle_no=3,
                billing_revision_id=revision_id,
                anchor_cycle_no=0,
                status="PAID",
                base_due_date=date(2026, 9, 26),
                adjusted_due_date=date(2026, 9, 26),
                due_date=date(2026, 9, 26),
            )
        ],
    )

    assert get_enrollment_next_fee_due(
        enrollment, reference_date=date(2026, 10, 1)
    ) == (date(2026, 11, 7), NEXT_FEE_DUE_UPCOMING)
