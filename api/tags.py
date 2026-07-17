from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from api.deps import PermissionChecker, get_tag_service
from models.enums import Action, Resource
from models.tag import TagCreate, TagResponse, TagUpdate
from models.user import UserResponse
from services.tag_service import TagService

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagResponse])
async def list_tags(
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.TAGS, Action.READ))],
    service: Annotated[TagService, Depends(get_tag_service)],
) -> list[TagResponse]:
    return await service.list(user.account_id)


@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(
    tag_id: UUID,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.TAGS, Action.READ))],
    service: Annotated[TagService, Depends(get_tag_service)],
) -> TagResponse:
    return await service.get(tag_id, user.account_id)


@router.post("", response_model=TagResponse, status_code=201)
async def create_tag(
    data: TagCreate,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.TAGS, Action.CREATE))],
    service: Annotated[TagService, Depends(get_tag_service)],
) -> TagResponse:
    return await service.create(data, user.account_id)


@router.patch("/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: UUID,
    data: TagUpdate,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.TAGS, Action.UPDATE))],
    service: Annotated[TagService, Depends(get_tag_service)],
) -> TagResponse:
    return await service.update(tag_id, data, user.account_id)


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: UUID,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.TAGS, Action.DELETE))],
    service: Annotated[TagService, Depends(get_tag_service)],
) -> None:
    await service.delete(tag_id, user.account_id)
