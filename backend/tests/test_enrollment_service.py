from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.student import Student
from app.schemas.enrollment import EnrollmentUpdate
from app.services.enrollment_service import (
    drop_enrollment,
    resolve_enrollment_date,
    update_enrollment,
)


class ScalarResult:
    def __init__(self, values: list[str]) -> None:
        self._values = values

    def scalars(self) -> "ScalarResult":
        return self

    def all(self) -> list[str]:
        return self._values


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
async def test_update_changes_only_the_selected_enrollment_date() -> None:
    first = make_enrollment()
    second = make_enrollment()
    second.student_id = first.student_id
    db = SimpleNamespace(
        scalar=AsyncMock(side_effect=[first.student_id, None]), commit=AsyncMock()
    )
    new_date = date(2026, 6, 20)

    with (
        patch(
            "app.services.enrollment_service._get_enrollment",
            new=AsyncMock(return_value=first),
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
    assert second.enrollment_date == date(2026, 6, 5)
    reconcile.assert_awaited_once_with(db, [first])
    db.commit.assert_awaited_once()


def test_structured_enrollment_date_is_bounded_by_its_own_class() -> None:
    enrollment = make_enrollment()
    class_ = enrollment.class_
    class_.identity_scheme = "ACADEMIC_YEAR"
    class_.start_date = date(2026, 8, 3)
    class_.end_date = date(2026, 8, 10)

    with patch(
        "app.services.enrollment_service.business_today",
        return_value=date(2026, 8, 2),
    ):
        assert resolve_enrollment_date(class_, None) == date(2026, 8, 3)
        assert resolve_enrollment_date(class_, date(2026, 8, 9)) == date(2026, 8, 9)

        with pytest.raises(HTTPException) as final_day_error:
            resolve_enrollment_date(class_, date(2026, 8, 10))

    assert final_day_error.value.status_code == 422


@pytest.mark.asyncio
async def test_drop_enrollment_never_deactivates_profile() -> None:
    """R6: leaving the last class marks the enrollment dropped but keeps the
    profile active — no auto-deactivate-without-class caller remains."""
    enrollment = make_enrollment()
    student = Student(
        id=enrollment.student_id,
        full_name="Nguyễn Minh An",
        status="active",
    )
    db = SimpleNamespace(
        scalar=AsyncMock(side_effect=[enrollment.class_id, student.id]),
        execute=AsyncMock(return_value=ScalarResult([])),
        add=Mock(),
        commit=AsyncMock(),
    )

    with (
        patch(
            "app.services.enrollment_service._get_enrollment",
            new=AsyncMock(return_value=enrollment),
        ),
        patch(
            "app.services.enrollment_service._reconcile_current_fee_records",
            new=AsyncMock(),
        ) as reconcile,
        patch("app.services.enrollment_service._clear_dependent_caches"),
    ):
        response = await drop_enrollment(db, uuid4())

    assert response is not None
    assert enrollment.status == "dropped"
    assert student.status == "active"
    reconcile.assert_awaited_once_with(db, [enrollment])
    db.add.assert_not_called()
    db.commit.assert_awaited_once()
