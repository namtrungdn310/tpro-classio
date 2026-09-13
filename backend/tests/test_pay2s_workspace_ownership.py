from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.banking import Pay2SConnectionUpsert


ROOT = Path(__file__).resolve().parents[2]


def test_pay2s_connection_requires_workspace_credentials() -> None:
    with pytest.raises(ValidationError):
        Pay2SConnectionUpsert()


def test_shared_connection_mode_is_not_an_api_field() -> None:
    with pytest.raises(ValidationError):
        Pay2SConnectionUpsert.model_validate(
            {
                "connection_mode": "central",
                "access_key": "a" * 16,
                "secret_key": "s" * 16,
                "collection_partner_code": "workspace-partner",
            }
        )


def test_dev_pay2s_testing_keeps_the_original_owner_workspace() -> None:
    migration = (
        ROOT / "backend/supabase/migrations/100_dev_workspace_ownership.sql"
    ).read_text(encoding="utf-8")

    assert "`dev` is an effective application role" in migration
    assert "where p.role = 'dev'" not in migration
    assert "group by owner_user_id" in migration
    assert "having count(*) > 1" in migration
    assert "one_account_per_workspace" in migration
