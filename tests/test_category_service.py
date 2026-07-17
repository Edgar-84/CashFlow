"""Unit tests for services/category_service.py — mocked repository, no DB (tests/CLAUDE.md)."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest

from models.category import CategoryCreate, CategoryResponse, CategoryUpdate
from models.errors import ConflictError, NotFoundError
from services.category_service import CategoryService


class FakeCategoryRepo:
    def __init__(
        self,
        categories: list[CategoryResponse] | None = None,
        *,
        restricted_ids: set[UUID] | None = None,
    ) -> None:
        self._categories: dict[UUID, CategoryResponse] = {c.id: c for c in (categories or [])}
        self._restricted_ids = restricted_ids or set()

    async def list(self, **filters: Any) -> list[CategoryResponse]:
        account_id = filters.get("account_id")
        return [c for c in self._categories.values() if c.account_id == account_id]

    async def get(self, id: UUID) -> CategoryResponse | None:
        return self._categories.get(id)

    async def create(self, data: dict[str, Any]) -> CategoryResponse:
        category = CategoryResponse(
            id=uuid4(),
            name=data["name"],
            account_id=data["account_id"],
            created_at=datetime.now(UTC),
        )
        self._categories[category.id] = category
        return category

    async def update(self, id: UUID, data: dict[str, Any]) -> CategoryResponse | None:
        category = self._categories.get(id)
        if category is None:
            return None
        updated = category.model_copy(update=data)
        self._categories[id] = updated
        return updated

    async def delete(self, id: UUID) -> bool:
        if id in self._restricted_ids:
            raise asyncpg.ForeignKeyViolationError(
                "update or delete on table violates foreign key constraint"
            )
        return self._categories.pop(id, None) is not None


def make_category(*, account_id: UUID, name: str = "Groceries") -> CategoryResponse:
    return CategoryResponse(
        id=uuid4(), name=name, account_id=account_id, created_at=datetime.now(UTC)
    )


async def test_list_scopes_by_account() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    mine = make_category(account_id=account_id)
    other = make_category(account_id=other_account_id)
    service = CategoryService(FakeCategoryRepo([mine, other]))

    result = await service.list(account_id)

    assert result == [mine]


async def test_get_returns_category_in_account() -> None:
    account_id = uuid4()
    category = make_category(account_id=account_id)
    service = CategoryService(FakeCategoryRepo([category]))

    result = await service.get(category.id, account_id)

    assert result == category


async def test_get_missing_raises_not_found() -> None:
    service = CategoryService(FakeCategoryRepo([]))

    with pytest.raises(NotFoundError):
        await service.get(uuid4(), uuid4())


async def test_get_foreign_account_raises_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    category = make_category(account_id=other_account_id)
    service = CategoryService(FakeCategoryRepo([category]))

    with pytest.raises(NotFoundError):
        await service.get(category.id, account_id)


async def test_create_forces_account_id_from_caller() -> None:
    account_id = uuid4()
    service = CategoryService(FakeCategoryRepo([]))
    data = CategoryCreate(name="Groceries")

    created = await service.create(data, account_id)

    assert created.account_id == account_id


async def test_update_changes_fields() -> None:
    account_id = uuid4()
    category = make_category(account_id=account_id)
    service = CategoryService(FakeCategoryRepo([category]))

    updated = await service.update(category.id, CategoryUpdate(name="Renamed"), account_id)

    assert updated.name == "Renamed"


async def test_update_explicit_null_is_ignored_not_nulled() -> None:
    # name is a NOT NULL column with no "clear" semantics (same gap as D30
    # for users) — an explicit null must not reach the repo as SET name = NULL.
    account_id = uuid4()
    category = make_category(account_id=account_id, name="Groceries")
    service = CategoryService(FakeCategoryRepo([category]))

    updated = await service.update(category.id, CategoryUpdate(name=None), account_id)

    assert updated.name == "Groceries"


async def test_update_missing_raises_not_found() -> None:
    service = CategoryService(FakeCategoryRepo([]))

    with pytest.raises(NotFoundError):
        await service.update(uuid4(), CategoryUpdate(name="X"), uuid4())


async def test_delete_removes_category() -> None:
    account_id = uuid4()
    category = make_category(account_id=account_id)
    repo = FakeCategoryRepo([category])
    service = CategoryService(repo)

    await service.delete(category.id, account_id)

    assert await repo.get(category.id) is None


async def test_delete_missing_raises_not_found() -> None:
    service = CategoryService(FakeCategoryRepo([]))

    with pytest.raises(NotFoundError):
        await service.delete(uuid4(), uuid4())


async def test_delete_referenced_category_raises_conflict() -> None:
    # docs/SCHEMA.sql: expenses.category_id / budget_plans.category_id are
    # ON DELETE RESTRICT (plan Decision log D5). The repo surfaces this as a
    # raw asyncpg.ForeignKeyViolationError; the service must translate it to
    # a domain ConflictError (mapped to a clean 409 by main.py), not a 500.
    account_id = uuid4()
    category = make_category(account_id=account_id)
    service = CategoryService(FakeCategoryRepo([category], restricted_ids={category.id}))

    with pytest.raises(ConflictError):
        await service.delete(category.id, account_id)
