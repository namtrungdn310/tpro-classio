from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest

from app.core.principal import Principal
from app.routers.fees import unnotify_fee_record
from app.schemas.fee import FeeBatchResponse
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
