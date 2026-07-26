import os
from dataclasses import dataclass
from uuid import UUID

import asyncpg
import pytest

from app.core.database import engine


@dataclass(frozen=True)
class AuthUserAdmin:
    """Owner-only fixture setup; the application role never receives auth grants."""

    dsn: str

    async def create(self, user_id: str, email: str) -> None:
        connection = await asyncpg.connect(self.dsn)
        try:
            await connection.execute(
                "insert into auth.users (id, email) values ($1, $2)",
                UUID(user_id),
                email,
            )
        finally:
            await connection.close()

    async def delete(self, user_id: str) -> None:
        connection = await asyncpg.connect(self.dsn)
        try:
            await connection.execute(
                "delete from auth.users where id = $1",
                UUID(user_id),
            )
        finally:
            await connection.close()


@pytest.fixture
def auth_user_admin() -> AuthUserAdmin:
    dsn = os.getenv("DB_TEST_ADMIN_DSN")
    if not dsn:
        pytest.fail("DB_TEST_ADMIN_DSN is required for owner-only integration fixtures")
    return AuthUserAdmin(dsn)


@pytest.fixture(autouse=True)
async def dispose_database_pool_in_owning_loop():
    """Keep pooled asyncpg connections inside one pytest event loop.

    pytest-asyncio intentionally creates a loop per test. Disposing during the
    fixture teardown closes the pool while that test's loop is still alive,
    instead of asking the next test to clean up connections owned by a closed
    loop.
    """
    try:
        yield
    finally:
        await engine.dispose()
