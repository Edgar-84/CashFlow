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
