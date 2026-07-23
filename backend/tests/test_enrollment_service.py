from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.schemas.enrollment import EnrollmentUpdate
from app.services.enrollment_service import update_enrollment


def make_enrollment(*, status: str = "active") -> Enrollment:
    class_ = Class(
        id=str(uuid4()),
        name="6C1",
        type="MONTHLY",
        base_fee=Decimal("750000"),
        billing_cycle_months=1,
        is_active=True,
    )
    enrollment = Enrollment(
        id=str(uuid4()),
        student_id=str(uuid4()),
        class_id=class_.id,
        enrollment_date=date(2026, 6, 5),
        status=status,
    )
    enrollment.class_ = class_
    return enrollment


@pytest.mark.asyncio
async def test_update_rejects_dropped_enrollment() -> None:
    enrollment = make_enrollment(status="dropped")
    db = SimpleNamespace()

    with patch(
        "app.services.enrollment_service._get_enrollment",
        new=AsyncMock(return_value=enrollment),
    ):
        with pytest.raises(HTTPException) as error:
            await update_enrollment(
                db,
                uuid4(),
                EnrollmentUpdate(enrollment_date=date(2026, 6, 20)),
            )

    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_update_propagates_date_to_all_active_enrollments() -> None:
    first = make_enrollment()
    second = make_enrollment()
    second.student_id = first.student_id
    db = SimpleNamespace(
        scalar=AsyncMock(return_value=first.student_id), commit=AsyncMock()
    )
    new_date = date(2026, 6, 20)

    with (
        patch(
            "app.services.enrollment_service._get_enrollment",
            new=AsyncMock(return_value=first),
        ),
        patch(
            "app.services.enrollment_service._get_active_enrollments",
            new=AsyncMock(return_value=[first, second]),
        ),
        patch(
            "app.services.enrollment_service._reconcile_current_fee_records",
            new=AsyncMock(),
        ) as reconcile,
        patch("app.services.enrollment_service._clear_dependent_caches"),
    ):
        response = await update_enrollment(
            db,
            uuid4(),
            EnrollmentUpdate(enrollment_date=new_date),
        )

    assert response is not None
    assert first.enrollment_date == new_date
    assert second.enrollment_date == new_date
    reconcile.assert_awaited_once_with(db, [first, second])
    db.commit.assert_awaited_once()
