from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.services.student_service import (
    _students_cache,
    clear_students_cache,
    get_students,
)


@pytest.mark.asyncio
async def test_class_list_reuses_fresh_active_student_superset() -> None:
    selected_class_id = uuid4()
    selected_student = SimpleNamespace(
        id="student-selected",
        classes=[SimpleNamespace(id=selected_class_id)],
    )
    other_student = SimpleNamespace(
        id="student-other",
        classes=[SimpleNamespace(id=uuid4())],
    )
    clear_students_cache()
    _students_cache[(None, None, "active")] = (
        datetime.now(timezone.utc),
        [selected_student, other_student],
    )
    db = AsyncMock()

    try:
        result = await get_students(
            db,
            class_id=selected_class_id,
            status="active",
        )
    finally:
        clear_students_cache()

    assert result == [selected_student]
    db.execute.assert_not_awaited()
