"""Audited one-off collection deadlines; never move the recurring anchor."""

from datetime import datetime, timezone
from dataclasses import replace
import hmac
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fee_record import FeeRecord
from app.models.start_date_change_command import StartDateChangeCommandRecord
from app.schemas.billing_schedule_change import (
    FeeDueDateApplyRequest,
    FeeDueDatePreviewRequest,
)
from app.services.admission_date_service import admission_conflict
from app.services.billing_schedule_change_service import digest, load_billing_context
from app.services.independent_dates_guard import require_date_contract


async def prepare_fee_due_date(
    db: AsyncSession, fee_id: UUID, data: FeeDueDatePreviewRequest, *, lock=False
):
    enrollment_id = await db.scalar(
        select(FeeRecord.enrollment_id).where(FeeRecord.id == str(fee_id))
    )
    if enrollment_id is None:
        raise HTTPException(404, detail="Không tìm thấy khoản học phí")
    enrollment, records, snapshots = await load_billing_context(
        db, UUID(enrollment_id), lock=lock
    )
    record = next(record for record in records if str(record.id) == str(fee_id))
    snapshot = next(snapshot for snapshot in snapshots if snapshot.id == str(fee_id))
    if (
        record.status != "UNPAID"
        or record.paid_date is not None
        or int(record.paid_amount or 0)
        or int(record.refunded_amount or 0)
        or snapshot.has_settlement
    ):
        raise admission_conflict(
            "FEE_DEADLINE_NOT_EDITABLE",
            "Chỉ điều chỉnh hạn của khoản chưa có giao dịch tiền",
        )
    current_due = record.adjusted_due_date or record.due_date
    if current_due is None:
        raise admission_conflict(
            "FEE_DEADLINE_UNKNOWN", "Cần kiểm tra hạn thu hiện tại trước"
        )
    from app.core.business_time import business_today

    result = {
        "fee_record_id": str(record.id),
        "previous_due_date": current_due.isoformat(),
        "next_due_date": data.due_date.isoformat(),
        "amount": int(record.final_amount),
        "coverage_start": str(record.coverage_start) if record.coverage_start else None,
        "coverage_end": str(record.coverage_end) if record.coverage_end else None,
        "schedule_unchanged": True,
        "already_notified": snapshot.notified,
        "becomes_overdue": data.due_date < business_today(),
    }
    result["preview_fingerprint"] = digest(
        {
            "impact": result,
            "request": data.model_dump(mode="json", include={"due_date", "reason"}),
            "financial_versions": [
                (snapshot.id, snapshot.financial_version) for snapshot in snapshots
            ],
            "business_date": business_today(),
        }
    )
    return enrollment, record, result


async def preview_fee_due_date(
    db: AsyncSession, fee_id: UUID, data: FeeDueDatePreviewRequest
):
    _, _, result = await prepare_fee_due_date(db, fee_id, data)
    return result


async def apply_fee_due_date(
    db: AsyncSession, fee_id: UUID, data: FeeDueDateApplyRequest, *, actor_user_id: str
):
    require_date_contract(4, has_date_edit=False)
    reason = " ".join(data.reason.replace("\x00", "").split())
    if len(reason) < 3:
        raise HTTPException(422, detail="Vui lòng nhập lý do điều chỉnh")
    payload_hash = digest(
        {"fee_id": str(fee_id), "request": data.model_dump(mode="json")}
    )
    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"billing-command:{data.request_id}"},
    )
    previous = await db.scalar(
        select(StartDateChangeCommandRecord).where(
            StartDateChangeCommandRecord.request_id == str(data.request_id)
        )
    )
    if previous is not None:
        if (
            previous.payload_hash != payload_hash
            or previous.operation_kind != "FEE_DUE_DATE_CHANGE"
        ):
            raise admission_conflict(
                "IDEMPOTENCY_PAYLOAD_MISMATCH", "Mã yêu cầu đã dùng cho nội dung khác"
            )
        if previous.state != "COMPLETED":
            raise admission_conflict(
                "BILLING_COMMAND_IN_PROGRESS",
                "Yêu cầu đang được xử lý; vui lòng thử lại",
            )
        return previous.execution_plan
    enrollment, record, result = await prepare_fee_due_date(db, fee_id, data, lock=True)
    if not hmac.compare_digest(
        data.expected_preview_fingerprint, result["preview_fingerprint"]
    ):
        raise admission_conflict(
            "STALE_BILLING_PREVIEW", "Khoản thu vừa thay đổi. Vui lòng xem lại."
        )
    old_due = record.adjusted_due_date or record.due_date
    from app.services.fee_operation_service import (
        append_fee_operation,
        snapshot_fee_record,
    )

    before = replace(snapshot_fee_record(record), due_date=old_due)
    from app.services.payment_scaffold_service import (
        revoke_open_payment_requests_for_fee_records,
    )

    await revoke_open_payment_requests_for_fee_records(
        db,
        [str(record.id)],
        actor_id=actor_user_id,
        reason="Hạn thu đã thay đổi; cần tạo yêu cầu thanh toán mới",
    )
    record.collection_due_offset_days = (
        int(record.collection_due_offset_days or 0) + (data.due_date - old_due).days
    )
    record.adjusted_due_date = data.due_date
    await append_fee_operation(
        db,
        action="due_date_change",
        before=[before],
        after=[replace(snapshot_fee_record(record), due_date=data.due_date)],
        actor_id=actor_user_id,
        request_id=data.request_id,
        reason=reason,
    )
    db.add(
        StartDateChangeCommandRecord(
            request_id=str(data.request_id),
            subject_type="STUDENT",
            operation_kind="FEE_DUE_DATE_CHANGE",
            student_id=enrollment.student_id,
            class_id=enrollment.class_id,
            old_date=old_due,
            new_date=data.due_date,
            reason=reason,
            payload_hash=payload_hash,
            preview_fingerprint=result["preview_fingerprint"],
            execution_plan=result,
            state="COMPLETED",
            completed_at=datetime.now(timezone.utc),
            item_count=0,
            actor_user_id=actor_user_id,
        )
    )
    await db.commit()
    from app.services.enrollment_service import _clear_dependent_caches

    _clear_dependent_caches()
    return result
