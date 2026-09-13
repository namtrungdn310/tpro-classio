from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "supabase"
    / "migrations"
    / "123_transfer_final_cycle_choice.sql"
)


def test_transfer_final_cycle_choice_is_durable_and_backward_compatible() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    assert (
        "add column if not exists collect_source_final_cycle boolean not null default true"
        in sql
    )
    assert "update public.student_membership_commands" not in sql
