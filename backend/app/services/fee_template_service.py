from fastapi import HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.fee_messages import (
    DEFAULT_FEE_RECEIPT_TEMPLATE,
    DEFAULT_FEE_REMINDER_TEMPLATE,
    normalize_fee_message_template,
    upgrade_legacy_fee_message_template,
)
from app.models.fee_message_template import FeeMessageTemplate
from app.core.workspace import get_workspace_id
from app.schemas.fee import (
    FeeMessageTemplatesResponse,
    FeeMessageTemplatesUpdate,
    FeeMessageTemplateValues,
)
from app.services.fee_operation_service import (
    FeeRecordAuditSnapshot,
    append_fee_operation,
)


async def get_fee_message_templates(
    db: AsyncSession,
) -> FeeMessageTemplatesResponse:
    workspace_id = get_workspace_id()
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Không xác định được workspace")
    template = await db.scalar(
        select(FeeMessageTemplate).where(
            FeeMessageTemplate.workspace_id == workspace_id
        )
    )
    if template is None:
        return FeeMessageTemplatesResponse(
            active=_defaults(),
            defaults=_defaults(),
            is_customized=False,
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
    workspace_id = get_workspace_id()
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Không xác định được workspace")
    current = await db.scalar(
        select(FeeMessageTemplate).where(
            FeeMessageTemplate.workspace_id == workspace_id
        )
    )
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
        insert_values = {"id": 1, "version": 1, **values}
        insert_values["workspace_id"] = workspace_id
        statement = (
            insert(FeeMessageTemplate)
            .values(**insert_values)
            .on_conflict_do_nothing(index_elements=[FeeMessageTemplate.workspace_id])
            .returning(FeeMessageTemplate)
        )
    else:
        update_where = [FeeMessageTemplate.version == payload.version]
        update_where.append(FeeMessageTemplate.workspace_id == workspace_id)
        statement = (
            update(FeeMessageTemplate)
            .where(*update_where)
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
        active=FeeMessageTemplateValues(
            payment_reminder_template=normalize_fee_message_template(
                upgrade_legacy_fee_message_template(
                    template.payment_reminder_template,
                    allow_legacy_overdue_token=True,
                )
            ),
            payment_received_template=normalize_fee_message_template(
                upgrade_legacy_fee_message_template(
                    template.payment_received_template,
                    allow_legacy_overdue_token=False,
                )
            ),
        ),
        defaults=_defaults(),
        is_customized=True,
        version=template.version,
        updated_at=template.updated_at,
    )


def _defaults() -> FeeMessageTemplateValues:
    return FeeMessageTemplateValues(
        payment_reminder_template=DEFAULT_FEE_REMINDER_TEMPLATE,
        payment_received_template=DEFAULT_FEE_RECEIPT_TEMPLATE,
    )


async def reset_fee_message_templates(
    db: AsyncSession,
    *,
    expected_version: int,
    actor_id: str | None,
) -> FeeMessageTemplatesResponse:
    workspace_id = get_workspace_id()
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Không xác định được workspace")
    current = await db.scalar(
        select(FeeMessageTemplate).where(
            FeeMessageTemplate.workspace_id == workspace_id
        )
    )
    actual_version = current.version if current else 0
    if actual_version != expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Mẫu tin nhắn vừa được cập nhật ở một phiên khác. Vui lòng tải lại.",
        )
    if current is not None:
        await db.execute(
            delete(FeeMessageTemplate).where(
                FeeMessageTemplate.workspace_id == workspace_id,
                FeeMessageTemplate.version == expected_version,
            )
        )
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
                    state=str(current.version),
                    amount=None,
                    due_date=None,
                    notification_channel=None,
                    notification_message=message,
                )
                for label, message in zip(
                    ["Thông báo đóng học phí", "Xác nhận đã nhận học phí"],
                    [
                        current.payment_reminder_template,
                        current.payment_received_template,
                    ],
                )
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
                    state="default",
                    amount=None,
                    due_date=None,
                    notification_channel=None,
                    notification_message=message,
                )
                for label, message in zip(
                    ["Thông báo đóng học phí", "Xác nhận đã nhận học phí"],
                    [DEFAULT_FEE_REMINDER_TEMPLATE, DEFAULT_FEE_RECEIPT_TEMPLATE],
                )
            ],
            actor_id=actor_id,
            amount_deltas=[0, 0],
        )
        await db.commit()
    return FeeMessageTemplatesResponse(
        active=_defaults(),
        defaults=_defaults(),
        is_customized=False,
        version=0,
        updated_at=None,
    )
