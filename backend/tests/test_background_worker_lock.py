"""Advisory-lock background workers: multiple uvicorn processes must never
process the same batch twice, and a locked cycle is skipped, not queued."""

from types import SimpleNamespace

import pytest

from app.core.database import release_advisory_lock, try_advisory_lock
from app.main import _try_run_worker


class _Session:
    def __init__(self, scripted_scalar):
        self._scripted_scalar = scripted_scalar
        self.executed: list[str] = []

    async def execute(self, statement, params=None):
        self.executed.append((str(statement), params))
        return SimpleNamespace(scalar=lambda: self._scripted_scalar)


async def _acquire(db, key):
    return True


async def _not_acquire(db, key):
    return False


@pytest.mark.asyncio
async def test_try_advisory_lock_calls_non_blocking_lock_with_key() -> None:
    session = _Session(True)
    assert await try_advisory_lock(session, 9081011) is True
    statement, params = session.executed[0]
    assert "pg_try_advisory_lock" in statement
    assert params == {"lock_key": 9081011}


@pytest.mark.asyncio
async def test_try_advisory_lock_returns_false_when_held() -> None:
    session = _Session(False)
    assert await try_advisory_lock(session, 9081011) is False


@pytest.mark.asyncio
async def test_release_advisory_lock_unlocks_with_key() -> None:
    session = _Session(True)
    await release_advisory_lock(session, 9081011)
    statement, params = session.executed[0]
    assert "pg_advisory_unlock" in statement
    assert params == {"lock_key": 9081011}


class _FakeLocal:
    def __init__(self, session: _Session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_worker_runs_task_and_releases_when_lock_acquired(
    monkeypatch, caplog
) -> None:
    session = _Session(True)
    calls: list[str] = []
    released: list[int] = []

    async def fake_task(db):
        calls.append("ran")
        return 3

    monkeypatch.setattr("app.main.AsyncSessionLocal", lambda: _FakeLocal(session))
    monkeypatch.setattr("app.main.try_advisory_lock", _acquire)

    async def fake_release(db, key):
        released.append(key)

    monkeypatch.setattr("app.main.release_advisory_lock", fake_release)

    with caplog.at_level("INFO", logger="tpro_classio"):
        await _try_run_worker(9081011, fake_task, label="test-worker")

    assert calls == ["ran"]
    assert released == [9081011]
    assert any("test-worker: 3 item(s)" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_worker_skips_task_when_lock_held(monkeypatch) -> None:
    session = _Session(False)
    calls: list[str] = []
    released: list[int] = []

    async def fake_task(db):
        calls.append("ran")

    monkeypatch.setattr("app.main.AsyncSessionLocal", lambda: _FakeLocal(session))
    monkeypatch.setattr("app.main.try_advisory_lock", _not_acquire)

    async def fake_release(db, key):
        released.append(key)

    monkeypatch.setattr("app.main.release_advisory_lock", fake_release)

    await _try_run_worker(9081011, fake_task, label="test-worker")

    assert calls == []
    assert released == []


@pytest.mark.asyncio
async def test_worker_releases_lock_even_when_task_raises(monkeypatch) -> None:
    session = _Session(True)
    released: list[int] = []

    async def failing_task(db):
        raise RuntimeError("batch failed")

    monkeypatch.setattr("app.main.AsyncSessionLocal", lambda: _FakeLocal(session))
    monkeypatch.setattr("app.main.try_advisory_lock", _acquire)

    async def fake_release(db, key):
        released.append(key)

    monkeypatch.setattr("app.main.release_advisory_lock", fake_release)

    with pytest.raises(RuntimeError, match="batch failed"):
        await _try_run_worker(9081011, failing_task, label="test-worker")

    assert released == [9081011]
