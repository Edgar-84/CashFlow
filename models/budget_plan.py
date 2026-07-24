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
    # gt=0 lives here, not on Base: BudgetPlanResponse also inherits Base
    # (four-schema pattern) — a Base-level constraint made every read of a
    # pre-existing/legacy zero-or-negative row raise ValidationError, not
    # just new writes (found via CI on PR #27, plan Decision log D112).
    # The DB now has CHECK(amount > 0) too (U1.6), but rows written before
    # that migration could still violate it, so Response must stay lenient.
    amount: int = Field(gt=0)


class BudgetPlanUpdate(BaseModel):
    amount: int | None = Field(default=None, gt=0)
    period: Period | None = None
    notify_threshold: int | None = Field(default=None, ge=0, le=100)


class BudgetPlanResponse(BudgetPlanBase):
    id: UUID
    account_id: UUID
    created_at: datetime
    updated_at: datetime  # DB-trigger-maintained (set_updated_at) — never set by app code
    model_config = ConfigDict(from_attributes=True)


class BudgetProgress(BaseModel):
    """Computed summary for one budget plan's current period — not a DB entity,
    so it sits outside the four-schema pattern (built directly by budget_service,
    never from_attributes)."""

    budget_plan_id: UUID
    category_id: UUID
    amount: int  # limit, minor units
    spent: int  # minor units
    remaining: int  # minor units; negative once spent exceeds amount
    fill_pct: float | None  # None when amount <= 0 (no meaningful limit)
    notify_threshold: int
    is_over_threshold: bool
    is_exceeded: bool  # spent has reached/crossed 100% of amount
