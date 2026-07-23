from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class StaffMember(Base):
    __tablename__ = "staff_members"
    __table_args__ = (
        CheckConstraint(
            "staff_type in ('TEACHER', 'ASSISTANT')",
            name="staff_members_staff_type_check",
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    staff_type: Mapped[str] = mapped_column(Text, nullable=False)
    zalo_name: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    classes = relationship("Class", back_populates="teacher", lazy="raise")
    class_links = relationship(
        "ClassTeacher",
        back_populates="teacher",
        cascade="all, delete-orphan",
        lazy="raise",
    )
    teaching_classes = relationship(
        "Class",
        secondary="class_teachers",
        viewonly=True,
        lazy="raise",
    )
