import pytest

from app.services.pay2s_service import Pay2SError, _authorization_result


def test_authorization_accepts_current_pay2s_access_token_shape() -> None:
    token, ttl = _authorization_result(
        {
            "success": True,
            "data": {
                "token_type": "Bearer",
                "access_token": " current-token ",
                "expires_in": 1800,
            },
        }
    )

    assert token == "current-token"
    assert ttl == 1800


def test_authorization_keeps_legacy_pay2s_token_shape_compatible() -> None:
    token, ttl = _authorization_result(
        {"success": True, "data": {"token": "legacy-token", "expires_in": 7200}}
    )

    assert token == "legacy-token"
    assert ttl == 3600


def test_authorization_rejects_response_without_a_bearer_token() -> None:
    with pytest.raises(Pay2SError, match="không trả về Bearer token"):
        _authorization_result({"success": True, "data": {"expires_in": 3600}})
