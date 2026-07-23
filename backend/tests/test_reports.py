from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from app.core.dependencies import get_current_user
from app.routers.reports import router
from app.services.report_service import _decode_cursor, _encode_cursor


def test_report_routes_are_read_only_and_available_to_authenticated_users() -> None:
    routes = [route for route in router.routes if isinstance(route, APIRoute)]

    assert routes
    assert all(route.methods == {"GET"} for route in routes)
    assert all(
        get_current_user
        in {dependency.call for dependency in route.dependant.dependencies}
        for route in routes
    )


def test_fee_operation_cursor_round_trip_is_opaque_and_stable() -> None:
    occurred_at = datetime(2026, 7, 23, 8, 15, tzinfo=timezone.utc)
    operation = SimpleNamespace(occurred_at=occurred_at, sequence_no=42)

    cursor = _encode_cursor(operation)

    assert "2026-07-23" not in cursor
    assert _decode_cursor(cursor) == (occurred_at, 42)


@pytest.mark.parametrize("cursor", ["!", "e30", "eyJhdCI6ImJhZCJ9"])
def test_fee_operation_cursor_rejects_malformed_input(cursor: str) -> None:
    with pytest.raises(HTTPException) as exc_info:
        _decode_cursor(cursor)

    assert exc_info.value.status_code == 422
