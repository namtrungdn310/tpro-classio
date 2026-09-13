from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "supabase"
    / "migrations"
    / "117_reconcile_class_schedule_staff_membership.sql"
)


def test_schedule_staff_reconciliation_is_workspace_safe_and_idempotent() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "insert into public.class_teachers" in sql
    assert "slot.workspace_id" in sql
    assert "on conflict (class_id, teacher_id) do nothing" in sql
    assert "cross-workspace class schedule assignment" in sql
    assert "schedule assignment role differs from staff role" in sql


def test_schedule_staff_reconciliation_uses_only_current_projection() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "slot.effective_until is null" in sql
    assert "current slot assignment is missing class membership" in sql
    assert "member.workspace_id = slot.workspace_id" in sql
