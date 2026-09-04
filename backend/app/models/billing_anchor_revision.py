from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class BillingAnchorRevision(WorkspaceScoped, Base):
    """Append-only audit of one enrollment billing-anchor change."""

    __tablename__ = "billing_anchor_revisions"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "enrollment_id",
            "sequence_no",
            name="billing_anchor_revisions_sequence_unique",
        ),
        UniqueConstraint(
            "workspace_id",
            "request_id",
            name="billing_anchor_revisions_request_unique",
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    enrollment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("enrollments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_anchor_date: Mapped[date | None] = mapped_column(Date)
    anchor_date: Mapped[date] = mapped_column(Date, nullable=False)
    effective_on: Mapped[date] = mapped_column(Date, nullable=False)
    generation_floor: Mapped[date] = mapped_column(Date, nullable=False)
    first_anchor_cycle_no: Mapped[int] = mapped_column(Integer, nullable=False)
    next_due_date: Mapped[date] = mapped_column(Date, nullable=False)
    change_kind: Mapped[str] = mapped_column(Text, nullable=False, default="INITIAL")
    billing_type_snapshot: Mapped[str] = mapped_column(
        Text, nullable=False, default="MONTHLY"
    )
    billing_cycle_months_snapshot: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=1
    )
    billing_cycle_weeks_snapshot: Mapped[int | None] = mapped_column(SmallInteger)
    class_billing_cycle_revision_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_billing_cycle_revisions.id", ondelete="RESTRICT"),
    )
    start_date_command_item_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("start_date_change_command_items.id", ondelete="SET NULL"),
    )
    decision_code: Mapped[str | None] = mapped_column(Text)
    previous_enrollment_date: Mapped[date | None] = mapped_column(Date)
    next_enrollment_date: Mapped[date | None] = mapped_column(Date)
    skipped_anchor_cycle_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    selected_historical_cycles: Mapped[list[int] | None] = mapped_column(ARRAY(Integer))
    state: Mapped[str] = mapped_column(Text, nullable=False, default="PENDING")
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    resolved_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    enrollment = relationship(
        "Enrollment",
        foreign_keys=[enrollment_id],
        back_populates="billing_anchor_revisions",
    )
    fee_records = relationship("FeeRecord", back_populates="billing_revision")
    class_billing_cycle_revision = relationship(
        "ClassBillingCycleRevision", back_populates="enrollment_revisions"
    )
