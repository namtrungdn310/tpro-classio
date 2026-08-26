from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager, raiseload

from app.core.billing import (
    get_enrollment_due_date_in_month,
    get_enrollment_fee_amount,
)
from app.core.billing_schedule import month_end
from app.core.business_time import business_today
from app.core.fee_messages import DEFAULT_FEE_REMINDER_TEMPLATE
from app.core.class_lifecycle import (
    active_class_today_predicate,
    is_active_class_today,
    operational_class_predicate,
)
from app.core.performance import log_timing
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.payment import Payment
from app.models.banking import WorkspacePaymentAccount
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
from app.services.fee_cycle_service import ensure_enrollment_cycles
from app.services.fee_reconciliation import (
    is_fee_record_protected,
    lock_fee_period,
)
from app.services.fee_operation_service import (
    FeeOperationActorSnapshot,
    append_fee_operation,
    snapshot_fee_record,
)


@dataclass
class _PaymentLedgerState:
    net_amount: int = 0
    payment_method: str | None = None
    payment_id: str | None = None
    has_entries: bool = False
    settlement_account_id: str | None = None
    settlement_bank_code: str | None = None
    settlement_bank_name: str | None = None
    settlement_account_number: str | None = None
    settlement_account_name: str | None = None


async def _load_settlement_account(
    db: AsyncSession,
    settlement_account_id: UUID | str | None,
) -> WorkspacePaymentAccount | None:
    """Resolve an active receiving account for a new ledger entry.

    Account selection is deliberately server-side: the client only submits an
    id, while the immutable bank/account snapshots are taken from the current
    workspace-owned row at the moment the payment is recorded.
    """
    if settlement_account_id is None:
        return None
    account = await db.scalar(
        select(WorkspacePaymentAccount).where(
            WorkspacePaymentAccount.id == str(settlement_account_id),
            WorkspacePaymentAccount.is_active.is_(True),
        )
    )
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tài khoản ngân hàng không tồn tại hoặc đã ngừng sử dụng.",
        )
    return account


def _settlement_snapshot_kwargs(
    account: WorkspacePaymentAccount | None,
) -> dict[str, str | None]:
    if account is None:
        return {}
    return {
        "settlement_account_id": account.id,
        "settlement_bank_code_snapshot": account.bank_code,
        "settlement_bank_name_snapshot": account.bank_name,
        "settlement_account_number_snapshot": account.account_number,
        "settlement_account_name_snapshot": account.account_name,
    }


async def sync_fee_records_for_period(
    db: AsyncSession,
    period: str,
    *,
    actor_id: str | None = None,
    actor_snapshot: FeeOperationActorSnapshot | None = None,
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
                .options(contains_eager(Enrollment.class_), raiseload("*"))
                .where(
                    Enrollment.status == "active",
                    active_class_today_predicate(reference_date),
                    Student.status == "active",
                ),
            )
        enrollments = enrollment_result.scalars().unique().all()

        # R6: lazily materialize missing future cycles for the period window;
        # existing records are never rewritten.
        created_any = False
        for enrollment in enrollments:
            created = await ensure_enrollment_cycles(
                db,
                enrollment,
                up_to=month_end(reference_date),
            )
            created_any = created_any or bool(created)

        # R6: VOID (không DELETE) các draft ngoài phạm vi; protected giữ nguyên.
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
                    raiseload("*"),
                )
                .where(FeeRecord.period == period)
                .with_for_update(of=FeeRecord),
            )
        existing_records = existing_result.scalars().unique().all()
        active_enrollment_ids = {enrollment.id for enrollment in enrollments}
        voided: list[FeeRecord] = []
        for record in existing_records:
            if record.enrollment_id in active_enrollment_ids:
                continue
            if is_fee_record_protected(record):
                continue
            if record.status in ("VOID", "SUPERSEDED"):
                continue
            record.status = "VOID"
            record.voided_at = datetime.now(timezone.utc)
            voided.append(record)

        if not created_any and not voided:
            await db.rollback()
            return

        await db.flush()
        if voided:
            await append_fee_operation(
                db,
                action="sync_void",
                before=[snapshot_fee_record(record) for record in voided],
                after=[snapshot_fee_record(record) for record in voided],
                actor_id=actor_id,
                amount_deltas=[0] * len(voided),
                actor_snapshot=actor_snapshot,
            )
        await db.commit()


async def get_fee_records(
    db: AsyncSession,
    period: str,
    class_id: UUID | None = None,
    state: str | None = None,
    include_future: bool = False,
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
                raiseload("*"),
            )
            .where(FeeRecord.period == period)
            # R6: VOID/SUPERSEDED là terminal lifecycle markers — không hiển thị
            # trong danh sách nghĩa vụ; lịch sử vẫn truy vấn được qua report.
            .where(FeeRecord.status.notin_(("VOID", "SUPERSEDED")))
        )
        # Default view keeps future UNPAID obligations out of the ordinary
        # due-list.  Paid rows remain visible even if a manager recorded a
        # legitimate early payment.  The explicit include_future scope is used
        # by the early-payment UI and is never implied by a normal refresh.
        today = business_today()
        if not include_future:
            query = query.where(
                or_(
                    func.coalesce(FeeRecord.adjusted_due_date, FeeRecord.due_date)
                    <= today,
                    FeeRecord.status == "PAID",
                )
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


async def get_outstanding_fee_records(
    db: AsyncSession,
    *,
    class_id: UUID | None = None,
) -> FeeRecordListResponse:
    """Return every due, unpaid obligation without collapsing its fee period.

    The ordinary fee list is deliberately period-scoped.  This read model is
    the complementary collections queue: old unpaid rows remain visible after
    a new period starts, while each row keeps its canonical ``period`` and
    record id so notification/payment commands still target the correct debt.
    """

    today = business_today()
    query = (
        select(FeeRecord)
        .join(Enrollment, Enrollment.id == FeeRecord.enrollment_id)
        .join(Student, Student.id == Enrollment.student_id)
        .join(Class, Class.id == Enrollment.class_id)
        .options(
            contains_eager(FeeRecord.enrollment).contains_eager(Enrollment.student),
            contains_eager(FeeRecord.enrollment).contains_eager(Enrollment.class_),
            raiseload("*"),
        )
        .where(
            FeeRecord.status == "UNPAID",
            func.coalesce(FeeRecord.adjusted_due_date, FeeRecord.due_date) <= today,
        )
        .order_by(
            func.coalesce(FeeRecord.adjusted_due_date, FeeRecord.due_date),
            FeeRecord.period,
            Class.name,
            Student.full_name,
            FeeRecord.id,
        )
    )
    if class_id is not None:
        query = query.where(Enrollment.class_id == str(class_id))

    with log_timing(
        "fee_service.get_outstanding_fee_records",
        threshold_ms=40,
        class_id=str(class_id) if class_id is not None else None,
    ):
        result = await db.execute(query)

    records = [_to_response(record) for record in result.scalars().unique().all()]
    return FeeRecordListResponse(period="outstanding", records=records)


async def get_upcoming_fee_records(
    db: AsyncSession,
    *,
    class_id: UUID | None = None,
    limit: int = 100,
) -> FeeRecordListResponse:
    """Return a bounded, management-only view of future unpaid obligations.

    This is deliberately separate from the period list: an early-payment
    action must not depend on which calendar month happens to be selected in
    the main fee screen.  The window is bounded by the same server setting as
    the early-payment command, and only current active classes/enrollments
    are eligible.  ``period=upcoming`` is a transport label, not a fee
    identity; each record keeps its canonical cycle/due-date fields.
    """
    from app.core.config import settings

    today = business_today()
    max_due = today + timedelta(days=settings.payment_early_window_days)
    safe_limit = max(1, min(limit, 100))
    query = (
        select(FeeRecord)
        .join(Enrollment, Enrollment.id == FeeRecord.enrollment_id)
        .join(Student, Student.id == Enrollment.student_id)
        .join(Class, Class.id == Enrollment.class_id)
        .options(
            contains_eager(FeeRecord.enrollment).contains_eager(Enrollment.student),
            contains_eager(FeeRecord.enrollment).contains_eager(Enrollment.class_),
            raiseload("*"),
        )
        .where(
            FeeRecord.status == "UNPAID",
            Enrollment.status == "active",
            Student.status == "active",
            operational_class_predicate(today),
            func.coalesce(FeeRecord.adjusted_due_date, FeeRecord.due_date) > today,
            func.coalesce(FeeRecord.adjusted_due_date, FeeRecord.due_date) <= max_due,
        )
        .order_by(
            func.coalesce(FeeRecord.adjusted_due_date, FeeRecord.due_date),
            Class.name,
            Student.full_name,
            FeeRecord.id,
        )
        .limit(safe_limit)
    )
    if class_id is not None:
        query = query.where(Enrollment.class_id == str(class_id))
    result = await db.execute(query)
    records = [_to_response(record) for record in result.scalars().unique().all()]
    return FeeRecordListResponse(period="upcoming", records=records)


async def get_fee_periods(db: AsyncSession) -> FeePeriodListResponse:
    result = await db.execute(
        select(FeeRecord.period)
        .where(
            or_(
                func.coalesce(FeeRecord.adjusted_due_date, FeeRecord.due_date)
                <= business_today(),
                FeeRecord.status == "PAID",
            )
        )
        .distinct()
        .order_by(FeeRecord.period.desc())
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
    actor_snapshot: FeeOperationActorSnapshot | None = None,
) -> FeeRecordResponse | None:
    result = await mark_fees_notified(
        db,
        [id],
        message,
        channel,
        actor_id=actor_id,
        actor_snapshot=actor_snapshot,
    )
    return result.records[0] if result.records else None


async def mark_fee_paid(
    db: AsyncSession,
    id: UUID,
    actor_id: str | None = None,
    payment_method: str = "bank_transfer",
    settlement_account_id: UUID | str | None = None,
    allow_early: bool = False,
    actor_snapshot: FeeOperationActorSnapshot | None = None,
) -> FeeRecordResponse | None:
    result = await mark_fees_paid(
        db,
        [id],
        actor_id=actor_id,
        payment_method=payment_method,
        settlement_account_id=settlement_account_id,
        allow_early=allow_early,
        actor_snapshot=actor_snapshot,
    )
    return result.records[0] if result.records else None


async def mark_fee_unpaid(
    db: AsyncSession,
    id: UUID,
    actor_id: str | None = None,
    target_notification_state: FeeUnpayTargetState = "NOTIFIED_UNPAID",
    actor_snapshot: FeeOperationActorSnapshot | None = None,
) -> FeeRecordResponse | None:
    result = await mark_fees_unpaid(
        db,
        [id],
        actor_id=actor_id,
        target_notification_state=target_notification_state,
        actor_snapshot=actor_snapshot,
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
    actor_snapshot: FeeOperationActorSnapshot | None = None,
) -> FeeBatchResponse:
    return await _transition_fee_records(
        db,
        ids,
        action="notify",
        actor_id=actor_id,
        message=message,
        channel=channel,
        request_id=request_id,
        actor_snapshot=actor_snapshot,
    )


async def mark_fees_paid(
    db: AsyncSession,
    ids: list[UUID],
    *,
    actor_id: str | None = None,
    payment_method: str = "bank_transfer",
    settlement_account_id: UUID | str | None = None,
    allow_early: bool = False,
    request_id: UUID | None = None,
    actor_snapshot: FeeOperationActorSnapshot | None = None,
    payment_origin: str = "manual",
    provider_transaction_id: str | None = None,
    preserve_payment_request: bool = False,
    commit: bool = True,
) -> FeeBatchResponse:
    return await _transition_fee_records(
        db,
        ids,
        action="pay",
        actor_id=actor_id,
        payment_method=payment_method,
        settlement_account_id=settlement_account_id,
        allow_early=allow_early,
        request_id=request_id,
        actor_snapshot=actor_snapshot,
        payment_origin=payment_origin,
        provider_transaction_id=provider_transaction_id,
        preserve_payment_request=preserve_payment_request,
        commit=commit,
    )


async def mark_fees_unpaid(
    db: AsyncSession,
    ids: list[UUID],
    *,
    actor_id: str | None = None,
    target_notification_state: FeeUnpayTargetState = "NOTIFIED_UNPAID",
    request_id: UUID | None = None,
    actor_snapshot: FeeOperationActorSnapshot | None = None,
) -> FeeBatchResponse:
    return await _transition_fee_records(
        db,
        ids,
        action="unpay",
        actor_id=actor_id,
        target_notification_state=target_notification_state,
        request_id=request_id,
        actor_snapshot=actor_snapshot,
    )


async def mark_fees_unnotified(
    db: AsyncSession,
    ids: list[UUID],
    *,
    actor_id: str | None = None,
    request_id: UUID | None = None,
    actor_snapshot: FeeOperationActorSnapshot | None = None,
) -> FeeBatchResponse:
    return await _transition_fee_records(
        db,
        ids,
        action="unnotify",
        actor_id=actor_id,
        request_id=request_id,
        actor_snapshot=actor_snapshot,
    )


async def refund_fee_records(
    db: AsyncSession,
    payload: FeeBatchRefundRequest,
    *,
    actor_id: str,
    actor_snapshot: FeeOperationActorSnapshot | None = None,
) -> FeeRefundBatchResponse:
    """Append an atomic, idempotent refund across one student's fee records."""

    request_id = str(payload.request_id)
    refund_settlement_account = (
        await _load_settlement_account(db, payload.settlement_account_id)
        if payload.refund_method == "bank_transfer"
        else None
    )
    if payload.refund_method == "cash" and payload.settlement_account_id is not None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Hoàn tiền mặt không cần chọn tài khoản ngân hàng.",
        )
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
            **_settlement_snapshot_kwargs(refund_settlement_account),
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
            actor_snapshot=actor_snapshot,
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
    actor_snapshot: FeeOperationActorSnapshot | None = None,
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
        settlement_account_id=source.settlement_account_id,
        settlement_bank_code_snapshot=source.settlement_bank_code_snapshot,
        settlement_bank_name_snapshot=source.settlement_bank_name_snapshot,
        settlement_account_number_snapshot=source.settlement_account_number_snapshot,
        settlement_account_name_snapshot=source.settlement_account_name_snapshot,
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
            actor_snapshot=actor_snapshot,
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
    settlement_account_id: UUID | str | None = None,
    allow_early: bool = False,
    target_notification_state: FeeUnpayTargetState = "NOTIFIED_UNPAID",
    request_id: UUID | None = None,
    actor_snapshot: FeeOperationActorSnapshot | None = None,
    payment_origin: str = "manual",
    provider_transaction_id: str | None = None,
    preserve_payment_request: bool = False,
    commit: bool = True,
) -> FeeBatchResponse:
    """Apply one state transition to every requested record atomically.

    Existing fee obligations are serialized by row lock. Reconciliation takes
    the period lock before acquiring those same row locks; a transition never
    needs the period lock because it cannot create a record. Avoiding that
    redundant lock and lookup removes two remote database round trips while
    preserving atomicity and preventing half-updated multi-class students.
    """

    if action not in {"notify", "pay", "unpay", "unnotify"}:
        raise ValueError(f"Unsupported fee transition: {action}")
    if action == "unpay" and target_notification_state not in {
        "UNNOTIFIED",
        "NOTIFIED_UNPAID",
    }:
        raise ValueError(f"Unsupported unpay target state: {target_notification_state}")

    if (
        action == "pay"
        and payment_method == "cash"
        and settlement_account_id is not None
    ):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Thanh toán tiền mặt không cần chọn tài khoản ngân hàng.",
        )
    settlement_account = (
        await _load_settlement_account(db, settlement_account_id)
        if action == "pay"
        else None
    )

    ordered_ids = list(dict.fromkeys(str(id_) for id_ in ids))
    records = await _load_locked_fee_records(db, ordered_ids)
    if (
        action == "unpay"
        and target_notification_state == "NOTIFIED_UNPAID"
        and any(
            record.status == "PAID"
            and (
                record.notified_at is None
                or not record.notification_channel
                or not record.notification_message
            )
            for record in records
        )
    ):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Khoản thu chưa có lịch sử báo phụ huynh. "
                "Chỉ có thể hoàn tác về trạng thái Chưa báo."
            ),
        )
    before_by_id = {record.id: snapshot_fee_record(record) for record in records}
    payment_date = business_today()
    current_period = payment_date.strftime("%Y-%m")
    if action == "notify" or (action == "pay" and not allow_early):
        if any(
            (
                _effective_due_date(record) is not None
                and _effective_due_date(record) > payment_date
            )
            or record.period > current_period
            for record in records
        ):
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Không thể báo hoặc thu một kỳ học phí trong tương lai",
            )
    if action == "pay" and allow_early:
        from app.core.config import settings

        selected = set(ordered_ids)
        for record in records:
            due = _effective_due_date(record)
            if due is None or due <= payment_date:
                continue
            if due > payment_date + timedelta(days=settings.payment_early_window_days):
                await db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Chỉ được ghi nhận sớm kỳ thu gần nhất trong phạm vi cho phép.",
                )
            earlier = await db.scalar(
                select(FeeRecord.id)
                .where(
                    FeeRecord.enrollment_id == record.enrollment_id,
                    FeeRecord.status == "UNPAID",
                    FeeRecord.id.notin_(selected),
                    func.coalesce(FeeRecord.adjusted_due_date, FeeRecord.due_date)
                    < due,
                )
                .limit(1)
            )
            if earlier is not None:
                await db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cần xử lý kỳ học phí trước đó trước khi ghi nhận sớm kỳ này.",
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
    # Response contract meaning: remove these rows from the active projection.
    # The underlying financial records remain append-only and are marked VOID.
    deleted_ids: list[UUID] = []
    notification_time = datetime.now(timezone.utc)
    changed_records: list[FeeRecord] = []
    operation_payments: list[Payment | None] = []
    operation_deltas: list[int] = []
    payment_record_ids: list[str] = []
    open_payment_request_ids: dict[str, str] = {}

    if action == "pay":
        from app.services.payment_scaffold_service import (
            get_open_payment_request_ids_for_fee_records,
        )

        open_payment_request_ids = await get_open_payment_request_ids_for_fee_records(
            db, ordered_ids
        )

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
                payment_request_id=open_payment_request_ids.get(record.id),
                entry_type="payment",
                payment_origin=(
                    payment_origin
                    if payment_origin != "manual"
                    else (
                        "manual_early"
                        if allow_early
                        and (_effective_due_date(record) or payment_date) > payment_date
                        else "manual"
                    )
                ),
                provider_transaction_id=(
                    provider_transaction_id if not payment_record_ids else None
                ),
                note=f"Ghi nhận học phí kỳ {record.period}",
                created_by=actor_id,
                **_settlement_snapshot_kwargs(settlement_account),
            )
            db.add(payment)
            payment_record_ids.append(record.id)
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
                settlement_account_id=getattr(
                    ledger_states[record.id], "settlement_account_id", None
                ),
                settlement_bank_code_snapshot=getattr(
                    ledger_states[record.id], "settlement_bank_code", None
                ),
                settlement_bank_name_snapshot=getattr(
                    ledger_states[record.id], "settlement_bank_name", None
                ),
                settlement_account_number_snapshot=getattr(
                    ledger_states[record.id], "settlement_account_number", None
                ),
                settlement_account_name_snapshot=getattr(
                    ledger_states[record.id], "settlement_account_name", None
                ),
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
                record.status = "VOID"
                record.voided_at = notification_time
                deleted_ids.append(UUID(record.id))

    # PostgreSQL expires generated columns such as ``final_amount`` when an
    # UPDATE is flushed. Capture transitions whose response is fully derived
    # from the already locked in-memory rows before that flush; otherwise
    # serializing the response can accidentally trigger async lazy I/O and
    # raise MissingGreenlet. Unnotify is excluded because it may recalculate
    # or delete current-period drafts and therefore still requires a reload.
    immediate_response = (
        FeeBatchResponse(
            records=[_to_response(record) for record in records],
            deleted_ids=[],
        )
        if action in {"notify", "pay", "unpay"}
        else None
    )

    if payment_record_ids:
        # A manual payment (including an allowed early cash/bank payment)
        # invalidates any open QR/reference for the same obligation.  This is
        # an audited status transition and prevents a stale code from being
        # posted a second time by a future webhook adapter.  Build the public
        # response first: the lookup below may autoflush generated columns,
        # and the response must not trigger async lazy I/O afterwards.
        from app.services.payment_scaffold_service import (
            revoke_open_payment_requests_for_fee_records,
        )

        if not preserve_payment_request:
            await revoke_open_payment_requests_for_fee_records(
                db,
                payment_record_ids,
                actor_id=actor_id,
                reason="Khoản học phí đã được ghi nhận thanh toán thủ công",
            )

    if not changed:
        response = FeeBatchResponse(
            records=[_to_response(record) for record in records],
            deleted_ids=[],
        )
        if commit:
            await db.rollback()
        return response

    await db.flush()
    await append_fee_operation(
        db,
        action={
            "notify": "notify",
            "pay": "payment",
            "unpay": "payment_reversal",
            "unnotify": "unnotify",
        }[action],
        before=[before_by_id[record.id] for record in changed_records],
        after=[snapshot_fee_record(record) for record in changed_records],
        actor_id=actor_id,
        request_id=request_id,
        payments=operation_payments,
        amount_deltas=operation_deltas,
        actor_snapshot=actor_snapshot,
    )

    if immediate_response is not None:
        if commit:
            await db.commit()
        return immediate_response

    remaining_ids = [id_ for id_ in ordered_ids if UUID(id_) not in deleted_ids]
    if commit:
        await db.commit()
    else:
        return FeeBatchResponse(
            records=[_to_response(record) for record in records],
            deleted_ids=deleted_ids,
        )
    updated_records = await _get_fee_records_by_ids(db, remaining_ids)
    return FeeBatchResponse(
        records=[_to_response(record) for record in updated_records],
        deleted_ids=deleted_ids,
    )


async def _load_locked_fee_records(
    db: AsyncSession,
    ordered_ids: list[str],
) -> list[FeeRecord]:
    records = await _get_fee_records_by_ids(db, ordered_ids, for_update=True)
    if len(records) != len(ordered_ids):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy một hoặc nhiều khoản học phí",
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
    expected_settlement_account_id = (
        str(payload.settlement_account_id)
        if payload.refund_method == "bank_transfer"
        else None
    )
    actual_amounts = {entry.fee_record_id: -_to_int(entry.amount) for entry in entries}
    is_same_request = (
        len(entries) == len(payload.items)
        and actual_amounts == expected_amounts
        and all(entry.entry_type == "refund" for entry in entries)
        and all(entry.payment_method == payload.refund_method for entry in entries)
        and all(
            entry.settlement_account_id == expected_settlement_account_id
            for entry in entries
        )
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
        payment_origin=entry.payment_origin,
        settlement_account_id=entry.settlement_account_id,
        settlement_bank_name=entry.settlement_bank_name_snapshot,
        settlement_account_number=entry.settlement_account_number_snapshot,
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
            Payment.settlement_account_id,
            Payment.settlement_bank_code_snapshot,
            Payment.settlement_bank_name_snapshot,
            Payment.settlement_account_number_snapshot,
            Payment.settlement_account_name_snapshot,
        )
        .where(Payment.fee_record_id.in_(fee_record_ids))
        .order_by(Payment.created_at.desc(), Payment.id.desc())
    )
    states: dict[str, _PaymentLedgerState] = {}
    for (
        payment_id,
        fee_record_id,
        payment_method,
        amount,
        entry_type,
        settlement_account_id,
        settlement_bank_code,
        settlement_bank_name,
        settlement_account_number,
        settlement_account_name,
    ) in result.all():
        state = states.setdefault(fee_record_id, _PaymentLedgerState())
        state.has_entries = True
        state.net_amount += _to_int(amount)
        # Entries are newest first. Keep the newest original payment as the
        # auditable source that a refund references. Legacy rows created before
        # entry types are backfilled by migration 028.
        if state.payment_id is None and entry_type == "payment":
            state.payment_id = payment_id
            state.payment_method = payment_method
            state.settlement_account_id = settlement_account_id
            state.settlement_bank_code = settlement_bank_code
            state.settlement_bank_name = settlement_bank_name
            state.settlement_account_number = settlement_account_number
            state.settlement_account_name = settlement_account_name
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
            raiseload("*"),
        )
    )
    if for_update:
        query = query.with_for_update(of=FeeRecord)

    result = await db.execute(query.execution_options(populate_existing=True))
    records_by_id = {record.id: record for record in result.scalars().unique().all()}
    return [records_by_id[id_] for id_ in ordered_ids if id_ in records_by_id]


async def get_fee_records_for_payment_request(
    db: AsyncSession,
    ids: list[UUID],
) -> list[FeeRecord]:
    """Load and lock fee rows for the explicit early-payment command."""
    ordered_ids = list(dict.fromkeys(str(id_) for id_ in ids))
    records = await _get_fee_records_by_ids(db, ordered_ids, for_update=True)
    if len(records) != len(ordered_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy một hoặc nhiều khoản học phí.",
        )
    return records


def _reconcile_unnotified_record(record: FeeRecord) -> bool:
    """Refresh a current-period draft after its notification is undone.

    Returns ``True`` when the record is no longer chargeable and must leave the
    active projection. The caller marks it VOID; financial rows are never
    physically deleted.
    """

    enrollment = record.enrollment
    class_ = enrollment.class_ if enrollment else None
    student = enrollment.student if enrollment else None
    is_chargeable = bool(
        enrollment
        and enrollment.status == "active"
        and class_
        and is_active_class_today(class_)
        and student
        and student.status == "active"
    )
    reference_date = _period_to_date(record.period)
    # A canonical cycle record already carries its own anchor.  Never derive
    # a course/package due date from ``period``: a 4-week package may have two
    # or more obligations in the same calendar month, while the legacy helper
    # intentionally returns only one monthly date.  The period remains a
    # reporting bucket, not the fee identity.
    due_date = None
    if is_chargeable and enrollment is not None:
        if record.cycle_no is None:
            # Legacy period-only rows must retain their historical
            # reconciliation semantics.  ``due_date`` on these rows was a
            # stale projection, not a canonical cycle anchor; recompute the
            # monthly due date from the enrollment and reporting period.
            due_date = get_enrollment_due_date_in_month(enrollment, reference_date)
        else:
            # Canonical cycle rows carry their own anchor.  Never derive a
            # course/package due date from ``period``: a 4-week package may
            # have two or more obligations in the same calendar month.
            due_date = record.base_due_date or record.due_date
    if due_date is None:
        return True

    record.base_amount = get_enrollment_fee_amount(enrollment)
    # Keep the canonical/base due separate from a service-credit adjustment.
    # Reconciliation is allowed to refresh an unnotified projection, but must
    # not erase a previously granted deferral.  Older rows may not have the
    # new base/adjusted columns populated, so initialize them conservatively.
    if record.base_due_date is None:
        record.base_due_date = due_date
    record.due_date = record.base_due_date
    if record.adjusted_due_date is None:
        record.adjusted_due_date = record.base_due_date
    record.enrollment_date_snapshot = enrollment.enrollment_date
    return False


def _effective_due_date(record: FeeRecord, fallback: date | None = None) -> date | None:
    """Return the date users should act on after service-credit adjustments."""

    return record.adjusted_due_date or record.due_date or fallback


def build_zalo_fee_message(
    record: FeeRecord, reference_date: date | None = None
) -> str:
    enrollment = record.enrollment
    student = enrollment.student if enrollment else None
    class_ = enrollment.class_ if enrollment else None
    effective_reference_date = reference_date or _period_to_date(record.period)
    due_date = _effective_due_date(
        record,
        (
            get_enrollment_due_date_in_month(enrollment, effective_reference_date)
            if enrollment
            else None
        ),
    )
    student_name = record.student_name_snapshot or (
        student.full_name if student else "học viên"
    )
    class_name = record.class_name_snapshot or (class_.name if class_ else "lớp")
    due_text = _format_date(due_date) if due_date else record.period

    message = DEFAULT_FEE_REMINDER_TEMPLATE
    replacements = {
        "{{ten_hoc_vien}}": student_name,
        "{{ky_hoc_phi}}": _format_fee_period_label(record.period),
        "{{chi_tiet_hoc_phi}}": f"{class_name}: {_format_currency(_to_int(record.final_amount))}",
        "{{ngay_den_han}}": due_text,
        "{{tong_tien}}": _format_currency(_to_int(record.final_amount)),
    }
    for token, replacement in replacements.items():
        message = message.replace(token, replacement)
    return message


def _to_response(
    record: FeeRecord, reference_date: date | None = None
) -> FeeRecordResponse:
    enrollment = record.enrollment
    student = enrollment.student if enrollment else None
    class_ = enrollment.class_ if enrollment else None
    effective_reference_date = reference_date or _period_to_date(record.period)
    due_date = _effective_due_date(
        record,
        (
            get_enrollment_due_date_in_month(enrollment, effective_reference_date)
            if enrollment
            else None
        ),
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
    billing_cycle_weeks = (
        record.billing_cycle_weeks_snapshot
        if protected_identity and record.billing_cycle_weeks_snapshot
        else (class_.billing_cycle_weeks if class_ else None)
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
        student_code=student.student_code if student else None,
        student_status=student.status if student else None,
        student_name=student_name,
        class_id=enrollment.class_id if enrollment else "",
        class_name=class_name,
        class_type=class_type,
        billing_cycle_months=billing_cycle_months,
        billing_cycle_weeks=billing_cycle_weeks,
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
        cycle_no=record.cycle_no,
        base_due_date=record.base_due_date,
        adjusted_due_date=record.adjusted_due_date,
        coverage_start=record.coverage_start,
        coverage_end=record.coverage_end,
        origin=record.origin,
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
        record.billing_cycle_weeks_snapshot = class_.billing_cycle_weeks


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
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Kỳ học phí không hợp lệ",
        ) from None


def _to_int(value: Decimal | int | None) -> int:
    return int(value or 0)


def _format_currency(amount: int) -> str:
    return f"{amount:,}".replace(",", ".") + "đ"


def _format_date(value: date) -> str:
    return value.strftime("%d/%m/%Y")


def _format_fee_period_label(period: str) -> str:
    try:
        year_text, month_text = period.split("-")
        return f"tháng {int(month_text)}/{year_text}"
    except (TypeError, ValueError):
        return period
