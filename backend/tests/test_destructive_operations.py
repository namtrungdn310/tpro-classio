from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.student import Student
from app.services.class_service import archive_class
from app.services.fee_service import sync_fee_records_for_period
from app.services.student_service import delete_student


class ScalarResult:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    def scalars(self) -> "ScalarResult":
        return self

    def unique(self) -> "ScalarResult":
        return self

    def all(self) -> list[object]:
        return self._values

    def scalar_one_or_none(self) -> object | None:
        return self._values[0] if self._values else None


@pytest.mark.asyncio
async def test_sync_keeps_current_unpaid_record_after_due_date() -> None:
    class_ = Class(
        id=str(uuid4()),
        name="Monthly class",
        type="MONTHLY",
        base_fee=Decimal("900000"),
        billing_cycle_months=1,
        is_active=True,
    )
    enrollment = Enrollment(
        id=str(uuid4()),
        student_id=str(uuid4()),
        class_id=class_.id,
        enrollment_date=date(2026, 6, 5),
        status="active",
    )
    enrollment.class_ = class_
    record = FeeRecord(
        id=str(uuid4()),
        enrollment_id=enrollment.id,
        period="2026-07",
        due_date=date(2026, 7, 5),
        enrollment_date_snapshot=date(2026, 6, 5),
        base_amount=Decimal("900000"),
        discount_amount=Decimal("0"),
        status="UNPAID",
    )
    db = AsyncMock()
    db.execute.side_effect = [
        None,
        ScalarResult([enrollment]),
        ScalarResult([record]),
    ]

    with patch("app.services.fee_service.date") as mocked_date:
        mocked_date.today.return_value = date(2026, 7, 11)
        mocked_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)
        await sync_fee_records_for_period(db, "2026-07")

    db.delete.assert_not_awaited()
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_archive_class_preserves_business_history() -> None:
    class_id = uuid4()
    class_ = Class(
        id=str(class_id),
        name="Class to delete",
        type="MONTHLY",
        base_fee=Decimal("900000"),
        billing_cycle_months=1,
        is_active=True,
    )
    db = AsyncMock()

    with (
        patch(
            "app.services.class_service.get_class",
            new=AsyncMock(return_value=class_),
        ),
        patch(
            "app.services.class_service._reconcile_current_class_fees",
            new=AsyncMock(),
        ) as reconcile,
    ):
        deleted = await archive_class(db, class_id)

    assert deleted is class_
    reconcile.assert_awaited_once_with(db, class_)
    assert class_.is_active is False
    db.delete.assert_not_awaited()
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(class_)


@pytest.mark.asyncio
async def test_delete_student_archives_and_drops_active_enrollments() -> None:
    student_id = uuid4()
    student = Student(
        id=str(student_id),
        full_name="Student to archive",
        status="active",
    )
    response = SimpleNamespace(id=str(student_id))
    class_ = Class(
        id=str(uuid4()),
        name="Student class",
        type="MONTHLY",
        base_fee=Decimal("900000"),
        billing_cycle_months=1,
        is_active=True,
    )
    enrollment = Enrollment(
        id=str(uuid4()),
        student_id=str(student_id),
        class_id=class_.id,
        enrollment_date=date(2026, 6, 5),
        status="active",
    )
    enrollment.class_ = class_
    db = AsyncMock()
    db.execute.side_effect = [ScalarResult([student]), ScalarResult([enrollment])]

    with (
        patch(
            "app.services.student_service.get_student",
            new=AsyncMock(return_value=response),
        ),
        patch(
            "app.services.student_service.lock_fee_period",
            new=AsyncMock(),
        ),
        patch(
            "app.services.student_service.reconcile_fee_record_for_period",
            new=AsyncMock(),
        ) as reconcile,
    ):
        deleted = await delete_student(db, student_id)

    assert deleted is response
    assert student.status == "inactive"
    assert enrollment.status == "dropped"
    reconcile.assert_awaited_once()
    db.delete.assert_not_awaited()
    db.commit.assert_awaited_once()
