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
