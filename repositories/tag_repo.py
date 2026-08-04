from uuid import UUID

import asyncpg

from models.tag import TagResponse
from repositories.base import BaseRepository


class TagRepository(BaseRepository[TagResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="tags", model=TagResponse)

    async def list_with_usage(
        self, account_id: UUID, *, include_archived: bool
    ) -> list[TagResponse]:
        archived_clause = "" if include_archived else "AND t.is_active"
        rows = await self._conn.fetch(
            f"""
            SELECT t.*, COUNT(et.expense_id)::int AS expense_count
            FROM tags t
            LEFT JOIN expense_tags et ON et.tag_id = t.id
            WHERE t.account_id = $1 {archived_clause}
            GROUP BY t.id
            ORDER BY t.created_at
            """,
            account_id,
        )
        return [TagResponse.model_validate(dict(row)) for row in rows]

    async def count_expenses(self, tag_id: UUID) -> int:
        row = await self._conn.fetchrow(
            "SELECT COUNT(*)::int AS count FROM expense_tags WHERE tag_id = $1", tag_id
        )
        assert row is not None
        return row["count"]
