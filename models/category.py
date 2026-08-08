from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CategoryBase(BaseModel):
    name: str


class CategoryCreate(CategoryBase):
    # omitted (None) means "the service picks the next free slot" from the
    # auto-assign pool (1-6, services/category_service.py::_next_free_color_slot,
    # unchanged by this range); an explicit value can be any of the 1-72
    # palette slots (D500, M2's colour picker sends 7-72 too).
    color_slot: int | None = Field(default=None, ge=1, le=72)


class CategoryUpdate(BaseModel):
    name: str | None = None
    color_slot: int | None = Field(default=None, ge=1, le=72)


class CategoryResponse(CategoryBase):
    id: UUID
    account_id: UUID
    created_at: datetime
    is_active: bool = True
    # Unbounded (four-schema rule, D112's lesson): a Response must never
    # reject a row the DB already holds.
    color_slot: int | None = None  # palette slot index (D308), never a hex value
    # populated only when the caller asks for usage (include_usage=true, U0.4);
    # None means "not requested", never "zero"
    expense_count: int | None = None
    model_config = ConfigDict(from_attributes=True)
