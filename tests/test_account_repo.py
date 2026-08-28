from uuid import uuid4

import asyncpg
import pytest
from factories import make_account, make_user

from models.enums import Currency, Language
from repositories.account_repo import AccountRepository


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_returns_account_with_default_currency(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    repo = AccountRepository(db_conn)

    account = await repo.get(account_id)

    assert account is not None
    assert account.currency == Currency.USD


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_returns_account_with_default_language(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    repo = AccountRepository(db_conn)

    account = await repo.get(account_id)

    assert account is not None
    assert account.language == Language.EN


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_returns_account_with_default_is_blocked(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    repo = AccountRepository(db_conn)

    account = await repo.get(account_id)

    assert account is not None
    assert account.is_blocked is False


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_returns_account_with_explicit_currency(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn, currency=Currency.PLN)
    repo = AccountRepository(db_conn)

    account = await repo.get(account_id)

    assert account is not None
    assert account.currency == Currency.PLN


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_missing_returns_none(db_conn: asyncpg.Connection) -> None:
    repo = AccountRepository(db_conn)
    assert await repo.get(uuid4()) is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_for_admin_returns_every_account_with_user_count(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn, name="Has Users")
    empty_account_id = await make_account(db_conn, name="No Users")
    await make_user(db_conn, account_id=account_id, tg_id=9001)
    await make_user(db_conn, account_id=account_id, tg_id=9002)
    repo = AccountRepository(db_conn)

    rows = await repo.list_for_admin()

    by_id = {row.id: row for row in rows}
    assert by_id[account_id].user_count == 2
    assert by_id[empty_account_id].user_count == 0
