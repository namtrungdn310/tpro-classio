from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, func, text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Enrollment(Base):
    __tablename__ = "enrollments"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    student_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
    )
    class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("classes.id", ondelete="CASCADE"),
        nullable=False,
    )
    enrollment_date: Mapped[date | None] = mapped_column(Date)
    custom_fee: Mapped[Decimal | None] = mapped_column(Numeric(12, 0))
    status: Mapped[str] = mapped_column(
        ENUM("active", "dropped", name="enrollment_status", create_type=False),
        nullable=False,
        default="active",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    student = relationship("Student", back_populates="enrollments")
    class_ = relationship("Class", back_populates="enrollments")
    fee_records = relationship(
        "FeeRecord",
        back_populates="enrollment",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
