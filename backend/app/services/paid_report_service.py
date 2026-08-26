import base64
import binascii
import hashlib
import hmac
import json
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import (
    Text,
    and_,
    any_,
    case,
    cast,
    distinct,
    exists,
    func,
    literal,
    or_,
    select,
    true,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import settings
from app.models.fee_operation import FeeOperation, FeeOperationItem
from app.models.payment import Payment
from app.models.student import Student
from app.schemas.report import (
    FeePaidAllocationResponse,
    FeePaidReceiptDetailResponse,
    FeePaidReceiptListResponse,
    FeePaidReceiptSummaryResponse,
    FeePaidReportSummaryResponse,
    FeePaidTimelineEntryResponse,
)

FeePaidRefundState = Literal["NONE", "PARTIAL", "FULL", "REVERSED"]


def _to_int(value: Decimal | int | None) -> int:
    return int(value or 0)


def _b64encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sign_payload(payload: bytes) -> str:
    signature = hmac.new(
        settings.secret_key.encode(),
        b"fee-paid-report:" + payload,
        hashlib.sha256,
    ).digest()[:16]
    return f"{_b64encode(payload)}.{_b64encode(signature)}"


def _verify_payload(value: str) -> dict[str, object]:
    try:
        encoded_payload, encoded_signature = value.split(".", 1)
        payload = _b64decode(encoded_payload)
        signature = _b64decode(encoded_signature)
        expected = hmac.new(
            settings.secret_key.encode(),
            b"fee-paid-report:" + payload,
            hashlib.sha256,
        ).digest()[:16]
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        decoded = json.loads(payload)
        if not isinstance(decoded, dict):
            raise ValueError
        return decoded
    except (
        ValueError,
        TypeError,
        UnicodeDecodeError,
        binascii.Error,
        json.JSONDecodeError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Mã phiếu thu không hợp lệ",
        ) from exc


def _encode_receipt_id(operation_id: str, student_key: str) -> str:
    payload = json.dumps(
        {"v": 1, "op": operation_id, "student": student_key},
        separators=(",", ":"),
    ).encode()
    return _sign_payload(payload)


def _decode_receipt_id(receipt_id: str) -> tuple[str, str]:
    payload = _verify_payload(receipt_id)
    try:
        if payload.get("v") != 1:
            raise ValueError
        operation_id = str(UUID(str(payload["op"])))
        student_key = str(payload["student"])
        if not student_key or len(student_key) > 128:
            raise ValueError
        return operation_id, student_key
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Mã phiếu thu không hợp lệ",
        ) from exc


def _encode_paid_cursor(
    paid_at: datetime,
    sequence_no: int,
    student_key: str,
) -> str:
    payload = json.dumps(
        {
            "v": 1,
            "at": paid_at.isoformat(),
            "seq": sequence_no,
            "student": student_key,
        },
        separators=(",", ":"),
    ).encode()
    return _sign_payload(payload)


def _decode_paid_cursor(cursor: str) -> tuple[datetime, int, str]:
    try:
        payload = _verify_payload(cursor)
        if payload.get("v") != 1:
            raise ValueError
        paid_at = datetime.fromisoformat(str(payload["at"]))
        sequence_no = int(payload["seq"])
        student_key = str(payload["student"])
        if (
            paid_at.tzinfo is None
            or sequence_no < 1
            or not student_key
            or len(student_key) > 128
        ):
            raise ValueError
        return paid_at, sequence_no, student_key
    except HTTPException as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Con trỏ phân trang báo cáo không hợp lệ",
        ) from exc
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Con trỏ phân trang báo cáo không hợp lệ",
        ) from exc


def _refund_state(
    *,
    reversed_all: bool,
    gross_amount: int,
    refunded_amount: int,
) -> FeePaidRefundState:
    if reversed_all:
        return "REVERSED"
    if refunded_amount <= 0:
        return "NONE"
    if gross_amount > 0 and refunded_amount >= gross_amount:
        return "FULL"
    return "PARTIAL"


def _effective_refunds_subquery():
    refund_reversal = aliased(Payment)
    reversal_totals = (
        select(
            refund_reversal.related_payment_id.label("refund_payment_id"),
            func.coalesce(func.sum(refund_reversal.amount), 0).label("reversed_amount"),
        )
        .where(refund_reversal.entry_type == "refund_reversal")
        .group_by(refund_reversal.related_payment_id)
        .subquery()
    )

    refund = aliased(Payment)
    return (
        select(
            refund.related_payment_id.label("source_payment_id"),
            func.coalesce(
                func.sum(
                    func.greatest(
                        0,
                        -refund.amount
                        - func.coalesce(reversal_totals.c.reversed_amount, 0),
                    )
                ),
                0,
            ).label("refunded_amount"),
        )
        .outerjoin(
            reversal_totals,
            reversal_totals.c.refund_payment_id == refund.id,
        )
        .where(refund.entry_type == "refund")
        .group_by(refund.related_payment_id)
        .subquery()
    )


def _receipt_source():
    item = aliased(FeeOperationItem)
    payment = aliased(Payment)
    effective_refunds = _effective_refunds_subquery()
    payment_reversal = aliased(Payment)
    reversed_sources = (
        select(payment_reversal.related_payment_id.label("source_payment_id"))
        .where(payment_reversal.entry_type == "payment_reversal")
        .distinct()
        .subquery()
    )
    source_reversed = reversed_sources.c.source_payment_id.is_not(None)
    student_key = func.coalesce(
        cast(item.student_id, Text),
        cast(item.fee_record_id, Text),
        cast(item.id, Text),
    )
    effective_gross = func.coalesce(
        func.sum(case((source_reversed, 0), else_=payment.amount)),
        0,
    )
    effective_refunded = func.coalesce(
        func.sum(
            case(
                (source_reversed, 0),
                else_=func.coalesce(effective_refunds.c.refunded_amount, 0),
            )
        ),
        0,
    )

    return (
        select(
            FeeOperation.id.label("payment_operation_id"),
            FeeOperation.sequence_no.label("sequence_no"),
            FeeOperation.business_date.label("paid_date"),
            FeeOperation.occurred_at.label("paid_at"),
            FeeOperation.actor_name_snapshot.label("actor_name"),
            FeeOperation.actor_username_snapshot.label("actor_username"),
            FeeOperation.actor_role_snapshot.label("actor_role"),
            item.student_id.label("student_id"),
            func.min(
                func.coalesce(item.student_code_snapshot, Student.student_code)
            ).label("student_code"),
            func.coalesce(item.student_name_snapshot, "Học viên đã xoá").label(
                "student_name"
            ),
            student_key.label("student_key"),
            func.array_agg(distinct(item.period)).label("periods"),
            func.array_agg(distinct(item.class_name_snapshot)).label("class_names"),
            func.count(distinct(item.class_id)).label("class_count"),
            cast(func.min(cast(payment.payment_method, Text)), Text).label(
                "payment_method"
            ),
            cast(func.min(payment.payment_origin), Text).label("payment_origin"),
            cast(func.min(cast(payment.settlement_account_id, Text)), Text).label(
                "settlement_account_id"
            ),
            func.min(payment.settlement_bank_name_snapshot).label(
                "settlement_bank_name"
            ),
            func.min(payment.settlement_account_number_snapshot).label(
                "settlement_account_number"
            ),
            func.min(payment.settlement_account_name_snapshot).label(
                "settlement_account_name"
            ),
            func.bool_and(source_reversed).label("reversed_all"),
            effective_gross.label("gross_amount"),
            effective_refunded.label("refunded_amount"),
            func.greatest(0, effective_gross - effective_refunded).label("net_amount"),
            func.lower(
                func.string_agg(
                    func.concat_ws(
                        " ",
                        item.student_name_snapshot,
                        item.student_code_snapshot,
                        Student.student_code,
                        item.class_name_snapshot,
                        FeeOperation.actor_name_snapshot,
                        FeeOperation.actor_username_snapshot,
                        cast(FeeOperation.sequence_no, Text),
                        cast(FeeOperation.id, Text),
                    ),
                    " ",
                )
            ).label("search_text"),
        )
        .join(item, item.operation_id == FeeOperation.id)
        .join(payment, payment.id == item.payment_id)
        .outerjoin(Student, Student.id == item.student_id)
        .outerjoin(
            effective_refunds,
            effective_refunds.c.source_payment_id == payment.id,
        )
        .outerjoin(
            reversed_sources,
            reversed_sources.c.source_payment_id == payment.id,
        )
        .where(
            FeeOperation.action == "payment",
            payment.entry_type == "payment",
        )
        .group_by(
            FeeOperation.id,
            FeeOperation.sequence_no,
            FeeOperation.business_date,
            FeeOperation.occurred_at,
            FeeOperation.actor_name_snapshot,
            FeeOperation.actor_username_snapshot,
            FeeOperation.actor_role_snapshot,
            item.student_id,
            item.student_name_snapshot,
            student_key,
        )
        .cte("paid_receipts")
    )


def _refund_state_condition(receipts, refund_state: FeePaidRefundState):
    if refund_state == "REVERSED":
        return receipts.c.reversed_all.is_(True)
    if refund_state == "NONE":
        return and_(
            receipts.c.reversed_all.is_(False),
            receipts.c.refunded_amount <= 0,
        )
    if refund_state == "PARTIAL":
        return and_(
            receipts.c.reversed_all.is_(False),
            receipts.c.refunded_amount > 0,
            receipts.c.refunded_amount < receipts.c.gross_amount,
        )
    return and_(
        receipts.c.reversed_all.is_(False),
        receipts.c.gross_amount > 0,
        receipts.c.refunded_amount >= receipts.c.gross_amount,
    )


def _apply_paid_filters(
    query,
    receipts,
    *,
    period: str | None,
    query_text: str | None,
    date_from: date | None,
    date_to: date | None,
    payment_method: str | None,
    payment_origin: str | None,
    refund_state: FeePaidRefundState | None,
):
    conditions = []
    if period:
        conditions.append(literal(period) == any_(receipts.c.periods))
    if query_text:
        term = query_text.strip().casefold()
        if term:
            conditions.append(receipts.c.search_text.contains(term, autoescape=True))
    if date_from:
        conditions.append(receipts.c.paid_date >= date_from)
    if date_to:
        conditions.append(receipts.c.paid_date <= date_to)
    if payment_method:
        conditions.append(receipts.c.payment_method == payment_method)
    if payment_origin:
        conditions.append(receipts.c.payment_origin == payment_origin)
    if refund_state:
        conditions.append(_refund_state_condition(receipts, refund_state))
    else:
        conditions.append(receipts.c.reversed_all.is_(False))
    return query.where(and_(*conditions)) if conditions else query


def _normalise_text_array(value: list[str | None] | None) -> list[str]:
    return sorted(
        dict.fromkeys(item.strip() for item in value or [] if item and item.strip()),
        key=str.casefold,
    )


def _single_period(value: list[str | None] | None) -> str | None:
    periods = _normalise_text_array(value)
    return periods[0] if len(periods) == 1 else None


def _receipt_summary(row) -> FeePaidReceiptSummaryResponse:
    gross_amount = _to_int(row.gross_amount)
    refunded_amount = min(gross_amount, _to_int(row.refunded_amount))
    class_names = _normalise_text_array(row.class_names)
    return FeePaidReceiptSummaryResponse(
        receipt_id=_encode_receipt_id(
            str(row.payment_operation_id),
            row.student_key,
        ),
        payment_operation_id=UUID(str(row.payment_operation_id)),
        student_id=UUID(str(row.student_id)) if row.student_id else None,
        student_code=row.student_code,
        student_name=row.student_name,
        period=_single_period(row.periods),
        paid_date=row.paid_date,
        paid_at=row.paid_at,
        payment_method=row.payment_method,
        payment_origin=row.payment_origin or "manual",
        settlement_account_id=(
            UUID(str(row.settlement_account_id)) if row.settlement_account_id else None
        ),
        settlement_bank_name=row.settlement_bank_name,
        settlement_account_number=row.settlement_account_number,
        settlement_account_name=row.settlement_account_name,
        gross_amount=gross_amount,
        refunded_amount=refunded_amount,
        net_amount=max(0, gross_amount - refunded_amount),
        refund_state=_refund_state(
            reversed_all=bool(row.reversed_all),
            gross_amount=gross_amount,
            refunded_amount=refunded_amount,
        ),
        class_count=max(1, int(row.class_count or len(class_names) or 1)),
        class_names=class_names or ["Lớp đã xoá"],
        actor_name=row.actor_name,
        actor_username=row.actor_username,
        actor_role=row.actor_role,
    )


async def get_paid_fee_receipts(
    db: AsyncSession,
    *,
    period: str | None = None,
    query_text: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    payment_method: str | None = None,
    payment_origin: str | None = None,
    refund_state: FeePaidRefundState | None = None,
    cursor: str | None = None,
    limit: int = 30,
) -> FeePaidReceiptListResponse:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Ngày bắt đầu không được sau ngày kết thúc",
        )

    receipts = _receipt_source()
    filtered = _apply_paid_filters(
        select(receipts),
        receipts,
        period=period,
        query_text=query_text,
        date_from=date_from,
        date_to=date_to,
        payment_method=payment_method,
        payment_origin=payment_origin,
        refund_state=refund_state,
    )
    filtered_receipts = filtered.cte("filtered_paid_receipts")
    summary = (
        select(
            func.coalesce(func.sum(filtered_receipts.c.gross_amount), 0).label(
                "report_gross_amount"
            ),
            func.coalesce(func.sum(filtered_receipts.c.refunded_amount), 0).label(
                "report_refunded_amount"
            ),
            func.coalesce(func.sum(filtered_receipts.c.net_amount), 0).label(
                "report_net_amount"
            ),
            func.count().label("report_receipt_count"),
            func.count(distinct(filtered_receipts.c.student_key)).label(
                "report_student_count"
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            filtered_receipts.c.payment_method == "bank_transfer",
                            filtered_receipts.c.net_amount,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("report_bank_transfer_net_amount"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            filtered_receipts.c.payment_method == "cash",
                            filtered_receipts.c.net_amount,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("report_cash_net_amount"),
        ).select_from(filtered_receipts)
    ).cte("paid_report_summary")

    page_query = select(filtered_receipts)
    if cursor:
        cursor_at, cursor_sequence, cursor_student = _decode_paid_cursor(cursor)
        page_query = page_query.where(
            or_(
                filtered_receipts.c.paid_at < cursor_at,
                and_(
                    filtered_receipts.c.paid_at == cursor_at,
                    filtered_receipts.c.sequence_no < cursor_sequence,
                ),
                and_(
                    filtered_receipts.c.paid_at == cursor_at,
                    filtered_receipts.c.sequence_no == cursor_sequence,
                    filtered_receipts.c.student_key < cursor_student,
                ),
            )
        )
    page_source = (
        page_query.order_by(
            filtered_receipts.c.paid_at.desc(),
            filtered_receipts.c.sequence_no.desc(),
            filtered_receipts.c.student_key.desc(),
        )
        .limit(limit + 1)
        .cte("paid_report_page")
    )
    rows = (
        await db.execute(
            select(
                page_source,
                summary.c.report_gross_amount,
                summary.c.report_refunded_amount,
                summary.c.report_net_amount,
                summary.c.report_receipt_count,
                summary.c.report_student_count,
                summary.c.report_bank_transfer_net_amount,
                summary.c.report_cash_net_amount,
            )
            .select_from(summary.outerjoin(page_source, true()))
            .order_by(
                page_source.c.paid_at.desc(),
                page_source.c.sequence_no.desc(),
                page_source.c.student_key.desc(),
            )
        )
    ).all()
    summary_row = rows[0]
    page_rows = [row for row in rows if row.payment_operation_id is not None]
    has_more = len(page_rows) > limit
    page = page_rows[:limit]
    gross_amount = _to_int(summary_row.report_gross_amount)
    refunded_amount = min(gross_amount, _to_int(summary_row.report_refunded_amount))
    return FeePaidReceiptListResponse(
        receipts=[_receipt_summary(row) for row in page],
        next_cursor=(
            _encode_paid_cursor(
                page[-1].paid_at,
                page[-1].sequence_no,
                page[-1].student_key,
            )
            if has_more and page
            else None
        ),
        summary=FeePaidReportSummaryResponse(
            gross_amount=gross_amount,
            refunded_amount=refunded_amount,
            net_amount=max(0, gross_amount - refunded_amount),
            receipt_count=int(summary_row.report_receipt_count or 0),
            student_count=int(summary_row.report_student_count or 0),
            bank_transfer_net_amount=_to_int(
                summary_row.report_bank_transfer_net_amount
            ),
            cash_net_amount=_to_int(summary_row.report_cash_net_amount),
        ),
    )


async def get_paid_fee_receipt(
    db: AsyncSession,
    receipt_id: str,
) -> FeePaidReceiptDetailResponse | None:
    operation_id, student_key = _decode_receipt_id(receipt_id)
    receipts = _receipt_source()
    row = (
        await db.execute(
            select(receipts).where(
                receipts.c.payment_operation_id == operation_id,
                receipts.c.student_key == student_key,
            )
        )
    ).one_or_none()
    if row is None:
        return None

    summary = _receipt_summary(row)
    allocations, source_payment_ids = await _load_allocations(
        db,
        operation_id=operation_id,
        student_key=student_key,
    )
    timeline = await _load_receipt_timeline(db, source_payment_ids)
    return FeePaidReceiptDetailResponse(
        **summary.model_dump(),
        allocations=allocations,
        timeline=timeline,
    )


async def _load_allocations(
    db: AsyncSession,
    *,
    operation_id: str,
    student_key: str,
) -> tuple[list[FeePaidAllocationResponse], list[str]]:
    item = aliased(FeeOperationItem)
    payment = aliased(Payment)
    effective_refunds = _effective_refunds_subquery()
    payment_reversal = aliased(Payment)
    reversed_sources = (
        select(payment_reversal.related_payment_id.label("source_payment_id"))
        .where(payment_reversal.entry_type == "payment_reversal")
        .distinct()
        .subquery()
    )
    source_reversed = reversed_sources.c.source_payment_id.is_not(None)
    item_student_key = func.coalesce(
        cast(item.student_id, Text),
        cast(item.fee_record_id, Text),
        cast(item.id, Text),
    )
    rows = (
        await db.execute(
            select(
                item.fee_record_id,
                item.enrollment_id,
                item.class_id,
                item.class_name_snapshot,
                item.period,
                payment.id.label("payment_id"),
                payment.amount.label("original_gross_amount"),
                source_reversed.label("source_reversed"),
                func.coalesce(
                    effective_refunds.c.refunded_amount,
                    0,
                ).label("refunded_amount"),
            )
            .join(payment, payment.id == item.payment_id)
            .outerjoin(
                effective_refunds,
                effective_refunds.c.source_payment_id == payment.id,
            )
            .outerjoin(
                reversed_sources,
                reversed_sources.c.source_payment_id == payment.id,
            )
            .where(
                item.operation_id == operation_id,
                item_student_key == student_key,
                payment.entry_type == "payment",
            )
            .order_by(item.ordinal)
        )
    ).all()
    allocations = []
    source_payment_ids = []
    for allocation in rows:
        source_payment_ids.append(str(allocation.payment_id))
        gross_amount = (
            0
            if allocation.source_reversed
            else _to_int(allocation.original_gross_amount)
        )
        refunded_amount = (
            0
            if allocation.source_reversed
            else min(gross_amount, _to_int(allocation.refunded_amount))
        )
        allocations.append(
            FeePaidAllocationResponse(
                fee_record_id=(
                    UUID(str(allocation.fee_record_id))
                    if allocation.fee_record_id
                    else None
                ),
                enrollment_id=(
                    UUID(str(allocation.enrollment_id))
                    if allocation.enrollment_id
                    else None
                ),
                class_id=(
                    UUID(str(allocation.class_id)) if allocation.class_id else None
                ),
                class_name=allocation.class_name_snapshot or "Lớp đã xoá",
                # Every payment item is created from a non-null fee-record
                # period. Keep the API contract machine-readable (YYYY-MM)
                # instead of replacing damaged financial data with UI text.
                period=allocation.period,
                gross_amount=gross_amount,
                refunded_amount=refunded_amount,
                net_amount=max(0, gross_amount - refunded_amount),
            )
        )
    return allocations, source_payment_ids


async def _load_receipt_timeline(
    db: AsyncSession,
    source_payment_ids: list[str],
) -> list[FeePaidTimelineEntryResponse]:
    if not source_payment_ids:
        return []

    refund_source = aliased(Payment)
    is_refund_reversal_for_receipt = exists(
        select(refund_source.id).where(
            refund_source.id == Payment.related_payment_id,
            refund_source.entry_type == "refund",
            refund_source.related_payment_id.in_(source_payment_ids),
        )
    ).correlate(Payment)
    rows = (
        await db.execute(
            select(FeeOperation, FeeOperationItem, Payment)
            .join(
                FeeOperationItem,
                FeeOperationItem.operation_id == FeeOperation.id,
            )
            .join(Payment, Payment.id == FeeOperationItem.payment_id)
            .where(
                or_(
                    Payment.id.in_(source_payment_ids),
                    Payment.related_payment_id.in_(source_payment_ids),
                    and_(
                        Payment.entry_type == "refund_reversal",
                        is_refund_reversal_for_receipt,
                    ),
                )
            )
            .order_by(
                FeeOperation.occurred_at,
                FeeOperation.sequence_no,
                FeeOperationItem.ordinal,
            )
        )
    ).all()
    if not rows:
        return []

    grouped: dict[str, list[tuple[FeeOperation, FeeOperationItem, Payment]]] = (
        defaultdict(list)
    )
    for operation, item, payment in rows:
        grouped[operation.id].append((operation, item, payment))

    timeline = []
    for entries in grouped.values():
        operation = entries[0][0]
        payments = [entry[2] for entry in entries]
        items = [entry[1] for entry in entries]
        timeline.append(
            FeePaidTimelineEntryResponse(
                id=UUID(str(operation.id)),
                event=operation.action,
                business_date=operation.business_date,
                occurred_at=operation.occurred_at,
                amount_delta=sum(_to_int(item.amount_delta) for item in items),
                payment_method=payments[0].payment_method,
                payment_origin=payments[0].payment_origin or "manual",
                settlement_account_id=(
                    UUID(str(payments[0].settlement_account_id))
                    if payments[0].settlement_account_id
                    else None
                ),
                settlement_bank_name=payments[0].settlement_bank_name_snapshot,
                settlement_account_number=(
                    payments[0].settlement_account_number_snapshot
                ),
                actor_name=operation.actor_name_snapshot,
                actor_username=operation.actor_username_snapshot,
                actor_role=operation.actor_role_snapshot,
                reason=next(
                    (item.reason_snapshot for item in items if item.reason_snapshot),
                    None,
                ),
            )
        )
    return timeline
