import asyncpg

from models.admin import AdminUserRow
from models.user import UserResponse
from repositories.base import BaseRepository


class UserRepository(BaseRepository[UserResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="users", model=UserResponse)

    async def list_for_admin(self) -> list[AdminUserRow]:
        """Every user across every account, with its account's name — unscoped
        by `account_id`, used only by `api/admin.py`'s system-admin surface
        (D711)."""
        rows = await self._conn.fetch(
            """
            SELECT users.*, accounts.name AS account_name
            FROM users
            JOIN accounts ON accounts.id = users.account_id
            ORDER BY users.created_at
            """
        )
        return [AdminUserRow.model_validate(dict(row)) for row in rows]
