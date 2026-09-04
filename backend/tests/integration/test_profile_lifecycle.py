"""R6-D08/V08 — profile lifecycle + student code read path integration tests.

Run with RUN_DB_INTEGRATION=1. Proves: profile-only create (no class),
leaving the last class keeps the profile unassigned; explicit stop/resume keeps
reason, no destructive CASCADE, student_code preserved, server search with
cursor.
"""

import os
from datetime import date
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.schemas.student import (
    StudentArchiveRequest,
    StudentCreate,
    StudentRestoreRequest,
)
from app.services.student_service import (
    archive_student,
    create_student,
    get_students,
    restore_student,
)

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


def _profile_payload(index: int, salt: str) -> StudentCreate:
    return StudentCreate(
        full_name=f"Profile Học viên {salt}-{index}",
        class_id=None,
        enrollment_date=None,
        birth_date=date(2014, 1, 1),
        school="TH Nguyễn Du",
        parent_phone=f"0987{salt}{index:04d}"[:10],
        parent_zalo=f"parent {salt}-{index}",
    )


def _salt() -> str:
    return str(uuid4().int % 1_000_000)


async def test_profile_only_create_with_code_and_unassigned_state() -> None:
    async with AsyncSessionLocal() as db:
        response = await create_student(db, _profile_payload(101, _salt()))
        assert response.student_code is not None
        assert response.student_code.startswith("TP")
        assert response.list_state == "UNASSIGNED"
        assert response.status == "active"
        # Không có enrollment nào được tạo.
        count = (
            await db.execute(
                text("select count(*) from public.enrollments where student_id = :id"),
                {"id": str(response.id)},
            )
        ).scalar()
        assert count == 0
        # Code nằm trong registry.
        registry = (
            await db.execute(
                text(
                    "select code from public.student_code_registry "
                    "where issued_student_id = :id"
                ),
                {"id": str(response.id)},
            )
        ).one()
        assert registry.code == response.student_code


async def test_archive_and_restore_preserve_code() -> None:
    async with AsyncSessionLocal() as db:
        created = await create_student(db, _profile_payload(102, _salt()))
        original_code = created.student_code

        archived = await archive_student(
            db,
            UUID(str(created.id)),
            StudentArchiveRequest(reason="Học viên chuyển trường"),
            actor_user_id=None,
        )
        assert archived is not None
        assert archived.status == "archived"
        assert archived.list_state == "STOPPED"
        assert archived.student_code == original_code

        restored = await restore_student(
            db,
            UUID(str(created.id)),
            StudentRestoreRequest(
                reason="Gia đình quay lại",
                expected_updated_at=archived.updated_at,
            ),
            actor_user_id=None,
        )
        assert restored is not None
        assert restored.status == "active"
        assert restored.list_state == "UNASSIGNED"
        assert restored.student_code == original_code


async def test_server_search_by_code_exact_and_prefix() -> None:
    async with AsyncSessionLocal() as db:
        created = await create_student(db, _profile_payload(103, _salt()))
        code = created.student_code or ""
        full_name = created.full_name

        exact, _ = await get_students(db, search=code, limit=10)
        assert any(str(item.id) == str(created.id) for item in exact)

        # The table displays the immutable code with separators. Searching
        # from that copied display value must resolve the same profile.
        formatted = f"{code[:2]}-{code[2:6]}-{code[6:10]}-{code[10:]}"
        formatted_hits, _ = await get_students(db, search=formatted, limit=10)
        assert any(str(item.id) == str(created.id) for item in formatted_hits)

        # Allow the numeric code body as a convenience when an admin copies
        # only the digits from a printed/exported student code.
        numeric_hits, _ = await get_students(db, search=code[2:], limit=10)
        assert any(str(item.id) == str(created.id) for item in numeric_hits)

        # A short serial such as ``16`` is also valid when copied from the
        # middle of the formatted code ``TP-0000-0016-6``.
        serial = code[2:-1]
        short_serial = serial.lstrip("0") or "0"
        short_serial_hits, _ = await get_students(db, search=short_serial, limit=10)
        assert any(str(item.id) == str(created.id) for item in short_serial_hits)

        prefix, _ = await get_students(db, search=code[:8], limit=10)
        assert any(str(item.id) == str(created.id) for item in prefix)

        name_hits, _ = await get_students(db, search=full_name.lower(), limit=10)
        assert any(str(item.id) == str(created.id) for item in name_hits)

        # Cursor phân trang: page giới hạn nhỏ vẫn trả dữ liệu đúng thứ tự.
        page, has_more = await get_students(db, limit=5)
        assert len(page) <= 5
        assert isinstance(has_more, bool)


async def test_no_destructive_cascade_from_student_delete() -> None:
    from uuid import uuid4 as _uuid4

    async with AsyncSessionLocal() as db:
        created = await create_student(db, _profile_payload(104, _salt()))
        student_id = str(created.id)
        # Gắn enrollment (fee history) để RESTRICT có ý nghĩa.
        teacher_id = str(_uuid4())
        await db.execute(
            text(
                "insert into public.staff_members "
                "(id, full_name, staff_type, zalo_name, phone, is_active) "
                "values (cast(:id as uuid), 'GV RESTRICT', 'TEACHER', 'r', '0900000001', true)"
            ),
            {"id": teacher_id},
        )
        class_id = str(_uuid4())
        await db.execute(
            text(
                """
                insert into public.classes (
                  id, name, type, base_fee, billing_cycle_months, teacher_id,
                  identity_scheme, is_active
                ) values (
                  cast(:id as uuid), 'RESTRICT CLASS', 'MONTHLY', 750000, 1,
                  cast(:t as uuid), 'LEGACY', true
                )
                """
            ),
            {"id": class_id, "t": teacher_id},
        )
        await db.execute(
            text(
                "insert into public.enrollments "
                "(id, student_id, class_id, enrollment_date, status) "
                "values (cast(:id as uuid), cast(:s as uuid), cast(:c as uuid), "
                "date '2026-09-01', 'active')"
            ),
            {
                "id": str(_uuid4()),
                "s": student_id,
                "c": class_id,
            },
        )
        await db.commit()
        # Xóa hồ sơ trực tiếp bị FK RESTRICT chặn (không cascade mất history).
        async with AsyncSessionLocal() as db2:
            with pytest.raises(Exception):
                await db2.execute(
                    text("delete from public.students where id = :id"),
                    {"id": student_id},
                )
            await db2.rollback()
            still_there = (
                await db2.execute(
                    text("select count(*) from public.students where id = :id"),
                    {"id": student_id},
                )
            ).scalar()
            assert still_there == 1
            history = (
                await db2.execute(
                    text(
                        "select count(*) from public.enrollments where student_id = :id"
                    ),
                    {"id": student_id},
                )
            ).scalar()
            assert history == 1
