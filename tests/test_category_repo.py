from uuid import uuid4

import asyncpg
import pytest
from factories import make_account, make_budget_plan, make_expense, make_user

from repositories.category_repo import CategoryRepository


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_get_update_delete(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    repo = CategoryRepository(db_conn)

    created = await repo.create({"name": "Groceries", "account_id": account_id})
    assert created.name == "Groceries"
    assert created.account_id == account_id

    fetched = await repo.get(created.id)
    assert fetched is not None
    assert fetched.name == "Groceries"

    updated = await repo.update(created.id, {"name": "Food"})
    assert updated is not None
    assert updated.name == "Food"

    deleted = await repo.delete(created.id)
    assert deleted is True

    gone = await repo.get(created.id)
    assert gone is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_missing_returns_none(db_conn: asyncpg.Connection) -> None:
    repo = CategoryRepository(db_conn)
    assert await repo.get(uuid4()) is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_missing_returns_false(db_conn: asyncpg.Connection) -> None:
    repo = CategoryRepository(db_conn)
    assert await repo.delete(uuid4()) is False


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_filters_by_account(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    other_account_id = await make_account(db_conn)
    repo = CategoryRepository(db_conn)

    await repo.create({"name": "Groceries", "account_id": account_id})
    await repo.create({"name": "Transport", "account_id": other_account_id})

    results = await repo.list(account_id=account_id)
    assert len(results) == 1
    assert results[0].name == "Groceries"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_duplicate_name_per_account_is_currently_allowed(
    db_conn: asyncpg.Connection,
) -> None:
    """docs/SCHEMA.sql has no UNIQUE(account_id, name) constraint on
    categories, so the DB accepts duplicate category names within the same
    account. Documents actual behavior, not a desired one — flag before
    relying on name uniqueness anywhere upstream."""
    account_id = await make_account(db_conn)
    repo = CategoryRepository(db_conn)

    first = await repo.create({"name": "Groceries", "account_id": account_id})
    second = await repo.create({"name": "Groceries", "account_id": account_id})

    assert first.id != second.id
    assert first.name == second.name == "Groceries"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_count_expenses(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    user = await make_user(db_conn, account_id=account_id)
    repo = CategoryRepository(db_conn)
    category = await repo.create({"name": "Groceries", "account_id": account_id})
    category_id = category.id

    assert await repo.count_expenses(category_id) == 0

    await make_expense(db_conn, account_id=account_id, user_id=user.id, category_id=category_id)
    await make_expense(db_conn, account_id=account_id, user_id=user.id, category_id=category_id)

    assert await repo.count_expenses(category_id) == 2


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_count_budget_plans(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    repo = CategoryRepository(db_conn)
    category = await repo.create({"name": "Groceries", "account_id": account_id})

    assert await repo.count_budget_plans(category.id) == 0

    await make_budget_plan(db_conn, account_id=account_id, category_id=category.id)

    assert await repo.count_budget_plans(category.id) == 1


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_with_usage_populates_expense_count(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    user = await make_user(db_conn, account_id=account_id)
    repo = CategoryRepository(db_conn)
    used = await repo.create({"name": "Groceries", "account_id": account_id})
    unused = await repo.create({"name": "Transport", "account_id": account_id})
    await make_expense(db_conn, account_id=account_id, user_id=user.id, category_id=used.id)
    await make_expense(db_conn, account_id=account_id, user_id=user.id, category_id=used.id)

    results = await repo.list_with_usage(account_id, include_archived=False)

    by_id = {c.id: c for c in results}
    assert by_id[used.id].expense_count == 2
    assert by_id[unused.id].expense_count == 0


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_with_usage_excludes_archived_unless_requested(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn)
    repo = CategoryRepository(db_conn)
    active = await repo.create({"name": "Groceries", "account_id": account_id})
    archived = await repo.create({"name": "Old", "account_id": account_id})
    updated = await repo.update(archived.id, {"is_active": False})
    assert updated is not None

    default_results = await repo.list_with_usage(account_id, include_archived=False)
    assert {c.id for c in default_results} == {active.id}

    all_results = await repo.list_with_usage(account_id, include_archived=True)
    assert {c.id for c in all_results} == {active.id, archived.id}
