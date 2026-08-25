from uuid import uuid4

import asyncpg
import pytest
from factories import make_account

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
