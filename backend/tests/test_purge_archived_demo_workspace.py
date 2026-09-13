from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "purge_archived_demo_workspace.py"
)


def test_purge_script_has_all_destructive_guards() -> None:
    source = SCRIPT.read_text(encoding="utf-8")

    assert 'settings.app_environment == "production"' in source
    assert "DELETE_ARCHIVED_TEST_WORKSPACE" in source
    assert "args.workspace_id == args.current_workspace_id" in source
    assert "target.owner_user_id is not None" in source
    assert '"lưu trữ" not in target.name.casefold()' in source


def test_purge_is_atomic_and_does_not_touch_auth_users() -> None:
    source = SCRIPT.read_text(encoding="utf-8")

    assert "async with engine.begin()" in source
    assert "session_replication_role = replica" in source
    assert "delete from public.workspaces" in source
    assert "auth.users" not in source
