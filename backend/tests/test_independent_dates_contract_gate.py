import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services.independent_dates_guard import require_date_contract


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("version", [1, 2, 3, 4])
@pytest.mark.parametrize("has_edit", [False, True])
def test_rollout_gate_explicitly_covers_old_and_new_clients(
    monkeypatch, enabled, version, has_edit
):
    monkeypatch.setattr(settings, "independent_billing_dates_enabled", enabled)
    expected = (
        "INDEPENDENT_DATES_NOT_ENABLED"
        if version == 4 and not enabled
        else "DATE_CONTRACT_UPGRADE_REQUIRED"
        if version != 4 and has_edit and enabled
        else None
    )
    if expected:
        with pytest.raises(HTTPException) as caught:
            require_date_contract(version, has_date_edit=has_edit)
        assert caught.value.status_code == 409
        assert caught.value.detail["code"] == expected
    else:
        require_date_contract(version, has_date_edit=has_edit)
