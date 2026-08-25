from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from models.enums import Currency, Language


class AccountResponse(BaseModel):
    id: UUID
    name: str
    currency: Currency
    language: Language
    owner_id: UUID | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class AccountUpdate(BaseModel):
    """`PATCH /accounts/me` only (D401) — relabels the account's currency,
    never converts `expenses.amount` (D400)."""

    currency: Currency | None = None
    language: Language | None = None
