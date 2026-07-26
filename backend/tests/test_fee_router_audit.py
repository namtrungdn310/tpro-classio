from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest

from app.routers.fees import unnotify_fee_record
from app.schemas.fee import FeeBatchResponse


@pytest.mark.asyncio
async def test_single_unnotify_records_the_authenticated_actor() -> None:
    record_id = uuid4()
    actor_id = str(uuid4())
    expected = FeeBatchResponse(records=[], deleted_ids=[])
    db = AsyncMock()

    with patch(
        "app.routers.fees.mark_fees_unnotified",
        new=AsyncMock(return_value=expected),
    ) as mark_unnotified:
        response = await unnotify_fee_record(
            record_id,
            db=db,
            current_user={"id": actor_id},
        )

    assert response == expected
    mark_unnotified.assert_awaited_once_with(
        db,
        [record_id],
        actor_id=actor_id,
    )
