"""Apply independent-date migrations to the approved database after backup."""

import argparse
import asyncio
import hashlib
import os
from pathlib import Path
import shutil
import subprocess

from dotenv import dotenv_values
from backup_configured_database import IDENTITY_SQL, runtime_identity, settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    only = parser.add_mutually_exclusive_group()
    only.add_argument("--only-126", action="store_true", help="Apply only the replacement metadata constraint")
    only.add_argument("--only-127", action="store_true", help="Apply only retained schedules and waiver metadata")
    only.add_argument("--repair-legacy-051", action="store_true", help="Explicitly approved orphaned backup FK repair; preserves all snapshots")
    only.add_argument("--suspensions-rollout", action="store_true", help="Approved M128-131 plus evidence-guarded 6C1 metadata repair")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    backup = args.backup.resolve(strict=True)
    if not backup.is_relative_to((root / "backups").resolve()):
        raise RuntimeError("Backup must be inside workspace backups")
    with backup.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != args.sha256:
            raise RuntimeError("Backup digest mismatch")
    env = dict(os.environ)
    values = dotenv_values(root / "backend/.env.maintenance")
    for key in ("PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD"):
        if not values.get(key):
            raise RuntimeError(f"Missing {key}")
        env[key] = values[key]
    env["PGSSLMODE"] = settings.database_ssl_mode
    env["PGCONNECT_TIMEOUT"] = "20"
    if settings.database_ssl_root_cert_path:
        env["PGSSLROOTCERT"] = settings.database_ssl_root_cert_path
    executable = shutil.which("psql") or "C:/Program Files/PostgreSQL/17/bin/psql.exe"

    def psql(*arguments):
        result = subprocess.run([executable, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", *arguments],
                                env=env, capture_output=True, text=True, timeout=360)
        if result.returncode:
            message = result.stderr
            for value in values.values():
                if value:
                    message = message.replace(value, "[redacted]")
            print(message[:1600])
            raise RuntimeError("Migration operation failed; stop and inspect")
        return result.stdout.strip()

    if psql("-c", IDENTITY_SQL) != asyncio.run(runtime_identity()):
        raise RuntimeError("Database identity mismatch")
    if psql("-c", "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='student_membership_commands' AND column_name='collect_source_final_cycle'") != "1":
        raise RuntimeError("Migration 123 prerequisite missing")
    financial = "SELECT md5(coalesce((SELECT string_agg((to_jsonb(f)-'admission_date_snapshot'-'billing_anchor_date_snapshot'-'collection_due_offset_days')::text, '' ORDER BY id) FROM public.fee_records f),'') || coalesce((SELECT string_agg(to_jsonb(r)::text, '' ORDER BY id) FROM public.billing_anchor_revisions r),''))"
    financial = financial.replace("to_jsonb(r)::text", "(to_jsonb(r)-'scheduled_segments'-'waived_intervals')::text")
    if args.only_126 or args.only_127 or args.repair_legacy_051 or args.suspensions_rollout:
        if psql("-c", "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='start_date_change_commands' AND column_name='execution_plan'") != "1":
            raise RuntimeError("Migration 125 prerequisite missing")
        financial = financial.replace("-'admission_date_snapshot'-'billing_anchor_date_snapshot'-'collection_due_offset_days'", "")
    if args.suspensions_rollout:
        if psql("-c", "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_anchor_revisions' AND column_name IN ('scheduled_segments','waived_intervals')") != "2":
            raise RuntimeError("Migration 127 prerequisite missing")
        # Preserve every existing financial field, including waiver/segment data.
        financial = financial.replace("(to_jsonb(r)-'scheduled_segments'-'waived_intervals')::text", "to_jsonb(r)::text")
        financial = "SELECT md5(string_agg(digest, '' ORDER BY ordinal)) FROM (" + financial.replace("SELECT md5(", "SELECT 0 AS ordinal, md5(", 1) + " AS digest UNION ALL " + " UNION ALL ".join(
            f"SELECT {index}, md5(coalesce(string_agg(({row})::text, '' ORDER BY id), '')) FROM public.{table} t"
            for index, (table, row) in enumerate([
                ("payments", "to_jsonb(t)"),
                ("enrollment_service_credit_events", "to_jsonb(t)-'suspension_command_id'"),
                ("service_credit_allocations", "to_jsonb(t)-'applies_from'"),
            ], 1)
        ) + ") hashes"
    before = psql("-c", financial)
    filenames = ("128_suspension_command_contract.sql", "129_enrollment_suspensions.sql", "130_suspension_ledger_boundaries.sql", "131_suspension_signed_balance.sql") if args.suspensions_rollout else ("051_preserve_orphaned_backup.sql",) if args.repair_legacy_051 else ("127_billing_schedule_segments.sql",) if args.only_127 else ("126_separate_superseded_fee_metadata.sql",) if args.only_126 else (
        "124_independent_admission_dates.sql", "125_billing_execution_plans.sql", "126_separate_superseded_fee_metadata.sql", "127_billing_schedule_segments.sql",
    )
    for filename in filenames:
        directory = "scripts" if args.repair_legacy_051 else "migrations"
        psql("-f", str(root / "backend/supabase" / directory / filename))
        print(f"Applied {filename}", flush=True)
    if args.suspensions_rollout:
        psql("-f", str(root / "backend/supabase/scripts/repair_6c1_exception_source.sql"))
        print("Applied evidence-guarded 6C1 metadata repair (no status/financial change).", flush=True)
    if before != psql("-c", financial):
        raise RuntimeError("Financial rows changed during migration window; inspect before activation")
    print("Financial records and billing revisions unchanged.")


if __name__ == "__main__":
    main()
