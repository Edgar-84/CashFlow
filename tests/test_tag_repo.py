from uuid import uuid4

import asyncpg
import pytest
from factories import make_account, make_category, make_user

from repositories.expense_repo import ExpenseRepository
from repositories.tag_repo import TagRepository


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_get_update_delete(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    repo = TagRepository(db_conn)

    created = await repo.create({"name": "recurring", "account_id": account_id})
    assert created.name == "recurring"
    assert created.account_id == account_id

    fetched = await repo.get(created.id)
    assert fetched is not None
    assert fetched.name == "recurring"

    updated = await repo.update(created.id, {"name": "subscription"})
    assert updated is not None
    assert updated.name == "subscription"

    deleted = await repo.delete(created.id)
    assert deleted is True

    gone = await repo.get(created.id)
    assert gone is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_missing_returns_none(db_conn: asyncpg.Connection) -> None:
    repo = TagRepository(db_conn)
    assert await repo.get(uuid4()) is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_missing_returns_false(db_conn: asyncpg.Connection) -> None:
    repo = TagRepository(db_conn)
    assert await repo.delete(uuid4()) is False


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_filters_by_account(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    other_account_id = await make_account(db_conn)
    repo = TagRepository(db_conn)

    await repo.create({"name": "recurring", "account_id": account_id})
    await repo.create({"name": "one-off", "account_id": other_account_id})

    results = await repo.list(account_id=account_id)
    assert len(results) == 1
    assert results[0].name == "recurring"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_duplicate_name_per_account_is_currently_allowed(
    db_conn: asyncpg.Connection,
) -> None:
    """docs/SCHEMA.sql has no UNIQUE(account_id, name) constraint on tags,
    so the DB accepts duplicate tag names within the same account. Documents
    actual behavior, not a desired one — flag before relying on name
    uniqueness anywhere upstream."""
    account_id = await make_account(db_conn)
    repo = TagRepository(db_conn)

    first = await repo.create({"name": "recurring", "account_id": account_id})
    second = await repo.create({"name": "recurring", "account_id": account_id})

    assert first.id != second.id
    assert first.name == second.name == "recurring"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_count_expenses(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    repo = TagRepository(db_conn)
    expense_repo = ExpenseRepository(db_conn)
    tag = await repo.create({"name": "urgent", "account_id": account_id})

    assert await repo.count_expenses(tag.id) == 0

    await expense_repo.create(
        {
            "amount": 500,
            "category_id": category_id,
            "user_id": user.id,
            "account_id": account_id,
            "tag_ids": [tag.id],
        }
    )
    await expense_repo.create(
        {
            "amount": 700,
            "category_id": category_id,
            "user_id": user.id,
            "account_id": account_id,
            "tag_ids": [tag.id],
        }
    )

    assert await repo.count_expenses(tag.id) == 2


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_with_usage_populates_expense_count(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    repo = TagRepository(db_conn)
    expense_repo = ExpenseRepository(db_conn)
    used = await repo.create({"name": "urgent", "account_id": account_id})
    unused = await repo.create({"name": "recurring", "account_id": account_id})
    await expense_repo.create(
        {
            "amount": 500,
            "category_id": category_id,
            "user_id": user.id,
            "account_id": account_id,
            "tag_ids": [used.id],
        }
    )

    results = await repo.list_with_usage(account_id, include_archived=False)

    by_id = {t.id: t for t in results}
    assert by_id[used.id].expense_count == 1
    assert by_id[unused.id].expense_count == 0


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_with_usage_excludes_archived_unless_requested(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn)
    repo = TagRepository(db_conn)
    active = await repo.create({"name": "urgent", "account_id": account_id})
    archived = await repo.create({"name": "old", "account_id": account_id})
    updated = await repo.update(archived.id, {"is_active": False})
    assert updated is not None

    default_results = await repo.list_with_usage(account_id, include_archived=False)
    assert {t.id for t in default_results} == {active.id}

    all_results = await repo.list_with_usage(account_id, include_archived=True)
    assert {t.id for t in all_results} == {active.id, archived.id}


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_archiving_tag_preserves_expense_tags_rows(db_conn: asyncpg.Connection) -> None:
    # AC (U0.5): expense_tags.tag_id is ON DELETE CASCADE — hard-deleting a
    # tag still in use would destroy these rows. Archiving (an UPDATE, never
    # a DELETE) must leave them untouched.
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    repo = TagRepository(db_conn)
    expense_repo = ExpenseRepository(db_conn)
    tag = await repo.create({"name": "urgent", "account_id": account_id})
    expense = await expense_repo.create(
        {
            "amount": 500,
            "category_id": category_id,
            "user_id": user.id,
            "account_id": account_id,
            "tag_ids": [tag.id],
        }
    )

    updated = await repo.update(tag.id, {"is_active": False})
    assert updated is not None
    assert updated.is_active is False

    remaining = await db_conn.fetchval(
        "SELECT count(*) FROM expense_tags WHERE expense_id = $1 AND tag_id = $2",
        expense.id,
        tag.id,
    )
    assert remaining == 1
