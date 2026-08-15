"""R6-D17 — payment reference + provider-neutral scaffold (feature OFF).

Reference format (Pay2S adapter v1): `<student_code>P<8_CROCKFORD>` —
20 ASCII alnum chars; suffix from CSPRNG (secrets.token_urlsafe stripped to
Crockford allowlist); DB unique. All runtime paths return a safe
"unavailable" while PAYMENT_PROVIDER=disabled.
"""

import re
import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.fee_record import FeeRecord
from app.models.payment_request import PaymentRequest

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # bỏ I/L/O/U
REFERENCE_PATTERN = re.compile(r"^TP\d{9}P[0-9A-HJKMNP-TV-Z]{8}$")


def generate_payment_reference(student_code: str) -> str:
    """student_code + 'P' + 8 Crockford CSPRNG chars."""
    suffix = "".join(CROCKFORD[secrets.randbelow(len(CROCKFORD))] for _ in range(8))
    return f"{student_code}P{suffix}"


def payment_automation_enabled() -> bool:
    return (
        settings.payment_provider not in {"", "disabled"}
        and settings.payment_webhook_ingress_enabled
    )


async def create_payment_request(
    db: AsyncSession,
    fee_record: FeeRecord,
    student_code: str,
) -> PaymentRequest | None:
    """Create an OPEN payment request when the feature is enabled.

    Feature OFF -> returns None (no live provider mutation; UI hides QR).
    """
    if not payment_automation_enabled():
        return None
    existing_open = await db.scalar(
        select(PaymentRequest).where(
            PaymentRequest.fee_record_id == fee_record.id,
            PaymentRequest.status == "OPEN",
        )
    )
    if existing_open is not None:
        return existing_open
    reference = generate_payment_reference(student_code)
    for _ in range(5):
        collision = await db.scalar(
            select(PaymentRequest.id).where(
                PaymentRequest.payment_reference == reference
            )
        )
        if collision is None:
            break
        reference = generate_payment_reference(student_code)
    request = PaymentRequest(
        fee_record_id=fee_record.id,
        enrollment_id=fee_record.enrollment_id,
        student_code_snapshot=student_code,
        payment_reference=reference,
        expected_amount=int(fee_record.final_amount),
        currency="VND",
        status="OPEN",
        provider="pay2s_v1",
    )
    db.add(request)
    await db.flush()
    return request
