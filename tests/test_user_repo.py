from uuid import uuid4

import asyncpg
import pytest
from factories import make_account

from models.enums import Role
from repositories.user_repo import UserRepository


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_get_update_delete(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    repo = UserRepository(db_conn)

    created = await repo.create(
        {
            "tg_id": 111,
            "name": "Alice",
            "role": Role.MEMBER.value,
            "account_id": account_id,
        }
    )
    assert created.tg_id == 111
    assert created.name == "Alice"
    assert created.role == Role.MEMBER
    assert created.account_id == account_id

    fetched = await repo.get(created.id)
    assert fetched is not None
    assert fetched.id == created.id
    assert fetched.name == "Alice"

    updated = await repo.update(created.id, {"name": "Alice B."})
    assert updated is not None
    assert updated.name == "Alice B."
    assert updated.role == Role.MEMBER

    deleted = await repo.delete(created.id)
    assert deleted is True

    gone = await repo.get(created.id)
    assert gone is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_missing_returns_none(db_conn: asyncpg.Connection) -> None:
    repo = UserRepository(db_conn)
    assert await repo.get(uuid4()) is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_missing_returns_false(db_conn: asyncpg.Connection) -> None:
    repo = UserRepository(db_conn)
    assert await repo.delete(uuid4()) is False


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_filters_by_account(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    other_account_id = await make_account(db_conn)
    repo = UserRepository(db_conn)

    await repo.create(
        {"tg_id": 222, "name": "Bob", "role": Role.MEMBER.value, "account_id": account_id}
    )
    await repo.create(
        {"tg_id": 333, "name": "Carol", "role": Role.MEMBER.value, "account_id": other_account_id}
    )

    results = await repo.list(account_id=account_id)
    assert len(results) == 1
    assert results[0].name == "Bob"
