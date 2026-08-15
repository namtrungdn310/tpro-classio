from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.principal import Principal
from app.routers.staff import delete_staff_member_route, list_staff_members
from app.services.staff_service import StaffConflictError


@pytest.fixture
def admin_principal() -> Principal:
    return Principal(
        user_id="test-admin-id",
        email="admin@example.com",
        persistent_role="admin",
        effective_role="admin",
        is_owner=False,
        account_status="active",
        staff_id=None,
        aal="aal2",
        device_type="desktop",
        session_nonce="test-nonce",
    )


@pytest.fixture
def dev_principal() -> Principal:
    return Principal(
        user_id="test-dev-id",
        email="dev@example.com",
        persistent_role="admin",
        effective_role="dev",
        is_owner=True,
        account_status="active",
        staff_id=None,
        aal="aal2",
        device_type="desktop",
        session_nonce="test-nonce",
    )


@pytest.mark.asyncio
async def test_staff_list_includes_sensitive_fields_for_management(
    admin_principal: Principal,
) -> None:
    db = AsyncMock()
    with patch(
        "app.routers.staff.get_staff_members",
        new=AsyncMock(return_value=[]),
    ) as get_staff:
        await list_staff_members(
            staff_type=None,
            is_active=None,
            db=db,
            principal=admin_principal,
        )

    get_staff.assert_awaited_once_with(
        db,
        staff_type=None,
        is_active=None,
        include_sensitive=True,
    )


@pytest.mark.asyncio
async def test_archive_conflict_is_returned_as_http_409(
    dev_principal: Principal,
) -> None:
    with patch(
        "app.routers.staff.archive_staff_member",
        new=AsyncMock(side_effect=StaffConflictError("Còn lớp đang hoạt động")),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await delete_staff_member_route(
                id=uuid4(),
                db=AsyncMock(),
                principal=dev_principal,
            )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Còn lớp đang hoạt động"
