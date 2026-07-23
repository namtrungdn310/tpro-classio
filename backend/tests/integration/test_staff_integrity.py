import os
from collections.abc import Mapping
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal


pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _assert_trigger_rejects(
    db: AsyncSession,
    statement: str,
    params: Mapping[str, str],
    *,
    match: str,
) -> None:
    savepoint = await db.begin_nested()
    try:
        with pytest.raises(DBAPIError, match=match):
            await db.execute(text(statement), dict(params))
    finally:
        if savepoint.is_active:
            await savepoint.rollback()


from app.core.database import engine


@pytest.mark.asyncio
async def test_staff_lifecycle_triggers_preserve_class_assignments() -> None:
    await engine.dispose()
    teacher_id = str(uuid4())
    assistant_id = str(uuid4())
    class_id = str(uuid4())

    async with AsyncSessionLocal() as db:
        transaction = await db.begin()
        try:
            teacher_phone = f"09{int(teacher_id[:8], 16) % 100000000:08d}"
            assistant_phone = f"08{int(assistant_id[:8], 16) % 100000000:08d}"
            teacher_zalo = f"CI Teacher {teacher_id[:8]}"
            assistant_zalo = f"CI Assistant {assistant_id[:8]}"

            await db.execute(
                text(
                    """
                    insert into public.staff_members
                      (id, full_name, staff_type, zalo_name, phone, is_active)
                    values
                      (cast(:teacher_id as uuid), 'CI Teacher', 'TEACHER',
                       :teacher_zalo, :teacher_phone, true),
                      (cast(:assistant_id as uuid), 'CI Assistant', 'ASSISTANT',
                       :assistant_zalo, :assistant_phone, true)
                    """
                ),
                {
                    "teacher_id": teacher_id,
                    "assistant_id": assistant_id,
                    "teacher_zalo": teacher_zalo,
                    "teacher_phone": teacher_phone,
                    "assistant_zalo": assistant_zalo,
                    "assistant_phone": assistant_phone,
                },
            )
            await db.execute(
                text(
                    """
                    insert into public.classes
                      (id, name, type, base_fee, billing_cycle_months,
                       teacher_id, is_active)
                    values
                      (cast(:class_id as uuid), :name, 'MONTHLY', 750000, 1,
                       cast(:teacher_id as uuid), true)
                    """
                ),
                {
                    "class_id": class_id,
                    "name": f"CI Staff {class_id[:8]}",
                    "teacher_id": teacher_id,
                },
            )
            await db.execute(
                text(
                    """
                    insert into public.class_teachers (class_id, teacher_id)
                    values (cast(:class_id as uuid), cast(:teacher_id as uuid))
                    """
                ),
                {"class_id": class_id, "teacher_id": teacher_id},
            )

            await _assert_trigger_rejects(
                db,
                """
                update public.staff_members
                set is_active = false
                where id = cast(:teacher_id as uuid)
                """,
                {"teacher_id": teacher_id},
                match="cannot be deactivated",
            )
            await _assert_trigger_rejects(
                db,
                """
                update public.staff_members
                set staff_type = 'ASSISTANT'
                where id = cast(:teacher_id as uuid)
                """,
                {"teacher_id": teacher_id},
                match="cannot change staff type",
            )
            await _assert_trigger_rejects(
                db,
                """
                insert into public.class_teachers (class_id, teacher_id)
                values (cast(:class_id as uuid), cast(:assistant_id as uuid))
                """,
                {"class_id": class_id, "assistant_id": assistant_id},
                match="must reference a teacher",
            )
            await _assert_trigger_rejects(
                db,
                """
                delete from public.staff_members
                where id = cast(:assistant_id as uuid)
                """,
                {"assistant_id": assistant_id},
                match="must be archived instead of deleted",
            )

            await db.execute(
                text(
                    """
                    update public.classes
                    set is_active = false,
                        teacher_id = null
                    where id = cast(:class_id as uuid)
                    """
                ),
                {"class_id": class_id},
            )
            await db.execute(
                text(
                    """
                    update public.staff_members
                    set is_active = false
                    where id = cast(:teacher_id as uuid)
                    """
                ),
                {"teacher_id": teacher_id},
            )

            await _assert_trigger_rejects(
                db,
                """
                update public.classes
                set is_active = true
                where id = cast(:class_id as uuid)
                """,
                {"class_id": class_id},
                match="invalid teacher assignment",
            )
            await _assert_trigger_rejects(
                db,
                """
                update public.staff_members
                set staff_type = 'ASSISTANT'
                where id = cast(:teacher_id as uuid)
                """,
                {"teacher_id": teacher_id},
                match="cannot change staff type",
            )
        finally:
            if transaction.is_active:
                await transaction.rollback()
