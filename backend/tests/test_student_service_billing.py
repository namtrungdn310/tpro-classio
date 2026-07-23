from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest

from app.models.class_ import Class
from app.schemas.student import StudentCreate
from app.services.student_service import create_student


@pytest.mark.asyncio
async def test_create_student_reconciles_initial_enrollment_fee() -> None:
    class_id = uuid4()
    class_ = Class(
        id=str(class_id),
        name="6C1",
        type="MONTHLY",
        base_fee=Decimal("750000"),
        billing_cycle_months=1,
        is_active=True,
    )
    db = SimpleNamespace(
        scalar=AsyncMock(return_value=class_),
        add=Mock(),
        flush=AsyncMock(),
        commit=AsyncMock(),
    )

    async def assign_generated_id() -> None:
        created = db.add.call_args.args[0]
        if created.id is None:
            created.id = str(uuid4())

    db.flush.side_effect = assign_generated_id
    response = SimpleNamespace(id=uuid4())

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
        patch("app.services.student_service._clear_dependent_caches"),
    ):
        created = await create_student(
            db,
            StudentCreate(
                full_name="Nguyễn Minh An",
                class_id=class_id,
                enrollment_date=date(2026, 6, 5),
                birth_date=date(2014, 6, 5),
                school="THCS Chu Văn An",
                parent_zalo="Mẹ An",
                parent_phone="0912345678",
            ),
        )

    assert created is response
    enrollment = reconcile.await_args.args[1]
    assert enrollment.class_ is class_
    assert enrollment.enrollment_date == date(2026, 6, 5)
    db.commit.assert_awaited_once()
