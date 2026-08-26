from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.core.principal import Principal
from app.routers.contact_suggestions import lookup_contact_suggestion_route
from app.schemas.contact_suggestion import ContactSuggestionLookup
from app.services.contact_suggestion_service import lookup_contact_suggestion


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("owner", "hidden_field", "phone", "zalo_name"),
    [
        ("student", ["student_contact"], "0912345678", None),
        ("parent", ["parent_contact"], None, "Mẹ An"),
    ],
)
async def test_contact_suggestion_excludes_hidden_source_data(
    owner: str,
    hidden_field: list[str],
    phone: str | None,
    zalo_name: str | None,
) -> None:
    result = Mock()
    result.all.return_value = [SimpleNamespace(phone="0912345678", zalo_name="Mẹ An")]
    db = SimpleNamespace(execute=AsyncMock(return_value=result))

    response = await lookup_contact_suggestion(
        db,
        ContactSuggestionLookup(
            owner=owner,
            phone=phone,
            zalo_name=zalo_name,
        ),
    )

    assert response is not None
    assert response.phone == "0912345678"
    assert response.zalo_name == "Mẹ An"
    statement = db.execute.await_args.args[0]
    compiled = statement.compile(dialect=postgresql.dialect())
    assert hidden_field in compiled.params.values()
    assert "hidden_fields" in str(compiled)
    assert "students.status" in str(compiled)
    assert "enrollments.status" in str(compiled)
    assert "classes.is_active" in str(compiled)


@pytest.mark.asyncio
async def test_contact_suggestion_rejects_ambiguous_or_unknown_lookup() -> None:
    with pytest.raises(ValueError):
        ContactSuggestionLookup(
            owner="parent",
            phone="0912345678",
            zalo_name="Mẹ An",
        )
    with pytest.raises(ValueError):
        ContactSuggestionLookup(
            owner="unknown",
            phone="0912345678",
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("phone", "zalo_name"),
    [("0912345678", None), (None, "Mẹ An")],
)
async def test_contact_suggestion_rejects_ambiguous_reused_values(
    phone: str | None,
    zalo_name: str | None,
) -> None:
    result = Mock()
    result.all.return_value = [
        SimpleNamespace(phone="0912345678", zalo_name="Mẹ An"),
        SimpleNamespace(phone="0987654321", zalo_name="Mẹ Bình"),
    ]
    db = SimpleNamespace(execute=AsyncMock(return_value=result))

    response = await lookup_contact_suggestion(
        db,
        ContactSuggestionLookup(
            owner="parent",
            phone=phone,
            zalo_name=zalo_name,
        ),
    )

    assert response is None


@pytest.mark.asyncio
async def test_staff_contact_suggestion_uses_retained_staff_profiles() -> None:
    result = Mock()
    result.all.return_value = [SimpleNamespace(phone="0912345678", zalo_name="Cô Hạnh")]
    db = SimpleNamespace(execute=AsyncMock(return_value=result))

    response = await lookup_contact_suggestion(
        db,
        ContactSuggestionLookup(owner="staff", phone="0912345678"),
    )

    assert response is not None
    assert response.zalo_name == "Cô Hạnh"
    statement = db.execute.await_args.args[0]
    compiled = statement.compile(dialect=postgresql.dialect())
    assert "staff_members.is_active" not in str(compiled)
    assert "students" not in str(compiled)


@pytest.mark.asyncio
async def test_contact_suggestion_route_denies_teacher() -> None:
    from app.core.dependencies import require_management

    teacher_principal = Principal(
        user_id="test-teacher-id",
        email="teacher@example.com",
        persistent_role="teacher",
        effective_role="teacher",
        is_owner=False,
        account_status="active",
        staff_id="test-staff-id",
        aal="aal2",
        device_type="desktop",
        session_nonce="test-nonce",
    )
    with pytest.raises(HTTPException) as exc_info:
        await require_management(teacher_principal)

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "principal",
    [
        Principal(
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
        ),
        Principal(
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
        ),
    ],
)
async def test_contact_suggestion_route_allows_management(
    principal: Principal,
) -> None:
    lookup = ContactSuggestionLookup(owner="student", phone="0912345678")
    result = Mock()
    result.all.return_value = [
        SimpleNamespace(phone="0912345678", zalo_name="Cô Hạnh"),
    ]
    db = SimpleNamespace(execute=AsyncMock(return_value=result))

    response = await lookup_contact_suggestion_route(lookup, db, principal)

    assert response is not None
    assert response.phone == "0912345678"
    db.execute.assert_awaited_once()
