from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "supabase"
    / "migrations"
    / "116_scope_class_identity_to_workspace.sql"
)


def test_class_identity_indexes_are_scoped_to_workspace() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "drop index if exists public.classes_academic_identity_unique_idx" in sql
    assert "drop index if exists public.classes_intake_identity_unique_idx" in sql
    assert "workspace_id,\n    class_category" in sql
    assert "workspace_id, class_category, lower(btrim(name)), intake_year_month" in sql


def test_migration_guards_existing_workspace_duplicates() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "duplicate academic class identity inside a workspace" in sql
    assert "duplicate intake class identity inside a workspace" in sql
    assert "group by workspace_id" in sql
