from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ClassTeacher(Base):
    __tablename__ = "class_teachers"

    class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("classes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    teacher_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    class_ = relationship("Class", back_populates="teacher_links")
    teacher = relationship("StaffMember", back_populates="class_links")
