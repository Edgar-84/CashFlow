from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from api.deps import PermissionChecker, get_category_service
from models.category import CategoryCreate, CategoryResponse, CategoryUpdate
from models.enums import Action, Resource
from models.user import UserResponse
from services.category_service import CategoryService

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryResponse])
async def list_categories(
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.CATEGORIES, Action.READ))],
    service: Annotated[CategoryService, Depends(get_category_service)],
) -> list[CategoryResponse]:
    return await service.list(user.account_id)


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: UUID,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.CATEGORIES, Action.READ))],
    service: Annotated[CategoryService, Depends(get_category_service)],
) -> CategoryResponse:
    return await service.get(category_id, user.account_id)


@router.post("", response_model=CategoryResponse, status_code=201)
async def create_category(
    data: CategoryCreate,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.CATEGORIES, Action.CREATE))],
    service: Annotated[CategoryService, Depends(get_category_service)],
) -> CategoryResponse:
    return await service.create(data, user.account_id)


@router.patch("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: UUID,
    data: CategoryUpdate,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.CATEGORIES, Action.UPDATE))],
    service: Annotated[CategoryService, Depends(get_category_service)],
) -> CategoryResponse:
    return await service.update(category_id, data, user.account_id)


@router.delete("/{category_id}", status_code=204)
async def delete_category(
    category_id: UUID,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.CATEGORIES, Action.DELETE))],
    service: Annotated[CategoryService, Depends(get_category_service)],
) -> None:
    await service.delete(category_id, user.account_id)
