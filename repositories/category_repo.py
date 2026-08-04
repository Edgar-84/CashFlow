from uuid import UUID

import asyncpg

from models.category import CategoryResponse
from repositories.base import BaseRepository


class CategoryRepository(BaseRepository[CategoryResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="categories", model=CategoryResponse)

    async def list_with_usage(
        self, account_id: UUID, *, include_archived: bool
    ) -> list[CategoryResponse]:
        archived_clause = "" if include_archived else "AND c.is_active"
        rows = await self._conn.fetch(
            f"""
            SELECT c.*, COUNT(e.id)::int AS expense_count
            FROM categories c
            LEFT JOIN expenses e ON e.category_id = c.id
            WHERE c.account_id = $1 {archived_clause}
            GROUP BY c.id
            ORDER BY c.created_at
            """,
            account_id,
        )
        return [CategoryResponse.model_validate(dict(row)) for row in rows]

    async def count_expenses(self, category_id: UUID) -> int:
        row = await self._conn.fetchrow(
            "SELECT COUNT(*)::int AS count FROM expenses WHERE category_id = $1", category_id
        )
        assert row is not None
        return row["count"]

    async def count_budget_plans(self, category_id: UUID) -> int:
        row = await self._conn.fetchrow(
            "SELECT COUNT(*)::int AS count FROM budget_plans WHERE category_id = $1", category_id
        )
        assert row is not None
        return row["count"]
