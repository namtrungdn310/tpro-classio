from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "supabase"
    / "migrations"
    / "119_membership_effective_dates.sql"
)


def test_membership_migration_contains_effective_range_and_audit_contract() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    assert "add column if not exists ended_on date" in sql
    assert "student_membership_commands" in sql
    assert "student_membership_command_items" in sql
    assert "unique (workspace_id, request_id)" in sql
    assert "force row level security" in sql
    assert "membership_effective_date_version" in sql
    assert "initial_backdated" in sql
    assert "membership_transfer" in sql


def test_membership_audit_is_not_mutable_or_browser_accessible() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    assert "student membership command audit is immutable" in sql
    assert "student membership command items are append-only" in sql
    assert "revoke all on table public.student_membership_commands from public, anon, authenticated" in sql
    assert "revoke all on table public.student_membership_command_items from public, anon, authenticated" in sql
