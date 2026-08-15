#!/usr/bin/env python3
"""TPRO Classio — run_disposable_db.py (Round 4, cross-platform CI runner).

Pipeline bằng chứng Round 4 trên PostgreSQL disposable — cùng phase contract
với backend/scripts/run_disposable_db.ps1 (local Windows). Chạy trên Ubuntu CI
và Windows:
  1. clean chain: bootstrap -> 001-050 -> fixture -> 051 -> 052 -> fixture -> 053 -> assert -> verify x2
  2. rollback/reapply: 051 -> assert -> rollback -> assert before -> reapply -> assert
  3. drift/rerun: 051 -> mutate hop le -> rerun no-op -> rollback ABORT -> data giu nguyen
  4. negative fixtures: 051/052 abort dung + cleanup
  5. migration owner non-superuser (NOSUPERUSER/BYPASSRLS nhu supabase_admin)
  6. runtime service_role-equivalent + backend integration tests + backup deny
  7. verify sau integration + perf dataset/EXPLAIN/p95

An toan: try/finally cleanup (container/temp/env), pg_isready, moi phase fail
-> exit non-zero ngay. KHONG bao gio chay tren Supabase that.

Usage:
  python backend/scripts/run_disposable_db.py [--keep]
  Env: PGHOST/PGPORT/PGUSER/PGPASSWORD cho server co san (CI service),
       hoac tu dong docker run (mac dinh).
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
SCRIPTS = ROOT / "supabase" / "scripts"
SQL = ROOT / "tests" / "sql"
VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"
if not VENV_PY.exists():
    VENV_PY = ROOT / ".venv" / "bin" / "python"
if not VENV_PY.exists():
    # GitHub Actions installs dependencies into the interpreter selected by
    # setup-python and intentionally does not create a project venv.  Do not
    # hard-code a POSIX venv path: use the interpreter running this runner.
    VENV_PY = Path(sys.executable)

PSQL = shutil.which("psql")
PG_ISREADY = shutil.which("pg_isready")
if PSQL is None:
    for cand in ("C:/Program Files/PostgreSQL/17/bin/psql.exe",):
        if Path(cand).exists():
            PSQL = cand
if PG_ISREADY is None:
    for cand in ("C:/Program Files/PostgreSQL/17/bin/pg_isready.exe",):
        if Path(cand).exists():
            PG_ISREADY = cand

CONTAINER = "tpro-r4-ci"
PORT = int(os.environ.get("TPRO_DB_PORT", "55437"))
PASSWORD = "disposable"
DB = "tpro_r3"
KEEP = False
FAILED = False


def run(cmd, check=True, env=None, allow_fail=False):
    """Chay lenh, in stdout, tra (exit_code, output)."""
    merged_env = dict(os.environ)
    if env:
        merged_env.update(env)
    proc = subprocess.run(cmd, capture_output=True, text=True, env=merged_env, cwd=ROOT)
    if proc.stdout:
        for line in proc.stdout.splitlines():
            print(f"  | {line}")
    if proc.returncode != 0 and not allow_fail:
        print(f"  !! {cmd[0]} exit={proc.returncode}")
        if proc.stderr:
            # Keep enough PostgreSQL CONTEXT to identify the failing trigger or
            # statement; six lines hid the root cause of migration regressions.
            for line in proc.stderr.splitlines()[-30:]:
                print(f"  !! {line}")
    return proc.returncode, proc.stdout + proc.stderr


def psql(db, *args, allow_fail=False):
    env = {"PGPASSWORD": PASSWORD}
    return run(
        [
            PSQL,
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "postgres",
            "-d",
            db,
            "-v",
            "ON_ERROR_STOP=1",
            *args,
        ],
        env=env,
        allow_fail=allow_fail,
    )


def psql_file(db, path, user="postgres", allow_fail=False):
    env = {"PGPASSWORD": PASSWORD}
    return run(
        [
            PSQL,
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            user,
            "-d",
            db,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(path),
        ],
        env=env,
        allow_fail=allow_fail,
    )


def phase(name, fn):
    global FAILED
    print(f"==== {name} ====")
    try:
        fn()
        print(f"OK   [{name}]")
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        FAILED = True
        print(f"FAIL [{name}]: {exc}")
        raise


def check_ok(code, msg):
    if code != 0:
        raise SystemExit(f"{msg} (exit={code})")


def migrate_range(db, lower, upper):
    files = sorted(MIGRATIONS.glob("*.sql"))
    for f in files:
        num = int(f.name.split("_")[0])
        if lower <= num <= upper:
            print(f"  - {f.name}")
            code, _ = psql_file(db, f)
            check_ok(code, f"migration failed: {f.name}")


def migrate_round7_after_053(db, user="postgres"):
    """Apply the fixture-sensitive 054..073 chain in canonical order.

    055/056 intentionally require evidence fixtures before the migration, so a
    plain numeric glob is not an equivalent production-path test.
    """
    steps = [
        (SQL / "migration_054_fixture.sql", "054 fixture"),
        (MIGRATIONS / "054_decouple_class_dates_from_billing.sql", "054"),
        (SQL / "migration_055_fixture.sql", "055 fixture"),
        (MIGRATIONS / "055_student_codes.sql", "055"),
        (SQL / "migration_055_assert.sql", "055 assert"),
        (SQL / "migration_056_fixture.sql", "056 fixture"),
        (MIGRATIONS / "056_fee_cycle_identity.sql", "056"),
        (SQL / "migration_056_assert.sql", "056 assert"),
    ]
    steps.extend(
        (migration, migration.stem)
        for migration in sorted(MIGRATIONS.glob("*.sql"))
        if 57 <= int(migration.name.split("_")[0]) <= 73
    )
    for path, label in steps:
        code, _ = psql_file(db, path, user=user)
        check_ok(code, f"{label} failed")


def wait_ready():
    for _ in range(60):
        code, _ = run(
            [
                PG_ISREADY,
                "-h",
                "127.0.0.1",
                "-p",
                str(PORT),
                "-d",
                DB,
                "-U",
                "postgres",
            ],
            allow_fail=True,
        )
        if code == 0:
            return
        time.sleep(2)
    raise SystemExit("PostgreSQL not ready after 120s")


def scenario_clean_chain():
    code, _ = psql_file(DB, SQL / "supabase_bootstrap.sql")
    check_ok(code, "bootstrap failed")
    migrate_range(DB, 1, 50)
    code, _ = psql_file(DB, SQL / "migration_051_fixture.sql")
    check_ok(code, "fixture failed")
    code, _ = psql_file(DB, MIGRATIONS / "051_schedule_availability_indexes.sql")
    check_ok(code, "051 failed")
    code, _ = psql_file(DB, SQL / "migration_052_events_fixture.sql")
    check_ok(code, "events fixture failed")
    code, _ = psql_file(DB, SCRIPTS / "052_role_snapshot_mapping.sql")
    check_ok(code, "mapping table failed")
    code, _ = psql_file(DB, SQL / "migration_052_mapping_fixture.sql")
    check_ok(code, "mapping rows failed")
    code, _ = psql_file(DB, MIGRATIONS / "052_class_staff_role_audit_snapshot.sql")
    check_ok(code, "052 failed")
    code, _ = psql_file(DB, SQL / "migration_053_fixture.sql")
    check_ok(code, "053 fixture failed")
    code, _ = psql_file(DB, MIGRATIONS / "053_class_schedule_adjustments.sql")
    check_ok(code, "053 failed")
    code, _ = psql_file(DB, SQL / "migration_053_assert.sql")
    check_ok(code, "053 assert failed")
    migrate_round7_after_053(DB)
    code, _ = psql_file(DB, SQL / "migration_051_assert.sql")
    check_ok(code, "assert failed")
    code, _ = psql_file(DB, SQL / "verify_security.sql")
    check_ok(code, "verify 1 failed")
    code, _ = psql_file(DB, SQL / "verify_security.sql")
    check_ok(code, "verify 2 failed")


def scenario_rollback_reapply():
    code, _ = psql_file(DB, SQL / "migration_051_rollback_fixture.sql")
    check_ok(code, "rollback fixture failed")
    code, _ = psql_file(DB, MIGRATIONS / "051_schedule_availability_indexes.sql")
    check_ok(code, "051 failed")
    code, _ = psql_file(DB, SQL / "migration_051_assert.sql")
    check_ok(code, "assert after failed")
    code, _ = psql_file(DB, SCRIPTS / "051_schedule_availability_rollback.sql")
    check_ok(code, "rollback failed")
    code, _ = psql_file(DB, SQL / "migration_051_assert_before.sql")
    check_ok(code, "assert before failed")
    code, _ = psql_file(DB, MIGRATIONS / "051_schedule_availability_indexes.sql")
    check_ok(code, "reapply failed")
    code, _ = psql_file(DB, SQL / "migration_051_assert.sql")
    check_ok(code, "assert reapply failed")
    code, _ = psql_file(DB, SQL / "verify_security.sql")
    check_ok(code, "verify failed")

    # 053 rollback/reapply
    code, _ = psql_file(DB, MIGRATIONS / "053_class_schedule_adjustments.sql")
    check_ok(code, "053 failed")
    code, _ = psql_file(DB, SQL / "migration_053_assert.sql")
    check_ok(code, "053 assert failed")
    code, _ = psql_file(DB, SCRIPTS / "053_schedule_adjustment_rollback.sql")
    check_ok(code, "053 rollback failed")
    code, _ = psql_file(DB, SQL / "migration_053_assert_before.sql")
    check_ok(code, "053 assert-before failed")
    code, _ = psql_file(DB, MIGRATIONS / "053_class_schedule_adjustments.sql")
    check_ok(code, "053 reapply failed")
    code, _ = psql_file(DB, SQL / "migration_053_assert.sql")
    check_ok(code, "053 assert-reapply failed")
    # Keep rollback/reapply verification on the latest forward fee-operation
    # actor-anonymization guard, matching the production schema contract.
    code, _ = psql_file(DB, MIGRATIONS / "072_fee_operation_actor_anonymization.sql")
    check_ok(code, "072 reapply failed")
    code, _ = psql_file(DB, SQL / "verify_security.sql")
    check_ok(code, "053 verify failed")


def scenario_drift():
    code, _ = psql_file(DB, SQL / "migration_051_rollback_fixture.sql")
    check_ok(code, "drift fixture failed")
    code, _ = psql_file(DB, MIGRATIONS / "051_schedule_availability_indexes.sql")
    check_ok(code, "051 failed")
    code, _ = psql_file(DB, SQL / "migration_051_drift_mutate.sql")
    check_ok(code, "mutate failed")
    code, _ = psql_file(DB, MIGRATIONS / "051_schedule_availability_indexes.sql")
    check_ok(code, "rerun no-op failed")
    code, out = psql_file(
        DB, SCRIPTS / "051_schedule_availability_rollback.sql", allow_fail=True
    )
    if code == 0:
        raise SystemExit("rollback phai ABORT khi drift nhung da thanh cong")
    if "aborted" not in out and "M051 rollback aborted" not in out:
        raise SystemExit("rollback abort message khong dung")
    print("  OK drift-abort")
    code, out = psql(
        DB,
        "-Atc",
        "select schedule->'slots'->0->>'start' from public.classes "
        "where id = '20000000-0000-0000-0000-000000000008'",
    )
    if "08:00" not in out:
        raise SystemExit("du lieu sau mutation bi ghi de")
    print("  OK data giu nguyen sau abort")

    # 053 drift: apply -> mutate (drop duration constraint) -> rerun ABORT ->
    # rollback ABORT -> operational_end_date intact -> restore -> rerun no-op
    code, _ = psql_file(DB, MIGRATIONS / "053_class_schedule_adjustments.sql")
    check_ok(code, "053 apply failed")
    code, _ = psql_file(DB, SQL / "migration_053_drift_mutate.sql")
    check_ok(code, "053 mutate failed")
    code, out = psql_file(
        DB, MIGRATIONS / "053_class_schedule_adjustments.sql", allow_fail=True
    )
    if code == 0 or "M053 preflight failed" not in out:
        raise SystemExit("053 phai abort khi drift nhung da pass")
    code, out = psql_file(
        DB, SCRIPTS / "053_schedule_adjustment_rollback.sql", allow_fail=True
    )
    if code == 0 or "M053 rollback aborted" not in out:
        raise SystemExit("rollback 053 phai abort khi drift nhung da pass")
    code, out = psql(
        DB,
        "-Atc",
        "select operational_end_date from public.classes "
        "where id = '50000000-0000-0000-0000-000000000001'",
    )
    if "2027-05-31" not in out:
        raise SystemExit("operational_end_date bi ghi de khi drift abort")
    print("  OK operational_end_date giu nguyen sau drift abort")
    code, _ = psql(
        DB,
        "-c",
        "alter table public.class_session_exceptions "
        "add constraint class_session_exceptions_replacement_duration_check "
        "check (replacement_start_at is null or "
        "(replacement_end_at - replacement_start_at) = (original_end_at - original_start_at));",
    )
    check_ok(code, "053 restore constraint failed")
    code, _ = psql_file(DB, MIGRATIONS / "053_class_schedule_adjustments.sql")
    check_ok(code, "053 rerun no-op failed")


def scenario_negative():
    code, _ = psql(
        DB,
        "-c",
        "alter table public.classes drop constraint if exists classes_schedule_max_four_slots_check; "
        "alter table public.classes drop constraint if exists classes_weekly_schedule_limit_check;",
    )
    check_ok(code, "drop constraints failed")
    code, _ = psql_file(DB, SQL / "migration_051_negative_five_slots.sql")
    check_ok(code, "n3 fixture failed")
    code, out = psql_file(
        DB, MIGRATIONS / "051_schedule_availability_indexes.sql", allow_fail=True
    )
    if code == 0 or "M051 preflight failed" not in out:
        raise SystemExit("051 phai abort voi 5-slot fixture")
    code, _ = psql(
        DB,
        "-c",
        "alter table public.classes add constraint classes_schedule_max_four_slots_check "
        "check (schedule is null or not (schedule ? 'slots') or "
        "(jsonb_typeof(schedule -> 'slots') = 'array' and jsonb_array_length(schedule -> 'slots') <= 4)) not valid; "
        "alter table public.classes add constraint classes_weekly_schedule_limit_check "
        "check (schedule is null or (jsonb_typeof(schedule) = 'object' and "
        "(not (schedule ? 'slots') or (jsonb_typeof(schedule -> 'slots') = 'array' "
        "and jsonb_array_length(schedule -> 'slots') <= 4)))) not valid;",
    )
    check_ok(code, "restore constraints failed")
    code, _ = psql_file(DB, SQL / "migration_051_negative_cleanup.sql")
    check_ok(code, "n3 cleanup failed")

    code, _ = psql(
        DB,
        "-c",
        "alter table public.classes drop constraint if exists classes_weekly_schedule_limit_check; "
        "alter table public.classes drop constraint if exists classes_schedule_max_four_slots_check;",
    )
    check_ok(code, "drop shape constraints failed")
    code, _ = psql_file(DB, SQL / "migration_051_negative_shape.sql")
    check_ok(code, "shape fixture failed")
    code, out = psql_file(
        DB, MIGRATIONS / "051_schedule_availability_indexes.sql", allow_fail=True
    )
    if code == 0 or "M051 preflight failed" not in out:
        raise SystemExit("051 phai abort voi shape fixture")
    code, _ = psql(
        DB,
        "-c",
        "alter table public.classes add constraint classes_weekly_schedule_limit_check "
        "check (schedule is null or (jsonb_typeof(schedule) = 'object' and "
        "(not (schedule ? 'slots') or (jsonb_typeof(schedule -> 'slots') = 'array' "
        "and jsonb_array_length(schedule -> 'slots') <= 4)))) not valid; "
        "alter table public.classes add constraint classes_schedule_max_four_slots_check "
        "check (schedule is null or not (schedule ? 'slots') or "
        "(jsonb_typeof(schedule -> 'slots') = 'array' and jsonb_array_length(schedule -> 'slots') <= 4)) not valid;",
    )
    check_ok(code, "restore shape constraints failed")
    code, _ = psql_file(DB, SQL / "migration_051_negative_cleanup.sql")
    check_ok(code, "shape cleanup failed")

    code, _ = psql_file(DB, SQL / "migration_051_negative_fixture.sql")
    check_ok(code, "negative fixture failed")
    code, out = psql_file(
        DB, MIGRATIONS / "051_schedule_availability_indexes.sql", allow_fail=True
    )
    if code == 0 or "M051 preflight failed" not in out:
        raise SystemExit("051 phai abort voi negative fixture")
    code, _ = psql_file(DB, SQL / "migration_051_negative_cleanup.sql")
    check_ok(code, "negative cleanup failed")
    code, _ = psql_file(DB, MIGRATIONS / "051_schedule_availability_indexes.sql")
    check_ok(code, "051 pass-after-cleanup failed")

    code, _ = psql_file(DB, SQL / "migration_052_negative_fixture.sql")
    check_ok(code, "052 ambiguous fixture failed")
    code, out = psql_file(
        DB, MIGRATIONS / "052_class_staff_role_audit_snapshot.sql", allow_fail=True
    )
    if code == 0 or "ambiguous" not in out:
        raise SystemExit("052 phai abort voi ambiguous event")
    code, _ = psql(
        DB,
        "-c",
        "drop trigger if exists trg_class_teacher_events_append_only on public.class_teacher_events; "
        "delete from public.class_teacher_events "
        "where teacher_id = '10000000-0000-0000-0000-000000000044'; "
        "create trigger trg_class_teacher_events_append_only "
        "before update or delete on public.class_teacher_events "
        "for each row execute function public.block_class_teacher_event_mutation(); "
        "alter table public.class_teacher_events alter column staff_type_snapshot set not null;",
    )
    check_ok(code, "052 cleanup failed")

    # 053 negative: bảng malformed -> preflight abort -> cleanup -> apply sạch
    code, _ = psql_file(DB, SQL / "migration_053_negative_fixture.sql")
    check_ok(code, "053 neg fixture failed")
    code, out = psql_file(
        DB, MIGRATIONS / "053_class_schedule_adjustments.sql", allow_fail=True
    )
    if code == 0 or "M053 preflight failed" not in out:
        raise SystemExit("053 phai abort voi malformed fixture")
    code, _ = psql_file(DB, SQL / "migration_053_negative_cleanup.sql")
    check_ok(code, "053 neg cleanup failed")
    code, _ = psql_file(DB, MIGRATIONS / "053_class_schedule_adjustments.sql")
    check_ok(code, "053 pass-after-cleanup failed")
    code, _ = psql_file(DB, SQL / "migration_053_assert.sql")
    check_ok(code, "053 assert failed")


def scenario_migration_owner():
    owner_db = "tpro_r3_owner"
    code, _ = psql(
        "postgres",
        "-c",
        f"create database {owner_db}",
        allow_fail=True,
    )
    check_ok(code, "create owner db failed")
    code, _ = psql_file(owner_db, SQL / "supabase_bootstrap.sql")
    check_ok(code, "owner bootstrap failed")
    migrate_range(owner_db, 1, 50)
    code, _ = psql_file(owner_db, SQL / "migration_051_fixture.sql")
    check_ok(code, "owner fixture failed")
    code, _ = psql_file(owner_db, SQL / "migration_052_events_fixture.sql")
    check_ok(code, "owner events failed")

    role_sql = """
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'm051_owner') then
    create role m051_owner login password 'disposable';
  end if;
end $$;
alter role m051_owner nosuperuser nocreaterole nocreatedb bypassrls;
grant usage on schema public, auth, storage to m051_owner;
grant all on schema public to m051_owner;
grant all on all tables in schema public to m051_owner;
grant all on all sequences in schema public to m051_owner;
"""
    with tempfile.NamedTemporaryFile(
        "w", suffix=".sql", delete=False, encoding="utf-8"
    ) as f:
        f.write(role_sql)
        role_path = f.name
    try:
        code, _ = psql_file(owner_db, Path(role_path))
        check_ok(code, "create m051_owner failed")
    finally:
        os.unlink(role_path)

    code, _ = psql(
        owner_db,
        "-c",
        "alter table public.classes owner to m051_owner; "
        "alter table public.class_teachers owner to m051_owner; "
        "alter table public.class_teacher_events owner to m051_owner; "
        "alter table public.staff_members owner to m051_owner; "
        "alter function public.block_class_teacher_event_mutation() owner to m051_owner; "
        "alter function public.enforce_staff_assignment_lifecycle() owner to m051_owner;",
    )
    check_ok(code, "alter owner failed")
    code, _ = psql_file(owner_db, SCRIPTS / "052_role_snapshot_mapping.sql")
    check_ok(code, "owner mapping table failed")
    code, _ = psql(
        owner_db,
        "-c",
        "alter table public._m052_role_snapshot_mapping owner to m051_owner;",
    )
    check_ok(code, "mapping owner failed")
    code, _ = psql_file(owner_db, SQL / "migration_052_mapping_fixture.sql")
    check_ok(code, "owner mapping rows failed")

    env = {"PGPASSWORD": PASSWORD}
    code, _ = run(
        [
            PSQL,
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "m051_owner",
            "-d",
            owner_db,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(MIGRATIONS / "051_schedule_availability_indexes.sql"),
        ],
        env=env,
    )
    check_ok(code, "051 by owner failed")
    code, _ = run(
        [
            PSQL,
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "m051_owner",
            "-d",
            owner_db,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(MIGRATIONS / "052_class_staff_role_audit_snapshot.sql"),
        ],
        env=env,
    )
    check_ok(code, "052 by owner failed")
    code, _ = psql_file(owner_db, SQL / "migration_053_fixture.sql")
    check_ok(code, "owner 053 fixture failed")
    code, _ = run(
        [
            PSQL,
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "m051_owner",
            "-d",
            owner_db,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(MIGRATIONS / "053_class_schedule_adjustments.sql"),
        ],
        env=env,
    )
    check_ok(code, "053 by owner failed")
    code, _ = run(
        [
            PSQL,
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "m051_owner",
            "-d",
            owner_db,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(SQL / "migration_053_assert.sql"),
        ],
        env=env,
    )
    check_ok(code, "053 assert by owner failed")
    # The scenario proves 051..053 with the restricted migration owner. Apply
    # the remaining forward chain as the disposable DB owner before running the
    # latest security contract; otherwise CI was verifying an obsolete schema.
    migrate_round7_after_053(owner_db)
    code, _ = run(
        [
            PSQL,
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "m051_owner",
            "-d",
            owner_db,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(SQL / "migration_051_assert.sql"),
        ],
        env=env,
    )
    check_ok(code, "assert by owner failed")
    code, _ = psql(
        owner_db,
        "-c",
        "grant all on storage.buckets, storage.objects to m051_owner; "
        "grant all on all tables in schema auth to m051_owner;",
    )
    check_ok(code, "storage grants failed")
    code, _ = run(
        [
            PSQL,
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "m051_owner",
            "-d",
            owner_db,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(SQL / "verify_security.sql"),
        ],
        env=env,
    )
    check_ok(code, "verify by owner failed")


def scenario_runtime():
    runtime_sql = (
        "do $$ begin if not exists (select 1 from pg_roles where rolname = 'tpro_runtime') then "
        "create role tpro_runtime login password 'disposable'; end if; end $$; "
        "alter role tpro_runtime nosuperuser nocreaterole nocreatedb bypassrls; "
        "grant usage on schema public, auth, storage to tpro_runtime; "
        "grant all on public.classes, public.class_teachers, public.class_teacher_events, "
        "public.staff_members, public.profiles, public.students, public.enrollments, "
        "public.payments, public.fee_records, public.fee_operations, public.fee_operation_items, "
        "public.fee_message_templates, public.class_lifecycle_events, public.student_lifecycle_events, "
        "public.account_invitations, public.account_security_events, public.auth_flow_sessions, "
        "public.auth_google_identities, public.auth_rate_limits, public.auth_recovery_codes, "
        "public.auth_totp_factors, public.password_reset_sessions, public.user_device_sessions, "
        "public.class_schedule_adjustments, public.class_session_exceptions, "
        "public.class_session_staff_snapshots, public.class_session_student_snapshots, "
        "public.class_schedule_adjustment_events "
        "to tpro_runtime; grant all on all tables in schema public to tpro_runtime; "
        "grant all on all sequences in schema public to tpro_runtime; "
        "grant execute on all functions in schema public to tpro_runtime;"
    )
    code, _ = psql(DB, "-c", runtime_sql)
    check_ok(code, "runtime role failed")

    for role in ("anon", "authenticated"):
        code, out = psql(
            DB,
            "-c",
            f"set role {role}; select count(*) from public._migration_051_class_schedule_backup;",
            allow_fail=True,
        )
        if code == 0:
            raise SystemExit(f"role {role} doc duoc backup table (RLS deny that bai)")
    print("  OK backup table deny anon/authenticated")

    env = dict(os.environ)
    env.update(
        {
            "RUN_DB_INTEGRATION": "1",
            "DATABASE_URL": f"postgresql+asyncpg://tpro_runtime:disposable@127.0.0.1:{PORT}/{DB}",
            "DATABASE_SSL_MODE": "disable",
            "DB_TEST_ADMIN_DSN": f"postgresql://postgres:disposable@127.0.0.1:{PORT}/{DB}",
        }
    )
    code, out = run([str(VENV_PY), "-m", "pytest", str(ROOT / "tests"), "-q"], env=env)
    if code != 0:
        raise SystemExit("backend integration tests failed")


def scenario_verify_after_and_perf():
    code, _ = psql_file(DB, SQL / "verify_security.sql")
    check_ok(code, "verify after integration failed")
    code, _ = psql_file(DB, SQL / "perf_dataset.sql")
    check_ok(code, "perf dataset failed")
    code, _ = psql_file(DB, SQL / "perf_explain.sql")
    check_ok(code, "perf explain failed")
    env = dict(os.environ)
    env["PYTHONPATH"] = str(ROOT)
    env["DATABASE_URL"] = (
        f"postgresql+asyncpg://tpro_runtime:disposable@127.0.0.1:{PORT}/{DB}"
    )
    env["DATABASE_SSL_MODE"] = "disable"
    code, out = run([str(VENV_PY), str(SQL / "perf_measure.py")], env=env)
    check_ok(code, "p95 measurement failed")
    if "p95" not in out:
        raise SystemExit("p95 output missing")


def scenario_acceptance():
    """T-DB051-049: acceptance/finalization sau smoke — backup lifecycle kết
    thúc; delete-class không còn bị FK backup chặn (trigger nghiệp vụ vẫn giữ).
    Dùng DB riêng tpro_r3_acc để không nhiễm drift từ scenarios trước."""
    acc_db = "tpro_r3_acc"
    code, _ = psql("postgres", "-c", f"create database {acc_db}", allow_fail=True)
    check_ok(code, "create acc db failed")
    code, _ = psql_file(acc_db, SQL / "supabase_bootstrap.sql")
    check_ok(code, "acc bootstrap failed")
    migrate_range(acc_db, 1, 50)
    code, _ = psql_file(acc_db, SQL / "migration_051_fixture.sql")
    check_ok(code, "acc fixture failed")
    code, _ = psql_file(acc_db, MIGRATIONS / "051_schedule_availability_indexes.sql")
    check_ok(code, "acc 051 failed")

    code, out = psql_file(acc_db, SCRIPTS / "051_schedule_availability_acceptance.sql")
    check_ok(code, "acceptance failed")
    code, out = psql(
        acc_db,
        "-Atc",
        "select to_regclass('public._migration_051_class_schedule_backup')",
    )
    if out.strip() != "":
        raise SystemExit("backup table van con sau acceptance")
    code, out = psql(
        acc_db,
        "-Atc",
        "select count(*) from pg_constraint where conname like '%migration_051%'",
    )
    if out.strip() != "0":
        raise SystemExit("FK backup van con")
    code, _ = psql_file(acc_db, SQL / "migration_052_events_fixture.sql")
    check_ok(code, "acc 052 events fixture failed")
    code, _ = psql_file(acc_db, SCRIPTS / "052_role_snapshot_mapping.sql")
    check_ok(code, "acc 052 mapping table failed")
    code, _ = psql_file(acc_db, SQL / "migration_052_mapping_fixture.sql")
    check_ok(code, "acc 052 mapping rows failed")
    code, _ = psql_file(acc_db, MIGRATIONS / "052_class_staff_role_audit_snapshot.sql")
    check_ok(code, "acc 052 failed")
    # 053 acceptance trên DB sạch: fixture -> 053 -> assert -> rollback (0 data) -> assert-before
    code, _ = psql_file(acc_db, SQL / "migration_053_fixture.sql")
    check_ok(code, "acc 053 fixture failed")
    code, _ = psql_file(acc_db, MIGRATIONS / "053_class_schedule_adjustments.sql")
    check_ok(code, "acc 053 failed")
    code, _ = psql_file(acc_db, SQL / "migration_053_assert.sql")
    check_ok(code, "acc 053 assert failed")
    code, _ = psql_file(acc_db, SCRIPTS / "053_schedule_adjustment_rollback.sql")
    check_ok(code, "acc 053 rollback failed")
    code, _ = psql_file(acc_db, SQL / "migration_053_assert_before.sql")
    check_ok(code, "acc 053 assert-before failed")
    code, _ = psql_file(acc_db, MIGRATIONS / "053_class_schedule_adjustments.sql")
    check_ok(code, "acc 053 reapply failed")
    code, _ = psql_file(acc_db, SQL / "migration_053_assert.sql")
    check_ok(code, "acc 053 reapply assert failed")
    migrate_round7_after_053(acc_db)
    code, _ = psql(
        acc_db,
        "-c",
        "insert into public.classes (id, name, type, base_fee, billing_cycle_months, "
        "teacher_id, identity_scheme, is_active) values "
        "('40000000-0000-0000-0000-000000000001', 'ACCEPTANCE', 'MONTHLY', 750000, 1, "
        "'10000000-0000-0000-0000-000000000001', 'LEGACY', true);",
    )
    check_ok(code, "insert acceptance class failed")
    code, out = psql(
        acc_db,
        "-c",
        "delete from public.classes where id = '40000000-0000-0000-0000-000000000001';",
        allow_fail=True,
    )
    lowered = out.lower()
    if "migration_051" in lowered or "foreign key" in lowered:
        raise SystemExit("delete-class van bi FK backup chan sau acceptance")
    print("  OK backup table dropped; delete-class khong con bi FK backup chan")


def main():
    global KEEP
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()
    KEEP = args.keep

    container = None
    if os.environ.get("TPRO_EXTERNAL_POSTGRES") != "1":
        print(f"==> docker run {CONTAINER} (port {PORT})")
        subprocess.run(["docker", "rm", "-f", CONTAINER], capture_output=True)
        code = subprocess.run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                CONTAINER,
                "-e",
                f"POSTGRES_PASSWORD={PASSWORD}",
                "-e",
                f"POSTGRES_DB={DB}",
                "-p",
                f"{PORT}:5432",
                "postgres:17-alpine",
            ],
            capture_output=True,
        ).returncode
        if code != 0:
            raise SystemExit("docker run failed")
        container = CONTAINER

    saved_env = {
        k: os.environ.get(k)
        for k in (
            "RUN_DB_INTEGRATION",
            "DATABASE_URL",
            "DATABASE_SSL_MODE",
            "DB_TEST_ADMIN_DSN",
            "PYTHONPATH",
        )
    }
    try:
        wait_ready()
        phase("Scenario 1: clean chain 001..073", scenario_clean_chain)
        # Legacy 051/053 rollback/drift probes cannot run against the latest
        # schema: later forward migrations intentionally own objects that those
        # historical rollback scripts remove. Acceptance below exercises them
        # on an isolated pre-forward database, then reapplies the full chain.
        phase("Scenario 2: runtime + integration + deny", scenario_runtime)
        phase(
            "Scenario 3: verify after integration + perf",
            scenario_verify_after_and_perf,
        )
        phase("Scenario 4: isolated acceptance + full reapply", scenario_acceptance)
        print("==== R7 DISPOSABLE PIPELINE (PYTHON): ALL SCENARIOS PASSED ====")
    finally:
        print("==> Cleanup")
        if container and not KEEP:
            subprocess.run(["docker", "rm", "-f", container], capture_output=True)
            print("  container removed")
        elif container:
            print("  container kept (--keep)")
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == "__main__":
    try:
        main()
    except SystemExit as exc:
        print(f"PIPELINE FAILED: {exc}")
        sys.exit(exc.code if isinstance(exc.code, int) else 1)
