from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.student import Student
from app.schemas.student import StudentArchiveRequest, StudentRestoreRequest
from app.services.student_service import archive_student, restore_student


def test_student_restore_request_validation():
    now = datetime.now(timezone.utc)
    # Valid payload
    req = StudentRestoreRequest(
        reason="  Học viên đăng ký học lại  ",
        expected_updated_at=now,
    )
    assert req.reason == "Học viên đăng ký học lại"
    assert req.expected_updated_at == now

    # Reason under 3 characters after trim
    with pytest.raises(ValidationError):
        StudentRestoreRequest(
            reason="   ab   ",
            expected_updated_at=now,
        )

    # Empty / whitespace-only reason
    with pytest.raises(ValidationError):
        StudentRestoreRequest(
            reason="       ",
            expected_updated_at=now,
        )

    # Missing expected_updated_at
    with pytest.raises(ValidationError):
        StudentRestoreRequest(
            reason="Học viên đăng ký học lại",  # type: ignore[call-arg]
        )

    # Reason over 500 characters
    with pytest.raises(ValidationError):
        StudentRestoreRequest(
            reason="a" * 501,
            expected_updated_at=now,
        )


@pytest.mark.asyncio
async def test_restore_student_not_found():
    db = AsyncMock()
    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = None
    db.execute.return_value = exec_result

    res = await restore_student(
        db,
        uuid4(),
        StudentRestoreRequest(
            reason="Đăng ký học lại",
            expected_updated_at=datetime.now(timezone.utc),
        ),
    )
    assert res is None


@pytest.mark.asyncio
async def test_restore_student_rejects_non_archived():
    db = AsyncMock()
    student = Student(
        id=str(uuid4()),
        full_name="Nguyễn Văn A",
        status="active",
        updated_at=datetime(2026, 9, 3, 10, 0, tzinfo=timezone.utc),
    )
    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = student
    db.execute.return_value = exec_result

    with pytest.raises(HTTPException) as exc_info:
        await restore_student(
            db,
            uuid4(),
            StudentRestoreRequest(
                reason="Đăng ký học lại",
                expected_updated_at=student.updated_at,
            ),
        )

    assert exc_info.value.status_code == 409
    assert isinstance(exc_info.value.detail, dict)
    assert exc_info.value.detail["code"] == "STUDENT_NOT_STOPPED"


@pytest.mark.asyncio
async def test_restore_student_rejects_stale_updated_at():
    db = AsyncMock()
    student = Student(
        id=str(uuid4()),
        full_name="Nguyễn Văn A",
        status="archived",
        updated_at=datetime(2026, 9, 3, 11, 0, tzinfo=timezone.utc),
    )
    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = student
    db.execute.return_value = exec_result

    with pytest.raises(HTTPException) as exc_info:
        await restore_student(
            db,
            uuid4(),
            StudentRestoreRequest(
                reason="Đăng ký học lại",
                expected_updated_at=datetime(2026, 9, 3, 10, 0, tzinfo=timezone.utc),
            ),
        )

    assert exc_info.value.status_code == 409
    assert isinstance(exc_info.value.detail, dict)
    assert exc_info.value.detail["code"] == "STUDENT_CHANGED"


@pytest.mark.asyncio
async def test_restore_student_rejects_anomalous_active_enrollments():
    db = AsyncMock()
    student = Student(
        id=str(uuid4()),
        full_name="Nguyễn Văn A",
        status="archived",
        updated_at=datetime(2026, 9, 3, 10, 0, tzinfo=timezone.utc),
    )
    # First query returns student, second query returns active enrollment
    mock_student_result = MagicMock()
    mock_student_result.scalar_one_or_none.return_value = student

    mock_enrollment_result = MagicMock()
    mock_enrollment_result.scalars.return_value.all.return_value = [
        "dummy_active_enrollment"
    ]

    db.execute.side_effect = [mock_student_result, mock_enrollment_result]

    with pytest.raises(HTTPException) as exc_info:
        await restore_student(
            db,
            uuid4(),
            StudentRestoreRequest(
                reason="Đăng ký học lại",
                expected_updated_at=student.updated_at,
            ),
        )

    assert exc_info.value.status_code == 409
    assert isinstance(exc_info.value.detail, dict)
    assert exc_info.value.detail["code"] == "STUDENT_RESTORE_MEMBERSHIP_CONFLICT"


@pytest.mark.asyncio
async def test_restore_student_success():
    db = AsyncMock()
    student_id = str(uuid4())
    now = datetime(2026, 9, 3, 10, 0, tzinfo=timezone.utc)
    student = Student(
        id=student_id,
        student_code="TP-0000-0123-4",
        full_name="Nguyễn Văn A",
        status="archived",
        archived_at=now,
        archived_by="actor-123",
        archived_reason="Chuyển trường",
        updated_at=now,
    )

    mock_student_result = MagicMock()
    mock_student_result.scalar_one_or_none.return_value = student

    mock_enrollment_result = MagicMock()
    mock_enrollment_result.scalars.return_value.all.return_value = []

    db.execute.side_effect = [mock_student_result, mock_enrollment_result]

    with (
        patch(
            "app.services.student_service.get_student", new_callable=AsyncMock
        ) as mock_get_student,
        patch(
            "app.services.student_service.append_student_lifecycle_event"
        ) as mock_append_audit,
    ):
        mock_get_student.return_value = student

        res = await restore_student(
            db,
            uuid4(),
            StudentRestoreRequest(
                reason="Gia đình quay lại trung tâm",
                expected_updated_at=now,
            ),
            actor_user_id="actor-456",
        )

        assert res is not None
        assert student.status == "active"
        assert student.archived_at is None
        assert student.archived_by is None
        assert student.archived_reason is None
        assert student.student_code == "TP-0000-0123-4"

        # Verify audit lifecycle event recorded with reason
        mock_append_audit.assert_called_once_with(
            db,
            student_id=student.id,
            actor_user_id="actor-456",
            action="student_restored",
            previous_status="archived",
            next_status="active",
            reason="Gia đình quay lại trung tâm",
        )
        db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_archive_student_records_reason_in_lifecycle_event():
    db = AsyncMock()
    student_id = str(uuid4())
    now = datetime(2026, 9, 3, 10, 0, tzinfo=timezone.utc)
    student = Student(
        id=student_id,
        student_code="TP-0000-0123-4",
        full_name="Nguyễn Văn A",
        status="active",
        updated_at=now,
    )

    mock_student_result = MagicMock()
    mock_student_result.scalar_one_or_none.return_value = student

    mock_enrollment_result = MagicMock()
    mock_enrollment_result.scalars.return_value.unique.return_value.all.return_value = []

    db.execute.side_effect = [mock_student_result, mock_enrollment_result]

    with (
        patch(
            "app.services.student_service.get_student", new_callable=AsyncMock
        ) as mock_get_student,
        patch(
            "app.services.student_service.append_student_lifecycle_event"
        ) as mock_append_audit,
    ):
        mock_get_student.return_value = student

        await archive_student(
            db,
            uuid4(),
            StudentArchiveRequest(reason="Học viên bận lịch học thêm ở trường"),
            actor_user_id="actor-admin",
        )

        assert student.status == "archived"
        assert student.archived_reason == "Học viên bận lịch học thêm ở trường"
        mock_append_audit.assert_called_once_with(
            db,
            student_id=student.id,
            actor_user_id="actor-admin",
            action="student_archived",
            previous_status="active",
            next_status="archived",
            reason="Học viên bận lịch học thêm ở trường",
        )
        db.commit.assert_awaited_once()
