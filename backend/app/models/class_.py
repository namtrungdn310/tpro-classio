from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, Numeric, SmallInteger, Text, func, text
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Class(Base):
    __tablename__ = "classes"
    __table_args__ = (
        CheckConstraint("billing_cycle_months >= 1", name="classes_billing_cycle_months_check"),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(
        ENUM("MONTHLY", "COURSE", name="class_type", create_type=False),
        nullable=False,
    )
    base_fee: Mapped[Decimal] = mapped_column(Numeric(12, 0), nullable=False, default=0)
    billing_cycle_months: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=1,
    )
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    schedule: Mapped[dict | None] = mapped_column(JSONB)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    enrollments = relationship("Enrollment", back_populates="class_")
