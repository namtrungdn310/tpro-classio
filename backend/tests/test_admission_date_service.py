from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.start_date_change_command import (
    StartDateChangeCommandItem,
    StartDateChangeCommandRecord,
)
from app.services.admission_date_service import (
    change_admission_date,
    validate_admission_date_change,
)


def membership():
    return SimpleNamespace(
        id=str(uuid4()),
        workspace_id=str(uuid4()),
        student_id=str(uuid4()),
        class_id=str(uuid4()),
        enrollment_date=date(2026, 9, 1),
        admission_version=0,
        status="active",
        ended_on=None,
        current_billing_revision_id=str(uuid4()),
        billing_anchor_version=3,
        custom_fee=900_000,
    )


def session(enrollment):
    db = SimpleNamespace(
        add=Mock(),
        flush=AsyncMock(),
        scalar=AsyncMock(return_value=None),
        execute=AsyncMock(),
    )
    db.get = AsyncMock(
        return_value=SimpleNamespace(
            id=enrollment.current_billing_revision_id, enrollment_id=enrollment.id
        )
    )
    return db


async def test_admission_change_keeps_financial_pointer_version_and_fee():
    enr = membership()
    before = (
        enr.current_billing_revision_id,
        enr.billing_anchor_version,
        enr.custom_fee,
    )
    db = session(enr)
    await change_admission_date(
        db,
        enr,
        next_date=date(2025, 8, 1),
        expected_version=0,
        request_id=uuid4(),
        reason="Sửa ngày ghi danh",
        actor_user_id=None,
    )
    assert enr.enrollment_date == date(2025, 8, 1)
    assert enr.admission_version == 1
    assert (
        enr.current_billing_revision_id,
        enr.billing_anchor_version,
        enr.custom_fee,
    ) == before
    created = [call.args[0] for call in db.add.call_args_list]
    assert [type(row) for row in created] == [
        StartDateChangeCommandRecord,
        StartDateChangeCommandItem,
    ]
    assert created[1].decision_code == "ACADEMIC_ONLY"
    assert created[1].first_anchor_cycle_no is None
    assert (
        created[1].previous_billing_revision_id == created[1].next_billing_revision_id
    )


async def test_missing_baseline_is_not_recreated_from_new_admission():
    enr = membership()
    db = session(enr)
    db.get.return_value = None
    with pytest.raises(HTTPException) as exc:
        await change_admission_date(
            db,
            enr,
            next_date=date(2025, 8, 1),
            expected_version=0,
            request_id=uuid4(),
            reason="Sửa ngày ghi danh",
            actor_user_id=None,
        )
    assert exc.value.detail["code"] == "BILLING_BASELINE_REQUIRED"
    db.add.assert_not_called()
    assert enr.enrollment_date == date(2026, 9, 1)


async def test_move_past_billed_period_requires_review_without_mutation():
    enr = membership()
    db = session(enr)
    db.scalar.return_value = "fee-id"
    with pytest.raises(HTTPException) as exc:
        await validate_admission_date_change(
            db, enr, next_date=date(2026, 11, 1), expected_version=0
        )
    assert exc.value.detail["fee_record_id"] == "fee-id"
    db.add.assert_not_called()


@pytest.mark.parametrize("version", [None, 1])
async def test_admission_concurrency_is_independent_from_billing_version(version):
    enr = membership()
    db = session(enr)
    with pytest.raises(HTTPException) as exc:
        await validate_admission_date_change(
            db, enr, next_date=date(2025, 8, 1), expected_version=version
        )
    assert exc.value.detail["code"] == "ADMISSION_CHANGED"
    db.get.assert_not_awaited()


async def test_same_date_has_no_audit_or_financial_effect():
    enr = membership()
    db = session(enr)
    await change_admission_date(
        db,
        enr,
        next_date=enr.enrollment_date,
        expected_version=0,
        request_id=uuid4(),
        reason="Giữ ngày ghi danh",
        actor_user_id=None,
    )
    db.add.assert_not_called()
    db.get.assert_not_awaited()


async def test_reused_request_with_different_payload_is_rejected():
    enr = membership()
    db = session(enr)
    db.scalar.return_value = SimpleNamespace(
        payload_hash="old", state="COMPLETED", operation_kind="ADMISSION_DATE_CHANGE"
    )
    with pytest.raises(HTTPException) as exc:
        await change_admission_date(
            db,
            enr,
            next_date=date(2025, 8, 1),
            expected_version=0,
            request_id=uuid4(),
            reason="Sửa ngày ghi danh",
            actor_user_id=None,
        )
    assert exc.value.detail["code"] == "IDEMPOTENCY_PAYLOAD_MISMATCH"
    db.add.assert_not_called()


async def test_class_parent_owns_atomic_completion_and_actual_item_count():
    enr = membership()
    db = session(enr)
    parent = StartDateChangeCommandRecord(id=str(uuid4()), state="PENDING")
    await change_admission_date(
        db,
        enr,
        next_date=date(2026, 9, 5),
        expected_version=0,
        request_id=uuid4(),
        reason="Dời ngày mở lớp",
        actor_user_id=None,
        parent_command=parent,
    )
    assert parent.state == "PENDING"
    rows = [call.args[0] for call in db.add.call_args_list]
    assert len(rows) == 1
    assert rows[0].command_id == parent.id
