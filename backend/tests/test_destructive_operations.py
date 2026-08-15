from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest

from app.models.class_ import Class
from app.schemas.student import StudentArchiveRequest
from app.services.student_service import archive_student
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.student import Student
from app.services.class_service import delete_class
from app.services.fee_service import sync_fee_records_for_period


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
    db.add = Mock()
    db.scalar = AsyncMock(return_value=1)
    db.execute.side_effect = [
        None,
        ScalarResult([enrollment]),
        None,
        ScalarResult([record]),
    ]

    with (
        patch(
            "app.services.fee_service.business_today", return_value=date(2026, 7, 11)
        ),
        patch("app.services.fee_service.date") as mocked_date,
    ):
        mocked_date.today.return_value = date(2026, 7, 11)
        mocked_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)
        await sync_fee_records_for_period(db, "2026-07")

    db.delete.assert_not_awaited()
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_class_preserves_history_and_never_deactivates_profiles() -> None:
    """R6: cancelling a class never archives/inactivates student profiles."""
    class_id = uuid4()
    class_ = Class(
        id=str(class_id),
        name="Class to delete",
        type="MONTHLY",
        base_fee=Decimal("900000"),
        billing_cycle_months=1,
        is_active=True,
    )
    orphan = Student(
        id=str(uuid4()),
        full_name="Only in deleted class",
        status="active",
    )
    enrollment = Enrollment(
        id=str(uuid4()),
        student_id=orphan.id,
        class_id=class_.id,
        enrollment_date=date(2026, 6, 5),
        status="active",
    )
    db = AsyncMock()
    db.add = Mock()
    db.execute.return_value = ScalarResult([orphan.id])
    db.scalar.return_value = 0

    with (
        patch(
            "app.services.class_service.get_class",
            new=AsyncMock(return_value=class_),
        ),
        patch(
            "app.services.class_service._lock_enrolled_students",
            new=AsyncMock(return_value=[orphan]),
        ),
        patch(
            "app.services.class_service._reconcile_current_class_fees",
            new=AsyncMock(return_value=[enrollment]),
        ) as reconcile,
    ):
        deleted = await delete_class(db, class_id)

    assert deleted is class_
    reconcile.assert_awaited_once_with(db, class_)
    assert class_.is_active is False
    assert enrollment.status == "cancelled"
    assert enrollment.ended_at is not None
    assert enrollment.end_reason == "Lớp đã bị hủy"
    assert orphan.status == "active"
    db.delete.assert_not_awaited()
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(class_)


@pytest.mark.asyncio
async def test_archive_student_requires_reason_and_preserves_profile() -> None:
    student_id = uuid4()
    student = Student(
        id=str(student_id),
        full_name="Student to archive",
        status="active",
    )
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
    db.add = Mock()
    db.execute.side_effect = [ScalarResult([student]), ScalarResult([enrollment])]
    db.commit = AsyncMock()

    with (
        patch(
            "app.services.student_service.get_student",
            new=AsyncMock(
                return_value=SimpleNamespace(id=str(student_id), status="archived")
            ),
        ),
        patch(
            "app.services.student_service.append_student_lifecycle_event",
            new=Mock(),
        ),
    ):
        archived = await archive_student(
            db,
            student_id,
            StudentArchiveRequest(reason="Học viên chuyển trường"),
            actor_user_id="actor-1",
        )

    assert archived is not None
    assert student.status == "archived"
    assert student.archived_reason == "Học viên chuyển trường"
    assert student.archived_by == "actor-1"
    assert student.archived_at is not None
    assert enrollment.status == "dropped"
    assert enrollment.end_reason == "Hồ sơ học viên được lưu trữ"
    db.delete.assert_not_awaited()
    db.commit.assert_awaited_once()
