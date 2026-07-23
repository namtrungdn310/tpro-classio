from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest

from app.services.google_identity_service import (
    link_google_identity,
    refresh_google_avatar,
)


class _EmptyScalarResult:
    def scalar_one_or_none(self):
        return None


@pytest.mark.asyncio
async def test_google_identity_without_picture_uses_initials_fallback() -> None:
    db = AsyncMock()
    db.add = Mock()
    db.execute.side_effect = [_EmptyScalarResult(), _EmptyScalarResult(), Mock()]
    user_id = str(uuid4())

    with (
        patch(
            "app.services.google_identity_service.encrypt_credential",
            return_value="encrypted-provider-refresh",
        ),
        patch(
            "app.services.google_identity_service.fetch_and_store_avatar",
            new_callable=AsyncMock,
        ) as fetch_avatar,
    ):
        identity = await link_google_identity(
            db,
            user_id=user_id,
            verified_email="member@example.com",
            claims={
                "sub": "google-subject",
                "email": "member@example.com",
            },
            provider_refresh_token="provider-refresh-secret",
        )

    fetch_avatar.assert_not_awaited()
    assert identity.user_id == user_id
    assert identity.google_sub == "google-subject"
    assert identity.avatar_object_path is None
    assert identity.avatar_source_url is None
    db.add.assert_called_once_with(identity)
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(identity)


def test_google_identity_avatar_path_is_nullable_in_migration() -> None:
    source = (
        (
            Path(__file__).parents[1]
            / "supabase"
            / "migrations"
            / "035_enforce_google_totp_onboarding.sql"
        )
        .read_text(encoding="utf-8")
        .lower()
    )

    assert "avatar_object_path text" in source
    assert "alter column avatar_object_path drop not null" in source


class _AvatarResponse:
    def __init__(self, payload: dict):
        self.status_code = 200
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _AvatarClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, *args, **kwargs):
        return _AvatarResponse({"access_token": "provider-access"})

    async def get(self, *args, **kwargs):
        return _AvatarResponse(
            {
                "sub": "google-subject",
                "email": "member@example.com",
                "email_verified": True,
            }
        )


@pytest.mark.asyncio
async def test_avatar_refresh_clears_stale_avatar_when_google_picture_is_removed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = AsyncMock()
    lock_result = Mock()
    lock_result.scalar_one.return_value = True
    db.execute.side_effect = [lock_result, Mock()]
    identity = SimpleNamespace(
        user_id=str(uuid4()),
        google_sub="google-subject",
        google_email="member@example.com",
        provider_refresh_token_ciphertext="encrypted-refresh",
        avatar_object_path="users/member/avatar.webp",
        avatar_source_url="https://lh3.googleusercontent.com/avatar",
        avatar_synced_at=datetime.now(timezone.utc),
    )
    cleanup = AsyncMock()
    monkeypatch.setattr(
        "app.services.google_identity_service.decrypt_credential",
        lambda *args, **kwargs: "provider-refresh",
    )
    monkeypatch.setattr(
        "app.services.google_identity_service.httpx.AsyncClient",
        lambda *args, **kwargs: _AvatarClient(),
    )
    monkeypatch.setattr(
        "app.services.google_identity_service._delete_private_avatar_object",
        cleanup,
    )

    refreshed = await refresh_google_avatar(db, identity)

    assert refreshed is True
    assert identity.avatar_object_path is None
    assert identity.avatar_source_url is None
    profile_update = " ".join(
        str(db.execute.await_args_list[1].args[0]).split()
    ).lower()
    assert "avatar_url = null" in profile_update
    db.commit.assert_awaited_once()
    cleanup.assert_awaited_once_with("users/member/avatar.webp")
