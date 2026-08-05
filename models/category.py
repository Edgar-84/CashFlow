from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CategoryBase(BaseModel):
    name: str


class CategoryCreate(CategoryBase):
    # omitted (None) means "the service picks the next free slot" from the
    # auto-assign pool (1-6, services/category_service.py::_next_free_color_slot,
    # unchanged by this range); an explicit value can be any of the 1-12
    # picker slots (D317, U2.2's screen 06b picker sends 7-12 too).
    color_slot: int | None = Field(default=None, ge=1, le=12)


class CategoryUpdate(BaseModel):
    name: str | None = None
    color_slot: int | None = Field(default=None, ge=1, le=12)


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
