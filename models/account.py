from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from models.enums import Currency


class AccountResponse(BaseModel):
    id: UUID
    name: str
    currency: Currency
    owner_id: UUID | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
