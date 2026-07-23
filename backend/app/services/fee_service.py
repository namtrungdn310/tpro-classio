from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager

from app.core.billing import (
    get_enrollment_due_date_in_month,
    get_enrollment_fee_amount,
)
from app.core.business_time import business_today
from app.core.performance import log_timing
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.payment import Payment
from app.models.student import Student
from app.models.user import Profile
from app.schemas.fee import (
    FeeBatchRefundRequest,
    FeeBatchResponse,
    FeeUnpayTargetState,
    FeePeriodListResponse,
    FeeRecordListResponse,
    FeeRecordResponse,
    FeeRefundBatchResponse,
    FeeRefundReceiptItem,
    FeeRefundReceiptResponse,
    FeeRefundReversalRequest,
    FeeRefundReversalResponse,
    FeeTransactionListResponse,
    FeeTransactionBatchResponse,
    FeeTransactionResponse,
)
from app.services.fee_reconciliation import (
    is_fee_record_protected,
    lock_fee_period,
    reconcile_fee_record_for_period,
)
from app.services.fee_operation_service import (
    append_fee_operation,
    snapshot_fee_record,
)


@dataclass
class _PaymentLedgerState:
    net_amount: int = 0
    payment_method: str | None = None
    payment_id: str | None = None
    has_entries: bool = False


async def sync_fee_records_for_period(
    db: AsyncSession,
    period: str,
    *,
    actor_id: str | None = None,
) -> None:
    with log_timing(
        "fee_service.sync_fee_records_for_period", threshold_ms=50, period=period
    ):
        reference_date = _period_to_date(period)
        if period != business_today().strftime("%Y-%m"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Chỉ được đồng bộ kỳ học phí hiện tại. "
                    "Dữ liệu lịch sử được giữ nguyên để bảo toàn đối soát."
                ),
            )
        has_changes = False
        await lock_fee_period(db, period)

        with log_timing(
            "fee_service.sync_fee_records_for_period.enrollments",
            threshold_ms=35,
            period=period,
        ):
            enrollment_result = await db.execute(
                select(Enrollment)
                .join(Class, Class.id == Enrollment.class_id)
                .join(Student, Student.id == Enrollment.student_id)
                .options(contains_eager(Enrollment.class_))
                .where(
                    Enrollment.status == "active",
                    Class.is_active.is_(True),
                    Student.status == "active",
                ),
            )
        enrollments = enrollment_result.scalars().unique().all()

        with log_timing(
            "fee_service.sync_fee_records_for_period.records",
            threshold_ms=35,
            period=period,
        ):
            existing_result = await db.execute(
                select(FeeRecord)
                .join(Enrollment, Enrollment.id == FeeRecord.enrollment_id)
                .join(Student, Student.id == Enrollment.student_id)
                .join(Class, Class.id == Enrollment.class_id)
                .options(
                    contains_eager(FeeRecord.enrollment).contains_eager(
                        Enrollment.student
                    ),
                    contains_eager(FeeRecord.enrollment).contains_eager(
                        Enrollment.class_
                    ),
                )
                .where(FeeRecord.period == period)
                .with_for_update(of=FeeRecord),
            )
        existing_records = existing_result.scalars().unique().all()
        before_by_id = {
            record.id: snapshot_fee_record(record) for record in existing_records
        }
        records_by_enrollment: dict[str, list[FeeRecord]] = defaultdict(list)
        for record in existing_records:
            records_by_enrollment[record.enrollment_id].append(record)

        active_enrollment_ids = {enrollment.id for enrollment in enrollments}
        for enrollment in enrollments:
            existing_records = records_by_enrollment.get(enrollment.id, [])
            current_record = existing_records[0] if existing_records else None
            has_changes = (
                await reconcile_fee_record_for_period(
                    db,
                    enrollment,
                    period,
                    reference_date,
                    existing_record=current_record,
                )
                or has_changes
            )

        # Remove only draft obligations that no longer belong to an active
        # student/class/enrollment. Notified and paid history is retained.
        for enrollment_id, records in records_by_enrollment.items():
            if enrollment_id in active_enrollment_ids:
                continue
            for record in records:
                if not is_fee_record_protected(record):
                    await db.delete(record)
                    has_changes = True

        if not has_changes:
            await db.rollback()
            return

        await db.flush()
        after_result = await db.execute(
            select(FeeRecord)
            .join(Enrollment, Enrollment.id == FeeRecord.enrollment_id)
            .join(Student, Student.id == Enrollment.student_id)
            .join(Class, Class.id == Enrollment.class_id)
            .options(
                contains_eager(FeeRecord.enrollment).contains_eager(Enrollment.student),
                contains_eager(FeeRecord.enrollment).contains_eager(Enrollment.class_),
            )
            .where(FeeRecord.period == period)
        )
        after_records = after_result.scalars().unique().all()
        after_by_id = {
            record.id: snapshot_fee_record(record) for record in after_records
        }
        changed_ids = sorted(
            record_id
            for record_id in set(before_by_id) | set(after_by_id)
            if before_by_id.get(record_id) != after_by_id.get(record_id)
        )
        await append_fee_operation(
            db,
            action="sync",
            before=[before_by_id.get(record_id) for record_id in changed_ids],
            after=[after_by_id.get(record_id) for record_id in changed_ids],
            actor_id=actor_id,
            amount_deltas=[0] * len(changed_ids),
        )
        await db.commit()


async def get_fee_records(
    db: AsyncSession,
    period: str,
    class_id: UUID | None = None,
    state: str | None = None,
) -> FeeRecordListResponse:
    with log_timing(
        "fee_service.get_fee_records",
        threshold_ms=40,
        period=period,
        class_id=str(class_id) if class_id is not None else None,
        state=state,
    ):
        reference_date = _period_to_date(period)
        query = (
            select(FeeRecord)
            .join(Enrollment, Enrollment.id == FeeRecord.enrollment_id)
            .join(Student, Student.id == Enrollment.student_id)
            .join(Class, Class.id == Enrollment.class_id)
            .options(
                contains_eager(FeeRecord.enrollment).contains_eager(Enrollment.student),
                contains_eager(FeeRecord.enrollment).contains_eager(Enrollment.class_),
            )
            .where(FeeRecord.period == period)
        )

        if class_id is not None:
            query = query.where(Enrollment.class_id == str(class_id))

        query = _apply_fee_state_filter(query, state)

        with log_timing(
            "fee_service.get_fee_records.db",
            threshold_ms=30,
            period=period,
            class_id=str(class_id) if class_id is not None else None,
            state=state,
        ):
            result = await db.execute(query)

        records = [
            _to_response(record, reference_date)
            for record in result.scalars().unique().all()
        ]

        records.sort(
            key=lambda record: (
                record.due_date or date.max,
                record.class_name,
                record.student_name,
            )
        )
        response = FeeRecordListResponse(period=period, records=records)
        return response


async def get_fee_periods(db: AsyncSession) -> FeePeriodListResponse:
    result = await db.execute(
        select(FeeRecord.period).distinct().order_by(FeeRecord.period.desc())
    )
    periods: list[str] = []
    for value in result.scalars().all():
        try:
            _period_to_date(value)
        except HTTPException:
            continue
        periods.append(value)
    return FeePeriodListResponse(periods=periods)


async def mark_fee_notified(
    db: AsyncSession,
    id: UUID,
    message: str | None,
    channel: str,
    actor_id: str | None = None,
) -> FeeRecordResponse | None:
    result = await mark_fees_notified(db, [id], message, channel, actor_id=actor_id)
    return result.records[0] if result.records else None


async def mark_fee_paid(
    db: AsyncSession,
    id: UUID,
    actor_id: str | None = None,
    payment_method: str = "bank_transfer",
) -> FeeRecordResponse | None:
    result = await mark_fees_paid(
        db,
        [id],
        actor_id=actor_id,
        payment_method=payment_method,
    )
    return result.records[0] if result.records else None


async def mark_fee_unpaid(
    db: AsyncSession,
    id: UUID,
    actor_id: str | None = None,
    target_notification_state: FeeUnpayTargetState = "NOTIFIED_UNPAID",
) -> FeeRecordResponse | None:
    result = await mark_fees_unpaid(
        db,
        [id],
        actor_id=actor_id,
        target_notification_state=target_notification_state,
    )
    return result.records[0] if result.records else None


async def mark_fees_notified(
    db: AsyncSession,
    ids: list[UUID],
    message: str | None,
    channel: str,
    *,
    actor_id: str | None = None,
    request_id: UUID | None = None,
) -> FeeBatchResponse:
    return await _transition_fee_records(
        db,
        ids,
        action="notify",
        actor_id=actor_id,
        message=message,
        channel=channel,
        request_id=request_id,
    )


async def mark_fees_paid(
    db: AsyncSession,
    ids: list[UUID],
    *,
    actor_id: str | None = None,
    payment_method: str = "bank_transfer",
    request_id: UUID | None = None,
) -> FeeBatchResponse:
    return await _transition_fee_records(
        db,
        ids,
        action="pay",
        actor_id=actor_id,
        payment_method=payment_method,
        request_id=request_id,
    )


async def mark_fees_unpaid(
    db: AsyncSession,
    ids: list[UUID],
    *,
    actor_id: str | None = None,
    target_notification_state: FeeUnpayTargetState = "NOTIFIED_UNPAID",
    request_id: UUID | None = None,
) -> FeeBatchResponse:
    return await _transition_fee_records(
        db,
        ids,
        action="unpay",
        actor_id=actor_id,
        target_notification_state=target_notification_state,
        request_id=request_id,
    )


async def mark_fees_unnotified(
    db: AsyncSession,
    ids: list[UUID],
    *,
    actor_id: str | None = None,
    request_id: UUID | None = None,
) -> FeeBatchResponse:
    return await _transition_fee_records(
        db,
        ids,
        action="unnotify",
        actor_id=actor_id,
        request_id=request_id,
    )


async def refund_fee_records(
    db: AsyncSession,
    payload: FeeBatchRefundRequest,
    *,
    actor_id: str,
) -> FeeRefundBatchResponse:
    """Append an atomic, idempotent refund across one student's fee records."""

    request_id = str(payload.request_id)
    await _lock_refund_request(db, request_id)
    existing_entries = await _get_refund_entries(db, request_id)
    if existing_entries:
        return await _return_idempotent_refund(db, payload, existing_entries)

    ordered_ids = [str(item.record_id) for item in payload.items]
    records = await _load_locked_fee_records(db, ordered_ids)
    before_snapshots = [snapshot_fee_record(record) for record in records]
    records_by_id = {record.id: record for record in records}
    student_ids = {
        record.enrollment.student_id
        for record in records
        if record.enrollment is not None
    }
    if len(student_ids) != 1 or len(records) != len(payload.items):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Một thao tác hoàn phí chỉ được áp dụng cho một học viên",
        )

    if any(record.status != "PAID" for record in records):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Chỉ có thể hoàn khoản học phí đã được ghi nhận đã nộp",
        )

    ledger_states = await _get_payment_ledger_states(db, ordered_ids)
    for item in payload.items:
        record = records_by_id[str(item.record_id)]
        paid_amount = _to_int(record.paid_amount or record.final_amount)
        refunded_amount = _to_int(record.refunded_amount)
        refundable_amount = max(0, paid_amount - refunded_amount)
        ledger_state = ledger_states.get(record.id)
        if (
            ledger_state is None
            or not ledger_state.has_entries
            or ledger_state.payment_id is None
            or ledger_state.net_amount != refundable_amount
        ):
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Sổ thanh toán không khớp với số tiền có thể hoàn. "
                    "Vui lòng đối soát dữ liệu trước khi tiếp tục."
                ),
            )
        if item.amount > refundable_amount:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Số tiền hoàn cho lớp {_record_class_name(record)} vượt quá "
                    f"mức còn có thể hoàn ({_format_currency(refundable_amount)})"
                ),
            )

    refund_date = business_today()
    refund_entries: list[Payment] = []
    for item in payload.items:
        record = records_by_id[str(item.record_id)]
        ledger_state = ledger_states[record.id]
        entry = Payment(
            fee_record_id=record.id,
            amount=-item.amount,
            payment_date=refund_date,
            payment_method=payload.refund_method,
            entry_type="refund",
            related_payment_id=ledger_state.payment_id,
            idempotency_key=request_id,
            note=payload.reason,
            created_by=actor_id,
        )
        refund_entries.append(entry)
        db.add(entry)

    try:
        await db.flush()
        updated_records = await _get_fee_records_by_ids(db, ordered_ids)
        await append_fee_operation(
            db,
            action="refund",
            before=before_snapshots,
            after=[snapshot_fee_record(record) for record in updated_records],
            actor_id=actor_id,
            request_id=payload.request_id,
            payments=refund_entries,
            amount_deltas=[-item.amount for item in payload.items],
            reason=payload.reason or None,
        )
        response = _build_refund_response(
            payload,
            refund_date,
            updated_records,
            refund_entries,
        )
        await db.commit()
        return response
    except (IntegrityError, DBAPIError) as exc:
        await db.rollback()
        _raise_financial_conflict(exc)
    except Exception:
        await db.rollback()
        raise


async def reverse_fee_refund(
    db: AsyncSession,
    payload: FeeRefundReversalRequest,
    *,
    actor_id: str,
) -> FeeRefundReversalResponse:
    """Append a correction that exactly reverses one erroneous refund entry."""

    request_id = str(payload.request_id)
    await _lock_refund_request(db, request_id)
    existing_entries = await _get_refund_entries(db, request_id)
    if existing_entries:
        return await _return_idempotent_refund_reversal(db, payload, existing_entries)

    source_result = await db.execute(
        select(Payment.fee_record_id).where(
            Payment.id == str(payload.refund_transaction_id)
        )
    )
    fee_record_id = source_result.scalar_one_or_none()
    if fee_record_id is None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy giao dịch hoàn phí cần sửa",
        )

    locked_records = await _load_locked_fee_records(db, [fee_record_id])
    before_snapshot = snapshot_fee_record(locked_records[0])
    source_result = await db.execute(
        select(Payment)
        .where(Payment.id == str(payload.refund_transaction_id))
        .with_for_update()
    )
    source = source_result.scalar_one_or_none()
    if source is None or source.entry_type != "refund":
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Giao dịch đã chọn không phải là một khoản hoàn phí",
        )

    reversal_result = await db.execute(
        select(Payment.id).where(
            Payment.entry_type == "refund_reversal",
            Payment.related_payment_id == source.id,
        )
    )
    if reversal_result.scalar_one_or_none() is not None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Khoản hoàn phí này đã được hoàn tác trước đó",
        )

    entry = Payment(
        fee_record_id=source.fee_record_id,
        amount=abs(source.amount),
        payment_date=business_today(),
        payment_method=source.payment_method,
        entry_type="refund_reversal",
        related_payment_id=source.id,
        idempotency_key=request_id,
        note=payload.reason,
        created_by=actor_id,
    )
    db.add(entry)
    try:
        await db.flush()
        updated_records = await _get_fee_records_by_ids(db, [fee_record_id])
        await append_fee_operation(
            db,
            action="refund_reversal",
            before=[before_snapshot],
            after=[snapshot_fee_record(updated_records[0])],
            actor_id=actor_id,
            request_id=payload.request_id,
            payments=[entry],
            amount_deltas=[_to_int(entry.amount)],
            reason=payload.reason,
        )
        transaction = await _get_fee_transaction_response(db, entry.id)
        if transaction is None:
            raise RuntimeError("Refund reversal entry was not persisted")
        response = FeeRefundReversalResponse(
            records=[_to_response(record) for record in updated_records],
            deleted_ids=[],
            transaction=transaction,
        )
        await db.commit()
        return response
    except (IntegrityError, DBAPIError) as exc:
        await db.rollback()
        _raise_financial_conflict(exc)
    except Exception:
        await db.rollback()
        raise


async def get_fee_transactions(
    db: AsyncSession,
    fee_record_id: UUID,
) -> FeeTransactionListResponse | None:
    record_result = await db.execute(
        select(FeeRecord.id).where(FeeRecord.id == str(fee_record_id))
    )
    if record_result.scalar_one_or_none() is None:
        return None

    result = await db.execute(
        select(Payment, Profile.full_name, Profile.username)
        .outerjoin(Profile, Profile.id == Payment.created_by)
        .where(Payment.fee_record_id == str(fee_record_id))
        .order_by(Payment.created_at.desc(), Payment.id.desc())
    )
    return FeeTransactionListResponse(
        fee_record_id=fee_record_id,
        transactions=[
            _to_transaction_response(entry, full_name, username)
            for entry, full_name, username in result.all()
        ],
    )


async def get_fee_transactions_batch(
    db: AsyncSession,
    fee_record_ids: list[UUID],
) -> FeeTransactionBatchResponse:
    ordered_ids = list(dict.fromkeys(str(id_) for id_ in fee_record_ids))
    record_result = await db.execute(
        select(FeeRecord.id).where(FeeRecord.id.in_(ordered_ids))
    )
    found_ids = set(record_result.scalars().all())
    if len(found_ids) != len(ordered_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy một hoặc nhiều khoản học phí cần xuất lịch sử",
        )

    result = await db.execute(
        select(Payment, Profile.full_name, Profile.username)
        .outerjoin(Profile, Profile.id == Payment.created_by)
        .where(Payment.fee_record_id.in_(ordered_ids))
        .order_by(
            Payment.fee_record_id,
            Payment.created_at.desc(),
            Payment.id.desc(),
        )
    )
    grouped: dict[str, list[FeeTransactionResponse]] = defaultdict(list)
    for entry, full_name, username in result.all():
        grouped[entry.fee_record_id].append(
            _to_transaction_response(entry, full_name, username)
        )

    return FeeTransactionBatchResponse(
        histories=[
            FeeTransactionListResponse(
                fee_record_id=UUID(record_id),
                transactions=grouped[record_id],
            )
            for record_id in ordered_ids
        ]
    )


async def _transition_fee_records(
    db: AsyncSession,
    ids: list[UUID],
    *,
    action: str,
    actor_id: str | None = None,
    message: str | None = None,
    channel: str | None = None,
    payment_method: str = "bank_transfer",
    target_notification_state: FeeUnpayTargetState = "NOTIFIED_UNPAID",
    request_id: UUID | None = None,
) -> FeeBatchResponse:
    """Apply one state transition to every requested record atomically.

    Every path uses the same period-lock -> row-lock order as reconciliation.
    All preconditions are checked before the first record is changed, so a
    multi-class student can never be left half updated.
    """

    if action not in {"notify", "pay", "unpay", "unnotify"}:
        raise ValueError(f"Unsupported fee transition: {action}")
    if action == "unpay" and target_notification_state not in {
        "UNNOTIFIED",
        "NOTIFIED_UNPAID",
    }:
        raise ValueError(f"Unsupported unpay target state: {target_notification_state}")

    ordered_ids = list(dict.fromkeys(str(id_) for id_ in ids))
    records = await _load_locked_fee_records(db, ordered_ids)
    before_by_id = {record.id: snapshot_fee_record(record) for record in records}
    payment_date = business_today()
    current_period = payment_date.strftime("%Y-%m")
    if action in {"notify", "pay"} and any(
        record.period > current_period for record in records
    ):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Không thể báo hoặc thu một kỳ học phí trong tương lai",
        )

    if action == "unnotify" and any(record.status == "PAID" for record in records):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Cần hoàn tác ghi nhận đã nộp trước khi chuyển khoản học phí "
                "về trạng thái chưa báo"
            ),
        )

    if (
        action == "unpay"
        and target_notification_state == "NOTIFIED_UNPAID"
        and any(
            record.status == "PAID" and record.notified_at is None for record in records
        )
    ):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Khoản học phí chưa từng được đánh dấu đã báo nên chỉ có thể "
                "hoàn tác về trạng thái chưa báo"
            ),
        )

    ledger_states = (
        await _get_payment_ledger_states(db, ordered_ids)
        if action in {"unpay", "unnotify"}
        else {}
    )

    if action == "unpay":
        if any(_to_int(record.refunded_amount) > 0 for record in records):
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Khoản học phí đã có hoàn phí nên không thể hoàn tác ghi nhận "
                    "đã nộp. Hoàn phí và sửa sai thanh toán là hai nghiệp vụ riêng."
                ),
            )
        inconsistent_records = []
        for record in records:
            if record.status != "PAID":
                continue
            expected_amount = _to_int(record.paid_amount or record.final_amount)
            ledger_state = ledger_states.get(record.id)
            if (
                ledger_state is None
                or not ledger_state.has_entries
                or ledger_state.net_amount != expected_amount
            ):
                inconsistent_records.append(record)
        if inconsistent_records:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Sổ thanh toán không khớp với trạng thái học phí. "
                    "Vui lòng đối soát dữ liệu trước khi hoàn tác."
                ),
            )

    if action == "unnotify" and any(
        state.has_entries for state in ledger_states.values()
    ):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Khoản học phí đã có lịch sử thanh toán nên không thể chuyển "
                "về trạng thái chưa báo. Lịch sử đối soát phải được giữ nguyên."
            ),
        )

    changed = False
    deleted_ids: list[UUID] = []
    notification_time = datetime.now(timezone.utc)
    changed_records: list[FeeRecord] = []
    operation_payments: list[Payment | None] = []
    operation_deltas: list[int] = []

    for record in records:
        if action == "notify":
            if record.status == "PAID" or record.notified_at is not None:
                continue
            _freeze_business_identity(record)
            record.notified_at = notification_time
            record.notification_channel = channel or "zalo_manual"
            record.notification_message = message or build_zalo_fee_message(record)
            changed_records.append(record)
            operation_payments.append(None)
            operation_deltas.append(0)
            changed = True
            continue

        if action == "pay":
            if record.status == "PAID":
                continue
            _freeze_business_identity(record)
            record.status = "PAID"
            record.paid_amount = record.final_amount
            record.paid_date = payment_date
            payment = Payment(
                fee_record_id=record.id,
                amount=record.final_amount,
                payment_date=payment_date,
                payment_method=payment_method,
                entry_type="payment",
                note=f"Ghi nhận học phí kỳ {record.period}",
                created_by=actor_id,
            )
            db.add(payment)
            changed_records.append(record)
            operation_payments.append(payment)
            operation_deltas.append(_to_int(record.final_amount))
            changed = True
            continue

        if action == "unpay":
            if record.status != "PAID":
                continue
            reversal_amount = record.paid_amount or record.final_amount
            record.status = "UNPAID"
            record.paid_amount = None
            record.paid_date = None
            if target_notification_state == "UNNOTIFIED":
                record.notification_channel = None
                record.notified_at = None
                record.notification_message = None
            target_note = (
                "chưa báo"
                if target_notification_state == "UNNOTIFIED"
                else "đã báo, chưa nộp"
            )
            payment = Payment(
                fee_record_id=record.id,
                amount=-reversal_amount,
                payment_date=payment_date,
                payment_method=(
                    ledger_states[record.id].payment_method or "bank_transfer"
                ),
                entry_type="payment_reversal",
                related_payment_id=getattr(
                    ledger_states[record.id], "payment_id", None
                ),
                note=(
                    f"Hoàn tác ghi nhận học phí kỳ {record.period}; "
                    f"chuyển về {target_note}"
                ),
                created_by=actor_id,
            )
            db.add(payment)
            changed_records.append(record)
            operation_payments.append(payment)
            operation_deltas.append(-_to_int(reversal_amount))
            changed = True
            continue

        if action == "unnotify":
            if record.notified_at is None:
                continue
            record.notification_channel = None
            record.notified_at = None
            record.notification_message = None
            changed_records.append(record)
            operation_payments.append(None)
            operation_deltas.append(0)
            changed = True

            if record.period == current_period and _reconcile_unnotified_record(record):
                await db.delete(record)
                deleted_ids.append(UUID(record.id))

    if not changed:
        response = FeeBatchResponse(
            records=[_to_response(record) for record in records],
            deleted_ids=[],
        )
        await db.rollback()
        return response

    await db.flush()
    deleted_id_strings = {str(id_) for id_ in deleted_ids}
    await append_fee_operation(
        db,
        action={
            "notify": "notify",
            "pay": "payment",
            "unpay": "payment_reversal",
            "unnotify": "unnotify",
        }[action],
        before=[before_by_id[record.id] for record in changed_records],
        after=[
            None if record.id in deleted_id_strings else snapshot_fee_record(record)
            for record in changed_records
        ],
        actor_id=actor_id,
        request_id=request_id,
        payments=operation_payments,
        amount_deltas=operation_deltas,
    )
    await db.commit()

    remaining_ids = [id_ for id_ in ordered_ids if UUID(id_) not in deleted_ids]
    updated_records = await _get_fee_records_by_ids(db, remaining_ids)
    return FeeBatchResponse(
        records=[_to_response(record) for record in updated_records],
        deleted_ids=deleted_ids,
    )


async def _load_locked_fee_records(
    db: AsyncSession,
    ordered_ids: list[str],
) -> list[FeeRecord]:
    period_result = await db.execute(
        select(FeeRecord.id, FeeRecord.period).where(FeeRecord.id.in_(ordered_ids))
    )
    id_period_rows = period_result.all()
    found_ids = {row[0] for row in id_period_rows}
    missing_ids = [id_ for id_ in ordered_ids if id_ not in found_ids]
    if missing_ids:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy một hoặc nhiều khoản học phí",
        )

    for period in sorted({row[1] for row in id_period_rows}):
        await lock_fee_period(db, period)

    records = await _get_fee_records_by_ids(db, ordered_ids, for_update=True)
    if len(records) != len(ordered_ids):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Dữ liệu học phí vừa thay đổi. Vui lòng tải lại và thử lại.",
        )
    return records


async def _lock_refund_request(db: AsyncSession, request_id: str) -> None:
    # A request-level advisory lock makes retries deterministic even when two
    # requests happen to contain disjoint fee records.
    await db.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:request_id, 0))"),
        {"request_id": request_id},
    )


async def _get_refund_entries(
    db: AsyncSession,
    request_id: str,
) -> list[Payment]:
    result = await db.execute(
        select(Payment)
        .where(Payment.idempotency_key == request_id)
        .order_by(Payment.fee_record_id, Payment.id)
    )
    return list(result.scalars().all())


async def _return_idempotent_refund(
    db: AsyncSession,
    payload: FeeBatchRefundRequest,
    entries: list[Payment],
) -> FeeRefundBatchResponse:
    expected_amounts = {str(item.record_id): item.amount for item in payload.items}
    actual_amounts = {entry.fee_record_id: -_to_int(entry.amount) for entry in entries}
    is_same_request = (
        len(entries) == len(payload.items)
        and actual_amounts == expected_amounts
        and all(entry.entry_type == "refund" for entry in entries)
        and all(entry.payment_method == payload.refund_method for entry in entries)
        and all(entry.note == payload.reason for entry in entries)
    )
    if not is_same_request:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Mã yêu cầu hoàn phí đã được dùng cho một nội dung khác. "
                "Vui lòng tải lại dữ liệu và thực hiện thao tác mới."
            ),
        )

    ordered_ids = [str(item.record_id) for item in payload.items]
    records = await _get_fee_records_by_ids(db, ordered_ids)
    response = _build_refund_response(
        payload,
        entries[0].payment_date,
        records,
        entries,
    )
    await db.rollback()
    return response


async def _return_idempotent_refund_reversal(
    db: AsyncSession,
    payload: FeeRefundReversalRequest,
    entries: list[Payment],
) -> FeeRefundReversalResponse:
    is_same_request = (
        len(entries) == 1
        and entries[0].entry_type == "refund_reversal"
        and entries[0].related_payment_id == str(payload.refund_transaction_id)
        and entries[0].note == payload.reason
    )
    if not is_same_request:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Mã yêu cầu sửa hoàn phí đã được dùng cho một nội dung khác. "
                "Vui lòng tải lại dữ liệu và thực hiện thao tác mới."
            ),
        )

    entry = entries[0]
    records = await _get_fee_records_by_ids(db, [entry.fee_record_id])
    transaction = await _get_fee_transaction_response(db, entry.id)
    if transaction is None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Không thể đối soát giao dịch sửa hoàn phí",
        )
    response = FeeRefundReversalResponse(
        records=[_to_response(record) for record in records],
        deleted_ids=[],
        transaction=transaction,
    )
    await db.rollback()
    return response


def _build_refund_response(
    payload: FeeBatchRefundRequest,
    refund_date: date,
    records: list[FeeRecord],
    entries: list[Payment],
) -> FeeRefundBatchResponse:
    entries_by_record_id = {entry.fee_record_id: entry for entry in entries}
    return FeeRefundBatchResponse(
        records=[_to_response(record) for record in records],
        deleted_ids=[],
        receipt=FeeRefundReceiptResponse(
            request_id=payload.request_id,
            refund_date=refund_date,
            refund_method=payload.refund_method,
            reason=payload.reason,
            total_amount=sum(item.amount for item in payload.items),
            items=[
                FeeRefundReceiptItem(
                    transaction_id=entries_by_record_id[str(item.record_id)].id,
                    record_id=item.record_id,
                    amount=item.amount,
                    created_at=entries_by_record_id[str(item.record_id)].created_at,
                )
                for item in payload.items
            ],
        ),
    )


async def _get_fee_transaction_response(
    db: AsyncSession,
    transaction_id: str,
) -> FeeTransactionResponse | None:
    result = await db.execute(
        select(Payment, Profile.full_name, Profile.username)
        .outerjoin(Profile, Profile.id == Payment.created_by)
        .where(Payment.id == transaction_id)
    )
    row = result.one_or_none()
    if row is None:
        return None
    entry, full_name, username = row
    return _to_transaction_response(entry, full_name, username)


def _to_transaction_response(
    entry: Payment,
    full_name: str | None,
    username: str | None,
) -> FeeTransactionResponse:
    return FeeTransactionResponse(
        id=entry.id,
        entry_type=entry.entry_type,
        amount=_to_int(entry.amount),
        transaction_date=entry.payment_date,
        payment_method=entry.payment_method,
        note=entry.note,
        related_payment_id=entry.related_payment_id,
        request_id=entry.idempotency_key,
        created_by=entry.created_by,
        created_by_name=full_name or username,
        created_at=entry.created_at,
    )


def _raise_financial_conflict(exc: DBAPIError) -> None:
    sqlstate = getattr(exc.orig, "sqlstate", None)
    if sqlstate in {"23505", "23514", "55000"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Dữ liệu học phí vừa thay đổi hoặc không còn khớp để thực hiện "
                "giao dịch. Vui lòng tải lại và kiểm tra trước khi thử lại."
            ),
        ) from exc
    raise exc


async def _get_payment_ledger_states(
    db: AsyncSession,
    fee_record_ids: list[str],
) -> dict[str, _PaymentLedgerState]:
    result = await db.execute(
        select(
            Payment.id,
            Payment.fee_record_id,
            Payment.payment_method,
            Payment.amount,
            Payment.entry_type,
        )
        .where(Payment.fee_record_id.in_(fee_record_ids))
        .order_by(Payment.created_at.desc(), Payment.id.desc())
    )
    states: dict[str, _PaymentLedgerState] = {}
    for payment_id, fee_record_id, payment_method, amount, entry_type in result.all():
        state = states.setdefault(fee_record_id, _PaymentLedgerState())
        state.has_entries = True
        state.net_amount += _to_int(amount)
        # Entries are newest first. Keep the newest original payment as the
        # auditable source that a refund references. Legacy rows created before
        # entry types are backfilled by migration 028.
        if state.payment_id is None and entry_type == "payment":
            state.payment_id = payment_id
            state.payment_method = payment_method
    return states


async def _get_fee_records_by_ids(
    db: AsyncSession,
    ordered_ids: list[str],
    *,
    for_update: bool = False,
) -> list[FeeRecord]:
    if not ordered_ids:
        return []

    query = (
        select(FeeRecord)
        .join(Enrollment, Enrollment.id == FeeRecord.enrollment_id)
        .join(Student, Student.id == Enrollment.student_id)
        .join(Class, Class.id == Enrollment.class_id)
        .where(FeeRecord.id.in_(ordered_ids))
        .options(
            contains_eager(FeeRecord.enrollment).contains_eager(Enrollment.student),
            contains_eager(FeeRecord.enrollment).contains_eager(Enrollment.class_),
        )
    )
    if for_update:
        query = query.with_for_update(of=FeeRecord)

    result = await db.execute(query.execution_options(populate_existing=True))
    records_by_id = {record.id: record for record in result.scalars().unique().all()}
    return [records_by_id[id_] for id_ in ordered_ids if id_ in records_by_id]


def _reconcile_unnotified_record(record: FeeRecord) -> bool:
    """Refresh a current-period draft after its notification is undone.

    Returns ``True`` when the record is no longer chargeable and must be
    deleted. Historical snapshots are intentionally left untouched.
    """

    enrollment = record.enrollment
    class_ = enrollment.class_ if enrollment else None
    student = enrollment.student if enrollment else None
    is_chargeable = bool(
        enrollment
        and enrollment.status == "active"
        and class_
        and class_.is_active
        and student
        and student.status == "active"
    )
    reference_date = _period_to_date(record.period)
    due_date = (
        get_enrollment_due_date_in_month(enrollment, reference_date)
        if is_chargeable and enrollment is not None
        else None
    )
    if due_date is None:
        return True

    record.base_amount = get_enrollment_fee_amount(enrollment)
    record.due_date = due_date
    record.enrollment_date_snapshot = enrollment.enrollment_date
    return False


def build_zalo_fee_message(
    record: FeeRecord, reference_date: date | None = None
) -> str:
    enrollment = record.enrollment
    student = enrollment.student if enrollment else None
    class_ = enrollment.class_ if enrollment else None
    effective_reference_date = reference_date or _period_to_date(record.period)
    due_date = record.due_date or (
        get_enrollment_due_date_in_month(enrollment, effective_reference_date)
        if enrollment
        else None
    )
    student_name = record.student_name_snapshot or (
        student.full_name if student else "học viên"
    )
    class_name = record.class_name_snapshot or (class_.name if class_ else "lớp")
    due_text = _format_date(due_date) if due_date else record.period

    return (
        f"TPRO English thông báo học phí của em {student_name} - {class_name} "
        f"đến hạn ngày {due_text}. Số tiền: {_format_currency(_to_int(record.final_amount))}. "
        "Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh."
    )


def _to_response(
    record: FeeRecord, reference_date: date | None = None
) -> FeeRecordResponse:
    enrollment = record.enrollment
    student = enrollment.student if enrollment else None
    class_ = enrollment.class_ if enrollment else None
    effective_reference_date = reference_date or _period_to_date(record.period)
    due_date = record.due_date or (
        get_enrollment_due_date_in_month(enrollment, effective_reference_date)
        if enrollment
        else None
    )
    parent_contact_hidden = bool(
        student and "parent_contact" in (student.hidden_fields or [])
    )
    student_contact_hidden = bool(
        student and "student_contact" in (student.hidden_fields or [])
    )
    has_complete_parent_contact = bool(
        student
        and student.parent_phone
        and student.parent_zalo
        and not parent_contact_hidden
    )
    has_complete_student_contact = bool(
        student
        and student.student_phone
        and student.student_zalo
        and not student_contact_hidden
    )
    protected_identity = is_fee_record_protected(record)
    student_name = (
        record.student_name_snapshot
        if protected_identity and record.student_name_snapshot
        else (student.full_name if student else "")
    )
    class_name = (
        record.class_name_snapshot
        if protected_identity and record.class_name_snapshot
        else (class_.name if class_ else "")
    )
    class_type = (
        record.class_type_snapshot
        if protected_identity and record.class_type_snapshot
        else (class_.type if class_ else "MONTHLY")
    )
    billing_cycle_months = (
        record.billing_cycle_months_snapshot
        if protected_identity and record.billing_cycle_months_snapshot
        else (class_.billing_cycle_months if class_ else 1)
    )
    paid_amount = (
        _to_int(record.paid_amount) if record.paid_amount is not None else None
    )
    refunded_amount = _to_int(record.refunded_amount)
    net_collected_amount = max(0, (paid_amount or 0) - refunded_amount)
    refundable_amount = net_collected_amount if record.status == "PAID" else 0
    return FeeRecordResponse(
        id=record.id,
        enrollment_id=record.enrollment_id,
        student_id=enrollment.student_id if enrollment else "",
        student_name=student_name,
        class_id=enrollment.class_id if enrollment else "",
        class_name=class_name,
        class_type=class_type,
        billing_cycle_months=billing_cycle_months,
        student_phone=(student.student_phone if has_complete_student_contact else None),
        student_zalo=(student.student_zalo if has_complete_student_contact else None),
        student_contact_hidden=student_contact_hidden,
        parent_phone=(student.parent_phone if has_complete_parent_contact else None),
        parent_zalo=(student.parent_zalo if has_complete_parent_contact else None),
        parent_contact_hidden=parent_contact_hidden,
        period=record.period,
        enrollment_date=(
            record.enrollment_date_snapshot
            or (enrollment.enrollment_date if enrollment else None)
        ),
        due_date=due_date,
        base_amount=_to_int(record.base_amount),
        discount_amount=_to_int(record.discount_amount),
        final_amount=_to_int(record.final_amount),
        status=record.status,
        paid_amount=paid_amount,
        paid_date=record.paid_date,
        refunded_amount=refunded_amount,
        refundable_amount=refundable_amount,
        net_collected_amount=net_collected_amount,
        refund_state=_get_refund_state(paid_amount, refunded_amount),
        notified_at=record.notified_at,
        notification_channel=record.notification_channel,
        notification_message=record.notification_message,
        notification_state=_get_notification_state(record),
    )


def _freeze_business_identity(record: FeeRecord) -> None:
    enrollment = record.enrollment
    student = enrollment.student if enrollment else None
    class_ = enrollment.class_ if enrollment else None
    if student is not None:
        record.student_name_snapshot = student.full_name
    if class_ is not None:
        record.class_name_snapshot = class_.name
        record.class_type_snapshot = class_.type
        record.billing_cycle_months_snapshot = class_.billing_cycle_months


def _get_notification_state(record: FeeRecord) -> str:
    if record.status == "PAID":
        return "PAID"
    if record.notified_at is not None:
        return "NOTIFIED_UNPAID"
    return "UNNOTIFIED"


def _get_refund_state(paid_amount: int | None, refunded_amount: int) -> str:
    if refunded_amount <= 0:
        return "NONE"
    if paid_amount is not None and refunded_amount >= paid_amount:
        return "FULL"
    return "PARTIAL"


def _record_class_name(record: FeeRecord) -> str:
    return record.class_name_snapshot or (
        record.enrollment.class_.name
        if record.enrollment is not None and record.enrollment.class_ is not None
        else "đã chọn"
    )


def _apply_fee_state_filter(query, state: str | None):
    if state == "PAID":
        return query.where(FeeRecord.status == "PAID")
    if state == "NOTIFIED_UNPAID":
        return query.where(
            FeeRecord.status == "UNPAID",
            FeeRecord.notified_at.is_not(None),
        )
    if state == "UNNOTIFIED":
        return query.where(
            FeeRecord.status == "UNPAID",
            FeeRecord.notified_at.is_(None),
        )
    return query


def _period_to_date(period: str) -> date:
    try:
        year_text, month_text = period.split("-")
        return date(int(year_text), int(month_text), 1)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Kỳ học phí không hợp lệ",
        ) from None


def _to_int(value: Decimal | int | None) -> int:
    return int(value or 0)


def _format_currency(amount: int) -> str:
    return f"{amount:,}".replace(",", ".") + "đ"


def _format_date(value: date) -> str:
    return value.strftime("%d/%m/%Y")
