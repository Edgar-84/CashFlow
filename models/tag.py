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
    model_config = ConfigDict(from_attributes=True)
