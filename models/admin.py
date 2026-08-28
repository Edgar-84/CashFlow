from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from models.enums import Currency, Language, Role


class AdminAccountRow(BaseModel):
    """One row of `GET /admin/accounts` (M4.3) — the only response shape in
    this project that reads across account boundaries (D711)."""

    id: UUID
    name: str
    currency: Currency
    language: Language
    is_blocked: bool
    user_count: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class AdminUserRow(BaseModel):
    """One row of `GET /admin/users` (M4.3)."""

    id: UUID
    tg_id: int
    name: str
    role: Role
    account_id: UUID
    account_name: str
    is_blocked: bool
    model_config = ConfigDict(from_attributes=True)


class AdminAccountCreate(BaseModel):
    """`POST /admin/accounts` (M4.4) — creates the account and its first user
    in one transaction (D712: every account still has exactly one owner)."""

    name: str
    currency: Currency = Currency.USD
    language: Language = Language.EN
    owner_tg_id: int
    owner_name: str


class BlockUpdate(BaseModel):
    """`PATCH /admin/users/{id}/block` and `PATCH /admin/accounts/{id}/block`
    (M4.5)."""

    is_blocked: bool
