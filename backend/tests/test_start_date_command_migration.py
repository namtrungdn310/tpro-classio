from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "supabase"
    / "migrations"
    / "121_start_date_change_commands.sql"
)


def test_start_date_command_migration_contains_required_tables_and_audit() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    assert "create table if not exists public.start_date_change_commands" in sql
    assert "create table if not exists public.start_date_change_command_items" in sql
    assert "start_date_command_item_id" in sql
    assert "decision_code" in sql
    assert "unique (workspace_id, request_id)" in sql
    assert "force row level security" in sql
    assert "start_date_change_command_version" in sql
    assert "class_start_date_change" in sql
    assert "student_start_date_change" in sql


def test_start_date_command_audit_is_protected_from_mutation_and_browser() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    assert "start_date_change_commands rows are append-only" in sql
    assert "start_date_change_command_items rows are immutable" in sql
    assert "revoke all on table public.start_date_change_commands from public, anon, authenticated" in sql
    assert "revoke all on table public.start_date_change_command_items from public, anon, authenticated" in sql
