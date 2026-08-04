from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CategoryBase(BaseModel):
    name: str


class CategoryCreate(CategoryBase):
    # omitted (None) means "the service picks the next free slot" (U0.6);
    # write-side range is 1-6 (the auto-assign pool), narrower than
    # CategoryResponse's 1-12 (D317 widened 7-12 for a future user-picker,
    # not for this unit's auto-assign).
    color_slot: int | None = Field(default=None, ge=1, le=6)


class CategoryUpdate(BaseModel):
    name: str | None = None
    color_slot: int | None = Field(default=None, ge=1, le=6)


class CategoryResponse(CategoryBase):
    id: UUID
    account_id: UUID
    created_at: datetime
    is_active: bool = True
    color_slot: int | None = Field(
        default=None, ge=1, le=12
    )  # palette slot index (D308), never a hex value
    # populated only when the caller asks for usage (include_usage=true, U0.4);
    # None means "not requested", never "zero"
    expense_count: int | None = None
    model_config = ConfigDict(from_attributes=True)
