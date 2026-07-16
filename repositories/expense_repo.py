from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

from models.expense import ExpenseResponse
from models.tag import TagResponse
from repositories.base import BaseRepository


class ExpenseRepository(BaseRepository[ExpenseResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="expenses", model=ExpenseResponse)

    async def _tags_by_expense_id(self, expense_ids: list[UUID]) -> dict[UUID, list[TagResponse]]:
        if not expense_ids:
            return {}
        rows = await self._conn.fetch(
            """
            SELECT expense_tags.expense_id, tags.*
            FROM expense_tags
            JOIN tags ON tags.id = expense_tags.tag_id
            WHERE expense_tags.expense_id = ANY($1::uuid[])
            """,
            expense_ids,
        )
        result: dict[UUID, list[TagResponse]] = defaultdict(list)
        for row in rows:
            data = dict(row)
            expense_id = data.pop("expense_id")
            result[expense_id].append(TagResponse.model_validate(data))
        return result

    async def _attach_tags(self, expenses: list[ExpenseResponse]) -> list[ExpenseResponse]:
        tags_by_id = await self._tags_by_expense_id([e.id for e in expenses])
        return [e.model_copy(update={"tags": tags_by_id.get(e.id, [])}) for e in expenses]

    async def get(self, id: UUID) -> ExpenseResponse | None:
        expense = await super().get(id)
        if expense is None:
            return None
        return (await self._attach_tags([expense]))[0]

    async def create(self, data: dict[str, Any]) -> ExpenseResponse:
        data = dict(data)
        tag_ids: list[UUID] = data.pop("tag_ids", [])
        async with self._conn.transaction():
            expense = await super().create(data)
            if tag_ids:
                await self._conn.executemany(
                    "INSERT INTO expense_tags (expense_id, tag_id) VALUES ($1, $2)",
                    [(expense.id, tag_id) for tag_id in tag_ids],
                )
        return await self.get(expense.id) or expense

    async def update(self, id: UUID, data: dict[str, Any]) -> ExpenseResponse | None:
        data = dict(data)
        tag_ids: list[UUID] | None = data.pop("tag_ids", None)
        async with self._conn.transaction():
            if tag_ids is not None:
                existing = await super().get(id)
                if existing is None:
                    return None
                await self._conn.execute("DELETE FROM expense_tags WHERE expense_id = $1", id)
                if tag_ids:
                    await self._conn.executemany(
                        "INSERT INTO expense_tags (expense_id, tag_id) VALUES ($1, $2)",
                        [(id, tag_id) for tag_id in tag_ids],
                    )
            if data:
                updated = await super().update(id, data)
                if updated is None:
                    return None
        return await self.get(id)

    async def get_by_period(
        self, account_id: UUID, start: datetime, end: datetime
    ) -> list[ExpenseResponse]:
        rows = await self._conn.fetch(
            """
            SELECT * FROM expenses
            WHERE account_id = $1 AND created_at >= $2 AND created_at < $3
            ORDER BY created_at
            """,
            account_id,
            start,
            end,
        )
        expenses = [self._model.model_validate(dict(row)) for row in rows]
        return await self._attach_tags(expenses)

    async def get_by_category(self, account_id: UUID, category_id: UUID) -> list[ExpenseResponse]:
        rows = await self._conn.fetch(
            """
            SELECT * FROM expenses
            WHERE account_id = $1 AND category_id = $2
            ORDER BY created_at
            """,
            account_id,
            category_id,
        )
        expenses = [self._model.model_validate(dict(row)) for row in rows]
        return await self._attach_tags(expenses)

    async def sum_by_category_month(
        self, account_id: UUID, start: datetime, end: datetime
    ) -> dict[UUID, int]:
        rows = await self._conn.fetch(
            """
            SELECT category_id, SUM(amount)::bigint AS total
            FROM expenses
            WHERE account_id = $1 AND created_at >= $2 AND created_at < $3
            GROUP BY category_id
            """,
            account_id,
            start,
            end,
        )
        return {row["category_id"]: row["total"] for row in rows}

    async def list(self, **filters: Any) -> list[ExpenseResponse]:
        expenses = await super().list(**filters)
        return await self._attach_tags(expenses)
