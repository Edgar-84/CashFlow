from __future__ import annotations

from uuid import UUID

import asyncpg

from models.enums import Resource
from models.permission import PermissionResponse
from repositories.base import BaseRepository


class PermissionRepository(BaseRepository[PermissionResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="permissions", model=PermissionResponse)

    async def get_by_user_and_resource(
        self, user_id: UUID, resource: Resource
    ) -> PermissionResponse | None:
        """Fetch the permission row for a (user, resource) pair, the lookup
        the auth pipeline (M2 PermissionChecker) performs on every request."""
        row = await self._conn.fetchrow(
            "SELECT * FROM permissions WHERE user_id = $1 AND resource = $2",
            user_id,
            resource.value,
        )
        return self._model.model_validate(dict(row)) if row is not None else None

    async def list_by_account(self, account_id: UUID) -> list[PermissionResponse]:
        """Fetch every override row for users in the given account (admin grid).

        `permissions` has no `account_id` column of its own — scoping goes
        through a JOIN on `users`, same pattern as U1.3's expense-author JOIN.
        """
        rows = await self._conn.fetch(
            "SELECT permissions.* FROM permissions "
            "JOIN users ON users.id = permissions.user_id "
            "WHERE users.account_id = $1",
            account_id,
        )
        return [self._model.model_validate(dict(row)) for row in rows]
