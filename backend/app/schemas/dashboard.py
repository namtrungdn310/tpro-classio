from pydantic import BaseModel, Field


class DashboardOperationsSummary(BaseModel):
    period: str
    active_student_count: int
    active_class_count: int
    weekly_session_count: int
    active_teacher_count: int
    active_assistant_count: int


class DashboardFeeSummary(BaseModel):
    total_amount: int = Field(ge=0)
    gross_collected_amount: int = Field(ge=0)
    refunded_amount: int = Field(ge=0)
    net_collected_amount: int = Field(ge=0)
    outstanding_amount: int = Field(ge=0)
    paid_record_count: int = Field(ge=0)
    record_count: int = Field(ge=0)


class DashboardRevenuePoint(BaseModel):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    net_collected_amount: int


class DashboardOverviewResponse(BaseModel):
    summary: DashboardOperationsSummary
    fees: DashboardFeeSummary
    revenue_trend: list[DashboardRevenuePoint]
