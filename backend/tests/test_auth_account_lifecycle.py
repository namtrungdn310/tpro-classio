from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.routers.auth.common import get_or_create_profile
from app.routers.auth.users import list_users, update_user_role, update_user_status
from app.schemas.auth import UpdateUserRoleRequest, UpdateUserStatusRequest


class ScalarResult:
    def __init__(self, value: object) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object:
        return self._value


class ScalarRowsResult:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    class _Scalars:
        def __init__(self, values: list[object]) -> None:
            self._values = values

        def all(self) -> list[object]:
            return self._values

    def scalars(self) -> _Scalars:
        return self._Scalars(self._values)


def _profile(
    user_id: str,
    *,
    role: str = "viewer",
    account_status: str = "active",
    is_owner: bool = False,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=user_id,
        role=role,
        username="Member",
        full_name="Member",
        account_status=account_status,
        is_owner=is_owner,
        created_at=datetime.now(timezone.utc),
        approved_at=None,
        approved_by=None,
        disabled_at=None,
        disabled_by=None,
        onboarding_completed_at=datetime.now(timezone.utc),
    )


def _executed_statements(db: AsyncMock) -> list[str]:
    return [str(call.args[0]) for call in db.execute.await_args_list]


@pytest.mark.asyncio
async def test_role_change_revokes_sessions_and_writes_security_event() -> None:
    target_id = str(uuid4())
    actor_id = str(uuid4())
    profile = _profile(target_id)
    db = AsyncMock()
    db.execute.side_effect = [ScalarResult(profile), None]
    event = AsyncMock()

    with (
        patch("app.routers.auth.users.record_account_security_event", event),
        patch(
            "app.routers.auth.users.get_active_auth_user",
            new=AsyncMock(return_value=SimpleNamespace(email="member@example.com")),
        ),
    ):
        response = await update_user_role(
            user_id=target_id,
            payload=UpdateUserRoleRequest(role="admin"),
            db=db,
            current_user={"id": actor_id, "is_owner": True},
        )

    assert response.role == "admin"
    assert any(
        "DELETE FROM user_device_sessions" in statement
        for statement in _executed_statements(db)
    )
    event.assert_awaited_once_with(
        db,
        actor_user_id=actor_id,
        target_user_id=target_id,
        action="role_changed",
        previous_role="viewer",
        next_role="admin",
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_disabling_account_revokes_sessions_and_is_audited() -> None:
    target_id = str(uuid4())
    actor_id = str(uuid4())
    profile = _profile(target_id)
    db = AsyncMock()
    db.execute.side_effect = [ScalarResult(profile), None]
    event = AsyncMock()

    with (
        patch("app.routers.auth.users.record_account_security_event", event),
        patch(
            "app.routers.auth.users.get_active_auth_user",
            new=AsyncMock(return_value=SimpleNamespace(email="member@example.com")),
        ),
    ):
        response = await update_user_status(
            user_id=target_id,
            payload=UpdateUserStatusRequest(status="disabled"),
            db=db,
            current_user={"id": actor_id, "is_owner": True},
        )

    assert response.account_status == "disabled"
    assert any(
        "DELETE FROM user_device_sessions" in statement
        for statement in _executed_statements(db)
    )
    assert event.await_args.kwargs["action"] == "account_disabled"
    assert event.await_args.kwargs["previous_status"] == "active"
    assert event.await_args.kwargs["next_status"] == "disabled"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_user_access_list_excludes_deleted_supabase_accounts() -> None:
    deleted_user_id = str(uuid4())
    db = AsyncMock()
    db.execute.return_value = ScalarRowsResult([_profile(deleted_user_id)])

    active_users = AsyncMock(return_value={})
    with patch("app.routers.auth.users.list_active_auth_users", active_users):
        response = await list_users(db=db, current_user={"is_owner": True})

    assert response == []
    active_users.assert_awaited_once_with()


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["role", "status"])
async def test_owner_account_cannot_be_demoted_or_disabled(operation: str) -> None:
    target_id = str(uuid4())
    db = AsyncMock()
    db.execute.side_effect = [ScalarResult(_profile(target_id, role="admin", is_owner=True))]

    with (
        patch("app.routers.auth.users.is_owner_email", return_value=True),
        patch(
            "app.routers.auth.users.get_active_auth_user",
            new=AsyncMock(return_value=SimpleNamespace(email="owner@example.com")),
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            if operation == "role":
                await update_user_role(
                    user_id=target_id,
                    payload=UpdateUserRoleRequest(role="viewer"),
                    db=db,
                    current_user={"id": str(uuid4()), "is_owner": True},
                )
            else:
                await update_user_status(
                    user_id=target_id,
                    payload=UpdateUserStatusRequest(status="disabled"),
                    db=db,
                    current_user={"id": str(uuid4()), "is_owner": True},
                )

    assert exc_info.value.status_code == 403
    assert db.execute.await_count == 1
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_unchanged_role_does_not_revoke_or_write_audit_event() -> None:
    target_id = str(uuid4())
    db = AsyncMock()
    db.execute.side_effect = [ScalarResult(_profile(target_id, role="viewer"))]
    event = AsyncMock()

    with (
        patch("app.routers.auth.users.record_account_security_event", event),
        patch(
            "app.routers.auth.users.get_active_auth_user",
            new=AsyncMock(return_value=SimpleNamespace(email="member@example.com")),
        ),
    ):
        response = await update_user_role(
            user_id=target_id,
            payload=UpdateUserRoleRequest(role="viewer"),
            db=db,
            current_user={"id": str(uuid4()), "is_owner": True},
        )

    assert response.role == "viewer"
    assert not any(
        "DELETE FROM user_device_sessions" in statement
        for statement in _executed_statements(db)
    )
    event.assert_not_awaited()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_concurrent_profile_creation_reuses_the_winning_profile() -> None:
    user_id = str(uuid4())
    winning_profile = _profile(user_id, account_status="pending")
    db = AsyncMock()
    db.add = Mock()
    db.execute.side_effect = [ScalarResult(None), ScalarResult(winning_profile)]
    db.commit.side_effect = IntegrityError("insert profile", {}, Exception("race"))

    with patch(
        "app.routers.auth.common.ensure_unique_username",
        new=AsyncMock(return_value="ConcurrentUser"),
    ):
        result = await get_or_create_profile(
            db,
            user_id,
            "member@example.com",
            "ConcurrentUser",
        )

    assert result is winning_profile
    db.rollback.assert_awaited_once()


def test_account_lifecycle_migration_backfill_is_fail_closed_for_legacy_viewers() -> (
    None
):
    migration = (
        Path(__file__).parents[1]
        / "supabase"
        / "migrations"
        / "033_account_access_lifecycle.sql"
    ).read_text(encoding="utf-8")

    assert "when role = 'admin' then 'active'" in migration
    assert "else 'pending'" in migration
