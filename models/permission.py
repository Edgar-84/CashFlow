from uuid import UUID

from pydantic import BaseModel, ConfigDict

from models.enums import Resource


class PermissionBase(BaseModel):
    resource: Resource
    can_create: bool = False
    can_read: bool = True
    can_update: bool = False
    can_delete: bool = False
    own_only: bool = True


class PermissionCreate(PermissionBase):
    user_id: UUID


class PermissionUpdate(BaseModel):
    can_create: bool | None = None
    can_read: bool | None = None
    can_update: bool | None = None
    can_delete: bool | None = None
    own_only: bool | None = None


class PermissionResponse(PermissionBase):
    id: UUID
    user_id: UUID
    model_config = ConfigDict(from_attributes=True)
