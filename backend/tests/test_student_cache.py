"""R6-D08 — student search server-side, indexed, cursor-paginated.

The process-local cache was removed (multi-worker stale data); every read goes
to the database with SQL-side filters and keyset pagination.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.services import student_service


class ScalarResult:
    def __init__(self, values: list) -> None:
        self._values = values

    def scalars(self):
        return self

    def unique(self):
        return self

    def all(self) -> list:
        return self._values


@pytest.mark.asyncio
async def test_get_students_always_queries_database() -> None:
    """Không còn cache process-local: mọi lần đọc đều chạy SQL."""
    student = SimpleNamespace(
        id=str(uuid4()),
        student_code="TP000000018",
        full_name="Nguyễn Văn An",
        birth_date=None,
        school=None,
        parent_name=None,
        parent_phone=None,
        parent_zalo=None,
        student_zalo=None,
        student_phone=None,
        notes=None,
        hidden_fields=[],
        status="active",
        archived_at=None,
        archived_reason=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        enrollments=[],
    )
    db = AsyncMock()
    db.execute.return_value = ScalarResult([student])
    db.get.return_value = None

    students, has_more = await student_service.get_students(
        db,
        search="TP000000018",
        limit=10,
    )

    assert has_more is False
    assert len(students) == 1
    assert students[0].student_code == "TP000000018"
    assert students[0].list_state == "UNASSIGNED"
    db.execute.assert_awaited()
    # Không có module-level cache nào để kiểm tra.
    assert not hasattr(student_service, "_students_cache")


@pytest.mark.asyncio
async def test_class_roster_orders_by_student_code_sequence() -> None:
    db = AsyncMock()
    db.execute.return_value = ScalarResult([])

    await student_service.get_students(db, class_id=uuid4(), limit=10)

    statement = db.execute.await_args.args[0]
    sql = str(statement)
    assert "ORDER BY students.student_code ASC NULLS LAST, students.id ASC" in sql
    assert "students.created_at DESC" not in sql


@pytest.mark.asyncio
async def test_non_class_student_scopes_keep_recent_profile_order() -> None:
    db = AsyncMock()
    db.execute.return_value = ScalarResult([])

    await student_service.get_students(db, limit=10)

    statement = db.execute.await_args.args[0]
    sql = str(statement)
    assert "ORDER BY students.created_at DESC, students.id ASC" in sql
