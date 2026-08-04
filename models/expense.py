from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from models.tag import TagResponse


class ExpenseBase(BaseModel):
    amount: int  # minor units (kopecks/cents) — NEVER float
    comment: str | None = None
    category_id: UUID  # NOT NULL (D2) — every account has a seeded "General" category
    # the day the expense happened, distinct from created_at (D314). None on
    # write means "default to today in family_tz" (ExpenseService.create).
    spent_at: date | None = None


class ExpenseCreate(ExpenseBase):
    # gt=0 lives here, not on Base: ExpenseResponse also inherits Base
    # (four-schema pattern) — a Base-level constraint would make reading
    # back a pre-existing zero-or-negative row raise ValidationError, not
    # just reject new writes (same reasoning as BudgetPlanCreate, D112).
    amount: int = Field(gt=0)
    tag_ids: list[UUID] = []


class ExpenseUpdate(BaseModel):
    amount: int | None = Field(default=None, gt=0)
    comment: str | None = None
    category_id: UUID | None = None
    tag_ids: list[UUID] | None = None
    spent_at: date | None = None


class ExpenseResponse(ExpenseBase):
    id: UUID
    user_id: UUID
    account_id: UUID
    created_at: datetime
    updated_at: datetime  # DB-trigger-maintained (set_updated_at) — never set by app code
    # narrows ExpenseBase's Optional back to a concrete date — a stored row
    # always has one; the default_factory only eases constructing fixtures
    # that predate the column.
    spent_at: date = Field(default_factory=date.today)
    tags: list[TagResponse] = []
    # populated by a repo LEFT JOIN on users.name; None for old fixtures or a
    # hard-deleted user (plan Decision log D102)
    user_name: str | None = None
    model_config = ConfigDict(from_attributes=True)
