import pytest
from fastapi import HTTPException

from app.services.payment_reconciliation_service import assert_recordable_transaction


def test_received_successful_transaction_can_be_reconciled() -> None:
    assert_recordable_transaction({"transfer_type": "IN", "result_code": "0"})


@pytest.mark.parametrize(
    ("snapshot", "message"),
    [
        ({"transfer_type": "OUT", "result_code": "0"}, "tiền ra"),
        ({"transfer_type": "IN", "result_code": "14"}, "chưa xác nhận"),
    ],
)
def test_unsafe_provider_transaction_cannot_be_reconciled(
    snapshot: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(HTTPException, match=message) as error:
        assert_recordable_transaction(snapshot)

    assert error.value.status_code == 409
