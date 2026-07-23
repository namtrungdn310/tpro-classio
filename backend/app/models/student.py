from datetime import date, datetime

from sqlalchemy import Date, DateTime, Text, func, text
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Student(Base):
    __tablename__ = "students"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    birth_date: Mapped[date | None] = mapped_column(Date)
    school: Mapped[str | None] = mapped_column(Text)
    parent_name: Mapped[str | None] = mapped_column(Text)
    parent_phone: Mapped[str | None] = mapped_column(Text)
    parent_zalo: Mapped[str | None] = mapped_column(Text)
    student_zalo: Mapped[str | None] = mapped_column(Text)
    student_phone: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    hidden_fields: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    status: Mapped[str] = mapped_column(
        ENUM("active", "inactive", name="student_status", create_type=False),
        nullable=False,
        default="active",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    enrollments = relationship(
        "Enrollment",
        back_populates="student",
        lazy="selectin",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
