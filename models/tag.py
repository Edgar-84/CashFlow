from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TagBase(BaseModel):
    name: str


class TagCreate(TagBase):
    pass


class TagUpdate(BaseModel):
    name: str | None = None


class TagResponse(TagBase):
    id: UUID
    account_id: UUID
    created_at: datetime
    is_active: bool = True
    # populated only when the caller asks for usage (include_usage=true, U0.5);
    # None means "not requested", never "zero"
    expense_count: int | None = None
    model_config = ConfigDict(from_attributes=True)
