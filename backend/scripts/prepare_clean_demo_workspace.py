"""Rotate the local/dev owner into one empty, deterministic demo workspace.

The former workspace is detached and marked as archived so the fixture can be
verified before an explicitly guarded purge. The command never runs in
production and requires an explicit confirmation.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import date
from pathlib import Path
import sys
from uuid import UUID, uuid5

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402


NAMESPACE = UUID("e9b1ab1d-e967-4580-85bf-f92b0683f3e0")
CONFIRMATION = "REPLACE_DEMO_WORKSPACE"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of-date", type=date.fromisoformat, required=True)
    parser.add_argument("--current-workspace-id", type=UUID, required=True)
    parser.add_argument("--confirm", required=True)
    return parser.parse_args()


def owner_database_url():
    password = settings.supabase_db_owner_password
    if password is None:
        raise SystemExit("SUPABASE_DB_OWNER_PASSWORD is required")
    runtime = make_url(settings.database_url)
    runtime_user = runtime.username or ""
    project_ref = runtime_user.rsplit(".", 1)[-1]
    return runtime.set(
        username=f"postgres.{project_ref}",
        password=password.get_secret_value(),
    )


async def main(args: argparse.Namespace) -> None:
    if settings.app_environment == "production":
        raise SystemExit("Refusing to rotate a production workspace")
    if args.confirm != CONFIRMATION:
        raise SystemExit(f"--confirm must equal {CONFIRMATION}")
    engine = create_async_engine(owner_database_url(), pool_pre_ping=True)
    try:
        async with engine.begin() as connection:
            owner_id = str(
                await connection.scalar(
                    text(
                        "select owner_user_id from public.workspaces "
                        "where id=:workspace_id"
                    ),
                    {"workspace_id": str(args.current_workspace_id)},
                )
                or ""
            )
            if not owner_id:
                raise SystemExit("Current workspace has no owner")
            workspace_id = str(
                uuid5(
                    NAMESPACE,
                    f"{owner_id}:clean-demo:{args.as_of_date.isoformat()}",
                )
            )
            current = (
                await connection.execute(
                    text(
                        "select id, name from public.workspaces "
                        "where owner_user_id=:owner_id for update"
                    ),
                    {"owner_id": owner_id},
                )
            ).one_or_none()
            if current and str(current.id) == workspace_id:
                print(f"READY workspace={workspace_id} name={current.name}")
                return

            existing = await connection.scalar(
                text("select id from public.workspaces where id=:workspace_id"),
                {"workspace_id": workspace_id},
            )
            if existing is not None:
                raise SystemExit(
                    "Target demo workspace exists but is not owned by the configured owner"
                )

            if current:
                await connection.execute(
                    text(
                        "update public.workspaces set owner_user_id=null, "
                        "name=name || ' · lưu trữ ' || :archive_date "
                        "where id=:workspace_id"
                    ),
                    {
                        "workspace_id": str(current.id),
                        "archive_date": args.as_of_date.isoformat(),
                    },
                )
            await connection.execute(
                text(
                    "insert into public.workspaces (id, owner_user_id, name) "
                    "values (:workspace_id, :owner_id, :name)"
                ),
                {
                    "workspace_id": workspace_id,
                    "owner_id": owner_id,
                    "name": f"TPRO English · Demo {args.as_of_date.year}",
                },
            )
            await connection.execute(
                text("select set_config('app.workspace_id', :workspace_id, true)"),
                {"workspace_id": workspace_id},
            )
            await connection.execute(
                text(
                    "update public.profiles set workspace_id=:workspace_id "
                    "where id=:owner_id"
                ),
                {"workspace_id": workspace_id, "owner_id": owner_id},
            )
        print(f"CREATED workspace={workspace_id}")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main(parse_args()))
