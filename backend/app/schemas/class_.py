from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ClassType = Literal["MONTHLY", "COURSE"]


class ClassBase(BaseModel):
    name: str = Field(min_length=1)
    type: ClassType
    base_fee: int = Field(ge=0)
    billing_cycle_months: int = Field(default=1, ge=1, le=24)
    start_date: date | None = None
    end_date: date | None = None
    schedule: dict | None = None


class ClassCreate(ClassBase):
    pass


class ClassUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    type: ClassType | None = None
    base_fee: int | None = Field(default=None, ge=0)
    billing_cycle_months: int | None = Field(default=None, ge=1, le=24)
    start_date: date | None = None
    end_date: date | None = None
    schedule: dict | None = None
    is_active: bool | None = None


class ClassResponse(ClassBase):
    id: UUID
    is_active: bool
    student_count: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
