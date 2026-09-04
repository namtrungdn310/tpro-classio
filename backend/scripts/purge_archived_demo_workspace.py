"""Permanently remove one archived non-production demo workspace.

The command is intentionally narrow: the target must be ownerless, named as an
archive, differ from the current owner's workspace, and be confirmed explicitly.
It removes workspace-scoped public rows in one transaction. Auth identities are
not deleted because they are managed independently by Supabase Auth.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sys
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from scripts.prepare_clean_demo_workspace import owner_database_url  # noqa: E402


CONFIRMATION = "DELETE_ARCHIVED_TEST_WORKSPACE"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-id", type=UUID, required=True)
    parser.add_argument("--current-workspace-id", type=UUID, required=True)
    parser.add_argument("--confirm", required=True)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


async def main(args: argparse.Namespace) -> None:
    if settings.app_environment == "production":
        raise SystemExit("Refusing to purge a production workspace")
    if args.confirm != CONFIRMATION:
        raise SystemExit(f"--confirm must equal {CONFIRMATION}")
    if args.workspace_id == args.current_workspace_id:
        raise SystemExit("Refusing to purge the current workspace")

    engine = create_async_engine(owner_database_url(), pool_pre_ping=True)
    try:
        async with engine.begin() as connection:
            target = (
                await connection.execute(
                    text(
                        "select name, owner_user_id from public.workspaces "
                        "where id=:workspace_id for update"
                    ),
                    {"workspace_id": str(args.workspace_id)},
                )
            ).one_or_none()
            if target is None:
                raise SystemExit("Archived workspace does not exist")
            if target.owner_user_id is not None:
                raise SystemExit("Refusing to purge a workspace that still has an owner")
            if "lưu trữ" not in target.name.casefold():
                raise SystemExit("Refusing to purge a workspace not marked as archived")

            current_exists = await connection.scalar(
                text("select 1 from public.workspaces where id=:workspace_id"),
                {"workspace_id": str(args.current_workspace_id)},
            )
            if current_exists is None:
                raise SystemExit("Current workspace guard does not exist")

            tables = (
                await connection.execute(
                    text(
                        "select c.relname from pg_class c "
                        "join pg_namespace n on n.oid=c.relnamespace "
                        "join pg_attribute a on a.attrelid=c.oid "
                        "where n.nspname='public' and c.relkind in ('r','p') "
                        "and a.attname='workspace_id' and not a.attisdropped "
                        "and c.relname <> 'workspaces' order by c.relname"
                    )
                )
            ).scalars().all()

            await connection.execute(text("set local session_replication_role = replica"))
            removed: dict[str, int] = {}
            for table_name in tables:
                quoted = table_name.replace('"', '""')
                result = await connection.execute(
                    text(f'delete from public."{quoted}" where workspace_id=:workspace_id'),
                    {"workspace_id": str(args.workspace_id)},
                )
                if result.rowcount:
                    removed[table_name] = result.rowcount
            workspace_result = await connection.execute(
                text("delete from public.workspaces where id=:workspace_id"),
                {"workspace_id": str(args.workspace_id)},
            )
            await connection.execute(text("set local session_replication_role = origin"))
            if workspace_result.rowcount != 1:
                raise SystemExit("Workspace deletion did not affect exactly one row")

            total = sum(removed.values())
            print(f"PURGE target={args.workspace_id} tables={len(removed)} rows={total}")
            for table_name, count in removed.items():
                print(f"  {table_name}: {count}")
            if args.dry_run:
                await connection.rollback()
                print("DRY RUN: rolled back")
            else:
                print("PURGE COMMITTED")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main(parse_args()))
