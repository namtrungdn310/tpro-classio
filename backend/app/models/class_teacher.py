from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class ClassTeacher(WorkspaceScoped, Base):
    __tablename__ = "class_teachers"
    __table_args__ = (
        CheckConstraint(
            "role in ('TEACHER', 'ASSISTANT')",
            name="class_teachers_role_check",
        ),
    )

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
    # Physical names stay unchanged for one compatibility release, but this
    # row now represents a role-bearing class staff assignment.
    role: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    class_ = relationship("Class", back_populates="teacher_links")
    teacher = relationship("StaffMember", back_populates="class_links")
