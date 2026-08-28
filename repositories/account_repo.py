import asyncpg

from models.account import AccountResponse
from models.admin import AdminAccountRow
from repositories.base import BaseRepository


class AccountRepository(BaseRepository[AccountResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="accounts", model=AccountResponse)

    async def list_for_admin(self) -> list[AdminAccountRow]:
        """Every account with its member count — unscoped by `account_id`,
        used only by `api/admin.py`'s system-admin surface (D711)."""
        rows = await self._conn.fetch(
            """
            SELECT accounts.id, accounts.name, accounts.currency, accounts.language,
                   accounts.is_blocked, accounts.created_at,
                   COUNT(users.id) AS user_count
            FROM accounts
            LEFT JOIN users ON users.account_id = accounts.id
            GROUP BY accounts.id
            ORDER BY accounts.created_at
            """
        )
        return [AdminAccountRow.model_validate(dict(row)) for row in rows]
