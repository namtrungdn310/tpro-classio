from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy.dialects import postgresql

from app.services.student_service import lookup_contact_suggestion


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
        owner=owner,
        phone=phone,
        zalo_name=zalo_name,
    )

    assert response is not None
    assert response.phone == "0912345678"
    assert response.zalo_name == "Mẹ An"
    statement = db.execute.await_args.args[0]
    compiled = statement.compile(dialect=postgresql.dialect())
    assert hidden_field in compiled.params.values()
    assert "hidden_fields" in str(compiled)


@pytest.mark.asyncio
async def test_contact_suggestion_rejects_ambiguous_or_unknown_lookup() -> None:
    db = SimpleNamespace(execute=AsyncMock())

    assert (
        await lookup_contact_suggestion(
            db,
            owner="parent",
            phone="0912345678",
            zalo_name="Mẹ An",
        )
        is None
    )
    assert (
        await lookup_contact_suggestion(
            db,
            owner="unknown",
            phone="0912345678",
        )
        is None
    )
    db.execute.assert_not_awaited()


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
        owner="parent",
        phone=phone,
        zalo_name=zalo_name,
    )

    assert response is None
