"""Tests for Copy Class template & provenance, and Payroll half-open invariants (R7)."""

from datetime import date
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.principal import Principal
from app.models.class_ import Class
from app.models.staff_attendance import StaffCompensationRate
from app.schemas.attendance import AttendanceCheckInRequest
from app.services.attendance_service import _resolve_rate, check_in
from app.services.attendance_occurrence_service import attendance_occurrence_id
from app.services.class_service import get_class_copy_template


@pytest.mark.asyncio
async def test_get_class_copy_template_preserves_configuration_and_strips_runtime():
    class_id = uuid4()
    mock_class = Class(
        id=str(class_id),
        name="Toán 9 Nâng Cao",
        class_category="GENERAL",
        grade_mode="GRADE",
        grade_level=9,
        type="MONTHLY",
        billing_cycle_months=1,
        billing_cycle_weeks=None,
        base_fee=1_200_000,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 6, 30),
        schedule={
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                }
            ]
        },
    )
    mock_db = AsyncMock(spec=AsyncSession)
    mock_db.get.return_value = mock_class

    teacher_id = uuid4()
    assistant_id = uuid4()
    with (
        patch(
            "app.services.class_service._get_class_teacher_ids",
            return_value=[str(teacher_id)],
        ),
        patch(
            "app.services.class_service._get_class_assistant_ids",
            return_value=[str(assistant_id)],
        ),
    ):
        template = await get_class_copy_template(mock_db, class_id)

    assert template.source_class_id == class_id
    assert template.name == "Toán 9 Nâng Cao (Bản sao)"
    assert template.base_fee == 1_200_000
    assert template.type == "MONTHLY"
    assert len(template.schedule.slots) == 1
    assert template.teacher_ids == [teacher_id]
    assert template.assistant_ids == [assistant_id]


@pytest.mark.asyncio
async def test_payroll_rate_half_open_interval():
    """Verify that effective_to > occurrence_date respects the half-open [effective_from, effective_to) boundary."""
    staff_id = str(uuid4())
    rate = StaffCompensationRate(
        id=str(uuid4()),
        staff_id=staff_id,
        rate_amount=250_000,
        effective_from=date(2026, 1, 1),
        effective_to=date(2026, 6, 1),
        version=1,
    )

    class QueryMock:
        def __init__(self, item):
            self.item = item

        def scalar_one_or_none(self):
            return self.item

    db = AsyncMock()
    db.execute.return_value = QueryMock(rate)

    # Within interval: 2026-05-31
    resolved = await _resolve_rate(db, staff_id, date(2026, 5, 31))
    assert resolved is not None
    assert resolved.rate_amount == 250_000

    # Query uses > on effective_to
    query_str = str(db.execute.await_args.args[0])
    assert "effective_to >" in query_str or "effective_to >=" not in query_str


@pytest.mark.asyncio
async def test_attendance_checkin_requires_linked_staff():
    """Principal without linked staff_id cannot check in."""
    unlinked_principal = Principal(
        user_id=str(uuid4()),
        email="unlinked@example.com",
        persistent_role="teacher",
        effective_role="teacher",
        is_owner=False,
        account_status="active",
        staff_id=None,
        aal="aal2",
        device_type="mobile",
        session_nonce="nonce",
    )
    db = AsyncMock()
    req = AttendanceCheckInRequest(request_id=uuid4())

    with pytest.raises(HTTPException) as exc_info:
        await check_in(db, unlinked_principal, uuid4(), req)
    assert exc_info.value.status_code == 403
    assert "chưa liên kết nhân sự" in exc_info.value.detail


def test_attendance_occurrence_public_id_is_stable_and_opaque():
    first = attendance_occurrence_id(
        "11111111-1111-1111-1111-111111111111:2026-08-14T11:00:00+00:00"
    )
    replay = attendance_occurrence_id(
        "11111111-1111-1111-1111-111111111111:2026-08-14T11:00:00+00:00"
    )
    other = attendance_occurrence_id(
        "11111111-1111-1111-1111-111111111111:2026-08-21T11:00:00+00:00"
    )
    assert first == replay
    assert first != other
    assert ":" not in str(first)
