from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    SmallInteger,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Class(Base):
    __tablename__ = "classes"
    __table_args__ = (
        CheckConstraint(
            "billing_cycle_months >= 1", name="classes_billing_cycle_months_check"
        ),
        CheckConstraint(
            "char_length(btrim(name)) between 1 and 120",
            name="classes_name_length_check",
        ),
        CheckConstraint(
            "base_fee >= 0 and base_fee <= 999999999999",
            name="classes_base_fee_range_check",
        ),
        CheckConstraint(
            "(type = 'MONTHLY' and billing_cycle_months = 1) or "
            "(type = 'COURSE' and billing_cycle_months in (2, 3, 6, 12))",
            name="classes_type_billing_cycle_check",
        ),
        CheckConstraint(
            "start_date is null or end_date is null or end_date >= start_date",
            name="classes_date_range_check",
        ),
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
    teacher_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="SET NULL"),
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    enrollments = relationship("Enrollment", back_populates="class_", lazy="selectin")
    teacher = relationship("StaffMember", back_populates="classes", lazy="selectin")
    teacher_links = relationship(
        "ClassTeacher",
        back_populates="class_",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    teachers = relationship(
        "StaffMember",
        secondary="class_teachers",
        viewonly=True,
        lazy="selectin",
    )
