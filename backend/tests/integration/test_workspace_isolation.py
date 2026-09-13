"""Database-level proof that an administrator workspace cannot cross-read/write."""

import os
from uuid import UUID, uuid4

import asyncpg
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.core.database import AsyncSessionLocal
from app.core.workspace import reset_workspace_id, set_workspace_id
from app.models.staff import StaffMember

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires the disposable database runner",
    ),
]


async def test_runtime_workspace_boundary_blocks_cross_tenant_staff_access() -> None:
    admin_dsn = os.getenv("DB_TEST_ADMIN_DSN")
    if not admin_dsn:
        pytest.fail("DB_TEST_ADMIN_DSN is required")

    admin = await asyncpg.connect(admin_dsn)
    workspace_id: UUID | None = None
    staff_id = uuid4()
    try:
        # The migration owner is intentionally supplied by each disposable
        # scenario (the main CI chain uses the legacy refund actor, while the
        # full disposable chain uses its dedicated owner fixture).  The test
        # only needs a real owner workspace; coupling it to one fixture UUID
        # made the otherwise valid main-chain setup fail before isolation was
        # exercised.
        owner_workspace = await admin.fetchval(
            "select w.id from public.workspaces w "
            "join public.profiles p on p.id = w.owner_user_id "
            "where p.role = 'admin' and p.account_status <> 'disabled' "
            "order by w.created_at, w.id limit 1"
        )
        assert owner_workspace is not None
        workspace_id = await admin.fetchval(
            "insert into public.workspaces (name) values ('Isolation probe') "
            "returning id"
        )
        await admin.execute(
            "select set_config('app.workspace_id', $1, false)", str(workspace_id)
        )
        await admin.execute(
            "insert into public.staff_members "
            "(id, workspace_id, full_name, staff_type, is_active) "
            "values ($1, $2, 'Isolation probe', 'TEACHER', true)",
            staff_id,
            workspace_id,
        )
    finally:
        await admin.close()

    owner_token = set_workspace_id(str(owner_workspace))
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(
                text("select set_config('app.workspace_id', :id, false)"),
                {"id": str(owner_workspace)},
            )
            visible = (
                await db.execute(select(StaffMember).where(StaffMember.id == staff_id))
            ).scalar_one_or_none()
            assert visible is None

            with pytest.raises((ValueError, DBAPIError)):
                await db.execute(
                    text(
                        "insert into public.staff_members "
                        "(id, workspace_id, full_name, staff_type, is_active) "
                        "values (cast(:id as uuid), cast(:workspace_id as uuid), "
                        "'Cross tenant', 'TEACHER', true)"
                    ),
                    {"id": str(uuid4()), "workspace_id": str(workspace_id)},
                )
            await db.rollback()
    finally:
        reset_workspace_id(owner_token)
        cleanup = await asyncpg.connect(admin_dsn)
        try:
            # The production lifecycle trigger intentionally forbids hard
            # deleting staff.  This probe is disposable-only, so use a
            # superuser transaction with replication triggers disabled solely
            # to remove its synthetic rows after assertions complete.
            async with cleanup.transaction():
                await cleanup.execute("set local session_replication_role = replica")
                await cleanup.execute(
                    "delete from public.staff_members where id = $1", staff_id
                )
                await cleanup.execute(
                    "delete from public.workspaces where id = $1", workspace_id
                )
        finally:
            await cleanup.close()
