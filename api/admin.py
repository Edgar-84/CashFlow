"""`POST /admin/accounts`, `GET /admin/accounts`, `GET /admin/users`,
`PATCH /admin/users/{id}/block`, `PATCH /admin/accounts/{id}/block` — the
system-admin panel's cross-account surface.

This is the **only** router in the project that reads or writes
`users`/`accounts` outside the caller's own `account_id` (D711): every other
router, service and repository call is scoped to the authenticated caller's
account, and that scoping is the security model (root CLAUDE.md). Gated by
:func:`api.deps.require_system_admin`, which admits `Role.SYSTEM_ADMIN`
alone — not even a plain `admin` reaches these routes.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from api.deps import get_admin_service, require_system_admin
from models.account import AccountResponse
from models.admin import AdminAccountCreate, AdminAccountRow, AdminUserRow, BlockUpdate
from models.user import UserResponse
from services.admin_service import AdminService

router = APIRouter(prefix="/admin", tags=["admin"])


def _unprocessable(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.post("/accounts", response_model=AdminAccountRow, status_code=201)
async def create_account(
    data: AdminAccountCreate,
    admin: Annotated[UserResponse, Depends(require_system_admin)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> AdminAccountRow:
    return await service.create_account(data)


@router.get("/accounts", response_model=list[AdminAccountRow])
async def list_accounts(
    admin: Annotated[UserResponse, Depends(require_system_admin)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> list[AdminAccountRow]:
    return await service.list_accounts()


@router.get("/users", response_model=list[AdminUserRow])
async def list_users(
    admin: Annotated[UserResponse, Depends(require_system_admin)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> list[AdminUserRow]:
    return await service.list_users()


@router.patch("/users/{user_id}/block", response_model=UserResponse)
async def block_user(
    user_id: UUID,
    data: BlockUpdate,
    admin: Annotated[UserResponse, Depends(require_system_admin)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> UserResponse:
    try:
        return await service.block_user(user_id, data.is_blocked, admin)
    except ValueError as exc:
        raise _unprocessable(exc) from exc


@router.patch("/accounts/{account_id}/block", response_model=AccountResponse)
async def block_account(
    account_id: UUID,
    data: BlockUpdate,
    admin: Annotated[UserResponse, Depends(require_system_admin)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> AccountResponse:
    try:
        return await service.block_account(account_id, data.is_blocked, admin)
    except ValueError as exc:
        raise _unprocessable(exc) from exc
