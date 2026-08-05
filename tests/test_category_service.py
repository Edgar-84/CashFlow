"""Unit tests for services/category_service.py — mocked repository, no DB (tests/CLAUDE.md)."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest
from pydantic import ValidationError

from models.category import CategoryCreate, CategoryResponse, CategoryUpdate
from models.errors import ConflictError, NotFoundError
from services.category_service import CategoryService


class FakeCategoryRepo:
    def __init__(
        self,
        categories: list[CategoryResponse] | None = None,
        *,
        restricted_ids: set[UUID] | None = None,
        expense_counts: dict[UUID, int] | None = None,
        budget_counts: dict[UUID, int] | None = None,
    ) -> None:
        self._categories: dict[UUID, CategoryResponse] = {c.id: c for c in (categories or [])}
        self._restricted_ids = restricted_ids or set()
        self._expense_counts = expense_counts or {}
        self._budget_counts = budget_counts or {}

    async def list_with_usage(
        self, account_id: UUID, *, include_archived: bool
    ) -> list[CategoryResponse]:
        return [
            c.model_copy(update={"expense_count": self._expense_counts.get(c.id, 0)})
            for c in self._categories.values()
            if c.account_id == account_id and (include_archived or c.is_active)
        ]

    async def list(self, **filters: Any) -> list[CategoryResponse]:
        return [
            c
            for c in self._categories.values()
            if all(getattr(c, key) == value for key, value in filters.items())
        ]

    async def get(self, id: UUID) -> CategoryResponse | None:
        return self._categories.get(id)

    async def create(self, data: dict[str, Any]) -> CategoryResponse:
        category = CategoryResponse(
            id=uuid4(),
            name=data["name"],
            account_id=data["account_id"],
            created_at=datetime.now(UTC),
            color_slot=data.get("color_slot"),
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

    async def count_expenses(self, category_id: UUID) -> int:
        return self._expense_counts.get(category_id, 0)

    async def count_budget_plans(self, category_id: UUID) -> int:
        return self._budget_counts.get(category_id, 0)


def make_category(
    *,
    account_id: UUID,
    name: str = "Groceries",
    is_active: bool = True,
    color_slot: int | None = None,
) -> CategoryResponse:
    return CategoryResponse(
        id=uuid4(),
        name=name,
        account_id=account_id,
        created_at=datetime.now(UTC),
        is_active=is_active,
        color_slot=color_slot,
    )


async def test_list_scopes_by_account() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    mine = make_category(account_id=account_id)
    other = make_category(account_id=other_account_id)
    service = CategoryService(FakeCategoryRepo([mine, other]))

    result = await service.list(account_id)

    assert result == [mine]


async def test_list_omits_archived_by_default() -> None:
    account_id = uuid4()
    active = make_category(account_id=account_id, name="Active")
    archived = make_category(account_id=account_id, name="Archived", is_active=False)
    service = CategoryService(FakeCategoryRepo([active, archived]))

    result = await service.list(account_id)

    assert result == [active]


async def test_list_includes_archived_when_requested() -> None:
    account_id = uuid4()
    active = make_category(account_id=account_id, name="Active")
    archived = make_category(account_id=account_id, name="Archived", is_active=False)
    service = CategoryService(FakeCategoryRepo([active, archived]))

    result = await service.list(account_id, include_archived=True)

    assert {c.id for c in result} == {active.id, archived.id}


async def test_list_without_usage_leaves_expense_count_none() -> None:
    account_id = uuid4()
    category = make_category(account_id=account_id)
    service = CategoryService(FakeCategoryRepo([category], expense_counts={category.id: 3}))

    result = await service.list(account_id)

    assert result[0].expense_count is None


async def test_list_with_usage_populates_expense_count() -> None:
    account_id = uuid4()
    category = make_category(account_id=account_id)
    service = CategoryService(FakeCategoryRepo([category], expense_counts={category.id: 3}))

    result = await service.list(account_id, include_usage=True)

    assert result[0].expense_count == 3


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


async def test_create_without_color_slot_assigns_lowest_free_slot() -> None:
    account_id = uuid4()
    existing = make_category(account_id=account_id, name="A", color_slot=1)
    service = CategoryService(FakeCategoryRepo([existing]))

    created = await service.create(CategoryCreate(name="B"), account_id)

    assert created.color_slot == 2


async def test_create_without_color_slot_skips_used_slots_out_of_order() -> None:
    account_id = uuid4()
    slot_1 = make_category(account_id=account_id, name="A", color_slot=1)
    slot_3 = make_category(account_id=account_id, name="C", color_slot=3)
    service = CategoryService(FakeCategoryRepo([slot_1, slot_3]))

    created = await service.create(CategoryCreate(name="D"), account_id)

    assert created.color_slot == 2


async def test_create_without_color_slot_returns_none_once_all_six_taken() -> None:
    account_id = uuid4()
    taken = [
        make_category(account_id=account_id, name=str(slot), color_slot=slot)
        for slot in range(1, 7)
    ]
    service = CategoryService(FakeCategoryRepo(taken))

    created = await service.create(CategoryCreate(name="Seventh"), account_id)

    assert created.color_slot is None


async def test_create_without_color_slot_ignores_other_accounts_slots() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    other = make_category(account_id=other_account_id, name="A", color_slot=1)
    service = CategoryService(FakeCategoryRepo([other]))

    created = await service.create(CategoryCreate(name="B"), account_id)

    assert created.color_slot == 1


async def test_create_without_color_slot_frees_archived_categorys_slot() -> None:
    account_id = uuid4()
    archived = make_category(account_id=account_id, name="Old", is_active=False, color_slot=1)
    service = CategoryService(FakeCategoryRepo([archived]))

    created = await service.create(CategoryCreate(name="New"), account_id)

    assert created.color_slot == 1


async def test_create_with_explicit_color_slot_keeps_it_even_if_taken() -> None:
    # Duplicates are allowed by design (six colours, unbounded categories) —
    # an explicit color_slot bypasses the free-slot search entirely.
    account_id = uuid4()
    existing = make_category(account_id=account_id, name="A", color_slot=3)
    service = CategoryService(FakeCategoryRepo([existing]))

    created = await service.create(CategoryCreate(name="B", color_slot=3), account_id)

    assert created.color_slot == 3


@pytest.mark.parametrize("color_slot", [0, 13, -1])
def test_category_create_rejects_out_of_range_color_slot(color_slot: int) -> None:
    with pytest.raises(ValidationError):
        CategoryCreate(name="Groceries", color_slot=color_slot)


@pytest.mark.parametrize("color_slot", [0, 13, -1])
def test_category_update_rejects_out_of_range_color_slot(color_slot: int) -> None:
    with pytest.raises(ValidationError):
        CategoryUpdate(color_slot=color_slot)


def test_category_create_accepts_picker_only_slot_7_to_12() -> None:
    # 7-12 are picker-only (D317) — never auto-assigned, but a valid explicit write.
    created = CategoryCreate(name="Groceries", color_slot=7)

    assert created.color_slot == 7


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


async def test_update_only_name_leaves_color_slot_untouched() -> None:
    account_id = uuid4()
    category = make_category(account_id=account_id, color_slot=4)
    service = CategoryService(FakeCategoryRepo([category]))

    updated = await service.update(category.id, CategoryUpdate(name="Renamed"), account_id)

    assert updated.color_slot == 4


async def test_update_explicit_color_slot_changes_it() -> None:
    account_id = uuid4()
    category = make_category(account_id=account_id, color_slot=4)
    service = CategoryService(FakeCategoryRepo([category]))

    updated = await service.update(category.id, CategoryUpdate(color_slot=5), account_id)

    assert updated.color_slot == 5


async def test_update_explicit_null_color_slot_is_ignored_not_cleared() -> None:
    # Same D30 convention as name: there is no "clear back to auto"
    # affordance for color_slot (Contracts section) — explicit null is
    # treated as omitted, not as SET color_slot = NULL.
    account_id = uuid4()
    category = make_category(account_id=account_id, color_slot=4)
    service = CategoryService(FakeCategoryRepo([category]))

    updated = await service.update(category.id, CategoryUpdate(color_slot=None), account_id)

    assert updated.color_slot == 4


async def test_update_missing_raises_not_found() -> None:
    service = CategoryService(FakeCategoryRepo([]))

    with pytest.raises(NotFoundError):
        await service.update(uuid4(), CategoryUpdate(name="X"), uuid4())


async def test_delete_unused_category_hard_deletes() -> None:
    account_id = uuid4()
    category = make_category(account_id=account_id)
    repo = FakeCategoryRepo([category])
    service = CategoryService(repo)

    await service.delete(category.id, account_id)

    assert await repo.get(category.id) is None


async def test_delete_category_with_expenses_archives_instead_of_deleting() -> None:
    # D302: a category still pointed at by an expense is archived, not
    # deleted — the row (and every expense pointing at it) must survive.
    account_id = uuid4()
    category = make_category(account_id=account_id)
    repo = FakeCategoryRepo([category], expense_counts={category.id: 1})
    service = CategoryService(repo)

    await service.delete(category.id, account_id)

    survivor = await repo.get(category.id)
    assert survivor is not None
    assert survivor.is_active is False


async def test_delete_category_with_only_budget_plan_archives_not_deletes() -> None:
    # D307: a budget plan alone (no expenses) is also enough to archive
    # rather than hard-delete — the plan's history must not be lost.
    account_id = uuid4()
    category = make_category(account_id=account_id)
    repo = FakeCategoryRepo([category], budget_counts={category.id: 1})
    service = CategoryService(repo)

    await service.delete(category.id, account_id)

    survivor = await repo.get(category.id)
    assert survivor is not None
    assert survivor.is_active is False


async def test_delete_missing_raises_not_found() -> None:
    service = CategoryService(FakeCategoryRepo([]))

    with pytest.raises(NotFoundError):
        await service.delete(uuid4(), uuid4())


async def test_delete_referenced_category_raises_conflict() -> None:
    # docs/SCHEMA.sql: expenses.category_id / budget_plans.category_id are
    # ON DELETE RESTRICT (plan Decision log D5). With usage counts now
    # deciding archive-vs-delete upfront (D302), the repo should never
    # actually hit this constraint — but the service keeps translating a raw
    # asyncpg.ForeignKeyViolationError into a domain ConflictError (mapped to
    # a clean 409 by main.py) as a defensive branch, and this test keeps it
    # covered even though it's unreachable in practice.
    account_id = uuid4()
    category = make_category(account_id=account_id)
    service = CategoryService(FakeCategoryRepo([category], restricted_ids={category.id}))

    with pytest.raises(ConflictError):
        await service.delete(category.id, account_id)
