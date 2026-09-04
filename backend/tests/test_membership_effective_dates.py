from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from app.core.enrollment_lifecycle import (
    effective_enrollment_state,
    enrollment_effective_predicate,
)
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.schemas.student import (
    StudentEnrollmentTarget,
    StudentMembershipCommand,
    StudentMembershipPreviewRequest,
    StudentUpdate,
)
from app.services.billing_anchor_service import ensure_initial_billing_revision


def _class(*, billing_type: str = "MONTHLY", weeks: int | None = None) -> Class:
    return Class(
        id=str(uuid4()),
        name="6C1",
        type=billing_type,
        base_fee=Decimal("750000"),
        billing_cycle_months=1,
        billing_cycle_weeks=weeks,
        identity_scheme="ACADEMIC_YEAR",
        start_date=date(2025, 1, 1),
        is_active=True,
    )


def _enrollment(*, started: date, status: str = "active", ended: date | None = None):
    class_ = _class()
    enrollment = Enrollment(
        id=str(uuid4()),
        student_id=str(uuid4()),
        class_id=class_.id,
        enrollment_date=started,
        ended_on=ended,
        status=status,
        billing_anchor_version=0,
    )
    enrollment.class_ = class_
    return enrollment


def test_effective_state_supports_scheduled_transfer_source() -> None:
    enrollment = _enrollment(
        started=date(2026, 1, 1),
        status="dropped",
        ended=date(2026, 10, 1),
    )
    assert (
        effective_enrollment_state(enrollment, reference=date(2026, 9, 30)) == "CURRENT"
    )
    assert (
        effective_enrollment_state(enrollment, reference=date(2026, 10, 1)) == "ENDED"
    )


def test_effective_state_distinguishes_future_and_legacy_ended_rows() -> None:
    future = _enrollment(started=date(2026, 10, 1))
    legacy_dropped = _enrollment(started=date(2025, 1, 1), status="dropped")
    assert effective_enrollment_state(future, reference=date(2026, 9, 1)) == "SCHEDULED"
    assert (
        effective_enrollment_state(legacy_dropped, reference=date(2026, 9, 1))
        == "ENDED"
    )


def test_effective_sql_predicate_uses_half_open_ended_on_boundary() -> None:
    compiled = str(
        enrollment_effective_predicate(date(2026, 9, 20)).compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )
    assert "enrollments.enrollment_date <= '2026-09-20'" in compiled
    assert "enrollments.ended_on > '2026-09-20'" in compiled


def test_transfer_contract_requires_exactly_one_target() -> None:
    common = {
        "request_id": uuid4(),
        "expected_updated_at": datetime.now(timezone.utc),
        "profile": StudentUpdate(),
        "mode": "transfer",
        "source_enrollment_id": uuid4(),
    }
    with pytest.raises(ValidationError, match="đúng một lớp đích"):
        StudentMembershipCommand(**common, targets=[])
    with pytest.raises(ValidationError, match="đúng một lớp đích"):
        StudentMembershipCommand(
            **common,
            targets=[
                StudentEnrollmentTarget(class_id=uuid4()),
                StudentEnrollmentTarget(class_id=uuid4()),
            ],
        )


def test_v2_command_and_preview_require_explicit_target_date() -> None:
    target = StudentEnrollmentTarget(class_id=uuid4())
    with pytest.raises(ValidationError, match="ngày bắt đầu"):
        StudentMembershipCommand(
            request_id=uuid4(),
            contract_version=2,
            expected_updated_at=datetime.now(timezone.utc),
            profile=StudentUpdate(),
            targets=[target],
        )
    with pytest.raises(ValidationError, match="ngày bắt đầu"):
        StudentMembershipPreviewRequest(
            expected_updated_at=datetime.now(timezone.utc),
            targets=[target],
        )


@pytest.mark.asyncio
async def test_initial_backdated_monthly_revision_skips_old_debt_and_requires_review() -> (
    None
):
    enrollment = _enrollment(started=date(2025, 8, 1))
    db = SimpleNamespace(add=Mock(), flush=AsyncMock(), get=AsyncMock())

    with patch(
        "app.services.billing_anchor_service.business_today",
        return_value=date(2026, 8, 31),
    ):
        revision = await ensure_initial_billing_revision(db, enrollment)

    assert revision.first_anchor_cycle_no == 13
    assert revision.next_due_date == date(2026, 9, 1)
    assert revision.state == "PENDING"
    assert revision.change_kind == "INITIAL_BACKDATED"
    assert revision.generation_floor == date(2026, 8, 31)


@pytest.mark.asyncio
async def test_initial_future_revision_is_confirmed_and_keeps_exact_anchor() -> None:
    enrollment = _enrollment(started=date(2026, 10, 15))
    db = SimpleNamespace(add=Mock(), flush=AsyncMock(), get=AsyncMock())

    with patch(
        "app.services.billing_anchor_service.business_today",
        return_value=date(2026, 8, 31),
    ):
        revision = await ensure_initial_billing_revision(db, enrollment)

    assert revision.first_anchor_cycle_no == 0
    assert revision.next_due_date == date(2026, 10, 15)
    assert revision.state == "CONFIRMED"
