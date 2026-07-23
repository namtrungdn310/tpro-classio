import os
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError

from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.payment import Payment
from app.models.student import Student
from app.models.user import Profile
from app.schemas.fee import FeeBatchRefundRequest, FeeRefundReversalRequest
from app.services.fee_service import (
    mark_fees_paid,
    mark_fees_unpaid,
    refund_fee_records,
    reverse_fee_refund,
)


pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


@pytest.mark.asyncio
async def test_batch_payment_and_reversal_share_one_consistent_ledger() -> None:
    class_ids = [str(uuid4()), str(uuid4())]
    student_id = str(uuid4())
    enrollment_ids = [str(uuid4()), str(uuid4())]
    fee_ids = [str(uuid4()), str(uuid4())]
    today = business_today()
    period = today.strftime("%Y-%m")
    notified_at = datetime.now(timezone.utc)
    fee_amounts = [Decimal("750000"), Decimal("0")]

    async with AsyncSessionLocal() as db:
        try:
            student = Student(
                id=student_id,
                full_name="Integration Fee Student",
                status="active",
            )
            db.add(student)
            for index, class_id in enumerate(class_ids):
                db.add(
                    Class(
                        id=class_id,
                        name=f"Integration {class_id[:8]}",
                        type="MONTHLY",
                        base_fee=fee_amounts[index],
                        billing_cycle_months=1,
                        is_active=True,
                    )
                )
            for index, enrollment_id in enumerate(enrollment_ids):
                enrollment = Enrollment(
                    id=enrollment_id,
                    student_id=student_id,
                    class_id=class_ids[index],
                    enrollment_date=today,
                    status="active",
                )
                db.add(enrollment)
                db.add(
                    FeeRecord(
                        id=fee_ids[index],
                        enrollment_id=enrollment_id,
                        period=period,
                        due_date=today,
                        enrollment_date_snapshot=today,
                        student_name_snapshot="Integration Fee Student",
                        class_name_snapshot=f"Integration {class_ids[index][:8]}",
                        class_type_snapshot="MONTHLY",
                        billing_cycle_months_snapshot=1,
                        base_amount=fee_amounts[index],
                        discount_amount=Decimal("0"),
                        status="UNPAID",
                        notified_at=notified_at,
                        notification_channel="zalo_manual",
                        notification_message="Integration notification",
                    )
                )
            await db.commit()

            paid = await mark_fees_paid(
                db,
                [UUID(value) for value in fee_ids],
                payment_method="cash",
            )
            assert [record.status for record in paid.records] == ["PAID", "PAID"]

            reversed_ = await mark_fees_unpaid(
                db,
                [UUID(value) for value in fee_ids],
            )
            assert [record.notification_state for record in reversed_.records] == [
                "NOTIFIED_UNPAID",
                "NOTIFIED_UNPAID",
            ]

            ledger_result = await db.execute(
                select(Payment).where(Payment.fee_record_id.in_(fee_ids))
            )
            ledger = ledger_result.scalars().all()
            assert len(ledger) == 4
            assert sum(int(entry.amount) for entry in ledger) == 0
            assert {entry.payment_method for entry in ledger} == {"cash"}
            assert sorted(int(entry.amount) for entry in ledger) == [
                -750000,
                0,
                0,
                750000,
            ]

            with pytest.raises(DBAPIError):
                await db.execute(
                    update(Payment)
                    .where(Payment.id == ledger[0].id)
                    .values(note="tampered")
                )
            await db.rollback()

            with pytest.raises(DBAPIError):
                await db.execute(delete(FeeRecord).where(FeeRecord.id == fee_ids[0]))
            await db.rollback()

            preserved_result = await db.execute(
                select(Payment).where(Payment.fee_record_id.in_(fee_ids))
            )
            assert len(preserved_result.scalars().all()) == 4
        finally:
            await db.rollback()
            # CI runs against an ephemeral database. Financial ledger rows are
            # append-only by design, so test fixtures must not delete their
            # referenced fee records after a committed transaction.


@pytest.mark.asyncio
async def test_refund_retry_and_reversal_keep_projection_and_ledger_consistent() -> (
    None
):
    actor_id = str(uuid4())
    class_id = str(uuid4())
    student_id = str(uuid4())
    enrollment_id = str(uuid4())
    fee_id = str(uuid4())
    refund_request_id = uuid4()
    today = business_today()
    period = today.strftime("%Y-%m")

    async with AsyncSessionLocal() as db:
        try:
            await db.execute(
                text("insert into auth.users (id, email) values (:id, :email)"),
                {"id": actor_id, "email": f"{actor_id}@integration.invalid"},
            )
            db.add(Profile(id=actor_id, role="admin", full_name="CI Refund Actor"))
            db.add(
                Class(
                    id=class_id,
                    name=f"Integration Refund {class_id[:8]}",
                    type="MONTHLY",
                    base_fee=Decimal("750000"),
                    billing_cycle_months=1,
                    is_active=True,
                )
            )
            db.add(
                Student(
                    id=student_id,
                    full_name="Integration Refund Student",
                    status="active",
                )
            )
            db.add(
                Enrollment(
                    id=enrollment_id,
                    student_id=student_id,
                    class_id=class_id,
                    enrollment_date=today,
                    status="active",
                )
            )
            db.add(
                FeeRecord(
                    id=fee_id,
                    enrollment_id=enrollment_id,
                    period=period,
                    due_date=today,
                    enrollment_date_snapshot=today,
                    student_name_snapshot="Integration Refund Student",
                    class_name_snapshot=f"Integration Refund {class_id[:8]}",
                    class_type_snapshot="MONTHLY",
                    billing_cycle_months_snapshot=1,
                    base_amount=Decimal("750000"),
                    discount_amount=Decimal("0"),
                    status="UNPAID",
                    notified_at=datetime.now(timezone.utc),
                    notification_channel="zalo_manual",
                    notification_message="Integration refund notification",
                )
            )
            await db.commit()

            await mark_fees_paid(db, [UUID(fee_id)], actor_id=actor_id)
            payload = FeeBatchRefundRequest(
                request_id=refund_request_id,
                items=[{"record_id": fee_id, "amount": 250_000}],
                reason="Học viên dừng khóa học sớm",
                refund_method="bank_transfer",
            )
            refunded = await refund_fee_records(db, payload, actor_id=actor_id)
            retried = await refund_fee_records(db, payload, actor_id=actor_id)

            assert refunded.receipt.request_id == refund_request_id
            assert retried.receipt.request_id == refund_request_id
            assert refunded.records[0].refunded_amount == 250_000
            assert retried.records[0].refunded_amount == 250_000

            with pytest.raises(HTTPException) as conflict:
                await refund_fee_records(
                    db,
                    FeeBatchRefundRequest(
                        request_id=refund_request_id,
                        items=[{"record_id": fee_id, "amount": 100_000}],
                        reason="Học viên dừng khóa học sớm",
                        refund_method="bank_transfer",
                    ),
                    actor_id=actor_id,
                )
            assert conflict.value.status_code == 409

            refund_transaction_id = refunded.receipt.items[0].transaction_id
            reversal = await reverse_fee_refund(
                db,
                FeeRefundReversalRequest(
                    refund_transaction_id=refund_transaction_id,
                    reason="Sửa giao dịch hoàn phí nhập nhầm",
                    request_id=uuid4(),
                ),
                actor_id=actor_id,
            )
            assert reversal.records[0].refunded_amount == 0
            assert reversal.records[0].net_collected_amount == 750_000

            ledger_result = await db.execute(
                select(Payment).where(Payment.fee_record_id == fee_id)
            )
            ledger = ledger_result.scalars().all()
            assert len(ledger) == 3
            assert sum(int(entry.amount) for entry in ledger) == 750_000
            assert {entry.entry_type for entry in ledger} == {
                "payment",
                "refund",
                "refund_reversal",
            }

            with pytest.raises(DBAPIError):
                await db.execute(
                    update(FeeRecord)
                    .where(FeeRecord.id == fee_id)
                    .values(refunded_amount=1)
                )
            await db.rollback()
        finally:
            await db.rollback()
