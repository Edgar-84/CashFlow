from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from models.enums import Role


class UserBase(BaseModel):
    tg_id: int
    name: str
    role: Role = Role.MEMBER


class UserCreate(UserBase):
    account_id: UUID


class UserUpdate(BaseModel):
    name: str | None = None
    role: Role | None = None


class UserResponse(UserBase):
    id: UUID
    account_id: UUID
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
