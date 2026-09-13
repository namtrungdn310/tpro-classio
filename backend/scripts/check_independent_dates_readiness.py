"""Read-only rollout preflight. Does not repair data or enable the feature.

Run with the intended environment's DATABASE_URL and an authorised runtime role.
Output contains counts only; no credentials, names, phones or financial amounts.
"""

import asyncio
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402
from app.core.database import engine  # noqa: E402
from app.main import (  # noqa: E402
    missing_required_schema_columns,
    missing_required_schema_features,
    missing_required_schema_functions,
    missing_required_schema_relations,
)


async def main(*, before_127: bool = False) -> int:
    async with engine.connect() as connection:
        async with connection.begin():
            await connection.execute(text("SET TRANSACTION READ ONLY"))
            await connection.execute(text("SET LOCAL statement_timeout = '15s'"))
            missing = []
            for check in (
                missing_required_schema_relations,
                missing_required_schema_features,
                missing_required_schema_functions,
                missing_required_schema_columns,
            ):
                missing.extend(await check(connection))
            expected_expansion = {"billing_anchor_revisions:scheduled_segments", "billing_anchor_revisions:waived_intervals"}
            allowed_missing = sorted(set(missing) & expected_expansion) if before_127 else []
            missing = [name for name in missing if name not in allowed_missing]
            if missing:
                print(json.dumps({"ready": False, "missing_schema": missing}))
                return 1
            counts = (
                (
                    await connection.execute(
                        text("""
                SELECT
                  (SELECT count(*) FROM enrollments e JOIN classes c ON c.id = e.class_id
                    WHERE e.status <> 'cancelled' AND e.enrollment_date < c.start_date) AS invalid_admission_boundaries,
                  (SELECT count(*) FROM enrollments e WHERE e.status = 'active' AND NOT EXISTS (
                    SELECT 1 FROM billing_anchor_revisions r WHERE r.id = e.current_billing_revision_id
                      AND r.enrollment_id = e.id AND r.workspace_id = e.workspace_id
                  )) AS missing_billing_baselines,
                  (SELECT count(*) FROM fee_records WHERE status NOT IN ('VOID', 'SUPERSEDED')
                    AND (coverage_start IS NULL OR coverage_end IS NULL)) AS unknown_fee_coverage,
                  (SELECT count(*) FROM start_date_change_commands WHERE state = 'PENDING') AS pending_commands,
                  (SELECT count(*) FROM payment_requests p WHERE p.status = 'OPEN' AND (
                    EXISTS (SELECT 1 FROM fee_records f WHERE f.id = p.fee_record_id AND f.status IN ('VOID', 'SUPERSEDED'))
                    OR EXISTS (SELECT 1 FROM payment_request_items i JOIN fee_records f ON f.id = i.fee_record_id
                      WHERE i.payment_request_id = p.id AND f.status IN ('VOID', 'SUPERSEDED'))
                  )) AS stale_open_payment_requests,
                  (SELECT count(*) FROM enrollment_service_credit_events e WHERE e.credit_days < (
                    SELECT coalesce(sum(a.allocated_days), 0) FROM service_credit_allocations a WHERE a.credit_event_id = e.id
                  )) AS overallocated_credit_events,
                  (SELECT count(*) FROM service_credit_allocations a
                    JOIN enrollment_service_credit_events e ON e.id = a.credit_event_id
                    JOIN fee_records f ON f.id = a.fee_record_id
                    WHERE e.enrollment_id <> f.enrollment_id) AS credit_target_mismatches
            """)
                    )
                )
                .mappings()
                .one()
            )
            result = dict(counts)
            if before_127:
                result["pending_migration_columns"] = allowed_missing
            result["ready"] = not any(counts.values())
            bypasses_rls = bool(await connection.scalar(text(
                "SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user"
            )))
            result["role_bypasses_rls"] = bypasses_rls
            result["scope"] = (
                "all rows (database role bypasses RLS)" if bypasses_rls else
                "rows visible to database role; verify all workspaces before global activation"
            )
            print(json.dumps(result))
            return 0 if result["ready"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--before-127", action="store_true", help="Allow only migration 127 columns to be absent; still check all data invariants")
    args = parser.parse_args()
    try:
        raise SystemExit(asyncio.run(main(before_127=args.before_127)))
    except Exception as exc:
        # Never print connection strings or SQL parameters from exception text.
        print(json.dumps({"ready": False, "error_type": type(exc).__name__}))
        raise SystemExit(1) from None
