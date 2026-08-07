from datetime import UTC, date, datetime, timedelta
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
async def test_get_by_period_respects_month_boundaries(
    db_conn: asyncpg.Connection,
) -> None:
    """get_by_period()'s [start, end) window is half-open on spent_at (D314):
    the last day of the window is included, the day the window ends on is
    not. spent_at is a bare DATE with no timezone of its own — unlike the
    old created_at-based version of this test, there is no tzinfo
    representation to vary here."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)

    first_day_of_july = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=100,
        spent_at=date(2026, 7, 1),
    )
    last_day_before_july = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=200,
        spent_at=date(2026, 6, 30),
    )
    last_day_of_july = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=300,
        spent_at=date(2026, 7, 31),
    )
    first_day_of_august = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=400,
        spent_at=date(2026, 8, 1),
    )

    repo = ExpenseRepository(db_conn)
    results = await repo.get_by_period(account_id, july_start, august_start)
    result_ids = {e.id for e in results}

    assert result_ids == {first_day_of_july.id, last_day_of_july.id}
    assert last_day_before_july.id not in result_ids
    assert first_day_of_august.id not in result_ids


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_period_filters_by_local_spent_at_not_utc_calendar_date(
    db_conn: asyncpg.Connection,
) -> None:
    """D323: start/end are UTC instants representing local midnight in `tz`
    (Europe/Belgrade is UTC+2 in August). spent_at must be compared against
    that LOCAL calendar date — naively truncating the UTC instant to its own
    calendar date shifts the whole window back a day for any tz ahead of
    UTC, silently misfiling both boundary expenses below."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)

    # August 2026 bounds in Europe/Belgrade (UTC+2, CEST), expressed in UTC.
    august_start = datetime(2026, 7, 31, 22, 0, tzinfo=UTC)
    september_start = datetime(2026, 8, 31, 22, 0, tzinfo=UTC)

    last_day_of_july = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=100,
        spent_at=date(2026, 7, 31),
    )
    last_day_of_august = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=200,
        spent_at=date(2026, 8, 31),
    )

    repo = ExpenseRepository(db_conn)
    results = await repo.get_by_period(
        account_id, august_start, september_start, tz="Europe/Belgrade"
    )
    result_ids = {e.id for e in results}

    assert result_ids == {last_day_of_august.id}
    assert last_day_of_july.id not in result_ids


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_period_filters_by_spent_at_not_created_at(
    db_conn: asyncpg.Connection,
) -> None:
    """D314: period filtering moved from created_at to spent_at — a backdated
    expense is filed by the day it happened, not the day it was typed."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)
    september_start = datetime(2026, 9, 1, tzinfo=UTC)

    backdated = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=500,
        created_at=datetime(2026, 8, 15, tzinfo=UTC),
        spent_at=date(2026, 7, 20),
    )

    repo = ExpenseRepository(db_conn)
    july_results = await repo.get_by_period(account_id, july_start, august_start)
    august_results = await repo.get_by_period(account_id, august_start, september_start)

    assert {e.id for e in july_results} == {backdated.id}
    assert august_results == []


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
async def test_sum_by_category_month_filters_by_spent_at_not_created_at(
    db_conn: asyncpg.Connection,
) -> None:
    """D314: same rule as get_by_period — a backdated expense's amount is
    summed into the month it was spent in, not the month it was typed in."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)

    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=1500,
        created_at=datetime(2026, 8, 5, tzinfo=UTC),
        spent_at=date(2026, 7, 10),
    )

    repo = ExpenseRepository(db_conn)
    july_sums = await repo.sum_by_category_month(account_id, july_start, august_start)
    august_sums = await repo.sum_by_category_month(
        account_id, august_start, datetime(2026, 9, 1, tzinfo=UTC)
    )

    assert july_sums == {category_id: 1500}
    assert august_sums == {}


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_sum_by_category_month_filters_by_local_spent_at_not_utc_calendar_date(
    db_conn: asyncpg.Connection,
) -> None:
    """Same D323 rule as get_by_period's equivalent test — a non-UTC `tz`
    boundary must compare against the local calendar date, not the UTC one."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)

    august_start = datetime(2026, 7, 31, 22, 0, tzinfo=UTC)
    september_start = datetime(2026, 8, 31, 22, 0, tzinfo=UTC)

    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=500,
        spent_at=date(2026, 8, 31),
    )
    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=999,
        spent_at=date(2026, 7, 31),
    )

    repo = ExpenseRepository(db_conn)
    sums = await repo.sum_by_category_month(
        account_id, august_start, september_start, tz="Europe/Belgrade"
    )

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
async def test_list_orders_newest_first(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)
    oldest = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        created_at=datetime(2026, 7, 1, tzinfo=UTC),
    )
    newest = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        created_at=datetime(2026, 7, 3, tzinfo=UTC),
    )
    middle = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        created_at=datetime(2026, 7, 2, tzinfo=UTC),
    )

    results = await repo.list(account_id=account_id)

    assert [e.id for e in results] == [newest.id, middle.id, oldest.id]


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_by_period_orders_newest_first(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)
    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)
    oldest = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        created_at=datetime(2026, 7, 10, tzinfo=UTC),
    )
    newest = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        created_at=datetime(2026, 7, 20, tzinfo=UTC),
    )

    results = await repo.get_by_period(account_id, july_start, august_start)

    assert [e.id for e in results] == [newest.id, oldest.id]


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_paginates_without_overlap_newest_first(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)
    seeded = [
        await make_expense(
            db_conn,
            account_id=account_id,
            user_id=user.id,
            category_id=category_id,
            created_at=datetime(2026, 7, day, tzinfo=UTC),
        )
        for day in range(1, 6)
    ]
    newest_first_ids = [e.id for e in reversed(seeded)]

    page1 = await repo.list(account_id=account_id, limit=2, offset=0)
    page2 = await repo.list(account_id=account_id, limit=2, offset=2)
    page3 = await repo.list(account_id=account_id, limit=2, offset=4)

    assert [e.id for e in page1] == newest_first_ids[0:2]
    assert [e.id for e in page2] == newest_first_ids[2:4]
    assert [e.id for e in page3] == newest_first_ids[4:5]
    all_ids = [e.id for page in (page1, page2, page3) for e in page]
    assert all_ids == newest_first_ids
    assert len(set(all_ids)) == len(all_ids)


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_default_limit_is_50(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)
    for _ in range(3):
        await make_expense(db_conn, account_id=account_id, user_id=user.id, category_id=category_id)

    results = await repo.list(account_id=account_id)

    assert len(results) == 3


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
async def test_list_filters_by_category_id(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    transport = await make_category(db_conn, account_id=account_id, name="Transport")
    food = await make_category(db_conn, account_id=account_id, name="Food")
    user = await make_user(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)
    transport_expense = await make_expense(
        db_conn, account_id=account_id, user_id=user.id, category_id=transport
    )
    await make_expense(db_conn, account_id=account_id, user_id=user.id, category_id=food)

    results = await repo.list(account_id=account_id, category_id=transport)

    assert [e.id for e in results] == [transport_expense.id]


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_filters_by_spent_at_window(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)
    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)
    in_window = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        spent_at=date(2026, 7, 15),
    )
    outside_window = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        spent_at=date(2026, 8, 15),
    )

    results = await repo.list(account_id=account_id, start=july_start, end=august_start)
    result_ids = {e.id for e in results}

    assert result_ids == {in_window.id}
    assert outside_window.id not in result_ids


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_combines_category_and_period_filters(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    transport = await make_category(db_conn, account_id=account_id, name="Transport")
    food = await make_category(db_conn, account_id=account_id, name="Food")
    user = await make_user(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)
    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)
    matching = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=transport,
        spent_at=date(2026, 7, 15),
    )
    # Wrong category, right period.
    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=food,
        spent_at=date(2026, 7, 16),
    )
    # Right category, wrong period.
    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=transport,
        spent_at=date(2026, 8, 16),
    )

    results = await repo.list(
        account_id=account_id, category_id=transport, start=july_start, end=august_start
    )

    assert [e.id for e in results] == [matching.id]


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_filters_by_spent_at_not_created_at(db_conn: asyncpg.Connection) -> None:
    """D314: an expense with spent_at 3 August and created_at 7 August is
    inside a 3 August window and outside a 7 August one."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)
    backdated = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        created_at=datetime(2026, 8, 7, tzinfo=UTC),
        spent_at=date(2026, 8, 3),
    )

    third_results = await repo.list(
        account_id=account_id,
        start=datetime(2026, 8, 3, tzinfo=UTC),
        end=datetime(2026, 8, 4, tzinfo=UTC),
    )
    seventh_results = await repo.list(
        account_id=account_id,
        start=datetime(2026, 8, 7, tzinfo=UTC),
        end=datetime(2026, 8, 8, tzinfo=UTC),
    )

    assert [e.id for e in third_results] == [backdated.id]
    assert backdated.id not in {e.id for e in seventh_results}


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_filters_by_local_spent_at_not_utc_calendar_date(
    db_conn: asyncpg.Connection,
) -> None:
    """D323: same boundary regression as get_by_period — start/end are UTC
    instants representing local midnight in `tz` (Europe/Belgrade is UTC+2 in
    August), so spent_at must be compared against the LOCAL calendar date."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)

    august_start = datetime(2026, 7, 31, 22, 0, tzinfo=UTC)
    september_start = datetime(2026, 8, 31, 22, 0, tzinfo=UTC)

    last_day_of_july = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        spent_at=date(2026, 7, 31),
    )
    last_day_of_august = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        spent_at=date(2026, 8, 31),
    )

    repo = ExpenseRepository(db_conn)
    results = await repo.list(
        account_id=account_id, start=august_start, end=september_start, tz="Europe/Belgrade"
    )
    result_ids = {e.id for e in results}

    assert result_ids == {last_day_of_august.id}
    assert last_day_of_july.id not in result_ids


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_paginates_the_filtered_set_not_the_unfiltered_one(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn)
    transport = await make_category(db_conn, account_id=account_id, name="Transport")
    food = await make_category(db_conn, account_id=account_id, name="Food")
    user = await make_user(db_conn, account_id=account_id)
    repo = ExpenseRepository(db_conn)
    # Interleave categories so a naive "filter after paginate" would drop rows.
    seeded_transport = [
        await make_expense(
            db_conn,
            account_id=account_id,
            user_id=user.id,
            category_id=transport,
            created_at=datetime(2026, 7, day, tzinfo=UTC),
        )
        for day in range(1, 6)
    ]
    for day in range(1, 6):
        await make_expense(
            db_conn,
            account_id=account_id,
            user_id=user.id,
            category_id=food,
            created_at=datetime(2026, 7, day, 12, tzinfo=UTC),
        )
    newest_first_transport_ids = [e.id for e in reversed(seeded_transport)]

    page1 = await repo.list(account_id=account_id, category_id=transport, limit=2, offset=0)
    page2 = await repo.list(account_id=account_id, category_id=transport, limit=2, offset=2)
    page3 = await repo.list(account_id=account_id, category_id=transport, limit=2, offset=4)

    assert [e.id for e in page1] == newest_first_transport_ids[0:2]
    assert [e.id for e in page2] == newest_first_transport_ids[2:4]
    assert [e.id for e in page3] == newest_first_transport_ids[4:5]


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
async def test_zero_or_negative_amount_rejected_by_db_check(db_conn: asyncpg.Connection) -> None:
    """DB CHECK (amount > 0) on expenses (U1.6)."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)

    # each attempt runs in its own savepoint: a CHECK violation aborts the
    # current (sub)transaction, so without this the second attempt would
    # raise InFailedSQLTransactionError instead of the expected error.
    with pytest.raises(asyncpg.CheckViolationError):
        async with db_conn.transaction():
            await make_expense(
                db_conn, account_id=account_id, user_id=user.id, category_id=category_id, amount=0
            )

    with pytest.raises(asyncpg.CheckViolationError):
        async with db_conn.transaction():
            await make_expense(
                db_conn,
                account_id=account_id,
                user_id=user.id,
                category_id=category_id,
                amount=-100,
            )


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
