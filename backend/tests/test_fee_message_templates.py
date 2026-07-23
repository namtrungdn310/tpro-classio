from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from pydantic import ValidationError

from app.core.dependencies import require_admin
from app.core.fee_messages import (
    DEFAULT_FEE_RECEIPT_TEMPLATE,
    DEFAULT_FEE_REMINDER_TEMPLATE,
)
from app.models.fee_message_template import FeeMessageTemplate
from app.routers.fees import router as fees_router
from app.schemas.fee import FeeMessageTemplatesResponse, FeeMessageTemplatesUpdate
from app.services.fee_template_service import (
    get_fee_message_templates,
    update_fee_message_templates,
)


def test_fee_message_template_endpoints_are_admin_only() -> None:
    routes = [
        route
        for route in fees_router.routes
        if isinstance(route, APIRoute) and route.path == "/message-templates"
    ]

    assert {method for route in routes for method in route.methods} == {"GET", "PUT"}
    assert all(
        require_admin
        in {dependency.call for dependency in route.dependant.dependencies}
        for route in routes
    )


def test_fee_message_template_update_normalizes_complete_templates() -> None:
    payload = FeeMessageTemplatesUpdate(
        payment_reminder_template=f"  {DEFAULT_FEE_REMINDER_TEMPLATE}\r\n",
        payment_received_template=DEFAULT_FEE_RECEIPT_TEMPLATE,
        version=3,
    )

    assert payload.payment_reminder_template == DEFAULT_FEE_REMINDER_TEMPLATE
    assert payload.version == 3


@pytest.mark.parametrize(
    ("field", "value"),
    [
        (
            "payment_reminder_template",
            "Thiếu tổng {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}}",
        ),
        (
            "payment_received_template",
            "Sai {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} "
            "{{tong_tien}} {{nhac_qua_han}}",
        ),
        (
            "payment_received_template",
            "Sai {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} "
            "{{tong_tien}} {{bien_la}}",
        ),
        (
            "payment_received_template",
            "Sai {{{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} {{tong_tien}}",
        ),
    ],
)
def test_fee_message_template_update_rejects_missing_or_unknown_tokens(
    field: str,
    value: str,
) -> None:
    data = {
        "payment_reminder_template": DEFAULT_FEE_REMINDER_TEMPLATE,
        "payment_received_template": DEFAULT_FEE_RECEIPT_TEMPLATE,
        "version": 1,
    }
    data[field] = value

    with pytest.raises(ValidationError):
        FeeMessageTemplatesUpdate(**data)


def test_fee_message_template_response_accepts_versioned_singleton_shape() -> None:
    response = FeeMessageTemplatesResponse(
        payment_reminder_template=DEFAULT_FEE_REMINDER_TEMPLATE,
        payment_received_template=DEFAULT_FEE_RECEIPT_TEMPLATE,
        version=2,
        updated_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
    )

    assert response.version == 2


def test_fee_message_template_version_is_bounded_to_postgresql_integer() -> None:
    with pytest.raises(ValidationError):
        FeeMessageTemplatesUpdate(
            payment_reminder_template=DEFAULT_FEE_REMINDER_TEMPLATE,
            payment_received_template=DEFAULT_FEE_RECEIPT_TEMPLATE,
            version=2_147_483_647,
        )


@pytest.mark.asyncio
async def test_fee_message_template_update_commits_incremented_version() -> None:
    actor_id = str(uuid4())
    reminder_template = (
        "Mời phụ huynh {{ten_hoc_vien}} đóng {{tong_tien}} cho {{ky_hoc_phi}}:\n"
        "{{chi_tiet_hoc_phi}}\nHạn {{ngay_den_han}}"
    )
    receipt_template = (
        "Đã nhận {{tong_tien}} của {{ten_hoc_vien}} cho {{ky_hoc_phi}}:\n"
        "{{chi_tiet_hoc_phi}}\nHạn {{ngay_den_han}}"
    )
    updated = FeeMessageTemplate(
        id=1,
        payment_reminder_template=reminder_template,
        payment_received_template=receipt_template,
        version=4,
        updated_by=actor_id,
        updated_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
    )
    result = Mock()
    result.scalar_one_or_none.return_value = updated
    db = SimpleNamespace(
        get=AsyncMock(return_value=updated),
        execute=AsyncMock(return_value=result),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )
    payload = FeeMessageTemplatesUpdate(
        payment_reminder_template=reminder_template,
        payment_received_template=receipt_template,
        version=3,
    )

    with patch(
        "app.services.fee_template_service.append_fee_operation",
        new=AsyncMock(),
    ):
        response = await update_fee_message_templates(db, payload, actor_id=actor_id)

    assert response.version == 4
    assert response.payment_reminder_template == reminder_template
    assert response.payment_received_template == receipt_template
    db.execute.assert_awaited_once()
    db.commit.assert_awaited_once()
    db.rollback.assert_not_awaited()


@pytest.mark.asyncio
async def test_fee_message_template_read_upgrades_legacy_row_without_changing_version() -> (
    None
):
    legacy = FeeMessageTemplate(
        id=1,
        payment_reminder_template=(
            "Nhắc {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} "
            "{{tong_tien}} {{nhac_qua_han}}"
        ),
        payment_received_template=(
            "Đã nhận {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} {{tong_tien}}"
        ),
        version=7,
        updated_by=None,
        updated_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
    )
    db = SimpleNamespace(get=AsyncMock(return_value=legacy))

    response = await get_fee_message_templates(db)

    assert response.version == 7
    assert "{{nhac_qua_han}}" not in response.payment_reminder_template
    assert "{{ngay_den_han}}" in response.payment_reminder_template
    assert "{{ngay_den_han}}" in response.payment_received_template


@pytest.mark.asyncio
async def test_fee_message_template_initial_insert_commits_version_one() -> None:
    created = FeeMessageTemplate(
        id=1,
        payment_reminder_template=DEFAULT_FEE_REMINDER_TEMPLATE,
        payment_received_template=DEFAULT_FEE_RECEIPT_TEMPLATE,
        version=1,
        updated_by=None,
        updated_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
    )
    result = Mock()
    result.scalar_one_or_none.return_value = created
    db = SimpleNamespace(
        get=AsyncMock(return_value=None),
        execute=AsyncMock(return_value=result),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )
    payload = FeeMessageTemplatesUpdate(
        payment_reminder_template=DEFAULT_FEE_REMINDER_TEMPLATE,
        payment_received_template=DEFAULT_FEE_RECEIPT_TEMPLATE,
        version=0,
    )

    with patch(
        "app.services.fee_template_service.append_fee_operation",
        new=AsyncMock(),
    ):
        response = await update_fee_message_templates(db, payload, actor_id=None)

    assert response.version == 1
    db.commit.assert_awaited_once()
    db.rollback.assert_not_awaited()


@pytest.mark.asyncio
async def test_fee_message_template_stale_update_rolls_back_with_conflict() -> None:
    result = Mock()
    result.scalar_one_or_none.return_value = None
    db = SimpleNamespace(
        get=AsyncMock(return_value=None),
        execute=AsyncMock(return_value=result),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )
    payload = FeeMessageTemplatesUpdate(
        payment_reminder_template=DEFAULT_FEE_REMINDER_TEMPLATE,
        payment_received_template=DEFAULT_FEE_RECEIPT_TEMPLATE,
        version=2,
    )

    with pytest.raises(HTTPException) as exc_info:
        await update_fee_message_templates(db, payload, actor_id=str(uuid4()))

    assert exc_info.value.status_code == 409
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()
