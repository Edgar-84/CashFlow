from uuid import uuid4

import asyncpg
import pytest
from factories import make_account, make_user

from models.enums import Resource
from repositories.permission_repo import PermissionRepository


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_get_update_delete(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    user = await make_user(db_conn, account_id=account_id)
    repo = PermissionRepository(db_conn)

    created = await repo.create(
        {
            "user_id": user.id,
            "resource": Resource.EXPENSES.value,
            "can_create": True,
            "can_read": True,
            "can_update": False,
            "can_delete": False,
            "own_only": True,
        }
    )
    assert created.user_id == user.id
    assert created.resource == Resource.EXPENSES
    assert created.can_create is True

    fetched = await repo.get(created.id)
    assert fetched is not None
    assert fetched.resource == Resource.EXPENSES

    updated = await repo.update(created.id, {"can_update": True})
    assert updated is not None
    assert updated.can_update is True

    deleted = await repo.delete(created.id)
    assert deleted is True

    gone = await repo.get(created.id)
    assert gone is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_missing_returns_none(db_conn: asyncpg.Connection) -> None:
    repo = PermissionRepository(db_conn)
    assert await repo.get(uuid4()) is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_missing_returns_false(db_conn: asyncpg.Connection) -> None:
    repo = PermissionRepository(db_conn)
    assert await repo.delete(uuid4()) is False


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_duplicate_user_resource_raises_unique_violation(
    db_conn: asyncpg.Connection,
) -> None:
    """docs/SCHEMA.sql's permissions table has UNIQUE(user_id, resource).
    Documents current behavior: the raw asyncpg error propagates untranslated
    — BaseRepository.create() does not map it to a domain exception (same
    gap as budget_plans, plan Decision log D23)."""
    account_id = await make_account(db_conn)
    user = await make_user(db_conn, account_id=account_id)
    repo = PermissionRepository(db_conn)

    await repo.create({"user_id": user.id, "resource": Resource.EXPENSES.value})
    with pytest.raises(asyncpg.UniqueViolationError):
        await repo.create({"user_id": user.id, "resource": Resource.EXPENSES.value})


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_user_and_resource_returns_row(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    user = await make_user(db_conn, account_id=account_id)
    repo = PermissionRepository(db_conn)
    await repo.create(
        {"user_id": user.id, "resource": Resource.CATEGORIES.value, "own_only": False}
    )

    result = await repo.get_by_user_and_resource(user.id, Resource.CATEGORIES)

    assert result is not None
    assert result.user_id == user.id
    assert result.resource == Resource.CATEGORIES
    assert result.own_only is False


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_user_and_resource_returns_none_when_no_row(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn)
    user = await make_user(db_conn, account_id=account_id)
    repo = PermissionRepository(db_conn)

    result = await repo.get_by_user_and_resource(user.id, Resource.TAGS)

    assert result is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_user_and_resource_scopes_by_user(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    user = await make_user(db_conn, account_id=account_id, tg_id=1)
    other_user = await make_user(db_conn, account_id=account_id, tg_id=2)
    repo = PermissionRepository(db_conn)
    await repo.create(
        {"user_id": other_user.id, "resource": Resource.BUDGET_PLANS.value, "can_create": True}
    )

    result = await repo.get_by_user_and_resource(user.id, Resource.BUDGET_PLANS)

    assert result is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_by_account_returns_only_that_accounts_rows(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn)
    other_account_id = await make_account(db_conn)
    user = await make_user(db_conn, account_id=account_id, tg_id=1)
    other_user = await make_user(db_conn, account_id=other_account_id, tg_id=2)
    repo = PermissionRepository(db_conn)
    own_row = await repo.create({"user_id": user.id, "resource": Resource.EXPENSES.value})
    await repo.create({"user_id": other_user.id, "resource": Resource.TAGS.value})

    result = await repo.list_by_account(account_id)

    assert [row.id for row in result] == [own_row.id]


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_by_account_returns_empty_when_no_rows(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    repo = PermissionRepository(db_conn)

    assert await repo.list_by_account(account_id) == []
