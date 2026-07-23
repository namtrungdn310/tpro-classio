from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models.staff import StaffMember
from app.schemas.staff import StaffClassResponse, StaffUpdate
from app.services.staff_service import (
    StaffConflictError,
    _commit_staff_changes,
    _rows_to_responses,
    archive_staff_member,
    update_staff_member,
)


def make_staff(*, staff_type: str = "TEACHER", is_active: bool = True) -> StaffMember:
    return StaffMember(
        id=str(uuid4()),
        full_name="Cô Hạnh",
        staff_type=staff_type,
        zalo_name="Cô Hạnh",
        phone="0912345678",
        is_active=is_active,
    )


def make_assignment(*, is_active: bool = True) -> StaffClassResponse:
    return StaffClassResponse(id=uuid4(), name="6C1", is_active=is_active)


def test_staff_relationships_never_implicitly_load_business_graph() -> None:
    assert StaffMember.classes.property.lazy == "raise"
    assert StaffMember.class_links.property.lazy == "raise"
    assert StaffMember.teaching_classes.property.lazy == "raise"


def test_staff_projection_redacts_viewer_contact_details() -> None:
    staff_id = uuid4()
    rows = [
        {
            "id": staff_id,
            "full_name": "Cô Hạnh",
            "staff_type": "TEACHER",
            "zalo_name": "Cô Hạnh",
            "phone": "0912345678",
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "class_id": uuid4(),
            "class_name": "6C1",
            "class_is_active": True,
        }
    ]

    response = _rows_to_responses(rows, include_sensitive=False)[0]

    assert response.zalo_name is None
    assert response.phone is None
    assert [item.name for item in response.assigned_classes] == ["6C1"]


def test_staff_projection_includes_owner_contact_details() -> None:
    rows = [
        {
            "id": uuid4(),
            "full_name": "Cô Hạnh",
            "staff_type": "TEACHER",
            "zalo_name": "Cô Hạnh",
            "phone": "0912345678",
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "class_id": None,
            "class_name": None,
            "class_is_active": None,
        }
    ]

    response = _rows_to_responses(rows, include_sensitive=True)[0]

    assert response.zalo_name == "Cô Hạnh"
    assert response.phone == "0912345678"


@pytest.mark.asyncio
async def test_teacher_cannot_change_type_while_still_assigned() -> None:
    staff = make_staff()
    db = AsyncMock()
    with (
        patch(
            "app.services.staff_service.get_staff_member",
            new=AsyncMock(return_value=staff),
        ),
        patch(
            "app.services.staff_service._read_assigned_classes",
            new=AsyncMock(return_value=[make_assignment()]),
        ),
    ):
        with pytest.raises(StaffConflictError, match="vẫn được gắn với lớp"):
            await update_staff_member(
                db,
                uuid4(),
                StaffUpdate(staff_type="ASSISTANT"),
            )

    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_teacher_cannot_deactivate_while_assigned_to_active_class() -> None:
    staff = make_staff()
    db = AsyncMock()
    with (
        patch(
            "app.services.staff_service.get_staff_member",
            new=AsyncMock(return_value=staff),
        ),
        patch(
            "app.services.staff_service._read_assigned_classes",
            new=AsyncMock(return_value=[make_assignment()]),
        ),
    ):
        with pytest.raises(StaffConflictError, match="thay giáo viên"):
            await update_staff_member(
                db,
                uuid4(),
                StaffUpdate(is_active=False),
            )

    assert staff.is_active is True
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_staff_update_rejects_incomplete_contact_after_merging_patch() -> None:
    staff = make_staff()
    db = AsyncMock()
    with patch(
        "app.services.staff_service.get_staff_member",
        new=AsyncMock(return_value=staff),
    ):
        with pytest.raises(ValueError, match="tên Zalo nhân sự"):
            await update_staff_member(
                db,
                uuid4(),
                StaffUpdate(zalo_name=None),
            )

    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_archive_preserves_staff_row_when_no_active_assignment() -> None:
    staff = make_staff(staff_type="ASSISTANT")
    db = AsyncMock()
    with (
        patch(
            "app.services.staff_service.get_staff_member",
            new=AsyncMock(return_value=staff),
        ),
        patch("app.services.staff_service._clear_dependent_caches"),
    ):
        archived = await archive_staff_member(db, uuid4())

    assert archived is staff
    assert staff.is_active is False
    db.delete.assert_not_awaited()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_unknown_integrity_error_is_not_hidden_as_business_conflict() -> None:
    db = AsyncMock()
    error = IntegrityError("insert", {}, Exception("unexpected constraint"))
    db.commit.side_effect = error

    with pytest.raises(IntegrityError) as exc_info:
        await _commit_staff_changes(db)

    assert exc_info.value is error
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_known_lifecycle_db_error_is_mapped_to_conflict() -> None:
    db = AsyncMock()
    db.commit.side_effect = DBAPIError(
        "update",
        {},
        Exception("teacher assigned to an active class cannot be deactivated"),
        connection_invalidated=False,
    )

    with pytest.raises(StaffConflictError, match="thay giáo viên"):
        await _commit_staff_changes(db)

    db.rollback.assert_awaited_once()
