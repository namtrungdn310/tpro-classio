"""Read-only suspension preflight. Does not migrate, repair or print personal data.

Use DATABASE_URL or --dsn for an explicitly selected database. Run on a restored
backup before rollout; legacy ambiguity must be reviewed, never guessed by code.
"""

import argparse
import asyncio
import json
import os
import asyncpg


async def inspect(dsn):
    connection = await asyncpg.connect(
        dsn.replace("postgresql+asyncpg://", "postgresql://")
    )
    try:
        async with connection.transaction(readonly=True):
            await connection.execute("set local statement_timeout = '30s'")
            tables = [
                "enrollment_suspensions",
                "suspension_commands",
                "enrollment_service_credit_events",
                "service_credit_allocations",
            ]
            missing = [
                name
                for name in tables
                if not await connection.fetchval(
                    "select to_regclass($1)", f"public.{name}"
                )
            ]
            columns = await connection.fetchval(
                "select count(*) from information_schema.columns where table_schema='public' and ((table_name='class_schedule_adjustments' and column_name='adjustment_kind') or (table_name='service_credit_allocations' and column_name='applies_from'))"
            )
            triggers = await connection.fetchval(
                "select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'D' and tgname = any($1::text[])",
                [
                    "zz_suspension_command_boundary",
                    "suspension_credit_command_boundary",
                    "zz_service_credit_allocation_balance",
                    "zz_suspension_signed_event",
                    "zz_suspension_request_protection",
                    "suspension_allocation_windows",
                ],
            )
            result = dict(
                expected_migration=131,
                missing_tables=missing,
                required_columns_present=columns == 2,
                required_triggers_present=triggers == 6,
                read_only=True,
            )
            if missing or columns != 2:
                result["ready"] = False
                return result
            result["legacy_pauses_to_review"] = await connection.fetchval(
                "select count(*) from public.class_schedule_adjustments where adjustment_kind='LEGACY_REVIEW' and status='OPEN'"
            )
            result["negative_credit_memberships"] = await connection.fetchval(
                "select count(*) from (select enrollment_id from public.enrollment_service_credit_events group by enrollment_id having sum(case when event_type='REVERSAL' then -credit_days else credit_days end)<0) t"
            )
            result["exceptions_missing_canonical_source"] = await connection.fetchval(
                "select count(*) from public.class_session_exceptions x where status in ('MAKEUP_PENDING','MAKEUP_SCHEDULED') and (source_slot_id is null or not exists(select 1 from public.class_session_staff_snapshots s where s.exception_id=x.id and s.role='TEACHER'))"
            )
            result["overallocated_events"] = await connection.fetchval(
                "select count(*) from (select e.id from public.enrollment_service_credit_events e join public.service_credit_allocations a on a.credit_event_id=e.id group by e.id having sum(a.allocated_days)>e.credit_days) t"
            )
            result["pending_credit_events"] = await connection.fetchval(
                "select count(*) from (select e.id from public.enrollment_service_credit_events e left join public.service_credit_allocations a on a.credit_event_id=e.id group by e.id having coalesce(sum(a.allocated_days),0)<e.credit_days) t"
            )
            result["ready"] = result["required_triggers_present"] and not any(
                result[key]
                for key in (
                    "legacy_pauses_to_review",
                    "negative_credit_memberships",
                    "exceptions_missing_canonical_source",
                    "overallocated_events",
                )
            )
            return result
    finally:
        await connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default=os.getenv("DATABASE_URL"))
    args = parser.parse_args()
    if not args.dsn:
        parser.error("Choose a database through --dsn or DATABASE_URL")
    try:
        result = asyncio.run(inspect(args.dsn))
    except (asyncpg.PostgresError, OSError, ValueError) as exc:
        # Connection exceptions may contain credentials; report type only.
        print(
            json.dumps(
                {"ready": False, "error_type": type(exc).__name__, "read_only": True}
            )
        )
        return 2
    print(json.dumps(result, indent=2))
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
