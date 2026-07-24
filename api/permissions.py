from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from api.deps import get_permission_service, require_admin
from models.permission import PermissionCreate, PermissionResponse, PermissionUpdate
from models.user import UserResponse
from services.permission_service import PermissionService

router = APIRouter(prefix="/permissions", tags=["permissions"])


@router.get("", response_model=list[PermissionResponse])
async def list_permissions(
    admin: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[PermissionService, Depends(get_permission_service)],
) -> list[PermissionResponse]:
    return await service.list(admin.account_id)


@router.get("/{permission_id}", response_model=PermissionResponse)
async def get_permission(
    permission_id: UUID,
    admin: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[PermissionService, Depends(get_permission_service)],
) -> PermissionResponse:
    return await service.get(permission_id, admin.account_id)


@router.post("", response_model=PermissionResponse, status_code=201)
async def create_permission(
    data: PermissionCreate,
    admin: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[PermissionService, Depends(get_permission_service)],
) -> PermissionResponse:
    return await service.create(data, admin.account_id)


@router.patch("/{permission_id}", response_model=PermissionResponse)
async def update_permission(
    permission_id: UUID,
    data: PermissionUpdate,
    admin: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[PermissionService, Depends(get_permission_service)],
) -> PermissionResponse:
    return await service.update(permission_id, data, admin.account_id)


@router.delete("/{permission_id}", status_code=204)
async def delete_permission(
    permission_id: UUID,
    admin: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[PermissionService, Depends(get_permission_service)],
) -> None:
    await service.delete(permission_id, admin.account_id)
