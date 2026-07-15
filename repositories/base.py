from typing import Any
from uuid import UUID

import asyncpg
from pydantic import BaseModel


class BaseRepository[T: BaseModel]:
    """Generic CRUD over a single table via a live asyncpg connection."""

    def __init__(self, conn: asyncpg.Connection, table: str, model: type[T]) -> None:
        self._conn = conn
        self._table = table
        self._model = model

    async def get(self, id: UUID) -> T | None:
        row = await self._conn.fetchrow(f"SELECT * FROM {self._table} WHERE id = $1", id)
        return self._model.model_validate(dict(row)) if row is not None else None

    async def list(self, **filters: Any) -> list[T]:
        if filters:
            columns = list(filters.keys())
            where = " AND ".join(f"{col} = ${i}" for i, col in enumerate(columns, start=1))
            rows = await self._conn.fetch(
                f"SELECT * FROM {self._table} WHERE {where}", *filters.values()
            )
        else:
            rows = await self._conn.fetch(f"SELECT * FROM {self._table}")
        return [self._model.model_validate(dict(row)) for row in rows]

    async def create(self, data: dict[str, Any]) -> T:
        columns = list(data.keys())
        placeholders = ", ".join(f"${i}" for i in range(1, len(columns) + 1))
        row = await self._conn.fetchrow(
            f"INSERT INTO {self._table} ({', '.join(columns)}) VALUES ({placeholders}) RETURNING *",
            *data.values(),
        )
        assert row is not None
        return self._model.model_validate(dict(row))

    async def update(self, id: UUID, data: dict[str, Any]) -> T | None:
        if not data:
            return await self.get(id)
        columns = list(data.keys())
        set_clause = ", ".join(f"{col} = ${i}" for i, col in enumerate(columns, start=1))
        row = await self._conn.fetchrow(
            f"UPDATE {self._table} SET {set_clause} WHERE id = ${len(columns) + 1} RETURNING *",
            *data.values(),
            id,
        )
        return self._model.model_validate(dict(row)) if row is not None else None

    async def delete(self, id: UUID) -> bool:
        row = await self._conn.fetchrow(f"DELETE FROM {self._table} WHERE id = $1 RETURNING id", id)
        return row is not None
