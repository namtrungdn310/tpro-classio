from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from app.schemas.student import (
    StudentEnrollmentPatch,
    StudentMembershipCommand,
    StudentMembershipPreviewRequest,
    StudentUpdate,
)
from app.services.membership_preview_service import preview_student_membership


def _mock_student(updated_at: datetime | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid4()),
        full_name="Lê Hoàng",
        status="active",
        updated_at=updated_at or datetime.now(timezone.utc),
    )


def _mock_enrollment(
    class_id: str,
    enrollment_date: date,
    student_id: str,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid4()),
        student_id=student_id,
        class_id=class_id,
        status="active",
        ended_on=None,
        enrollment_date=enrollment_date,
        billing_anchor_version=1,
        custom_fee=None,
        class_=SimpleNamespace(
            id=class_id,
            name="Lớp Tiếng Anh 9",
            type="MONTHLY",
            base_fee=1_200_000,
            billing_cycle_months=1,
            billing_cycle_weeks=None,
            start_date=enrollment_date - timedelta(days=30),
            identity_scheme="ACADEMIC_YEAR",
            stopped_on=None,
        ),
        fee_records=[],
        billing_anchor_revisions=[],
    )


@pytest.mark.asyncio
async def test_preview_v3_fingerprints_enrollment_updates() -> None:
    now = datetime.now(timezone.utc)
    student = _mock_student(updated_at=now)
    class_id = str(uuid4())
    enr_date = date(2026, 7, 1)
    new_date = date(2026, 7, 15)
    enr = _mock_enrollment(class_id, enr_date, student.id)

    mock_db = MagicMock()
    # First query gets student, second gets enrollment
    mock_db.scalar = AsyncMock(side_effect=[student, enr, student, enr])
    mock_db.scalars = AsyncMock(return_value=MagicMock(all=MagicMock(return_value=[])))

    with patch(
        "app.services.membership_preview_service.ensure_enrollment_allowed", AsyncMock()
    ):
        req1 = StudentMembershipPreviewRequest(
            expected_updated_at=now,
            targets=[],
            enrollment_updates=[
                StudentEnrollmentPatch(
                    enrollment_id=UUID(enr.id),
                    enrollment_date=new_date,
                    decision_code="REANCHOR_NEXT_BOUNDARY",
                )
            ],
            contract_version=3,
        )
        res1 = await preview_student_membership(mock_db, UUID(student.id), req1)
        assert res1 is not None
        assert len(res1.enrollment_updates) == 1
        assert res1.enrollment_updates[0]["new_enrollment_date"] == new_date.isoformat()

        # Changing decision code must change fingerprint
        req2 = StudentMembershipPreviewRequest(
            expected_updated_at=now,
            targets=[],
            enrollment_updates=[
                StudentEnrollmentPatch(
                    enrollment_id=UUID(enr.id),
                    enrollment_date=new_date,
                    decision_code="KEEP_CURRENT_THEN_REANCHOR",
                )
            ],
            contract_version=3,
        )
        res2 = await preview_student_membership(mock_db, UUID(student.id), req2)
        assert res2 is not None
        assert res1.preview_fingerprint != res2.preview_fingerprint


def test_student_membership_command_v3_requires_fingerprint_on_date_change() -> None:
    now = datetime.now(timezone.utc)
    enr_id = uuid4()

    # In v3, when enrollment_updates changes enrollment_date, expected_preview_fingerprint is required
    with pytest.raises(ValueError, match="mã xác thực xem trước"):
        StudentMembershipCommand(
            request_id=uuid4(),
            contract_version=3,
            expected_preview_fingerprint=None,
            expected_updated_at=now,
            profile=StudentUpdate(),
            enrollment_updates=[
                StudentEnrollmentPatch(
                    enrollment_id=enr_id,
                    enrollment_date=date(2026, 8, 15),
                )
            ],
            targets=[],
        )
