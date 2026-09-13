"""Payment-request snapshots can protect fees even before notified_at catches up."""

from sqlalchemy import or_, select
from app.models.payment_request import PaymentRequest, PaymentRequestItem
from app.services.fee_reconciliation import is_fee_record_protected


async def attach_suspension_payment_protection(db, enrollments):
    by_fee = {str(r.id): e for e in enrollments for r in e.fee_records}
    for e in enrollments:
        e.suspension_protected_fee_ids = set()
        e.suspension_payment_snapshot = []
    if not by_fee:
        return
    rows = (
        await db.execute(
            select(
                PaymentRequest.id,
                PaymentRequest.fee_record_id,
                PaymentRequest.status,
                PaymentRequest.sent_at,
                PaymentRequest.paid_at,
                PaymentRequest.revoked_at,
                PaymentRequestItem.fee_record_id.label("item_fee_id"),
            )
            .outerjoin(
                PaymentRequestItem,
                PaymentRequestItem.payment_request_id == PaymentRequest.id,
            )
            .where(
                or_(
                    PaymentRequest.fee_record_id.in_(by_fee),
                    PaymentRequestItem.fee_record_id.in_(by_fee),
                )
            )
            .order_by(PaymentRequest.id, PaymentRequestItem.fee_record_id)
        )
    ).all()
    for r in rows:
        for fid in {str(r.fee_record_id), str(r.item_fee_id)}:
            e = by_fee.get(fid)
            if e is None:
                continue
            e.suspension_payment_snapshot.append(
                (
                    str(r.id),
                    fid,
                    r.status,
                    str(r.sent_at),
                    str(r.paid_at),
                    str(r.revoked_at),
                )
            )
            if r.sent_at is not None or r.paid_at is not None or r.status == "PAID":
                e.suspension_protected_fee_ids.add(fid)


def is_suspension_fee_protected(enrollment, record):
    return is_fee_record_protected(record) or str(record.id) in getattr(
        enrollment, "suspension_protected_fee_ids", set()
    )
