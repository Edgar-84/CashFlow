from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from models.enums import Currency, Role


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


class UserMeResponse(UserResponse):
    """`GET /users/me` only — adds the caller's account currency (D211).

    Deliberately not merged into ``UserResponse``: every other ``users``
    route/consumer (admin CRUD, ``PermissionChecker``, existing tests) reads
    straight from the `users` table with no `accounts` join, and stays that
    way.
    """

    currency: Currency
