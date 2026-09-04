import pytest
from datetime import date, datetime, time, timezone
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock
from pydantic import ValidationError

from app.schemas.student import (
    StudentMembershipCommand,
    StudentEnrollmentTarget,
    StudentUpdate,
)
from app.models.class_ import Class
from app.models.class_schedule_slot import ClassScheduleSlot
from app.models.student import Student
from app.models.fee_record import FeeRecord
from app.services.membership_preview_service import (
    preview_student_membership,
    StudentMembershipPreviewRequest,
)
from fastapi import HTTPException


def test_student_membership_command_rejects_missing_fingerprint_on_contract_v2():
    target = StudentEnrollmentTarget(
        class_id=uuid4(),
        enrollment_date=date(2026, 9, 5),
    )
    # Missing fingerprint on v2 must raise ValidationError (422)
    with pytest.raises(ValidationError) as exc:
        StudentMembershipCommand(
            request_id=uuid4(),
            contract_version=2,
            expected_updated_at="2026-09-02T10:00:00Z",
            profile=StudentUpdate(),
            targets=[target],
            expected_preview_fingerprint=None,
        )
    assert "Yêu cầu thay đổi lớp bắt buộc phải có mã xác thực xem trước" in str(
        exc.value
    )


def test_student_membership_command_rejects_malformed_fingerprint():
    target = StudentEnrollmentTarget(
        class_id=uuid4(),
        enrollment_date=date(2026, 9, 5),
    )
    with pytest.raises(ValidationError) as exc:
        StudentMembershipCommand(
            request_id=uuid4(),
            contract_version=2,
            expected_updated_at="2026-09-02T10:00:00Z",
            profile=StudentUpdate(),
            targets=[target],
            expected_preview_fingerprint="not-a-64-char-hex",
        )
    assert "pattern" in str(exc.value).lower() or "expected_preview_fingerprint" in str(
        exc.value
    )


@pytest.mark.asyncio
async def test_preview_detects_mutual_target_schedule_conflict():
    db = AsyncMock()
    student_id = uuid4()
    now = datetime(2026, 9, 2, 10, 0, tzinfo=timezone.utc)
    student = Student(
        id=str(student_id),
        status="active",
        updated_at=now,
    )

    def mock_scalar(stmt):
        text_stmt = str(stmt)
        if "count(" in text_stmt.lower():
            return 1
        if "FROM students" in text_stmt:
            return student
        return None

    db.scalar.side_effect = mock_scalar

    class_1_id = str(uuid4())
    class_2_id = str(uuid4())

    class_1 = Class(
        id=class_1_id,
        name="Lớp 6A1",
        is_active=True,
        start_date=date(2026, 9, 1),
        stopped_on=None,
        type="MONTHLY",
        base_fee=1_000_000,
        identity_scheme="ACADEMIC_YEAR",
    )
    class_2 = Class(
        id=class_2_id,
        name="Lớp 6A2",
        is_active=True,
        start_date=date(2026, 9, 1),
        stopped_on=None,
        type="MONTHLY",
        base_fee=1_200_000,
        identity_scheme="ACADEMIC_YEAR",
    )

    slot_1_id = str(uuid4())
    slot_2_id = str(uuid4())

    slot_1 = ClassScheduleSlot(
        id=slot_1_id,
        class_id=class_1_id,
        weekday="Thứ 2",
        local_start=time(18, 0),
        local_end=time(19, 30),
        effective_from=date(2026, 9, 1),
        effective_until=None,
    )
    slot_2 = ClassScheduleSlot(
        id=slot_2_id,
        class_id=class_2_id,
        weekday="Thứ 2",
        local_start=time(18, 30),
        local_end=time(20, 0),  # Overlaps 18:30-19:30 with slot_1!
        effective_from=date(2026, 9, 1),
        effective_until=None,
    )

    async def mock_scalars(stmt):
        text_stmt = str(stmt)
        res = MagicMock()
        if "FROM classes" in text_stmt:
            res.all.return_value = [class_1, class_2]
        elif (
            f"class_schedule_slots.class_id = '{class_1_id}'" in text_stmt
            or f"class_id = '{class_1_id}'" in text_stmt
        ):
            res.all.return_value = [slot_1]
        elif (
            f"class_schedule_slots.class_id = '{class_2_id}'" in text_stmt
            or f"class_id = '{class_2_id}'" in text_stmt
        ):
            res.all.return_value = [slot_2]
        elif "FROM class_schedule_slots" in text_stmt:
            res.all.return_value = [slot_1, slot_2]
        else:
            res.all.return_value = []
        return res

    db.scalars.side_effect = mock_scalars
    db.execute.return_value = MagicMock(all=lambda: [])

    request = StudentMembershipPreviewRequest(
        expected_updated_at="2026-09-02T10:00:00Z",
        mode="supplement",
        targets=[
            StudentEnrollmentTarget(
                class_id=class_1_id,
                enrollment_date=date(2026, 9, 5),
                selected_slot_ids=[slot_1_id],
            ),
            StudentEnrollmentTarget(
                class_id=class_2_id,
                enrollment_date=date(2026, 9, 5),
                selected_slot_ids=[slot_2_id],
            ),
        ],
    )

    with pytest.raises(HTTPException) as exc_info:
        await preview_student_membership(db, student_id, request)

    assert exc_info.value.status_code == 409
    detail = exc_info.value.detail
    assert isinstance(detail, dict)
    assert detail.get("code") == "TARGET_SCHEDULE_CONFLICT"
    assert "Lớp 6A1 trùng lịch với lớp Lớp 6A2" in detail.get("message", "")


@pytest.mark.asyncio
async def test_preview_allows_adjacent_sessions_without_conflict():
    db = AsyncMock()
    student_id = uuid4()
    now = datetime(2026, 9, 2, 10, 0, tzinfo=timezone.utc)
    student = Student(
        id=str(student_id),
        status="active",
        updated_at=now,
    )

    def mock_scalar(stmt):
        text_stmt = str(stmt)
        if "count(" in text_stmt.lower():
            return 1
        if "FROM students" in text_stmt:
            return student
        return None

    db.scalar.side_effect = mock_scalar

    class_1_id = str(uuid4())
    class_2_id = str(uuid4())

    class_1 = Class(
        id=class_1_id,
        name="Lớp 6A1",
        is_active=True,
        start_date=date(2026, 9, 1),
        stopped_on=None,
        type="MONTHLY",
        base_fee=1_000_000,
        identity_scheme="ACADEMIC_YEAR",
    )
    class_2 = Class(
        id=class_2_id,
        name="Lớp 6A2",
        is_active=True,
        start_date=date(2026, 9, 1),
        stopped_on=None,
        type="MONTHLY",
        base_fee=1_200_000,
        identity_scheme="ACADEMIC_YEAR",
    )

    slot_1_id = str(uuid4())
    slot_2_id = str(uuid4())

    # Adjacent: 17:00-18:30 and 18:30-20:00 (end of slot 1 == start of slot 2)
    slot_1 = ClassScheduleSlot(
        id=slot_1_id,
        class_id=class_1_id,
        weekday="Thứ 2",
        local_start=time(17, 0),
        local_end=time(18, 30),
        effective_from=date(2026, 9, 1),
        effective_until=None,
    )
    slot_2 = ClassScheduleSlot(
        id=slot_2_id,
        class_id=class_2_id,
        weekday="Thứ 2",
        local_start=time(18, 30),
        local_end=time(20, 0),
        effective_from=date(2026, 9, 1),
        effective_until=None,
    )

    async def mock_scalars(stmt):
        text_stmt = str(stmt)
        res = MagicMock()
        if "FROM classes" in text_stmt:
            res.all.return_value = [class_1, class_2]
        else:
            try:
                params = stmt.compile().params
                if class_1_id in params.values():
                    res.all.return_value = [slot_1]
                elif class_2_id in params.values():
                    res.all.return_value = [slot_2]
                else:
                    res.all.return_value = [slot_1, slot_2]
            except Exception:
                res.all.return_value = [slot_1, slot_2]
        return res

    db.scalars.side_effect = mock_scalars
    db.execute.return_value = MagicMock(all=lambda: [])

    request = StudentMembershipPreviewRequest(
        expected_updated_at="2026-09-02T10:00:00Z",
        mode="supplement",
        targets=[
            StudentEnrollmentTarget(
                class_id=class_1_id,
                enrollment_date=date(2026, 9, 5),
                selected_slot_ids=[slot_1_id],
            ),
            StudentEnrollmentTarget(
                class_id=class_2_id,
                enrollment_date=date(2026, 9, 5),
                selected_slot_ids=[slot_2_id],
            ),
        ],
    )

    # Should NOT raise any TARGET_SCHEDULE_CONFLICT
    response = await preview_student_membership(db, student_id, request)
    assert response is not None
    assert len(response.preview_fingerprint) == 64


@pytest.mark.asyncio
async def test_preview_fingerprint_changes_with_source_fee_state():
    from app.models.enrollment import Enrollment

    student_id = uuid4()
    now = datetime(2026, 9, 2, 10, 0, tzinfo=timezone.utc)
    student = Student(id=str(student_id), status="active", updated_at=now)

    source_id = str(uuid4())
    source_class_id = str(uuid4())
    source_class = Class(
        id=source_class_id,
        name="Lớp 5A1",
        is_active=True,
        start_date=date(2026, 8, 1),
        type="MONTHLY",
        base_fee=800_000,
        identity_scheme="ACADEMIC_YEAR",
    )
    source_enrollment = Enrollment(
        id=source_id,
        student_id=str(student_id),
        class_id=source_class_id,
        status="active",
        enrollment_date=date(2026, 8, 1),
        billing_anchor_version=1,
    )
    source_enrollment.class_ = source_class

    target_class_id = str(uuid4())
    target_class = Class(
        id=target_class_id,
        name="Lớp 6A1",
        is_active=True,
        start_date=date(2026, 9, 1),
        type="MONTHLY",
        base_fee=1_000_000,
        identity_scheme="ACADEMIC_YEAR",
    )
    target_slot_id = str(uuid4())
    target_slot = ClassScheduleSlot(
        id=target_slot_id,
        class_id=target_class_id,
        weekday="Thứ 3",
        local_start=time(18, 0),
        local_end=time(19, 30),
        effective_from=date(2026, 9, 1),
    )

    fee_record_1 = FeeRecord(
        id=str(uuid4()),
        enrollment_id=source_id,
        status="UNPAID",
        final_amount=800_000,
        coverage_start=date(2026, 9, 1),
        coverage_end=date(2026, 9, 30),
        due_date=date(2026, 9, 10),
    )

    async def run_preview(fee_status="UNPAID", final_amount=800_000):
        fee_record_1.status = fee_status
        fee_record_1.final_amount = final_amount
        db = AsyncMock()

        def mock_scalar(stmt):
            text = str(stmt)
            if "count(" in text.lower():
                return 1
            if "FROM students" in text:
                return student
            if (
                "SELECT enrollments.id \nFROM" in text
                or "SELECT enrollments.id\nFROM" in text
            ):
                return None
            if "FROM enrollments" in text:
                return source_enrollment
            return None

        db.scalar.side_effect = mock_scalar

        async def mock_scalars(stmt):
            text = str(stmt)
            res = MagicMock()
            if "FROM classes" in text:
                res.all.return_value = [target_class]
            elif "FROM fee_records" in text:
                res.all.return_value = [fee_record_1]
            else:
                res.all.return_value = [target_slot]
            return res

        db.scalars.side_effect = mock_scalars
        db.execute.return_value = MagicMock(all=lambda: [])

        req = StudentMembershipPreviewRequest(
            expected_updated_at="2026-09-02T10:00:00Z",
            mode="transfer",
            source_enrollment_id=source_id,
            targets=[
                StudentEnrollmentTarget(
                    class_id=target_class_id,
                    enrollment_date=date(2026, 9, 5),
                    selected_slot_ids=[target_slot_id],
                )
            ],
        )
        return await preview_student_membership(db, student_id, req)

    res1 = await run_preview(fee_status="UNPAID", final_amount=800_000)
    res2 = await run_preview(fee_status="PAID", final_amount=800_000)
    res3 = await run_preview(fee_status="PAID", final_amount=900_000)

    assert res1 is not None and res2 is not None and res3 is not None
    assert res1.preview_fingerprint != res2.preview_fingerprint
    assert res2.preview_fingerprint != res3.preview_fingerprint
