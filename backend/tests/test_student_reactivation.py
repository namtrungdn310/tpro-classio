from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.student import Student
from app.schemas.student import (
    StudentCreate,
    StudentCreateCommand,
    StudentDuplicateResolution,
    StudentIdentityCandidate,
    StudentReactivationRequest,
)
from app.services.student_reactivation_service import reactivate_student
from app.services.student_service import create_student

ROOT = Path(__file__).resolve().parents[1]


def make_create_payload(class_id: UUID) -> StudentCreate:
    return StudentCreate(
        full_name="Nguyễn Minh An",
        class_id=class_id,
        enrollment_date=date(2026, 7, 29),
        birth_date=date(2014, 6, 5),
        school="THCS Chu Văn An",
        parent_zalo="Mẹ An",
        parent_phone="0912345678",
    )


def make_candidate(
    student_id: UUID,
    class_id: UUID,
    *,
    updated_at: datetime,
) -> StudentIdentityCandidate:
    return StudentIdentityCandidate(
        id=student_id,
        student_code="TP000000018",
        status="inactive",
        list_state="UNASSIGNED",
        full_name="Nguyễn Minh An",
        birth_date=date(2014, 6, 5),
        school="THCS Chu Văn An",
        masked_parent_phone="******5678",
        masked_student_phone=None,
        previous_classes=[
            {
                "name": "6C1",
                "enrollment_date": date(2026, 6, 5),
            }
        ],
        updated_at=updated_at,
        match_strength="strong",
        match_reason="Trùng họ tên, ngày sinh và số điện thoại.",
        already_in_target_class=False,
    )


@pytest.mark.asyncio
async def test_create_student_stops_before_write_when_identity_matches() -> None:
    class_id = uuid4()
    candidate_id = uuid4()
    class_ = Class(
        id=str(class_id),
        name="6C1",
        type="MONTHLY",
        base_fee=Decimal("750000"),
        billing_cycle_months=1,
        is_active=True,
    )
    candidate = make_candidate(
        candidate_id,
        class_id,
        updated_at=datetime.now(timezone.utc),
    )
    db = SimpleNamespace(
        scalar=AsyncMock(return_value=class_),
        add=Mock(),
    )

    with (
        patch(
            "app.services.student_service.lock_student_identity",
            new=AsyncMock(),
        ),
        patch(
            "app.services.student_service.find_student_identity_candidates",
            new=AsyncMock(return_value=[candidate]),
        ),
    ):
        with pytest.raises(HTTPException) as raised:
            await create_student(db, make_create_payload(class_id))

    assert raised.value.status_code == 409
    assert raised.value.detail["code"] == "STUDENT_IDENTITY_CONFLICT"
    assert raised.value.headers == {"Cache-Control": "no-store"}
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_create_student_requires_current_candidate_acknowledgement() -> None:
    class_id = uuid4()
    current_candidate_id = uuid4()
    class_ = Class(
        id=str(class_id),
        name="6C1",
        type="MONTHLY",
        base_fee=Decimal("750000"),
        billing_cycle_months=1,
        is_active=True,
    )
    candidate = make_candidate(
        current_candidate_id,
        class_id,
        updated_at=datetime.now(timezone.utc),
    )
    data = StudentCreateCommand(
        **make_create_payload(class_id).model_dump(),
        duplicate_resolution=StudentDuplicateResolution(
            action="create_new",
            candidate_ids=[uuid4()],
        ),
    )
    db = SimpleNamespace(
        scalar=AsyncMock(return_value=class_),
        add=Mock(),
    )

    with (
        patch(
            "app.services.student_service.lock_student_identity",
            new=AsyncMock(),
        ),
        patch(
            "app.services.student_service.find_student_identity_candidates",
            new=AsyncMock(return_value=[candidate]),
        ),
    ):
        with pytest.raises(HTTPException) as raised:
            await create_student(db, data)

    assert raised.value.status_code == 409
    assert raised.value.detail["code"] == "STUDENT_IDENTITY_CONFLICT_CHANGED"
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_reactivate_student_updates_profile_and_audits_in_one_transaction() -> (
    None
):
    class_id = uuid4()
    student_id = uuid4()
    updated_at = datetime.now(timezone.utc)
    class_ = Class(
        id=str(class_id),
        name="6C1",
        type="MONTHLY",
        base_fee=Decimal("750000"),
        billing_cycle_months=1,
        is_active=True,
    )
    student = Student(
        id=str(student_id),
        full_name="Tên cũ",
        birth_date=date(2014, 6, 5),
        school="Trường cũ",
        parent_zalo="Mẹ An",
        parent_phone="0912345678",
        hidden_fields=[],
        status="inactive",
        updated_at=updated_at,
    )
    enrollment = Enrollment(
        id=str(uuid4()),
        student_id=str(student_id),
        class_id=str(class_id),
        enrollment_date=date(2026, 7, 29),
        status="active",
    )
    candidate = make_candidate(student_id, class_id, updated_at=updated_at)
    response = SimpleNamespace(id=str(student_id), full_name="Nguyễn Minh An")
    db = SimpleNamespace(
        scalar=AsyncMock(side_effect=[class_, student]),
        commit=AsyncMock(),
    )
    request = StudentReactivationRequest(
        student=make_create_payload(class_id),
        expected_updated_at=updated_at,
    )

    with (
        patch(
            "app.services.student_reactivation_service.lock_student_identity",
            new=AsyncMock(),
        ),
        patch(
            "app.services.student_reactivation_service.find_student_identity_candidates",
            new=AsyncMock(return_value=[candidate]),
        ),
        patch(
            "app.services.student_reactivation_service.enroll_locked_student",
            new=AsyncMock(return_value=enrollment),
        ) as enroll,
        patch(
            "app.services.student_reactivation_service.append_student_lifecycle_event",
        ) as append_audit,
        patch(
            "app.services.student_reactivation_service.get_student",
            new=AsyncMock(return_value=response),
        ),
        patch(
            "app.services.student_reactivation_service._clear_dependent_caches",
        ),
    ):
        restored = await reactivate_student(
            db,
            student_id,
            request,
            actor_user_id=str(uuid4()),
        )

    assert restored is response
    assert student.status == "active"
    assert student.full_name == "Nguyễn Minh An"
    enroll.assert_awaited_once()
    append_audit.assert_called_once()
    assert append_audit.call_args.kwargs["action"] == "student_reactivated"
    db.commit.assert_awaited_once()


def test_lifecycle_migration_is_private_indexed_and_append_only() -> None:
    migration = (
        (
            ROOT
            / "supabase"
            / "migrations"
            / "040_student_reactivation_and_lifecycle_audit.sql"
        )
        .read_text(encoding="utf-8")
        .lower()
    )

    assert "create table if not exists public.student_lifecycle_events" in migration
    assert "force row level security" in migration
    assert "from public, anon, authenticated" in migration
    assert "before update or delete" in migration
    assert "before truncate" in migration
    assert "idx_students_identity_parent_phone" in migration
    assert "idx_students_identity_student_phone" in migration
