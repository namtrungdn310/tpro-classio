import base64
import json
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import Select, and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.business_time import BUSINESS_TIMEZONE
from app.models.fee_operation import FeeOperation, FeeOperationItem
from app.schemas.report import (
    FeeOperationItemResponse,
    FeeOperationListResponse,
    FeeOperationResponse,
    FeeOperationSummaryResponse,
)


def _encode_cursor(operation: FeeOperation) -> str:
    payload = json.dumps(
        {"at": operation.occurred_at.isoformat(), "seq": operation.sequence_no},
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode())
        occurred_at = datetime.fromisoformat(payload["at"])
        if occurred_at.tzinfo is None:
            raise ValueError
        return occurred_at, int(payload["seq"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Con trỏ phân trang báo cáo không hợp lệ",
        ) from exc


def _to_int(value: Decimal | int | None) -> int:
    return int(value or 0)


def _item_response(item: FeeOperationItem) -> FeeOperationItemResponse:
    return FeeOperationItemResponse(
        id=UUID(item.id),
        ordinal=item.ordinal,
        fee_record_id=UUID(item.fee_record_id) if item.fee_record_id else None,
        enrollment_id=UUID(item.enrollment_id) if item.enrollment_id else None,
        student_id=UUID(item.student_id) if item.student_id else None,
        student_name=item.student_name_snapshot,
        class_id=UUID(item.class_id) if item.class_id else None,
        class_name=item.class_name_snapshot,
        period=item.period,
        state_before=item.state_before,
        state_after=item.state_after,
        amount_before=_to_int(item.amount_before) if item.amount_before is not None else None,
        amount_after=_to_int(item.amount_after) if item.amount_after is not None else None,
        amount_delta=_to_int(item.amount_delta),
        due_date_before=item.due_date_before,
        due_date_after=item.due_date_after,
        payment_method=item.payment_method,
        notification_channel=item.notification_channel,
        message=item.message_snapshot,
        reason=item.reason_snapshot,
        payment_id=UUID(item.payment_id) if item.payment_id else None,
        related_payment_id=UUID(item.related_payment_id) if item.related_payment_id else None,
    )


def _operation_response(
    operation: FeeOperation,
    *,
    items: list[FeeOperationItem] | None = None,
) -> FeeOperationResponse:
    return FeeOperationResponse(
        id=UUID(operation.id),
        sequence_no=operation.sequence_no,
        action=operation.action,
        origin=operation.origin,
        request_id=UUID(operation.request_id) if operation.request_id else None,
        period=operation.period,
        business_date=operation.business_date,
        occurred_at=operation.occurred_at,
        actor_user_id=UUID(operation.actor_user_id) if operation.actor_user_id else None,
        actor_name=operation.actor_name_snapshot,
        actor_username=operation.actor_username_snapshot,
        actor_role=operation.actor_role_snapshot,
        item_count=operation.item_count,
        total_amount=_to_int(operation.total_amount),
        items=[
            _item_response(item)
            for item in (items if items is not None else operation.items)
        ],
    )


def _apply_filters(
    query: Select,
    *,
    action: str | None,
    period: str | None,
    query_text: str | None,
    date_from: date | None,
    date_to: date | None,
) -> Select:
    conditions = []
    if action:
        conditions.append(FeeOperation.action == action)
    if period:
        conditions.append(FeeOperation.period == period)
    if date_from:
        conditions.append(
            FeeOperation.occurred_at
            >= datetime.combine(date_from, time.min, BUSINESS_TIMEZONE).astimezone(
                timezone.utc
            )
        )
    if date_to:
        conditions.append(
            FeeOperation.occurred_at
            < (
                datetime.combine(date_to, time.min, BUSINESS_TIMEZONE)
                + timedelta(days=1)
            ).astimezone(timezone.utc)
        )
    if query_text:
        term = query_text.strip()
        if term:
            item_match = exists(
                select(FeeOperationItem.id).where(
                    FeeOperationItem.operation_id == FeeOperation.id,
                    or_(
                        FeeOperationItem.student_name_snapshot.icontains(term, autoescape=True),
                        FeeOperationItem.class_name_snapshot.icontains(term, autoescape=True),
                    ),
                )
            )
            conditions.append(
                or_(
                    FeeOperation.actor_name_snapshot.icontains(term, autoescape=True),
                    FeeOperation.actor_username_snapshot.icontains(term, autoescape=True),
                    item_match,
                )
            )
    return query.where(and_(*conditions)) if conditions else query


async def get_fee_operations(
    db: AsyncSession,
    *,
    action: str | None = None,
    period: str | None = None,
    query_text: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    cursor: str | None = None,
    limit: int = 30,
) -> FeeOperationListResponse:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Ngày bắt đầu không được sau ngày kết thúc",
        )

    base = _apply_filters(
        select(FeeOperation),
        action=action,
        period=period,
        query_text=query_text,
        date_from=date_from,
        date_to=date_to,
    )
    summary_source = base.with_only_columns(
        FeeOperation.id,
        FeeOperation.item_count,
        FeeOperation.total_amount,
    ).subquery()
    summary_result = await db.execute(
        select(
            func.count(summary_source.c.id),
            func.coalesce(func.sum(summary_source.c.item_count), 0),
            func.coalesce(func.sum(summary_source.c.total_amount), 0),
        )
    )
    operation_count, affected_count, financial_change = summary_result.one()

    if cursor:
        cursor_at, cursor_sequence = _decode_cursor(cursor)
        base = base.where(
            or_(
                FeeOperation.occurred_at < cursor_at,
                and_(
                    FeeOperation.occurred_at == cursor_at,
                    FeeOperation.sequence_no < cursor_sequence,
                ),
            )
        )

    result = await db.execute(
        base.order_by(FeeOperation.occurred_at.desc(), FeeOperation.sequence_no.desc())
        .limit(limit + 1)
    )
    operations = result.scalars().unique().all()
    has_more = len(operations) > limit
    page = operations[:limit]
    preview_by_operation: dict[str, list[FeeOperationItem]] = {
        operation.id: [] for operation in page
    }
    if page:
        preview_result = await db.execute(
            select(FeeOperationItem)
            .where(
                FeeOperationItem.operation_id.in_(preview_by_operation),
                FeeOperationItem.ordinal <= 2,
            )
            .order_by(FeeOperationItem.operation_id, FeeOperationItem.ordinal)
        )
        for item in preview_result.scalars().all():
            preview_by_operation[item.operation_id].append(item)

    coverage_result = await db.execute(
        select(func.min(FeeOperation.occurred_at)).where(
            FeeOperation.origin != "migration"
        )
    )
    history_complete_from = coverage_result.scalar_one_or_none()
    return FeeOperationListResponse(
        operations=[
            _operation_response(
                operation,
                items=preview_by_operation.get(operation.id, []),
            )
            for operation in page
        ],
        next_cursor=_encode_cursor(page[-1]) if has_more and page else None,
        summary=FeeOperationSummaryResponse(
            operation_count=int(operation_count or 0),
            affected_item_count=int(affected_count or 0),
            financial_net_change=_to_int(financial_change),
        ),
        history_complete_from=history_complete_from,
    )


async def get_fee_operation(
    db: AsyncSession, operation_id: UUID
) -> FeeOperationResponse | None:
    result = await db.execute(
        select(FeeOperation)
        .options(selectinload(FeeOperation.items))
        .where(FeeOperation.id == str(operation_id))
    )
    operation = result.scalar_one_or_none()
    return _operation_response(operation) if operation else None
