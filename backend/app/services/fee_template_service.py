from fastapi import HTTPException, status
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.fee_messages import (
    DEFAULT_FEE_RECEIPT_TEMPLATE,
    DEFAULT_FEE_REMINDER_TEMPLATE,
    upgrade_legacy_fee_message_template,
)
from app.models.fee_message_template import FeeMessageTemplate
from app.schemas.fee import FeeMessageTemplatesResponse, FeeMessageTemplatesUpdate
from app.services.fee_operation_service import (
    FeeRecordAuditSnapshot,
    append_fee_operation,
)


async def get_fee_message_templates(
    db: AsyncSession,
) -> FeeMessageTemplatesResponse:
    template = await db.get(FeeMessageTemplate, 1)
    if template is None:
        return FeeMessageTemplatesResponse(
            payment_reminder_template=DEFAULT_FEE_REMINDER_TEMPLATE,
            payment_received_template=DEFAULT_FEE_RECEIPT_TEMPLATE,
            version=0,
            updated_at=None,
        )
    return _to_response(template)


async def update_fee_message_templates(
    db: AsyncSession,
    payload: FeeMessageTemplatesUpdate,
    *,
    actor_id: str | None,
) -> FeeMessageTemplatesResponse:
    current = await db.get(FeeMessageTemplate, 1)
    before_version = str(current.version) if current else "0"
    before_reminder = (
        current.payment_reminder_template if current else DEFAULT_FEE_REMINDER_TEMPLATE
    )
    before_receipt = (
        current.payment_received_template if current else DEFAULT_FEE_RECEIPT_TEMPLATE
    )
    values = {
        "payment_reminder_template": payload.payment_reminder_template,
        "payment_received_template": payload.payment_received_template,
        "updated_by": actor_id,
    }

    if payload.version == 0:
        statement = (
            insert(FeeMessageTemplate)
            .values(id=1, version=1, **values)
            .on_conflict_do_nothing(index_elements=[FeeMessageTemplate.id])
            .returning(FeeMessageTemplate)
        )
    else:
        statement = (
            update(FeeMessageTemplate)
            .where(
                FeeMessageTemplate.id == 1,
                FeeMessageTemplate.version == payload.version,
            )
            .values(version=FeeMessageTemplate.version + 1, **values)
            .returning(FeeMessageTemplate)
        )

    template = (await db.execute(statement)).scalar_one_or_none()
    if template is None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Mẫu tin nhắn vừa được cập nhật ở một phiên khác. "
                "Vui lòng tải lại trước khi lưu."
            ),
        )

    labels = ["Thông báo đóng học phí", "Xác nhận đã nhận học phí"]
    before_messages = [before_reminder, before_receipt]
    after_messages = [
        template.payment_reminder_template,
        template.payment_received_template,
    ]
    await append_fee_operation(
        db,
        action="template_update",
        before=[
            FeeRecordAuditSnapshot(
                fee_record_id=None,
                enrollment_id=None,
                student_id=None,
                student_name=label,
                class_id=None,
                class_name=None,
                period=None,
                state=before_version,
                amount=None,
                due_date=None,
                notification_channel=None,
                notification_message=message,
            )
            for label, message in zip(labels, before_messages)
        ],
        after=[
            FeeRecordAuditSnapshot(
                fee_record_id=None,
                enrollment_id=None,
                student_id=None,
                student_name=label,
                class_id=None,
                class_name=None,
                period=None,
                state=str(template.version),
                amount=None,
                due_date=None,
                notification_channel=None,
                notification_message=message,
            )
            for label, message in zip(labels, after_messages)
        ],
        actor_id=actor_id,
        amount_deltas=[0, 0],
    )
    await db.commit()
    return _to_response(template)


def _to_response(template: FeeMessageTemplate) -> FeeMessageTemplatesResponse:
    return FeeMessageTemplatesResponse(
        payment_reminder_template=upgrade_legacy_fee_message_template(
            template.payment_reminder_template,
            allow_legacy_overdue_token=True,
        ),
        payment_received_template=upgrade_legacy_fee_message_template(
            template.payment_received_template,
            allow_legacy_overdue_token=False,
        ),
        version=template.version,
        updated_at=template.updated_at,
    )
