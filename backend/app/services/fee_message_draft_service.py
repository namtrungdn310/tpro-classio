import hashlib
import json
from datetime import date
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.fee_messages import (
    DEFAULT_FEE_RECEIPT_TEMPLATE,
    DEFAULT_FEE_REMINDER_TEMPLATE,
    normalize_fee_notification_message,
)
from app.core.workspace import get_workspace_id
from app.models.fee_message_draft import FeeMessageDraft
from app.models.fee_message_template import FeeMessageTemplate
from app.models.fee_record import FeeRecord
from app.schemas.fee import FeeMessageDraftResponse
from app.services.fee_service import _get_fee_records_by_ids


def _format_currency(value: int) -> str:
    return f"{value:,.0f}đ".replace(",", ".")


def _format_date(value: date | None) -> str:
    return value.strftime("%d/%m/%Y") if value else "chưa xác định"


def _period_label(period: str) -> str:
    year, month = period.split("-", 1)
    return f"tháng {int(month)}/{year}"


def _record_student_id(record: FeeRecord) -> str:
    return record.enrollment.student_id


def _validate_group(records: list[FeeRecord], *, kind: str) -> tuple[str, str]:
    if not records:
        raise HTTPException(status_code=404, detail="Không tìm thấy khoản học phí")
    students = {_record_student_id(record) for record in records}
    periods = {record.period for record in records}
    if len(students) != 1 or len(periods) != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tin nhắn Zalo chỉ áp dụng cho một học viên trong cùng một kỳ.",
        )
    expected_status = "UNPAID" if kind == "reminder" else "PAID"
    if any(record.status != expected_status for record in records):
        label = "chưa nộp" if kind == "reminder" else "đã nộp"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tin nhắn này chỉ dùng cho các khoản học phí {label} còn hiệu lực.",
        )
    return next(iter(students)), next(iter(periods))


async def _active_templates(db: AsyncSession) -> tuple[str, str, int]:
    workspace_id = get_workspace_id()
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Không xác định được workspace")
    row = await db.scalar(
        select(FeeMessageTemplate).where(
            FeeMessageTemplate.workspace_id == workspace_id
        )
    )
    if row is None:
        return DEFAULT_FEE_REMINDER_TEMPLATE, DEFAULT_FEE_RECEIPT_TEMPLATE, 0
    return row.payment_reminder_template, row.payment_received_template, row.version


def _source_payload(records: list[FeeRecord], kind: str, template_hash: str) -> dict:
    ordered = sorted(
        records,
        key=lambda record: (
            record.class_name_snapshot or record.enrollment.class_.name,
            record.id,
        ),
    )
    return {
        "kind": kind,
        "workspace_id": get_workspace_id(),
        "template_hash": template_hash,
        "student_id": _record_student_id(ordered[0]),
        "student_name": ordered[0].student_name_snapshot
        or ordered[0].enrollment.student.full_name,
        "period": ordered[0].period,
        "records": [
            {
                "id": record.id,
                "class": record.class_name_snapshot or record.enrollment.class_.name,
                "amount": int(record.final_amount),
                "due": (record.adjusted_due_date or record.due_date).isoformat()
                if (record.adjusted_due_date or record.due_date)
                else None,
                "status": record.status,
                "refunded": int(record.refunded_amount),
            }
            for record in ordered
        ],
    }


def _digest(payload: object) -> str:
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _render(template: str, records: list[FeeRecord]) -> str:
    ordered = sorted(
        records,
        key=lambda record: (
            record.class_name_snapshot or record.enrollment.class_.name,
            record.id,
        ),
    )
    student_name = (
        ordered[0].student_name_snapshot or ordered[0].enrollment.student.full_name
    )
    details = "\n".join(
        f"{record.class_name_snapshot or record.enrollment.class_.name}: {_format_currency(int(record.final_amount))}"
        for record in ordered
    )
    due_dates = [record.adjusted_due_date or record.due_date for record in ordered]
    due_date = max((item for item in due_dates if item is not None), default=None)
    replacements = {
        "{{ten_hoc_vien}}": student_name,
        "{{ky_hoc_phi}}": _period_label(ordered[0].period),
        "{{chi_tiet_hoc_phi}}": details,
        "{{ngay_den_han}}": _format_date(due_date),
        "{{tong_tien}}": _format_currency(
            sum(int(record.final_amount) for record in ordered)
        ),
    }
    for token, value in replacements.items():
        template = template.replace(token, value)
    return template


async def get_fee_message_draft(
    db: AsyncSession, ids: list[UUID], *, kind: str
) -> FeeMessageDraftResponse:
    ordered_ids = list(dict.fromkeys(str(value) for value in ids))
    records = await _get_fee_records_by_ids(db, ordered_ids)
    if len(records) != len(ordered_ids):
        raise HTTPException(
            status_code=404, detail="Không tìm thấy một hoặc nhiều khoản học phí"
        )
    student_id, period = _validate_group(records, kind=kind)
    reminder, received, _ = await _active_templates(db)
    template = reminder if kind == "reminder" else received
    template_hash = _digest(template)
    fingerprint = _digest(_source_payload(records, kind, template_hash))
    workspace_id = get_workspace_id()
    draft = await db.scalar(
        select(FeeMessageDraft).where(
            FeeMessageDraft.workspace_id == workspace_id,
            FeeMessageDraft.student_id == student_id,
            FeeMessageDraft.period == period,
            FeeMessageDraft.kind == kind,
        )
    )
    return FeeMessageDraftResponse(
        student_id=student_id,
        period=period,
        kind=kind,
        message=draft.message if draft else _render(template, records),
        source_fingerprint=fingerprint,
        revision=draft.revision if draft else 1,
        is_customized=draft is not None,
        is_stale=draft is not None and draft.source_fingerprint != fingerprint,
    )


async def save_fee_message_draft(
    db: AsyncSession,
    ids: list[UUID],
    *,
    kind: str,
    message: str,
    expected_revision: int,
    source_fingerprint: str,
    actor_id: str | None,
) -> FeeMessageDraftResponse:
    current = await get_fee_message_draft(db, ids, kind=kind)
    if current.source_fingerprint != source_fingerprint:
        raise HTTPException(
            status_code=409,
            detail="Dữ liệu học phí đã thay đổi. Vui lòng tải lại nội dung trước khi lưu.",
        )
    canonical = normalize_fee_notification_message(message)
    workspace_id = get_workspace_id()
    reminder, received, _ = await _active_templates(db)
    template_hash = _digest(reminder if kind == "reminder" else received)
    values = {
        "message": canonical,
        "source_fingerprint": source_fingerprint,
        "template_hash": template_hash,
        "updated_by": actor_id,
        "updated_at": func.now(),
    }
    if not current.is_customized:
        if expected_revision not in {0, 1}:
            raise HTTPException(
                status_code=409, detail="Bản nháp đã thay đổi. Vui lòng tải lại."
            )
        statement = (
            insert(FeeMessageDraft)
            .values(
                workspace_id=workspace_id,
                student_id=str(current.student_id),
                period=current.period,
                kind=kind,
                revision=1,
                created_by=actor_id,
                **values,
            )
            .on_conflict_do_nothing(constraint="fee_message_drafts_group_unique")
            .returning(FeeMessageDraft)
        )
    else:
        statement = (
            update(FeeMessageDraft)
            .where(
                FeeMessageDraft.workspace_id == workspace_id,
                FeeMessageDraft.student_id == str(current.student_id),
                FeeMessageDraft.period == current.period,
                FeeMessageDraft.kind == kind,
                FeeMessageDraft.revision == expected_revision,
            )
            .values(revision=FeeMessageDraft.revision + 1, **values)
            .returning(FeeMessageDraft)
        )
    saved = (await db.execute(statement)).scalar_one_or_none()
    if saved is None:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Bản nháp đã thay đổi. Vui lòng tải lại."
        )
    await db.commit()
    return FeeMessageDraftResponse(
        student_id=saved.student_id,
        period=saved.period,
        kind=saved.kind,
        message=saved.message,
        source_fingerprint=saved.source_fingerprint,
        revision=saved.revision,
        is_customized=True,
        is_stale=False,
    )


async def resolve_fee_message_draft(
    db: AsyncSession,
    ids: list[UUID],
    *,
    kind: str,
    revision: int,
    source_fingerprint: str,
) -> str:
    current = await get_fee_message_draft(db, ids, kind=kind)
    if current.revision != revision or current.source_fingerprint != source_fingerprint:
        raise HTTPException(
            status_code=409,
            detail="Nội dung hoặc dữ liệu học phí đã thay đổi. Vui lòng mở lại tin nhắn.",
        )
    return current.message
