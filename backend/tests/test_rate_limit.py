from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.core.rate_limit import enforce_rate_limit


class ScalarResult:
    def __init__(self, value: int) -> None:
        self._value = value

    def scalar_one(self) -> int:
        return self._value


@pytest.mark.asyncio
async def test_rate_limit_commits_allowed_attempt() -> None:
    db = AsyncMock()
    db.execute.return_value = ScalarResult(2)

    await enforce_rate_limit(
        db,
        scope="login",
        subject="User@Example.com",
        max_attempts=10,
        window_seconds=900,
    )

    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_rate_limit_rejects_attempt_over_limit() -> None:
    db = AsyncMock()
    db.execute.return_value = ScalarResult(11)

    with pytest.raises(HTTPException) as exc_info:
        await enforce_rate_limit(
            db,
            scope="login",
            subject="user@example.com",
            max_attempts=10,
            window_seconds=900,
        )

    assert exc_info.value.status_code == 429
    assert int(exc_info.value.headers["Retry-After"]) > 0
