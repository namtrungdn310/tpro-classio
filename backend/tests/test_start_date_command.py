from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from app.core.business_time import business_today
from app.schemas.billing_decision import BillingDecisionCode
from app.schemas.class_ import (
    ClassStartDateUpdate,
)
from app.services.class_service import (
    _start_date_impact,
    _start_date_preview_fingerprint,
    update_class_start_date,
)


def _mock_class(
    *,
    id_: str | None = None,
    start_date: date | None = None,
    version: int = 1,
    type_: str = "MONTHLY",
    base_fee: int = 1_500_000,
    cycle_months: int = 1,
    cycle_weeks: int | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=id_ or str(uuid4()),
        workspace_id=str(uuid4()),
        name="Lớp Toán 10",
        start_date=start_date or (business_today() - timedelta(days=60)),
        version=version,
        type=type_,
        base_fee=base_fee,
        billing_cycle_months=cycle_months,
        billing_cycle_weeks=cycle_weeks,
        identity_scheme="ACADEMIC_YEAR",
        class_category="GENERAL",
        academic_year_start=business_today().year,
        cancelled_at=None,
        stopped_at=None,
        completed_at=None,
        schedule={"slots": []},
    )


def _mock_fee(
    *,
    status: str = "UNPAID",
    paid_amount: Decimal = Decimal(0),
    notified: bool = False,
    coverage_start: date | None = None,
    coverage_end: date | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid4()),
        status=status,
        paid_amount=paid_amount,
        paid_date=business_today() if status == "PAID" else None,
        notified_at=datetime.now(timezone.utc) if notified else None,
        refunded_amount=Decimal(0),
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        payments=[],
    )


def test_start_date_preview_fingerprint_deterministic_and_tamper_resistant() -> None:
    class_id = str(uuid4())
    prev_date = date(2026, 6, 1)
    next_date = date(2026, 6, 15)

    fp1 = _start_date_preview_fingerprint(
        class_id=class_id,
        version=1,
        previous_start_date=prev_date,
        next_start_date=next_date,
        affected_enrollment_count=2,
        protected_fee_record_count=1,
        blocking_history_count=3,
        affected_enrollments=[
            {
                "enrollment_id": "e1",
                "new_enrollment_date": "2026-06-15",
                "recommended_decision": "REANCHOR_NEXT_BOUNDARY",
            },
            {
                "enrollment_id": "e2",
                "new_enrollment_date": "2026-06-15",
                "recommended_decision": "KEEP_CURRENT_THEN_REANCHOR",
            },
        ],
    )
    fp2 = _start_date_preview_fingerprint(
        class_id=class_id,
        version=1,
        previous_start_date=prev_date,
        next_start_date=next_date,
        affected_enrollment_count=2,
        protected_fee_record_count=1,
        blocking_history_count=3,
        affected_enrollments=[
            {
                "enrollment_id": "e1",
                "new_enrollment_date": "2026-06-15",
                "recommended_decision": "REANCHOR_NEXT_BOUNDARY",
            },
            {
                "enrollment_id": "e2",
                "new_enrollment_date": "2026-06-15",
                "recommended_decision": "KEEP_CURRENT_THEN_REANCHOR",
            },
        ],
    )
    assert fp1 == fp2

    # Any tamper must change the hash
    fp_tampered = _start_date_preview_fingerprint(
        class_id=class_id,
        version=2,  # version bumped
        previous_start_date=prev_date,
        next_start_date=next_date,
        affected_enrollment_count=2,
        protected_fee_record_count=1,
        blocking_history_count=3,
    )
    assert fp1 != fp_tampered


@pytest.mark.asyncio
async def test_start_date_impact_blocking_on_staff_attendance() -> None:
    mock_class = _mock_class(start_date=date(2026, 6, 1))
    new_start = date(2026, 6, 20)

    # Mock staff attendance entry occurring on 2026-06-10
    mock_att = SimpleNamespace(
        occurrence_start_at=datetime(2026, 6, 10, 8, 0, tzinfo=timezone.utc),
    )

    mock_db = MagicMock()
    # First scalar returns the attendance entry, second returns None for adjustments
    mock_db.scalar = AsyncMock(side_effect=[mock_att, None])
    mock_db.scalars = AsyncMock(
        return_value=MagicMock(
            unique=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        )
    )

    impact = await _start_date_impact(mock_db, mock_class, new_start)
    assert impact["can_apply"] is False
    assert "điểm danh" in (impact["blocking_reason"] or "")
    assert impact["earliest_historical_activity_date"] == date(2026, 6, 10)


@pytest.mark.asyncio
async def test_start_date_impact_evaluates_billing_decisions_for_affected_students() -> (
    None
):
    class_start = date(2026, 6, 1)
    new_start = date(2026, 6, 15)
    mock_class = _mock_class(start_date=class_start)

    # Student enrollment starting on class_start
    mock_enr = SimpleNamespace(
        id=str(uuid4()),
        student=SimpleNamespace(id=str(uuid4()), full_name="Nguyễn Văn A"),
        enrollment_date=class_start,
        custom_fee=None,
        fee_records=[
            _mock_fee(
                status="UNPAID",
                coverage_start=class_start,
                coverage_end=class_start + timedelta(days=30),
            )
        ],
        billing_anchor_revisions=[],
    )

    mock_db = MagicMock()
    # No historical activities
    mock_db.scalar = AsyncMock(return_value=None)
    mock_scalars_res = MagicMock()
    mock_scalars_res.unique.return_value.all.return_value = [mock_enr]
    mock_db.scalars = AsyncMock(return_value=mock_scalars_res)

    impact = await _start_date_impact(mock_db, mock_class, new_start)
    assert impact["can_apply"] is True
    assert impact["affected_enrollment_count"] == 1
    assert len(impact["affected_enrollments"]) == 1

    student_impact = impact["affected_enrollments"][0]
    assert student_impact["student_name"] == "Nguyễn Văn A"
    assert student_impact["must_change"] is True
    assert len(student_impact["decisions"]) == 5

    decision_codes = {d["decision_code"] for d in student_impact["decisions"]}
    assert BillingDecisionCode.KEEP_CURRENT_THEN_REANCHOR in decision_codes
    assert BillingDecisionCode.REANCHOR_NEXT_BOUNDARY in decision_codes
    assert BillingDecisionCode.REANCHOR_CURRENT_CYCLE in decision_codes


@pytest.mark.asyncio
async def test_update_class_start_date_idempotency() -> None:
    mock_class = _mock_class(start_date=date(2026, 6, 1))
    req_id = uuid4()

    mock_db = MagicMock()
    # Mock existing completed command record
    existing_cmd = SimpleNamespace(
        id=str(uuid4()),
        request_id=str(req_id),
        state="COMPLETED",
    )
    mock_db.scalar = AsyncMock(return_value=existing_cmd)

    with patch(
        "app.services.class_service.get_class", AsyncMock(return_value=mock_class)
    ):
        res = await update_class_start_date(
            mock_db,
            UUID(mock_class.id),
            ClassStartDateUpdate(
                request_id=req_id,
                start_date=date(2026, 6, 15),
                reason="Điều chỉnh",
                expected_version=1,
                expected_fingerprint="0" * 64,
            ),
            actor_user_id=str(uuid4()),
        )
        assert res == mock_class


@pytest.mark.asyncio
async def test_update_class_start_date_stale_fingerprint_rejected() -> None:
    mock_class = _mock_class(start_date=date(2026, 6, 1), version=1)

    mock_db = MagicMock()
    # No existing command
    mock_db.scalar = AsyncMock(return_value=None)
    mock_scalars_res = MagicMock()
    mock_scalars_res.unique.return_value.all.return_value = []
    mock_db.scalars = AsyncMock(return_value=mock_scalars_res)

    with (
        patch(
            "app.services.class_service.get_class", AsyncMock(return_value=mock_class)
        ),
        patch(
            "app.services.class_service._get_class_teacher_ids",
            AsyncMock(return_value=[]),
        ),
        patch(
            "app.services.class_service._get_class_assistant_ids",
            AsyncMock(return_value=[]),
        ),
        patch(
            "app.services.class_service._validate_staff_schedule_availability",
            AsyncMock(),
        ),
    ):
        with pytest.raises(ValueError, match="vừa được cập nhật"):
            await update_class_start_date(
                mock_db,
                UUID(mock_class.id),
                ClassStartDateUpdate(
                    request_id=uuid4(),
                    start_date=date(2026, 6, 15),
                    reason="Điều chỉnh",
                    expected_version=1,
                    expected_fingerprint="wrong_fingerprint_" + "0" * 46,
                ),
                actor_user_id=str(uuid4()),
            )
