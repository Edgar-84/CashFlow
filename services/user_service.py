from typing import Any, Protocol
from uuid import UUID

import asyncpg

from models.enums import Role
from models.errors import ConflictError, NotFoundError
from models.user import UserCreate, UserResponse, UserUpdate


class UserRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real UserRepository."""

    async def list(self, **filters: Any) -> list[UserResponse]: ...
    async def get(self, id: UUID) -> UserResponse | None: ...
    async def create(self, data: dict[str, Any]) -> UserResponse: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> UserResponse | None: ...
    async def delete(self, id: UUID) -> bool: ...


class UserService:
    """Admin-only user management, scoped to the calling admin's account.

    ``account_id`` is always the authenticated admin's own account, never a
    client-supplied value (root CLAUDE.md: never trust client-supplied
    UUIDs) — callers (routes) pass the admin's ``account_id`` explicitly.
    """

    def __init__(self, user_repo: UserRepositoryProtocol) -> None:
        self._user_repo = user_repo

    async def list(self, account_id: UUID) -> list[UserResponse]:
        return await self._user_repo.list(account_id=account_id)

    async def get(self, user_id: UUID, account_id: UUID) -> UserResponse:
        user = await self._user_repo.get(user_id)
        if user is None or user.account_id != account_id:
            raise NotFoundError(f"User {user_id} not found")
        return user

    async def create(self, data: UserCreate, account_id: UUID) -> UserResponse:
        payload = data.model_dump()
        payload["account_id"] = account_id
        payload["role"] = data.role.value
        try:
            return await self._user_repo.create(payload)
        except asyncpg.UniqueViolationError as exc:
            raise ConflictError(f"User with tg_id {data.tg_id} already exists") from exc

    async def update(self, user_id: UUID, data: UserUpdate, account_id: UUID) -> UserResponse:
        current = await self.get(user_id, account_id)  # 404 if missing or foreign
        # name/role are NOT NULL columns with no "clear" semantics — an explicit
        # {"name": null} would otherwise reach the repo as SET name = NULL and
        # raise an uncaught asyncpg.NotNullViolationError (500). Treat it the
        # same as an omitted field rather than rejecting the whole request.
        payload = {
            key: (value.value if isinstance(value, Role) else value)
            for key, value in data.model_dump(exclude_unset=True).items()
            if value is not None
        }
        if not payload:
            return current
        updated = await self._user_repo.update(user_id, payload)
        assert updated is not None
        return updated

    async def delete(self, user_id: UUID, account_id: UUID) -> None:
        await self.get(user_id, account_id)  # 404 if missing or foreign
        await self._user_repo.delete(user_id)
