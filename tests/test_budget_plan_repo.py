from datetime import UTC, datetime, timedelta
from uuid import uuid4

import asyncpg
import pytest
from factories import make_account, make_budget_plan, make_category, make_expense, make_user

from repositories.budget_plan_repo import BudgetPlanRepository


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_get_update_delete(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    repo = BudgetPlanRepository(db_conn)

    created = await repo.create(
        {
            "category_id": category_id,
            "account_id": account_id,
            "amount": 10000,
            "period": "monthly",
            "notify_threshold": 80,
        }
    )
    assert created.amount == 10000
    assert created.notify_threshold == 80

    fetched = await repo.get(created.id)
    assert fetched is not None
    assert fetched.amount == 10000

    updated = await repo.update(created.id, {"amount": 20000})
    assert updated is not None
    assert updated.amount == 20000

    deleted = await repo.delete(created.id)
    assert deleted is True

    gone = await repo.get(created.id)
    assert gone is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_duplicate_plan_raises_unique_violation(db_conn: asyncpg.Connection) -> None:
    """Unlike categories/tags (D19), budget_plans DOES have a DB-level
    UNIQUE(category_id, account_id, period) constraint (docs/SCHEMA.sql).
    Documents current behavior: the raw asyncpg error propagates untranslated
    — BaseRepository.create() does not map it to a domain exception."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    repo = BudgetPlanRepository(db_conn)

    await repo.create(
        {
            "category_id": category_id,
            "account_id": account_id,
            "amount": 10000,
            "period": "monthly",
            "notify_threshold": 80,
        }
    )
    with pytest.raises(asyncpg.UniqueViolationError):
        await repo.create(
            {
                "category_id": category_id,
                "account_id": account_id,
                "amount": 5000,
                "period": "monthly",
                "notify_threshold": 50,
            }
        )


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_missing_returns_none(db_conn: asyncpg.Connection) -> None:
    repo = BudgetPlanRepository(db_conn)
    assert await repo.get(uuid4()) is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_missing_returns_false(db_conn: asyncpg.Connection) -> None:
    repo = BudgetPlanRepository(db_conn)
    assert await repo.delete(uuid4()) is False


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_check_limit_no_plan_returns_none(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    repo = BudgetPlanRepository(db_conn)

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)

    result = await repo.check_limit(account_id, category_id, start=july_start, end=august_start)

    assert result is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
@pytest.mark.parametrize(
    ("spent", "expected_pct"),
    [
        pytest.param(0, 0.0, id="zero_spent"),
        pytest.param(8000, 80.0, id="exactly_at_notify_threshold"),
        pytest.param(15000, 150.0, id="over_100_percent"),
    ],
)
async def test_check_limit_fill_percentage(
    db_conn: asyncpg.Connection, spent: int, expected_pct: float
) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    await make_budget_plan(
        db_conn, account_id=account_id, category_id=category_id, amount=10000, notify_threshold=80
    )

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)
    mid_july = july_start + timedelta(days=10)

    if spent:
        await make_expense(
            db_conn,
            account_id=account_id,
            user_id=user.id,
            category_id=category_id,
            amount=spent,
            created_at=mid_july,
        )

    repo = BudgetPlanRepository(db_conn)
    result = await repo.check_limit(account_id, category_id, start=july_start, end=august_start)

    assert result == expected_pct
    assert type(result) is float


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_check_limit_zero_amount_plan_returns_none(db_conn: asyncpg.Connection) -> None:
    """models/budget_plan.py's `amount: int` has no positivity constraint;
    guards against a ZeroDivisionError rather than crashing."""
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    await make_budget_plan(db_conn, account_id=account_id, category_id=category_id, amount=0)

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)

    repo = BudgetPlanRepository(db_conn)
    result = await repo.check_limit(account_id, category_id, start=july_start, end=august_start)

    assert result is None


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_check_limit_ignores_expenses_outside_period(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)
    await make_budget_plan(db_conn, account_id=account_id, category_id=category_id, amount=10000)

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)

    await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=5000,
        created_at=august_start,
    )

    repo = BudgetPlanRepository(db_conn)
    result = await repo.check_limit(account_id, category_id, start=july_start, end=august_start)

    assert result == 0.0


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_check_limit_scopes_by_account(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    other_account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    other_category_id = await make_category(db_conn, account_id=other_account_id)
    other_user = await make_user(db_conn, account_id=other_account_id)
    await make_budget_plan(db_conn, account_id=account_id, category_id=category_id, amount=10000)
    await make_budget_plan(
        db_conn, account_id=other_account_id, category_id=other_category_id, amount=10000
    )

    july_start = datetime(2026, 7, 1, tzinfo=UTC)
    august_start = datetime(2026, 8, 1, tzinfo=UTC)
    mid_july = july_start + timedelta(days=10)

    await make_expense(
        db_conn,
        account_id=other_account_id,
        user_id=other_user.id,
        category_id=other_category_id,
        amount=9000,
        created_at=mid_july,
    )

    repo = BudgetPlanRepository(db_conn)
    mine = await repo.check_limit(account_id, category_id, start=july_start, end=august_start)
    theirs = await repo.check_limit(
        other_account_id, other_category_id, start=july_start, end=august_start
    )

    assert mine == 0.0
    assert theirs == 90.0
