from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest

from app.core.principal import Principal
from app.routers.fees import (
    list_outstanding_fee_records,
    save_fee_message_draft,
    unnotify_fee_record,
)
from app.schemas.fee import (
    FeeMessageDraftResponse,
    FeeMessageDraftSaveRequest,
    FeeBatchResponse,
    FeeRecordListResponse,
)
from app.services.fee_operation_service import FeeOperationActorSnapshot


@pytest.mark.asyncio
async def test_single_unnotify_records_the_authenticated_actor() -> None:
    record_id = uuid4()
    actor_id = str(uuid4())
    expected = FeeBatchResponse(records=[], deleted_ids=[])
    db = AsyncMock()
    principal = Principal(
        user_id=actor_id,
        email="admin@example.com",
        persistent_role="admin",
        effective_role="admin",
        is_owner=False,
        account_status="active",
        staff_id=None,
        aal="aal2",
        device_type="desktop",
        session_nonce="test-nonce",
    )

    with patch(
        "app.routers.fees.mark_fees_unnotified",
        new=AsyncMock(return_value=expected),
    ) as mark_unnotified:
        response = await unnotify_fee_record(
            record_id,
            db=db,
            principal=principal,
        )

    assert response == expected
    mark_unnotified.assert_awaited_once_with(
        db,
        [record_id],
        actor_id=actor_id,
        actor_snapshot=FeeOperationActorSnapshot(
            user_id=actor_id,
            name=None,
            username=None,
            role="admin",
        ),
    )


@pytest.mark.asyncio
async def test_outstanding_route_preserves_cross_period_read_scope() -> None:
    class_id = uuid4()
    db = AsyncMock()
    principal = Principal(
        user_id=str(uuid4()),
        email="admin@example.com",
        persistent_role="admin",
        effective_role="admin",
        is_owner=False,
        account_status="active",
        staff_id=None,
        aal="aal2",
        device_type="desktop",
        session_nonce="test-nonce",
    )
    expected = FeeRecordListResponse(period="outstanding", records=[])

    with patch(
        "app.routers.fees.get_outstanding_fee_records",
        new=AsyncMock(return_value=expected),
    ) as get_outstanding:
        response = await list_outstanding_fee_records(
            class_id=class_id,
            db=db,
            principal=principal,
        )

    assert response == expected
    get_outstanding.assert_awaited_once_with(db, class_id=class_id)


@pytest.mark.asyncio
async def test_message_draft_route_persists_normalized_student_message() -> None:
    record_id = uuid4()
    expected = FeeMessageDraftResponse(
        student_id=uuid4(),
        period="2026-08",
        kind="reminder",
        message="  Xin chào\n\nPhụ huynh  ",
        source_fingerprint="a" * 64,
        revision=2,
        is_customized=True,
    )
    db = AsyncMock()
    principal = Principal(
        user_id=str(uuid4()),
        email="admin@example.com",
        persistent_role="admin",
        effective_role="admin",
        is_owner=False,
        account_status="active",
        staff_id=None,
        aal="aal2",
        device_type="desktop",
        session_nonce="test-nonce",
    )
    payload = FeeMessageDraftSaveRequest(
        record_ids=[record_id],
        kind="reminder",
        message="  Xin chào\n\nPhụ huynh  ",
        expected_revision=1,
        source_fingerprint="a" * 64,
    )

    with patch(
        "app.routers.fees.save_group_fee_message_draft",
        new=AsyncMock(return_value=expected),
    ) as save_drafts:
        response = await save_fee_message_draft(
            payload,
            db=db,
            principal=principal,
        )

    assert response == expected
    save_drafts.assert_awaited_once_with(
        db,
        [record_id],
        kind="reminder",
        message="  Xin chào\n\nPhụ huynh  ",
        expected_revision=1,
        source_fingerprint="a" * 64,
        actor_id=principal.user_id,
    )
