"""Read-only, counts-only inventory. Never confirms or repairs user schedules."""
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import text
from app.core.database import engine


async def main():
    async with engine.connect() as connection:
        async with connection.begin():
            await connection.execute(text("SET TRANSACTION READ ONLY"))
            await connection.execute(text("SET LOCAL statement_timeout = '15s'"))
            groups = await connection.execute(text("""
                SELECT r.change_kind, (r.id = e.current_billing_revision_id) AS is_current,
                       count(*) AS count
                FROM billing_anchor_revisions r
                JOIN enrollments e ON e.id = r.enrollment_id AND e.workspace_id = r.workspace_id
                WHERE r.state = 'PENDING'
                GROUP BY r.change_kind, (r.id = e.current_billing_revision_id)
                ORDER BY r.change_kind, is_current
            """))
            inconsistent = await connection.scalar(text("""
                SELECT count(*) FROM fee_records f
                LEFT JOIN billing_anchor_revisions r ON r.id = f.billing_revision_id AND r.workspace_id = f.workspace_id
                WHERE f.review_required AND (r.id IS NULL OR r.state <> 'PENDING' OR f.status IN ('VOID', 'SUPERSEDED'))
            """))
            print(json.dumps({"scope": "rows visible to database role", "pending_by_source": [dict(row) for row in groups.mappings()], "inconsistent_review_flags": inconsistent}))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(json.dumps({"error_type": type(exc).__name__}))
        raise SystemExit(1) from None
