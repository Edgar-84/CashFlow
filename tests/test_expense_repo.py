from datetime import UTC, datetime, timedelta, timezone
from uuid import uuid4

import asyncpg
import pytest
from factories import make_account, make_category, make_expense, make_tag, make_user

from repositories.expense_repo import ExpenseRepository


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_get_update_delete(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)

    created = await repo.create(
        {
            "amount": 500,
            "comment": "Coffee",
            "category_id": category_id,
            "user_id": user.id,
            "account_id": account_id,
        }
    )
    assert created.amount == 500
    assert created.tags == []

    fetched = await repo.get(created.id)
    assert fetched is not None
    assert fetched.amount == 500

    updated = await repo.update(created.id, {"amount": 750})
    assert updated is not None
    assert updated.amount == 750

    deleted = await repo.delete(created.id)
    assert deleted is True

    gone = await repo.get(created.id)
    assert gone is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_missing_returns_none(db_conn: asyncpg.Connection) -> None:
    repo = ExpenseRepository(db_conn)
    assert await repo.get(uuid4()) is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_missing_returns_false(db_conn: asyncpg.Connection) -> None:
    repo = ExpenseRepository(db_conn)
    assert await repo.delete(uuid4()) is False


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_with_tag_ids_attaches_tags(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    tag1 = await make_tag(db_conn, account_id=account_id, name="urgent")
    tag2 = await make_tag(db_conn, account_id=account_id, name="shared")
    repo = ExpenseRepository(db_conn)

    created = await repo.create(
        {
            "amount": 500,
            "category_id": category_id,
            "user_id": user.id,
            "account_id": account_id,
            "tag_ids": [tag1, tag2],
        }
    )
    assert {tag.id for tag in created.tags} == {tag1, tag2}

    fetched = await repo.get(created.id)
    assert fetched is not None
    assert {tag.id for tag in fetched.tags} == {tag1, tag2}


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_update_tag_ids_replaces_existing_tags(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    tag1 = await make_tag(db_conn, account_id=account_id, name="urgent")
    tag2 = await make_tag(db_conn, account_id=account_id, name="shared")
    repo = ExpenseRepository(db_conn)

    created = await repo.create(
        {
            "amount": 500,
            "category_id": category_id,
            "user_id": user.id,
            "account_id": account_id,
            "tag_ids": [tag1],
        }
    )

    updated = await repo.update(created.id, {"tag_ids": [tag2]})
    assert updated is not None
    assert {tag.id for tag in updated.tags} == {tag2}


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_expense_cascades_expense_tags(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    tag_id = await make_tag(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)

    created = await repo.create(
        {
            "amount": 500,
            "category_id": category_id,
            "user_id": user.id,
            "account_id": account_id,
            "tag_ids": [tag_id],
        }
    )

    await repo.delete(created.id)

    remaining = await db_conn.fetchval(
        "SELECT count(*) FROM expense_tags WHERE expense_id = $1", created.id
    )
    assert remaining == 0


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_category_filters_by_account_and_category(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn)
    other_account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    other_category_id = await make_category(db_conn, account_id=account_id, name="Transport")
    user = await make_user(db_conn, account_id=account_id)
    other_user = await make_user(db_conn, account_id=other_account_id, tg_id=2)

    await make_expense(db_conn, account_id=account_id, user_id=user.id, category_id=category_id)
    await make_expense(
        db_conn, account_id=account_id, user_id=user.id, category_id=other_category_id
    )
    await make_expense(
        db_conn,
        account_id=other_account_id,
        user_id=other_user.id,
        category_id=await make_category(db_conn, account_id=other_account_id),
    )

    repo = ExpenseRepository(db_conn)
    results = await repo.get_by_category(account_id, category_id)

    assert len(results) == 1
    assert results[0].category_id == category_id
    assert results[0].account_id == account_id


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_period_respects_month_boundaries_across_timezones(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)

    # July 2026 boundaries expressed in UTC.
    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)

    in_july_utc = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=100,
        created_at=july_start,
    )
    # Same absolute instant as july_start but expressed in a UTC-3 offset the
    # afternoon before, at a local calendar date of 2026-06-30 — proves
    # TIMESTAMPTZ comparison is instant-based, not dependent on the caller's
    # tzinfo representation.
    just_before_july = july_start - timedelta(microseconds=1)
    before_july_offset = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=200,
        created_at=just_before_july.astimezone(timezone(timedelta(hours=-3))),
    )
    last_instant_of_july = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=300,
        created_at=(august_start - timedelta(microseconds=1)).astimezone(
            timezone(timedelta(hours=5))
        ),
    )
    in_august = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=400,
        created_at=august_start,
    )

    repo = ExpenseRepository(db_conn)
    results = await repo.get_by_period(account_id, july_start, august_start)
    result_ids = {e.id for e in results}

    assert result_ids == {in_july_utc.id, last_instant_of_july.id}
    assert before_july_offset.id not in result_ids
    assert in_august.id not in result_ids


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_sum_by_category_month_known_sums(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    groceries_id = await make_category(db_conn, account_id=account_id, name="Groceries")
    transport_id = await make_category(db_conn, account_id=account_id, name="Transport")
    user = await make_user(db_conn, account_id=account_id)

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)
    mid_july = july_start + timedelta(days=15)

    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=groceries_id,
        amount=1000,
        created_at=mid_july,
    )
    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=groceries_id,
        amount=2500,
        created_at=mid_july,
    )
    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=transport_id,
        amount=400,
        created_at=mid_july,
    )
    # Outside the window entirely — must not be counted.
    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=groceries_id,
        amount=99999,
        created_at=august_start,
    )

    repo = ExpenseRepository(db_conn)
    sums = await repo.sum_by_category_month(account_id, july_start, august_start)

    assert sums[groceries_id] == 3500
    assert sums[transport_id] == 400
    # SUM(bigint) is promoted to numeric/Decimal by Postgres unless cast back —
    # money must stay int end to end.
    assert type(sums[groceries_id]) is int
    assert type(sums[transport_id]) is int


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_period_scopes_by_account(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    other_account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    other_category_id = await make_category(db_conn, account_id=other_account_id)
    user = await make_user(db_conn, account_id=account_id)
    other_user = await make_user(db_conn, account_id=other_account_id, tg_id=2)

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)
    mid_july = july_start + timedelta(days=10)

    mine = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=500,
        created_at=mid_july,
    )
    await make_expense(
        db_conn,
        account_id=other_account_id,
        user_id=other_user.id,
        category_id=other_category_id,
        amount=999,
        created_at=mid_july,
    )

    repo = ExpenseRepository(db_conn)
    results = await repo.get_by_period(account_id, july_start, august_start)

    assert {e.id for e in results} == {mine.id}


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_sum_by_category_month_scopes_by_account(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    other_account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    other_category_id = await make_category(db_conn, account_id=other_account_id)
    user = await make_user(db_conn, account_id=account_id)
    other_user = await make_user(db_conn, account_id=other_account_id, tg_id=2)

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)
    mid_july = july_start + timedelta(days=10)

    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=500,
        created_at=mid_july,
    )
    await make_expense(
        db_conn,
        account_id=other_account_id,
        user_id=other_user.id,
        category_id=other_category_id,
        amount=999999,
        created_at=mid_july,
    )

    repo = ExpenseRepository(db_conn)
    sums = await repo.sum_by_category_month(account_id, july_start, august_start)

    assert sums == {category_id: 500}


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_populates_user_name(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id, name="Alice")
    repo = ExpenseRepository(db_conn)

    created = await repo.create(
        {
            "amount": 500,
            "category_id": category_id,
            "user_id": user.id,
            "account_id": account_id,
        }
    )
    assert created.user_name == "Alice"

    fetched = await repo.get(created.id)
    assert fetched is not None
    assert fetched.user_name == "Alice"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_populates_user_name(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id, name="Bob")
    await make_expense(db_conn, account_id=account_id, user_id=user.id, category_id=category_id)
    repo = ExpenseRepository(db_conn)

    results = await repo.list(account_id=account_id)

    assert len(results) == 1
    assert results[0].user_name == "Bob"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_period_populates_user_name(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id, name="Carol")
    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)
    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        created_at=july_start,
    )
    repo = ExpenseRepository(db_conn)

    results = await repo.get_by_period(account_id, july_start, august_start)

    assert len(results) == 1
    assert results[0].user_name == "Carol"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_category_populates_user_name(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id, name="Dave")
    await make_expense(db_conn, account_id=account_id, user_id=user.id, category_id=category_id)
    repo = ExpenseRepository(db_conn)

    results = await repo.get_by_category(account_id, category_id)

    assert len(results) == 1
    assert results[0].user_name == "Dave"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_with_duplicate_tag_ids_rolls_back_whole_expense(
    db_conn: asyncpg.Connection,
) -> None:
    """A PK violation on expense_tags partway through create() must not leave
    a partially-written expense row behind — the whole create is one
    transaction."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    tag_id = await make_tag(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)

    with pytest.raises(asyncpg.PostgresError):
        await repo.create(
            {
                "amount": 500,
                "category_id": category_id,
                "user_id": user.id,
                "account_id": account_id,
                "tag_ids": [tag_id, tag_id],
            }
        )

    remaining = await db_conn.fetchval(
        "SELECT count(*) FROM expenses WHERE account_id = $1", account_id
    )
    assert remaining == 0
