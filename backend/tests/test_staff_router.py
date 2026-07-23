from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routers.staff import delete_staff_member_route, list_staff_members
from app.services.staff_service import StaffConflictError


@pytest.mark.asyncio
async def test_staff_list_redacts_sensitive_fields_for_viewer() -> None:
    db = AsyncMock()
    with patch(
        "app.routers.staff.get_staff_members",
        new=AsyncMock(return_value=[]),
    ) as get_staff:
        await list_staff_members(
            staff_type=None,
            is_active=None,
            db=db,
            current_user={"role": "viewer", "is_owner": False},
        )

    get_staff.assert_awaited_once_with(
        db,
        staff_type=None,
        is_active=None,
        include_sensitive=False,
    )


@pytest.mark.asyncio
async def test_staff_list_includes_sensitive_fields_for_admin() -> None:
    db = AsyncMock()
    with patch(
        "app.routers.staff.get_staff_members",
        new=AsyncMock(return_value=[]),
    ) as get_staff:
        await list_staff_members(
            staff_type=None,
            is_active=None,
            db=db,
            current_user={"role": "admin", "is_owner": False},
        )

    assert get_staff.await_args.kwargs["include_sensitive"] is True


@pytest.mark.asyncio
async def test_archive_conflict_is_returned_as_http_409() -> None:
    with patch(
        "app.routers.staff.archive_staff_member",
        new=AsyncMock(side_effect=StaffConflictError("Còn lớp đang hoạt động")),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await delete_staff_member_route(
                id=uuid4(),
                db=AsyncMock(),
                _current_user={"is_owner": True},
            )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Còn lớp đang hoạt động"
