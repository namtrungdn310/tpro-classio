"""SQLAlchemy models for payroll (migrations 066/067)."""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class StaffCompensationRate(WorkspaceScoped, Base):
    __tablename__ = "staff_compensation_rates"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    staff_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # NULL is the backward-compatible default rate.  A role-specific row wins
    # when the same person teaches one class and assists another.
    assignment_role: Mapped[str | None] = mapped_column(Text)
    rate_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class StaffCompensationRateEvent(WorkspaceScoped, Base):
    __tablename__ = "staff_compensation_rate_events"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    staff_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="RESTRICT"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    before_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    after_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class StaffAttendanceEntry(WorkspaceScoped, Base):
    __tablename__ = "staff_attendance_entries"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    staff_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="RESTRICT"),
        nullable=False,
    )
    occurrence_class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("classes.id", ondelete="RESTRICT"),
        nullable=False,
    )
    occurrence_slot_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("class_schedule_slots.id", ondelete="RESTRICT"),
        nullable=False,
    )
    occurrence_start_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    occurrence_end_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    occurrence_kind: Mapped[str] = mapped_column(Text, nullable=False)
    staff_role: Mapped[str] = mapped_column(Text, nullable=False)
    scheduled_start_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    checkin_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    rate_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    rate_version: Mapped[int] = mapped_column(Integer, nullable=False)
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reversed_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    reversal_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class StaffEarningLedgerEntry(WorkspaceScoped, Base):
    __tablename__ = "staff_earning_ledger"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    staff_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="RESTRICT"),
        nullable=False,
    )
    attendance_entry_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_attendance_entries.id", ondelete="RESTRICT"),
        nullable=False,
    )
    entry_type: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    related_entry_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_earning_ledger.id", ondelete="RESTRICT"),
    )
    reason: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class StaffPayrollSettlement(WorkspaceScoped, Base):
    __tablename__ = "staff_payroll_settlements"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    staff_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="RESTRICT"),
        nullable=False,
    )
    cutoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    total_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    high_watermark_ledger_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_earning_ledger.id", ondelete="RESTRICT"),
    )
    method: Mapped[str] = mapped_column(Text, nullable=False)
    settlement_account_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspace_payment_accounts.id", ondelete="SET NULL"),
    )
    settlement_bank_code_snapshot: Mapped[str | None] = mapped_column(Text)
    settlement_bank_name_snapshot: Mapped[str | None] = mapped_column(Text)
    settlement_account_number_snapshot: Mapped[str | None] = mapped_column(Text)
    settlement_account_name_snapshot: Mapped[str | None] = mapped_column(Text)
    reference: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class StaffPayrollSettlementItem(WorkspaceScoped, Base):
    __tablename__ = "staff_payroll_settlement_items"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    settlement_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_payroll_settlements.id", ondelete="RESTRICT"),
        nullable=False,
    )
    ledger_entry_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_earning_ledger.id", ondelete="RESTRICT"),
        nullable=False,
    )
    allocated_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)


class StaffPayrollSettlementReversal(WorkspaceScoped, Base):
    __tablename__ = "staff_payroll_settlement_reversals"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()")
    )
    settlement_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_payroll_settlements.id", ondelete="RESTRICT"),
        nullable=False,
    )
    staff_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="RESTRICT"),
        nullable=False,
    )
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
