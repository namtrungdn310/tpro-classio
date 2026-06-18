from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID # UUUI: set khoá chính
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default="viewer")
    full_name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
