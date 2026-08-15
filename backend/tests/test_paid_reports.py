from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.core.dependencies import require_management
from app.routers.reports import router
from app.schemas.report import (
    FeePaidAllocationResponse,
    FeePaidReceiptDetailResponse,
    FeePaidReceiptListResponse,
    FeePaidReceiptSummaryResponse,
    FeePaidReportSummaryResponse,
    FeePaidTimelineEntryResponse,
)
from app.services.paid_report_service import (
    _decode_paid_cursor,
    _decode_receipt_id,
    _encode_paid_cursor,
    _encode_receipt_id,
    _receipt_source,
    _refund_state,
)


def test_paid_report_routes_are_read_only_and_require_current_user() -> None:
    routes = [
        route
        for route in router.routes
        if isinstance(route, APIRoute) and route.path.startswith("/fees/paid")
    ]

    assert {route.path for route in routes} == {
        "/fees/paid",
        "/fees/paid/{receipt_id}",
    }
    assert all(route.methods == {"GET"} for route in routes)
    assert all(
        require_management
        in {dependency.call for dependency in route.dependant.dependencies}
        for route in routes
    )


def test_paid_report_contract_does_not_expose_notification_data() -> None:
    models = (
        FeePaidReceiptSummaryResponse,
        FeePaidReportSummaryResponse,
        FeePaidReceiptListResponse,
        FeePaidAllocationResponse,
        FeePaidTimelineEntryResponse,
        FeePaidReceiptDetailResponse,
    )
    forbidden = {"notification", "notified", "message", "channel"}

    for model in models:
        field_names = {field.casefold() for field in model.model_fields}
        assert not any(
            fragment in field_name
            for fragment in forbidden
            for field_name in field_names
        )


def test_paid_receipt_identifier_is_signed_and_round_trips() -> None:
    operation_id = str(uuid4())
    student_key = str(uuid4())

    receipt_id = _encode_receipt_id(operation_id, student_key)

    assert operation_id not in receipt_id
    assert _decode_receipt_id(receipt_id) == (operation_id, student_key)
    payload, signature = receipt_id.split(".", 1)
    tampered_signature = ("A" if signature[0] != "A" else "B") + signature[1:]
    with pytest.raises(HTTPException) as exc_info:
        _decode_receipt_id(f"{payload}.{tampered_signature}")
    assert exc_info.value.status_code == 422


def test_paid_report_cursor_is_signed_stable_and_rejects_tampering() -> None:
    paid_at = datetime(2026, 7, 30, 8, 45, tzinfo=timezone.utc)
    student_key = str(uuid4())

    cursor = _encode_paid_cursor(paid_at, 91, student_key)

    assert "2026-07-30" not in cursor
    assert _decode_paid_cursor(cursor) == (paid_at, 91, student_key)
    with pytest.raises(HTTPException) as exc_info:
        _decode_paid_cursor(f"{cursor}broken")
    assert exc_info.value.status_code == 422


@pytest.mark.parametrize(
    ("reversed_all", "gross", "refunded", "expected"),
    [
        (False, 750_000, 0, "NONE"),
        (False, 750_000, 250_000, "PARTIAL"),
        (False, 750_000, 750_000, "FULL"),
        (True, 0, 0, "REVERSED"),
    ],
)
def test_paid_report_refund_state_invariants(
    reversed_all: bool,
    gross: int,
    refunded: int,
    expected: str,
) -> None:
    assert (
        _refund_state(
            reversed_all=reversed_all,
            gross_amount=gross,
            refunded_amount=refunded,
        )
        == expected
    )


def test_paid_receipt_projection_uses_append_only_ledger_relationships() -> None:
    sql = str(
        select(_receipt_source()).compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    ).casefold()

    assert "fee_operations.action = 'payment'" in sql
    assert "payments_1.entry_type = 'payment'" in sql
    assert "payment_reversal" in sql
    assert "refund_reversal" in sql
    assert "related_payment_id" in sql
    assert "notified_at" not in sql
    assert "notification_message" not in sql
