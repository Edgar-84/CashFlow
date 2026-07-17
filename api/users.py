from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from api.deps import get_user_service, require_admin
from models.user import UserCreate, UserResponse, UserUpdate
from services.user_service import UserService

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserResponse])
async def list_users(
    admin: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[UserService, Depends(get_user_service)],
) -> list[UserResponse]:
    return await service.list(admin.account_id)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: UUID,
    admin: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[UserService, Depends(get_user_service)],
) -> UserResponse:
    return await service.get(user_id, admin.account_id)


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    data: UserCreate,
    admin: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[UserService, Depends(get_user_service)],
) -> UserResponse:
    return await service.create(data, admin.account_id)


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    data: UserUpdate,
    admin: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[UserService, Depends(get_user_service)],
) -> UserResponse:
    return await service.update(user_id, data, admin.account_id)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: UUID,
    admin: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[UserService, Depends(get_user_service)],
) -> None:
    await service.delete(user_id, admin.account_id)
