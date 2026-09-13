import pytest
from pydantic import ValidationError

from app.schemas.banking import Pay2SBankConnectRequest, Pay2SBankOtpRequest
from app.services.banking_service import (
    _bank_account_from_remote,
    _matches_remote_bank,
    _sync_remote_pay2s_banks,
)
from app.services.pay2s_catalog import resolve_pay2s_payment_bank


def test_openapi_requires_the_fields_pay2s_documents() -> None:
    with pytest.raises(ValidationError, match="tên chủ tài khoản và số điện thoại"):
        Pay2SBankConnectRequest(
            bank_type="openapi",
            bank_short_name="ACB",
            account_number="19354957",
        )

    payload = Pay2SBankConnectRequest(
        bank_type="openapi",
        bank_short_name="ACB",
        account_number="19354957",
        account_name="NGUYEN VAN A",
        acc_mobile="0902506099",
    )
    assert payload.bank_short_name == "ACB"


def test_bidv_openapi_requires_merchant_identity_fields() -> None:
    with pytest.raises(ValidationError, match="BIDV OpenAPI"):
        Pay2SBankConnectRequest(
            bank_type="openapi",
            bank_short_name="BIDV",
            account_number="8810281999",
            account_name="NGUYEN VAN A",
            acc_mobile="0708077478",
        )


def test_personal_connection_and_otp_keep_credentials_for_pay2s() -> None:
    payload = Pay2SBankConnectRequest(
        bank_type="personal",
        bank_short_name="VCB",
        account_number="0123456789",
        internet_banking_username="bank-user",
        internet_banking_password="bank-password",
    )
    assert payload.internet_banking_password is not None

    with pytest.raises(ValidationError, match="Xác nhận Internet Banking"):
        Pay2SBankOtpRequest(
            bank_type="personal",
            bank_short_name="VCB",
            account_number="0123456789",
            otp="123456",
        )


def test_remote_bank_without_short_name_uses_selected_catalog_fallback() -> None:
    account = _bank_account_from_remote(
        {
            "id": 410,
            "name": "NGUYEN VAN A",
            "accountNumber": "19354957",
            "bankName": "Asia Commercial Bank",
            "statusText": "Đang hoạt động",
        },
        label="Tài khoản học phí",
        actor_id=None,
        fallback_bank_code="ACB",
        fallback_bank_name="Ngân hàng TMCP Á Châu",
    )

    assert account is not None
    assert account.bank_code == "ACB"
    assert account.account_name == "NGUYEN VAN A"
    assert account.provider_bank_id == "410"


def test_remote_bank_match_accepts_documented_response_without_short_name() -> None:
    remote = {"id": 410, "accountNumber": "19354957", "bankName": "ACB"}

    assert _matches_remote_bank(remote, account_number="19354957", bank_code="ACB")
    assert not _matches_remote_bank(remote, account_number="00000000", bank_code="ACB")


def test_live_vcb_bank_name_resolves_without_short_bank_name() -> None:
    bank = resolve_pay2s_payment_bank(None, "Ngân hàng Ngoại Thương VN (VietcomBank)")

    assert bank is not None
    assert bank.code == "VCB"


def test_remote_bank_metadata_excludes_login_and_balance() -> None:
    account = _bank_account_from_remote(
        {
            "id": 1,
            "name": "NGUYEN VAN A",
            "username": "0900000000",
            "balance": 123456,
            "accountNumber": "0123456789",
            "bankName": "Ngân hàng Ngoại Thương VN (VietcomBank)",
            "status": 1,
            "statusText": "Đang hoạt động",
        },
        label=None,
        actor_id=None,
        fallback_bank_code="VCB",
        fallback_bank_name="Ngân hàng TMCP Ngoại thương Việt Nam",
    )

    assert account is not None
    assert "username" not in account.provider_metadata
    assert "balance" not in account.provider_metadata


class _SyncDb:
    def __init__(self) -> None:
        self.account = None
        self.add_count = 0
        self.flush_count = 0

    async def scalar(self, _query):
        return self.account

    def add(self, account) -> None:
        self.account = account
        self.add_count += 1

    async def flush(self) -> None:
        self.flush_count += 1


@pytest.mark.asyncio
async def test_existing_pay2s_bank_sync_is_idempotent() -> None:
    db = _SyncDb()
    remote = {
        "id": 1,
        "name": "CHAU THANH NAM TRUNG",
        "accountNumber": "1329602195",
        "bankName": "Ngân hàng Ngoại Thương VN (VietcomBank)",
        "status": 1,
        "statusText": "Đang hoạt động",
        "vaNumber": None,
    }

    assert await _sync_remote_pay2s_banks(db, [remote], actor_id="actor") == 1
    assert await _sync_remote_pay2s_banks(db, [remote], actor_id="actor") == 1
    assert db.add_count == 1
    assert db.account.bank_code == "VCB"
    assert db.account.provider_bank_id == "1"
