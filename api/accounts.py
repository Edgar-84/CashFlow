from typing import Annotated

from fastapi import APIRouter, Depends

from api.deps import get_account_service, require_admin
from models.account import AccountResponse, AccountUpdate
from models.user import UserResponse
from services.account_service import AccountService

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.patch("/me", response_model=AccountResponse)
async def update_my_account(
    data: AccountUpdate,
    user: Annotated[UserResponse, Depends(require_admin)],
    service: Annotated[AccountService, Depends(get_account_service)],
) -> AccountResponse:
    return await service.update(user.account_id, data)
