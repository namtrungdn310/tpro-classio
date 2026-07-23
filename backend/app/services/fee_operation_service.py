from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_time import business_today
from app.models.fee_operation import FeeOperation, FeeOperationItem
from app.models.fee_record import FeeRecord
from app.models.payment import Payment
from app.models.user import Profile


@dataclass(frozen=True)
class FeeRecordAuditSnapshot:
    fee_record_id: str | None
    enrollment_id: str | None
    student_id: str | None
    student_name: str | None
    class_id: str | None
    class_name: str | None
    period: str | None
    state: str | None
    amount: int | None
    due_date: date | None
    notification_channel: str | None
    notification_message: str | None


def _to_int(value: Decimal | int | None) -> int:
    return int(value or 0)


def snapshot_fee_record(record: FeeRecord | None) -> FeeRecordAuditSnapshot | None:
    if record is None:
        return None
    enrollment = record.enrollment if "enrollment" in record.__dict__ else None
    student = (
        enrollment.student
        if enrollment is not None and "student" in enrollment.__dict__
        else None
    )
    class_ = (
        enrollment.class_
        if enrollment is not None and "class_" in enrollment.__dict__
        else None
    )
    paid_amount = (
        _to_int(record.paid_amount) if record.paid_amount is not None else None
    )
    refunded_amount = _to_int(record.refunded_amount)
    if record.status == "PAID" and refunded_amount > 0:
        state = (
            "REFUNDED_FULL"
            if paid_amount and refunded_amount >= paid_amount
            else "REFUNDED_PARTIAL"
        )
    elif record.status == "PAID":
        state = "PAID"
    elif record.notified_at is not None:
        state = "NOTIFIED_UNPAID"
    else:
        state = "UNNOTIFIED"
    final_amt = (
        _to_int(record.final_amount)
        if "final_amount" in record.__dict__ and record.final_amount is not None
        else (_to_int(record.base_amount) - _to_int(record.discount_amount))
    )
    amount = (
        max(0, (paid_amount or final_amt) - refunded_amount)
        if record.status == "PAID"
        else final_amt
    )
    return FeeRecordAuditSnapshot(
        fee_record_id=record.id,
        enrollment_id=record.enrollment_id,
        student_id=enrollment.student_id if enrollment else None,
        student_name=record.student_name_snapshot
        or (student.full_name if student else None),
        class_id=enrollment.class_id if enrollment else None,
        class_name=record.class_name_snapshot or (class_.name if class_ else None),
        period=record.period,
        state=state,
        amount=amount,
        due_date=record.due_date,
        notification_channel=record.notification_channel,
        notification_message=record.notification_message,
    )


async def append_fee_operation(
    db: AsyncSession,
    *,
    action: str,
    before: list[FeeRecordAuditSnapshot | None],
    after: list[FeeRecordAuditSnapshot | None],
    actor_id: str | None,
    request_id: UUID | str | None = None,
    payments: list[Payment | None] | None = None,
    amount_deltas: list[int] | None = None,
    reason: str | None = None,
    origin: str = "application",
) -> FeeOperation:
    """Append one immutable event inside the caller's current transaction."""

    if len(before) != len(after):
        raise ValueError("Fee operation snapshots must have matching lengths")
    if payments is not None and len(payments) != len(before):
        raise ValueError("Fee operation payments must match snapshots")
    if amount_deltas is not None and len(amount_deltas) != len(before):
        raise ValueError("Fee operation deltas must match snapshots")

    actor = None
    if actor_id:
        actor = (
            await db.execute(select(Profile).where(Profile.id == actor_id))
        ).scalar_one_or_none()

    periods = {
        snapshot.period
        for snapshot in [*before, *after]
        if snapshot is not None and snapshot.period
    }
    deltas = amount_deltas or [0] * len(before)
    operation = FeeOperation(
        action=action,
        origin=origin,
        request_id=str(request_id or uuid4()),
        period=next(iter(periods)) if len(periods) == 1 else None,
        business_date=business_today(),
        actor_user_id=actor_id,
        actor_name_snapshot=(actor.full_name or actor.username) if actor else None,
        actor_username_snapshot=actor.username if actor else None,
        actor_role_snapshot=actor.role if actor else None,
        item_count=len(before),
        total_amount=sum(deltas),
    )
    db.add(operation)
    await db.flush()

    for index, (before_item, after_item) in enumerate(zip(before, after), start=1):
        subject = after_item or before_item
        if subject is None:
            continue
        payment = payments[index - 1] if payments else None
        db.add(
            FeeOperationItem(
                operation_id=operation.id,
                ordinal=index,
                fee_record_id=subject.fee_record_id,
                enrollment_id=subject.enrollment_id,
                student_id=subject.student_id,
                student_name_snapshot=subject.student_name,
                class_id=subject.class_id,
                class_name_snapshot=subject.class_name,
                period=subject.period,
                state_before=before_item.state if before_item else None,
                state_after=after_item.state if after_item else None,
                amount_before=before_item.amount if before_item else None,
                amount_after=after_item.amount if after_item else None,
                amount_delta=deltas[index - 1],
                due_date_before=before_item.due_date if before_item else None,
                due_date_after=after_item.due_date if after_item else None,
                payment_method=payment.payment_method if payment else None,
                notification_channel=(
                    after_item.notification_channel
                    if after_item
                    else before_item.notification_channel
                    if before_item
                    else None
                ),
                message_snapshot=(
                    after_item.notification_message
                    if after_item and after_item.notification_message
                    else before_item.notification_message
                    if before_item
                    else None
                ),
                reason_snapshot=reason,
                payment_id=payment.id if payment else None,
                related_payment_id=payment.related_payment_id if payment else None,
            )
        )
    await db.flush()
    return operation
