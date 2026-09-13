from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_me_and_internal_token_expose_workspace_identity() -> None:
    schema = (ROOT / "app/schemas/auth.py").read_text(encoding="utf-8")
    session = (ROOT / "app/routers/auth/session.py").read_text(encoding="utf-8")
    common = (ROOT / "app/routers/auth/common.py").read_text(encoding="utf-8")

    assert "class UserMe" in schema and "workspace_id: str" in schema
    assert "workspace_id=principal.workspace_id" in session
    assert '"workspace_id": str(profile.workspace_id)' in common
