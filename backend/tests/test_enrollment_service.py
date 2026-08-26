from datetime import date, time
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.models.class_ import Class
from app.models.class_schedule_slot import ClassScheduleSlot
from app.models.enrollment import Enrollment
from app.models.student import Student
from app.schemas.enrollment import EnrollmentUpdate
from app.services.enrollment_service import (
    _ensure_student_schedule_available,
    _create_slot_selections,
    close_enrollment_financial_projection,
    drop_enrollment,
    enroll_locked_student,
    resolve_enrollment_date,
    update_enrollment,
)


class IterableScalarResult:
    def __init__(self, values: list[object], rows: list[object] | None = None) -> None:
        self.values = values
        self.rows = rows or []

    def __iter__(self):
        return iter(self.rows)

    def scalars(self):
        return SimpleNamespace(all=lambda: self.values)

    def all(self):
        return self.rows


@pytest.mark.asyncio
async def test_schedule_guard_rejects_overlapping_active_class() -> None:
    target_class = Class(
        id=str(uuid4()),
        name="7C1",
        type="MONTHLY",
        base_fee=Decimal("700000"),
        billing_cycle_months=1,
        start_date=date(2026, 8, 20),
        end_date=date(2027, 8, 19),
        is_active=True,
    )
    slot_id = str(uuid4())
    target_slot = ClassScheduleSlot(
        id=slot_id,
        class_id=target_class.id,
        weekday="Thứ 2",
        local_start=time(18, 0),
        local_end=time(19, 30),
        effective_from=date(2026, 8, 20),
    )
    db = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                IterableScalarResult([target_slot]),
                IterableScalarResult([], [("6C1", "Thứ 2", time(19, 0), time(20, 0))]),
            ]
        )
    )

    with pytest.raises(HTTPException, match="trùng lịch với lớp 6C1"):
        await _ensure_student_schedule_available(
            db,
            student_id=str(uuid4()),
            class_=target_class,
            selected_slot_ids=[slot_id],
            enrollment_id=None,
            effective_from=target_class.start_date,
        )

    conflict_query = db.execute.await_args_list[1].args[0]
    compiled = str(
        conflict_query.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": False},
        )
    )
    assert "FROM enrollments JOIN classes" in compiled
    assert ", enrollments" not in compiled


@pytest.mark.asyncio
async def test_known_new_class_skips_repeated_membership_guards() -> None:
    class_ = Class(
        id=str(uuid4()),
        name="6C1 kế tiếp",
        type="MONTHLY",
        base_fee=Decimal("750000"),
        billing_cycle_months=1,
        identity_scheme="ACADEMIC_YEAR",
        start_date=date(2026, 8, 20),
        end_date=date(2027, 6, 6),
        is_active=True,
    )
    student = Student(id=str(uuid4()), full_name="Nguyễn Minh Tuấn", status="active")
    db = SimpleNamespace(add=Mock(), flush=AsyncMock(), scalar=AsyncMock())
    active_slot_ids = [str(uuid4())]

    with (
        patch(
            "app.services.enrollment_service.ensure_enrollment_allowed",
            new=AsyncMock(),
        ) as enrollment_guard,
        patch(
            "app.services.enrollment_service.create_cycle_zero",
            new=AsyncMock(),
        ) as create_cycle_zero,
        patch(
            "app.services.enrollment_service.ensure_enrollment_cycles",
            new=AsyncMock(return_value=[]),
        ) as ensure_cycles,
        patch(
            "app.services.enrollment_service._create_slot_selections",
            new=AsyncMock(),
        ) as create_selections,
    ):
        enrollment = await enroll_locked_student(
            db,
            student=student,
            class_=class_,
            custom_fee=None,
            enrollment_date=class_.start_date,
            selected_slot_ids=active_slot_ids,
            known_new_class=True,
            known_active_slot_ids=active_slot_ids,
        )

    db.scalar.assert_not_awaited()
    enrollment_guard.assert_not_awaited()
    create_cycle_zero.assert_awaited_once_with(db, enrollment, assume_new=True)
    assert ensure_cycles.await_args.kwargs["known_max_cycle"] == 0
    assert (
        create_selections.await_args.kwargs["known_active_slot_ids"] == active_slot_ids
    )


@pytest.mark.asyncio
async def test_explicit_empty_slot_selection_is_rejected_instead_of_falling_back_to_all() -> (
    None
):
    class_ = Class(
        id=str(uuid4()),
        name="6C1",
        type="MONTHLY",
        base_fee=Decimal("700000"),
        billing_cycle_months=1,
        start_date=date(2026, 8, 20),
        end_date=date(2027, 6, 6),
        is_active=True,
    )
    enrollment = SimpleNamespace(enrollment_date=class_.start_date)

    with pytest.raises(HTTPException, match="ít nhất một buổi"):
        await _create_slot_selections(
            SimpleNamespace(),
            enrollment,
            class_,
            [],
            known_active_slot_ids=[str(uuid4()), str(uuid4())],
        )


class ScalarResult:
    def __init__(self, values: list[str]) -> None:
        self._values = values

    def scalars(self) -> "ScalarResult":
        return self

    def all(self) -> list[str]:
        return self._values


class AsyncScalarRows:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    def all(self) -> list[object]:
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
async def test_closing_membership_keeps_qr_for_protected_outstanding_debt() -> None:
    enrollment = make_enrollment()
    mutable = SimpleNamespace(id=str(uuid4()), status="UNPAID", voided_at=None)
    notified_debt = SimpleNamespace(id=str(uuid4()), status="UNPAID", voided_at=None)
    db = SimpleNamespace(
        scalars=AsyncMock(return_value=AsyncScalarRows([mutable, notified_debt])),
        flush=AsyncMock(),
    )

    with (
        patch(
            "app.services.fee_reconciliation.is_fee_record_protected",
            side_effect=lambda record: record is notified_debt,
        ),
        patch(
            "app.services.payment_scaffold_service.revoke_open_payment_requests_for_fee_records",
            new=AsyncMock(),
        ) as revoke,
        patch(
            "app.services.fee_operation_service.snapshot_fee_record",
            side_effect=lambda record: SimpleNamespace(id=record.id),
        ),
        patch(
            "app.services.fee_operation_service.append_fee_operation",
            new=AsyncMock(),
        ),
    ):
        await close_enrollment_financial_projection(
            db,
            enrollment,
            actor_user_id=None,
            reason="Học viên rời lớp",
        )

    revoke.assert_awaited_once()
    assert revoke.await_args.args[1] == [mutable.id]
    assert mutable.status == "VOID"
    assert notified_debt.status == "UNPAID"


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
        scalar=AsyncMock(side_effect=[first.student_id, None, None, None]),
        commit=AsyncMock(),
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
            "app.services.enrollment_service.close_enrollment_financial_projection",
            new=AsyncMock(),
        ) as reconcile,
        patch("app.services.enrollment_service._clear_dependent_caches"),
    ):
        response = await drop_enrollment(db, uuid4())

    assert response is not None
    assert enrollment.status == "dropped"
    assert student.status == "active"
    reconcile.assert_awaited_once_with(
        db,
        enrollment,
        actor_user_id=None,
        reason="Học viên rời lớp",
    )
    db.add.assert_not_called()
    db.commit.assert_awaited_once()
