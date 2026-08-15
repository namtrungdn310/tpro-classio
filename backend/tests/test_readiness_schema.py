from unittest.mock import AsyncMock, MagicMock

import pytest

from app.main import _REQUIRED_SCHEMA_RELATIONS, missing_required_schema_relations


@pytest.mark.asyncio
async def test_schema_readiness_returns_missing_relations_in_database_order() -> None:
    result = MagicMock()
    result.scalars.return_value.all.return_value = [
        "payment_requests",
        "staff_payroll_settlement_reversals",
    ]
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)

    missing = await missing_required_schema_relations(session)

    assert missing == [
        "payment_requests",
        "staff_payroll_settlement_reversals",
    ]
    statement = str(session.execute.await_args.args[0])
    assert "to_regclass" in statement
    assert "required_relations" in statement
    assert session.execute.await_args.args[1] == {
        "required_relations": list(_REQUIRED_SCHEMA_RELATIONS)
    }


@pytest.mark.asyncio
async def test_schema_readiness_accepts_complete_schema() -> None:
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)

    assert await missing_required_schema_relations(session) == []
