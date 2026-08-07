from datetime import date, datetime
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
    """`GET /users/me` only — adds the caller's account currency (D211),
    name (U0.2c) and today's date in `family_tz` (U3.3), all resolved
    server-side.

    Deliberately not merged into ``UserResponse``: every other ``users``
    route/consumer (admin CRUD, ``PermissionChecker``, existing tests) reads
    straight from the `users` table with no `accounts` join, and stays that
    way.
    """

    currency: Currency
    account_name: str
    # The Mini App's Add-expense date row must anchor on family_tz, never the
    # device clock (D120's bug class) — this is the only place that date
    # reaches the browser. `date`, not `datetime`: the client only ever
    # renders/compares it as a plain calendar date.
    today: date
