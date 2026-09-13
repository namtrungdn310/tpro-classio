from unittest.mock import AsyncMock, MagicMock

import pytest

from app.main import (
    _REQUIRED_SCHEMA_COLUMNS,
    _REQUIRED_SCHEMA_FUNCTIONS,
    _REQUIRED_SCHEMA_RELATIONS,
    _REQUIRED_SCHEMA_TRIGGERS,
    _readiness_result,
    missing_required_schema_features,
    missing_required_schema_relations,
)


def test_schema_readiness_requires_contextual_staffing_migration() -> None:
    assert "class_schedule_slot_staff_revisions" in _REQUIRED_SCHEMA_RELATIONS
    assert "class_teachers:class_teachers_validate_staff" in _REQUIRED_SCHEMA_TRIGGERS
    assert (
        "class_schedule_slot_staff:class_schedule_slot_staff_validate_assignment"
        in _REQUIRED_SCHEMA_TRIGGERS
    )
    assert "public.contextual_class_staff_version()" in _REQUIRED_SCHEMA_FUNCTIONS
    assert "class_teachers:role" in _REQUIRED_SCHEMA_COLUMNS
    assert "staff_compensation_rates:assignment_role" in _REQUIRED_SCHEMA_COLUMNS


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


@pytest.mark.asyncio
async def test_schema_readiness_checks_suspension_triggers() -> None:
    result = MagicMock()
    result.scalars.return_value.all.return_value = [
        "enrollments:trg_enrollments_no_open_suspension"
    ]
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)

    missing = await missing_required_schema_features(session)

    assert missing == ["enrollments:trg_enrollments_no_open_suspension"]
    assert session.execute.await_args.args[1] == {
        "required_triggers": list(_REQUIRED_SCHEMA_TRIGGERS)
    }


@pytest.mark.asyncio
async def test_readiness_result_caches_ok_result(monkeypatch) -> None:
    probes = {"count": 0}

    async def fake_probe() -> list[str]:
        probes["count"] += 1
        return []

    monkeypatch.setattr("app.main._readiness_probe", fake_probe)
    monkeypatch.setattr("app.main._READINESS_CACHE_AT", 0.0)
    monkeypatch.setattr("app.main._READINESS_CACHE_OK", None)

    assert await _readiness_result() is True
    assert await _readiness_result() is True
    assert probes["count"] == 1


@pytest.mark.asyncio
async def test_readiness_result_fails_closed_and_caches_failure(monkeypatch) -> None:
    probes = {"count": 0}

    async def fake_probe() -> list[str]:
        probes["count"] += 1
        return ["payment_requests"]

    monkeypatch.setattr("app.main._readiness_probe", fake_probe)
    monkeypatch.setattr("app.main._READINESS_CACHE_AT", 0.0)
    monkeypatch.setattr("app.main._READINESS_CACHE_OK", None)

    assert await _readiness_result() is False
    assert await _readiness_result() is False
    assert probes["count"] == 1


@pytest.mark.asyncio
async def test_readiness_result_reprobes_after_ttl(monkeypatch) -> None:
    probes = {"count": 0}

    async def fake_probe() -> list[str]:
        probes["count"] += 1
        return []

    monkeypatch.setattr("app.main._readiness_probe", fake_probe)
    monkeypatch.setattr("app.main._READINESS_CACHE_AT", 0.0)
    monkeypatch.setattr("app.main._READINESS_CACHE_OK", None)

    assert await _readiness_result() is True
    # Force the cache to expire and verify a fresh probe runs.
    monkeypatch.setattr("app.main._READINESS_CACHE_AT", -10_000.0)
    assert await _readiness_result() is True
    assert probes["count"] == 2
