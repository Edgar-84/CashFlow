"""Additive aggregate models for statistics_service (not four-schema entities —
computed summaries, never `from_attributes`, same precedent as
`models.budget_plan.BudgetProgress`, plan Decision log D34)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class PeriodTotal(BaseModel):
    start: datetime
    end: datetime
    total: int


class CategoryTotal(BaseModel):
    category_id: UUID
    total: int


class TagTotal(BaseModel):
    tag_id: UUID
    total: int


class BudgetFill(BaseModel):
    """One budget plan scored against a resolved month's spend (U3.1, D807):
    `amount` is the plan's CURRENT limit, not a historical snapshot — same
    fields as `models.budget_plan.BudgetProgress`, built via
    `services.budget_service.calculate_progress` rather than a second copy of
    its arithmetic."""

    budget_plan_id: UUID
    category_id: UUID
    amount: int
    spent: int
    remaining: int
    fill_pct: float | None
    notify_threshold: int
    is_over_threshold: bool
    is_exceeded: bool
