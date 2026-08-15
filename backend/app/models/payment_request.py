from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Numeric, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PaymentRequest(Base):
    __tablename__ = "payment_requests"

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
    enrollment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("enrollments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    student_code_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    payment_reference: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    expected_amount: Mapped[int] = mapped_column(Numeric(12, 0), nullable=False)
    currency: Mapped[str] = mapped_column(Text, nullable=False, default="VND")
    status: Mapped[str] = mapped_column(Text, nullable=False, default="OPEN")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider: Mapped[str] = mapped_column(Text, nullable=False, default="pay2s_v1")
    provider_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
