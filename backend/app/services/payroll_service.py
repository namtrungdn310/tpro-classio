"""Management payroll commands backed exclusively by append-only ledgers."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.staff import StaffMember
from app.models.banking import WorkspacePaymentAccount
from app.models.staff_attendance import (
    StaffCompensationRate,
    StaffCompensationRateEvent,
    StaffEarningLedgerEntry,
    StaffPayrollSettlement,
    StaffPayrollSettlementItem,
    StaffPayrollSettlementReversal,
)
from app.schemas.staff import (
    StaffCompensationRateCreate,
    StaffCompensationRateResponse,
    StaffPayrollSettlementCreate,
    StaffPayrollSettlementReversalCreate,
    StaffPayrollSettlementReversalResponse,
    StaffPayrollSettlementResponse,
    StaffPayrollSummaryResponse,
)


async def get_staff_payroll_summary(
    db: AsyncSession, staff_id: UUID
) -> StaffPayrollSummaryResponse:
    await _require_staff(db, staff_id)
    rates = list(
        (
            await db.scalars(
                select(StaffCompensationRate)
                .where(StaffCompensationRate.staff_id == str(staff_id))
                .order_by(StaffCompensationRate.effective_from.desc())
            )
        ).all()
    )
    settlement_rows = list(
        (
            await db.execute(
                select(
                    StaffPayrollSettlement, StaffPayrollSettlementReversal.created_at
                )
                .outerjoin(
                    StaffPayrollSettlementReversal,
                    StaffPayrollSettlementReversal.settlement_id
                    == StaffPayrollSettlement.id,
                )
                .where(StaffPayrollSettlement.staff_id == str(staff_id))
                .order_by(StaffPayrollSettlement.created_at.desc())
                .limit(100)
            )
        ).all()
    )
    earned = int(
        await db.scalar(
            select(func.coalesce(func.sum(StaffEarningLedgerEntry.amount), 0)).where(
                StaffEarningLedgerEntry.staff_id == str(staff_id)
            )
        )
        or 0
    )
    allocated = int(
        await db.scalar(
            select(
                func.coalesce(func.sum(StaffPayrollSettlementItem.allocated_amount), 0)
            )
            .join(
                StaffPayrollSettlement,
                StaffPayrollSettlement.id == StaffPayrollSettlementItem.settlement_id,
            )
            .outerjoin(
                StaffPayrollSettlementReversal,
                StaffPayrollSettlementReversal.settlement_id
                == StaffPayrollSettlement.id,
            )
            .where(
                StaffPayrollSettlement.staff_id == str(staff_id),
                StaffPayrollSettlementReversal.id.is_(None),
            )
        )
        or 0
    )
    return StaffPayrollSummaryResponse(
        staff_id=staff_id,
        balance=earned - allocated,
        rates=[StaffCompensationRateResponse.model_validate(rate) for rate in rates],
        settlements=[
            _settlement_response(item, reversed_at)
            for item, reversed_at in settlement_rows
        ],
    )


async def create_staff_compensation_rate(
    db: AsyncSession,
    staff_id: UUID,
    payload: StaffCompensationRateCreate,
    *,
    actor_user_id: str,
) -> StaffCompensationRateResponse:
    await _require_staff(db, staff_id)
    current_version = int(
        await db.scalar(
            select(func.coalesce(func.max(StaffCompensationRate.version), 0)).where(
                StaffCompensationRate.staff_id == str(staff_id)
            )
        )
        or 0
    )
    rate = StaffCompensationRate(
        staff_id=str(staff_id),
        assignment_role=payload.assignment_role,
        rate_amount=payload.rate_amount,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        version=current_version + 1,
    )
    db.add(rate)
    try:
        await db.flush()
    except (IntegrityError, DBAPIError) as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Khoảng hiệu lực mức lương bị trùng với cấu hình hiện có",
        ) from exc
    db.add(
        StaffCompensationRateEvent(
            staff_id=str(staff_id),
            event_type="CREATE",
            before_snapshot={},
            after_snapshot={
                "rate_id": str(rate.id),
                "rate_amount": payload.rate_amount,
                "assignment_role": payload.assignment_role,
                "effective_from": payload.effective_from.isoformat(),
                "effective_to": (
                    payload.effective_to.isoformat() if payload.effective_to else None
                ),
                "version": rate.version,
            },
            actor_user_id=actor_user_id,
            reason=payload.reason,
        )
    )
    await db.commit()
    return StaffCompensationRateResponse.model_validate(rate)


async def settle_staff_payroll(
    db: AsyncSession,
    staff_id: UUID,
    payload: StaffPayrollSettlementCreate,
    *,
    actor_user_id: str,
) -> StaffPayrollSettlementResponse:
    await _require_staff(db, staff_id)
    settlement_account = None
    if payload.settlement_account_id is not None:
        settlement_account = await db.scalar(
            select(WorkspacePaymentAccount).where(
                WorkspacePaymentAccount.id == str(payload.settlement_account_id),
                WorkspacePaymentAccount.is_active.is_(True),
            )
        )
        if settlement_account is None:
            raise HTTPException(
                status_code=404,
                detail="Tài khoản ngân hàng không tồn tại hoặc đã ngừng sử dụng.",
            )
    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:scope))"),
        {"scope": f"staff-payroll:{staff_id}"},
    )
    existing = await db.scalar(
        select(StaffPayrollSettlement).where(
            StaffPayrollSettlement.request_id == str(payload.request_id)
        )
    )
    if existing is not None:
        if existing.staff_id != str(staff_id):
            raise HTTPException(status_code=409, detail="Mã yêu cầu đã được sử dụng")
        return await _load_settlement_response(db, existing)

    now = datetime.now(timezone.utc)
    eligible = list(
        (
            await db.scalars(
                select(StaffEarningLedgerEntry)
                .where(
                    StaffEarningLedgerEntry.staff_id == str(staff_id),
                    StaffEarningLedgerEntry.amount > 0,
                    StaffEarningLedgerEntry.created_at <= now,
                    ~select(StaffPayrollSettlementItem.id)
                    .join(
                        StaffPayrollSettlement,
                        StaffPayrollSettlement.id
                        == StaffPayrollSettlementItem.settlement_id,
                    )
                    .outerjoin(
                        StaffPayrollSettlementReversal,
                        StaffPayrollSettlementReversal.settlement_id
                        == StaffPayrollSettlement.id,
                    )
                    .where(
                        StaffPayrollSettlementItem.ledger_entry_id
                        == StaffEarningLedgerEntry.id,
                        StaffPayrollSettlementReversal.id.is_(None),
                    )
                    .exists(),
                )
                .order_by(
                    StaffEarningLedgerEntry.created_at,
                    StaffEarningLedgerEntry.id,
                )
                .with_for_update(of=StaffEarningLedgerEntry)
            )
        ).all()
    )
    summary = await get_staff_payroll_summary(db, staff_id)
    remaining = summary.balance
    if remaining <= 0 or not eligible:
        raise HTTPException(
            status_code=409, detail="Nhân sự chưa có thù lao cần tất toán"
        )

    allocations: list[tuple[StaffEarningLedgerEntry, int]] = []
    for entry in eligible:
        if remaining <= 0:
            break
        amount = min(int(entry.amount), remaining)
        if amount > 0:
            allocations.append((entry, amount))
            remaining -= amount
    total = sum(amount for _, amount in allocations)
    settlement = StaffPayrollSettlement(
        staff_id=str(staff_id),
        cutoff_at=now,
        total_amount=total,
        high_watermark_ledger_id=(allocations[-1][0].id if allocations else None),
        method=payload.method,
        settlement_account_id=(
            settlement_account.id if settlement_account is not None else None
        ),
        settlement_bank_code_snapshot=(
            settlement_account.bank_code if settlement_account is not None else None
        ),
        settlement_bank_name_snapshot=(
            settlement_account.bank_name if settlement_account is not None else None
        ),
        settlement_account_number_snapshot=(
            settlement_account.account_number
            if settlement_account is not None
            else None
        ),
        settlement_account_name_snapshot=(
            settlement_account.account_name if settlement_account is not None else None
        ),
        reference=payload.reference,
        reason=payload.reason,
        request_id=str(payload.request_id),
        actor_user_id=actor_user_id,
    )
    db.add(settlement)
    await db.flush()
    for entry, amount in allocations:
        db.add(
            StaffPayrollSettlementItem(
                settlement_id=settlement.id,
                ledger_entry_id=entry.id,
                allocated_amount=amount,
            )
        )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        replay = await db.scalar(
            select(StaffPayrollSettlement).where(
                StaffPayrollSettlement.request_id == str(payload.request_id)
            )
        )
        if replay is not None and replay.staff_id == str(staff_id):
            return await _load_settlement_response(db, replay)
        raise HTTPException(
            status_code=409, detail="Thù lao vừa được tất toán ở một phiên khác"
        ) from exc
    return await _load_settlement_response(db, settlement)


async def reverse_staff_payroll_settlement(
    db: AsyncSession,
    staff_id: UUID,
    settlement_id: UUID,
    payload: StaffPayrollSettlementReversalCreate,
    *,
    actor_user_id: str,
) -> StaffPayrollSettlementReversalResponse:
    await _require_staff(db, staff_id)
    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:scope))"),
        {"scope": f"staff-payroll:{staff_id}"},
    )
    replay = await db.scalar(
        select(StaffPayrollSettlementReversal).where(
            StaffPayrollSettlementReversal.request_id == str(payload.request_id)
        )
    )
    if replay is not None:
        if replay.staff_id != str(staff_id) or replay.settlement_id != str(
            settlement_id
        ):
            raise HTTPException(status_code=409, detail="Mã yêu cầu đã được sử dụng")
        return StaffPayrollSettlementReversalResponse.model_validate(replay)

    settlement = await db.scalar(
        select(StaffPayrollSettlement)
        .where(
            StaffPayrollSettlement.id == str(settlement_id),
            StaffPayrollSettlement.staff_id == str(staff_id),
        )
        .with_for_update()
    )
    if settlement is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy lần tất toán")
    existing = await db.scalar(
        select(StaffPayrollSettlementReversal).where(
            StaffPayrollSettlementReversal.settlement_id == str(settlement_id)
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Lần tất toán này đã được hoàn tác")

    reversal = StaffPayrollSettlementReversal(
        settlement_id=str(settlement_id),
        staff_id=str(staff_id),
        request_id=str(payload.request_id),
        reason=payload.reason,
        actor_user_id=actor_user_id,
    )
    db.add(reversal)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        replay = await db.scalar(
            select(StaffPayrollSettlementReversal).where(
                StaffPayrollSettlementReversal.request_id == str(payload.request_id)
            )
        )
        if replay is not None and replay.settlement_id == str(settlement_id):
            return StaffPayrollSettlementReversalResponse.model_validate(replay)
        raise HTTPException(
            status_code=409, detail="Lần tất toán vừa được hoàn tác"
        ) from exc
    return StaffPayrollSettlementReversalResponse.model_validate(reversal)


def _settlement_response(
    settlement: StaffPayrollSettlement, reversed_at: datetime | None
) -> StaffPayrollSettlementResponse:
    return StaffPayrollSettlementResponse(
        id=settlement.id,
        total_amount=settlement.total_amount,
        cutoff_at=settlement.cutoff_at,
        method=settlement.method,
        settlement_account_id=settlement.settlement_account_id,
        settlement_bank_code=settlement.settlement_bank_code_snapshot,
        settlement_bank_name=settlement.settlement_bank_name_snapshot,
        settlement_account_number=settlement.settlement_account_number_snapshot,
        settlement_account_name=settlement.settlement_account_name_snapshot,
        reference=settlement.reference,
        created_at=settlement.created_at,
        reversed_at=reversed_at,
    )


async def _load_settlement_response(
    db: AsyncSession, settlement: StaffPayrollSettlement
) -> StaffPayrollSettlementResponse:
    reversed_at = await db.scalar(
        select(StaffPayrollSettlementReversal.created_at).where(
            StaffPayrollSettlementReversal.settlement_id == settlement.id
        )
    )
    return _settlement_response(settlement, reversed_at)


async def _require_staff(db: AsyncSession, staff_id: UUID) -> StaffMember:
    staff = await db.get(StaffMember, str(staff_id))
    if staff is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân sự")
    return staff
