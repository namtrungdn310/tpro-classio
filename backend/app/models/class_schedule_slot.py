"""SQLAlchemy models for stable class schedule slots (migration 059)."""

from datetime import date, datetime, time

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Text, Time, func, text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ClassScheduleSlot(Base):
    """Một recurring slot với UUID ổn định, version và effective range.

    Sửa giờ giữ UUID + tăng version; đóng slot đặt `effective_until` — không
    bao giờ xóa lịch sử occurrence/snapshot.
    """

    __tablename__ = "class_schedule_slots"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("classes.id", ondelete="RESTRICT"),
        nullable=False,
    )
    weekday: Mapped[str] = mapped_column(
        ENUM(
            "Thứ 2",
            "Thứ 3",
            "Thứ 4",
            "Thứ 5",
            "Thứ 6",
            "Thứ 7",
            "Chủ Nhật",
            name="class_day",
            create_type=False,
        ),
        nullable=False,
    )
    local_start: Mapped[time] = mapped_column(Time, nullable=False)
    local_end: Mapped[time] = mapped_column(Time, nullable=False)
    timezone: Mapped[str] = mapped_column(
        Text, nullable=False, default="Asia/Ho_Chi_Minh"
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_until: Mapped[date | None] = mapped_column(Date)
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

    class_ = relationship("Class", back_populates="schedule_slots")
    staff_links = relationship(
        "ClassScheduleSlotStaff",
        back_populates="slot",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ClassScheduleSlotStaff(Base):
    __tablename__ = "class_schedule_slot_staff"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    slot_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_schedule_slots.id", ondelete="RESTRICT"),
        nullable=False,
    )
    staff_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="RESTRICT"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    slot = relationship("ClassScheduleSlot", back_populates="staff_links")
