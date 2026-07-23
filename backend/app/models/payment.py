from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, Text, func, text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Payment(Base):
    """Append-only payment ledger entry.

    A correction is represented by a negative entry instead of deleting the
    original payment. This keeps the financial trail reviewable while
    ``fee_records`` remains the fast current-state projection used by the UI.
    """

    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    fee_record_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("fee_records.id", ondelete="RESTRICT"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 0), nullable=False)
    payment_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        server_default=text("current_date"),
    )
    payment_method: Mapped[str] = mapped_column(
        ENUM("bank_transfer", "cash", name="payment_method", create_type=False),
        nullable=False,
        default="bank_transfer",
    )
    entry_type: Mapped[str] = mapped_column(
        ENUM(
            "payment",
            "payment_reversal",
            "refund",
            "refund_reversal",
            name="payment_entry_type",
            create_type=False,
        ),
        nullable=False,
        default="payment",
    )
    related_payment_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("payments.id", ondelete="RESTRICT"),
    )
    idempotency_key: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    fee_record = relationship("FeeRecord", back_populates="payments")
