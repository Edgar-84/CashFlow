from typing import Any, Protocol
from uuid import UUID

import asyncpg

from models.category import CategoryCreate, CategoryResponse, CategoryUpdate
from models.errors import ConflictError, NotFoundError


class CategoryRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real CategoryRepository."""

    async def list(self, **filters: Any) -> list[CategoryResponse]: ...
    async def get(self, id: UUID) -> CategoryResponse | None: ...
    async def create(self, data: dict[str, Any]) -> CategoryResponse: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> CategoryResponse | None: ...
    async def delete(self, id: UUID) -> bool: ...


class CategoryService:
    """Category CRUD, scoped to the calling user's account.

    ``account_id`` is always the authenticated caller's own account, never a
    client-supplied value (root CLAUDE.md: never trust client-supplied
    UUIDs) — callers (routes) pass it explicitly.
    """

    def __init__(self, category_repo: CategoryRepositoryProtocol) -> None:
        self._category_repo = category_repo

    async def list(self, account_id: UUID) -> list[CategoryResponse]:
        return await self._category_repo.list(account_id=account_id)

    async def get(self, category_id: UUID, account_id: UUID) -> CategoryResponse:
        category = await self._category_repo.get(category_id)
        if category is None or category.account_id != account_id:
            raise NotFoundError(f"Category {category_id} not found")
        return category

    async def create(self, data: CategoryCreate, account_id: UUID) -> CategoryResponse:
        payload = data.model_dump()
        payload["account_id"] = account_id
        return await self._category_repo.create(payload)

    async def update(
        self, category_id: UUID, data: CategoryUpdate, account_id: UUID
    ) -> CategoryResponse:
        current = await self.get(category_id, account_id)  # 404 if missing or foreign
        # name is a NOT NULL column with no "clear" semantics — an explicit
        # {"name": null} would otherwise reach the repo as SET name = NULL,
        # same gap fixed for users in D30. Treat it as omitted, not a 500.
        payload = {
            key: value
            for key, value in data.model_dump(exclude_unset=True).items()
            if value is not None
        }
        if not payload:
            return current
        updated = await self._category_repo.update(category_id, payload)
        assert updated is not None
        return updated

    async def delete(self, category_id: UUID, account_id: UUID) -> None:
        await self.get(category_id, account_id)  # 404 if missing or foreign
        try:
            await self._category_repo.delete(category_id)
        except asyncpg.ForeignKeyViolationError as exc:
            # docs/SCHEMA.sql: expenses.category_id and budget_plans.category_id
            # are ON DELETE RESTRICT (plan Decision log D5) — a category still
            # referenced by either must surface as a clean 409, not a 500.
            raise ConflictError(
                f"Category {category_id} is still in use by expenses or budget plans"
            ) from exc
