from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.core.password_reset import (
    claim_password_reset_handle,
    create_password_reset_handle,
)


class FirstResult:
    def __init__(self, mapping: dict[str, str]) -> None:
        self._row = SimpleNamespace(_mapping=mapping)

    def first(self) -> SimpleNamespace:
        return self._row


@pytest.fixture(autouse=True)
def _test_auth_encryption_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.core.auth_credentials.settings.auth_encryption_key",
        "test-only-auth-encryption-key-with-more-than-32-chars",
    )


@pytest.mark.asyncio
async def test_reset_handle_is_hashed_and_access_token_is_encrypted() -> None:
    db = AsyncMock()

    handle = await create_password_reset_handle(
        db,
        user_id=str(uuid4()),
        email="user@example.com",
        supabase_access_token="supabase-access-token",
        expires_in_minutes=10,
    )

    insert_params = db.execute.await_args_list[1].args[1]
    assert insert_params["token_hash"] != handle
    assert "supabase-access-token" not in insert_params["ciphertext"]
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_reset_handle_can_only_be_claimed_through_hashed_lookup() -> None:
    create_db = AsyncMock()
    handle = await create_password_reset_handle(
        create_db,
        user_id=str(uuid4()),
        email="user@example.com",
        supabase_access_token="supabase-access-token",
        expires_in_minutes=10,
    )
    insert_params = create_db.execute.await_args_list[1].args[1]
    claim_db = AsyncMock()
    claim_db.execute.return_value = FirstResult(
        {
            "user_id": str(uuid4()),
            "email": "user@example.com",
            "access_token_ciphertext": insert_params["ciphertext"],
        }
    )

    _, email, access_token = await claim_password_reset_handle(claim_db, handle)

    claim_params = claim_db.execute.await_args.args[1]
    assert claim_params["token_hash"] == insert_params["token_hash"]
    assert email == "user@example.com"
    assert access_token == "supabase-access-token"
