import os

import pytest

from app.core.database import AsyncSessionLocal
from app.main import missing_required_schema_relations

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires the latest migrated disposable PostgreSQL database",
    ),
]


@pytest.mark.asyncio
async def test_latest_migrated_schema_satisfies_readiness_contract() -> None:
    async with AsyncSessionLocal() as db:
        assert await missing_required_schema_relations(db) == []
