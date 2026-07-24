from typing import Any, Protocol
from uuid import UUID

import asyncpg

from models.errors import ConflictError, NotFoundError
from models.permission import PermissionCreate, PermissionResponse, PermissionUpdate
from models.user import UserResponse


class PermissionRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real PermissionRepository."""

    async def list_by_account(self, account_id: UUID) -> list[PermissionResponse]: ...
    async def get(self, id: UUID) -> PermissionResponse | None: ...
    async def create(self, data: dict[str, Any]) -> PermissionResponse: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> PermissionResponse | None: ...
    async def delete(self, id: UUID) -> bool: ...


class UserRepositoryProtocol(Protocol):
    async def get(self, id: UUID) -> UserResponse | None: ...


class PermissionService:
    """Admin-only permission-override management, scoped to the admin's account.

    ``account_id`` is always the authenticated admin's own account, never a
    client-supplied value (root CLAUDE.md: never trust client-supplied
    UUIDs). Since `permissions` rows carry no `account_id` of their own,
    scoping goes through the row's target user: the target must belong to
    the admin's account, 404 otherwise (plan Decision D103, MVP D29 pattern
    — foreign-account targets never surface as 403, which would confirm the
    row's existence to a cross-account probe).
    """

    def __init__(
        self,
        permission_repo: PermissionRepositoryProtocol,
        user_repo: UserRepositoryProtocol,
    ) -> None:
        self._permission_repo = permission_repo
        self._user_repo = user_repo

    async def list(self, account_id: UUID) -> list[PermissionResponse]:
        return await self._permission_repo.list_by_account(account_id)

    async def get(self, permission_id: UUID, account_id: UUID) -> PermissionResponse:
        permission = await self._permission_repo.get(permission_id)
        if permission is None or not await self._owned_by_account(permission.user_id, account_id):
            raise NotFoundError(f"Permission {permission_id} not found")
        return permission

    async def create(self, data: PermissionCreate, account_id: UUID) -> PermissionResponse:
        if not await self._owned_by_account(data.user_id, account_id):
            raise NotFoundError(f"User {data.user_id} not found")
        payload = data.model_dump()
        payload["resource"] = data.resource.value
        try:
            return await self._permission_repo.create(payload)
        except asyncpg.UniqueViolationError as exc:
            raise ConflictError(
                f"Permission for user {data.user_id} on {data.resource.value} already exists"
            ) from exc

    async def update(
        self, permission_id: UUID, data: PermissionUpdate, account_id: UUID
    ) -> PermissionResponse:
        current = await self.get(permission_id, account_id)  # 404 if missing or foreign
        payload = {
            key: value
            for key, value in data.model_dump(exclude_unset=True).items()
            if value is not None
        }
        if not payload:
            return current
        updated = await self._permission_repo.update(permission_id, payload)
        assert updated is not None
        return updated

    async def delete(self, permission_id: UUID, account_id: UUID) -> None:
        await self.get(permission_id, account_id)  # 404 if missing or foreign
        await self._permission_repo.delete(permission_id)

    async def _owned_by_account(self, user_id: UUID, account_id: UUID) -> bool:
        target = await self._user_repo.get(user_id)
        return target is not None and target.account_id == account_id
