from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Period = Literal["monthly"]


class BudgetPlanBase(BaseModel):
    category_id: UUID
    amount: int  # minor units (kopecks/cents) — NEVER float
    period: Period = "monthly"
    notify_threshold: int = Field(default=80, ge=0, le=100)  # percent


class BudgetPlanCreate(BudgetPlanBase):
    pass


class BudgetPlanUpdate(BaseModel):
    amount: int | None = None
    period: Period | None = None
    notify_threshold: int | None = Field(default=None, ge=0, le=100)


class BudgetPlanResponse(BudgetPlanBase):
    id: UUID
    account_id: UUID
    created_at: datetime
    updated_at: datetime  # DB-trigger-maintained (set_updated_at) — never set by app code
    model_config = ConfigDict(from_attributes=True)
