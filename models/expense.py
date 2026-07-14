from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from models.tag import TagResponse


class ExpenseBase(BaseModel):
    amount: int  # minor units (kopecks/cents) — NEVER float
    comment: str | None = None
    category_id: UUID  # NOT NULL (D2) — every account has a seeded "General" category


class ExpenseCreate(ExpenseBase):
    tag_ids: list[UUID] = []


class ExpenseUpdate(BaseModel):
    amount: int | None = None
    comment: str | None = None
    category_id: UUID | None = None
    tag_ids: list[UUID] | None = None


class ExpenseResponse(ExpenseBase):
    id: UUID
    user_id: UUID
    account_id: UUID
    created_at: datetime
    updated_at: datetime  # DB-trigger-maintained (set_updated_at) — never set by app code
    tags: list[TagResponse] = []
    model_config = ConfigDict(from_attributes=True)
