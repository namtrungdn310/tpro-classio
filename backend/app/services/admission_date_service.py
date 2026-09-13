"""Academic-only date changes. Never call fee reconciliation from this service.

Callers own the class -> student -> enrollment locks and transaction. Legacy
memberships without a proven billing baseline fail closed rather than rebasing
their tuition on the new academic date.
"""

from datetime import date, datetime, timezone
from hashlib import sha256
import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing_anchor_revision import BillingAnchorRevision
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.student import Student
from app.models.start_date_change_command import (
    StartDateChangeCommandItem,
    StartDateChangeCommandRecord,
)


def admission_conflict(code: str, message: str, **context: object) -> HTTPException:
    return HTTPException(409, detail={"code": code, "message": message, **context})


async def validate_admission_date_change(
    db: AsyncSession,
    enrollment: Enrollment,
    *,
    next_date: date,
    expected_version: int | None,
) -> None:
    if expected_version is None or expected_version != int(
        enrollment.admission_version or 0
    ):
        raise admission_conflict(
            "ADMISSION_CHANGED", "Ngày ghi danh vừa thay đổi. Vui lòng tải lại."
        )
    if enrollment.status != "active" or enrollment.enrollment_date is None:
        raise admission_conflict(
            "MEMBERSHIP_NOT_EDITABLE",
            "Không thể sửa ngày ghi danh của lượt học đã kết thúc",
        )
    if enrollment.ended_on is not None and next_date >= enrollment.ended_on:
        raise admission_conflict(
            "ADMISSION_AFTER_MEMBERSHIP_END", "Ngày ghi danh phải trước ngày rời lớp"
        )
    if next_date == enrollment.enrollment_date:
        return
    revision = (
        await db.get(BillingAnchorRevision, enrollment.current_billing_revision_id)
        if enrollment.current_billing_revision_id
        else None
    )
    if revision is None or revision.enrollment_id != enrollment.id:
        raise admission_conflict(
            "BILLING_BASELINE_REQUIRED",
            "Cần kiểm tra lịch thu cũ trước khi tách ngày ghi danh; chưa có khoản nào bị thay đổi.",
        )
    if next_date > enrollment.enrollment_date:
        # Payment before admission is legitimate. It is the billed service
        # interval, not paid_at/due_date, that can contradict the new boundary.
        conflicting_fee = await db.scalar(
            select(FeeRecord.id)
            .where(
                FeeRecord.enrollment_id == enrollment.id,
                FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
                FeeRecord.coverage_end > enrollment.enrollment_date,
                FeeRecord.coverage_end <= next_date,
            )
            .order_by(FeeRecord.coverage_end, FeeRecord.id)
            .limit(1)
        )
        if conflicting_fee is not None:
            raise admission_conflict(
                "ADMISSION_BILLING_REVIEW_REQUIRED",
                "Ngày ghi danh mới nằm sau một kỳ đã tính học phí. Vui lòng đối chiếu khoản thu trước; lịch thu chưa thay đổi.",
                fee_record_id=str(conflicting_fee),
            )
    from app.models.enrollment_suspension import EnrollmentSuspension
    from app.models.makeup import ClassScheduleAdjustment
    from sqlalchemy import union_all

    lo, hi = sorted((next_date, enrollment.enrollment_date))
    pause = await db.scalar(
        union_all(
            select(EnrollmentSuspension.id).where(
                EnrollmentSuspension.enrollment_id == enrollment.id,
                EnrollmentSuspension.status == "ACTIVE",
                EnrollmentSuspension.suspended_from < hi,
                EnrollmentSuspension.resume_on > lo,
            ),
            select(ClassScheduleAdjustment.id).where(
                ClassScheduleAdjustment.class_id == enrollment.class_id,
                ClassScheduleAdjustment.status == "OPEN",
                ClassScheduleAdjustment.adjustment_kind != "OCCURRENCE",
                ClassScheduleAdjustment.affected_from < hi,
                ClassScheduleAdjustment.affected_through >= lo,
            ),
        ).limit(1)
    )
    if pause is not None:
        raise admission_conflict(
            "ADMISSION_SUSPENSION_REVIEW_REQUIRED",
            "Ngày ghi danh mới cắt qua khoảng nghỉ đã bảo lưu. Hãy đối chiếu hoặc hủy lần hoãn nhập nhầm trước; sửa ngày ghi danh không tự thay đổi học phí.",
        )


async def change_admission_date(
    db: AsyncSession,
    enrollment: Enrollment,
    *,
    next_date: date,
    expected_version: int,
    request_id: UUID,
    reason: str,
    actor_user_id: str | None,
    parent_command: StartDateChangeCommandRecord | None = None,
) -> None:
    """Apply one academic edit and append its audit, without touching finance."""
    reason = " ".join(reason.replace("\x00", "").split())
    if not 3 <= len(reason) <= 500:
        raise HTTPException(422, detail="Lý do phải có từ 3 đến 500 ký tự")
    payload_hash = sha256(
        json.dumps(
            {
                "enrollment_id": str(enrollment.id),
                "next_date": next_date.isoformat(),
                "expected_version": expected_version,
                "reason": reason,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    existing = (
        await db.scalar(
            select(StartDateChangeCommandRecord).where(
                StartDateChangeCommandRecord.request_id == str(request_id),
            )
        )
        if parent_command is None
        else None
    )
    if existing is not None:
        if (
            existing.payload_hash != payload_hash
            or existing.operation_kind != "ADMISSION_DATE_CHANGE"
        ):
            raise admission_conflict(
                "IDEMPOTENCY_PAYLOAD_MISMATCH",
                "Mã yêu cầu đã được dùng cho nội dung khác",
            )
        if existing.state != "COMPLETED":
            raise admission_conflict(
                "ADMISSION_COMMAND_IN_PROGRESS",
                "Yêu cầu đang được xử lý; vui lòng thử lại",
            )
        return
    await validate_admission_date_change(
        db, enrollment, next_date=next_date, expected_version=expected_version
    )
    previous = enrollment.enrollment_date
    if next_date == previous:
        return
    now = datetime.now(timezone.utc)
    command = parent_command or StartDateChangeCommandRecord(
        workspace_id=enrollment.workspace_id,
        request_id=str(request_id),
        subject_type="STUDENT",
        operation_kind="ADMISSION_DATE_CHANGE",
        student_id=enrollment.student_id,
        class_id=enrollment.class_id,
        old_date=previous,
        new_date=next_date,
        payload_hash=payload_hash,
        state="PENDING",
        item_count=1,
        reason=reason,
        actor_user_id=actor_user_id,
    )
    if parent_command is None:
        db.add(command)
        await db.flush()
    db.add(
        StartDateChangeCommandItem(
            workspace_id=enrollment.workspace_id,
            command_id=command.id,
            enrollment_id=enrollment.id,
            old_enrollment_date=previous,
            new_enrollment_date=next_date,
            decision_code="ACADEMIC_ONLY",
            previous_billing_revision_id=enrollment.current_billing_revision_id,
            next_billing_revision_id=enrollment.current_billing_revision_id,
            first_anchor_cycle_no=None,
            protected_fee_count=0,
            superseded_fee_count=0,
            skipped_cycle_count=0,
        )
    )
    enrollment.enrollment_date = next_date
    enrollment.admission_version = int(enrollment.admission_version or 0) + 1
    await db.execute(
        update(Student)
        .where(Student.id == enrollment.student_id)
        .values(updated_at=now)
    )
    if parent_command is None:
        command.state = "COMPLETED"
        command.completed_at = now
    await db.flush()
