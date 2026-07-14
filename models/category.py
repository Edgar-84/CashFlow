from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CategoryBase(BaseModel):
    name: str


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = None


class CategoryResponse(CategoryBase):
    id: UUID
    account_id: UUID
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
