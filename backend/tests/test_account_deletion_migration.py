from pathlib import Path


def test_account_deletion_migration_preserves_audit_and_releases_identity() -> None:
    source = (
        Path(__file__).parents[1]
        / "supabase"
        / "migrations"
        / "034_account_deletion_sync.sql"
    ).read_text(encoding="utf-8")

    assert "target_email_snapshot" in source
    assert "target_username_snapshot" in source
    assert "populate_account_security_event_snapshots" in source
    assert "before insert on public.account_security_events" in source.lower()
    assert "on delete set null" in source.lower()
    assert "alter column target_user_id drop not null" in source.lower()
    assert "new.actor_user_id is distinct from old.actor_user_id" in source
    assert "new.target_user_id is distinct from old.target_user_id" in source
    assert "account security events are append-only" in source
