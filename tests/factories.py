from datetime import date, datetime
from uuid import UUID

import asyncpg

from models.budget_plan import BudgetPlanResponse
from models.enums import Currency, Role
from models.expense import ExpenseResponse
from models.user import UserResponse


async def make_account(
    conn: asyncpg.Connection, *, name: str = "Test Account", currency: Currency | None = None
) -> UUID:
    if currency is None:
        row = await conn.fetchrow("INSERT INTO accounts (name) VALUES ($1) RETURNING id", name)
    else:
        row = await conn.fetchrow(
            "INSERT INTO accounts (name, currency) VALUES ($1, $2) RETURNING id",
            name,
            currency.value,
        )
    assert row is not None
    return row["id"]


async def make_category(
    conn: asyncpg.Connection,
    *,
    account_id: UUID,
    name: str = "General",
    created_at: datetime | None = None,
) -> UUID:
    row = await conn.fetchrow(
        """
        INSERT INTO categories (name, account_id, created_at)
        VALUES ($1, $2, COALESCE($3, now()))
        RETURNING id
        """,
        name,
        account_id,
        created_at,
    )
    assert row is not None
    return row["id"]


async def make_tag(conn: asyncpg.Connection, *, account_id: UUID, name: str = "urgent") -> UUID:
    row = await conn.fetchrow(
        "INSERT INTO tags (name, account_id) VALUES ($1, $2) RETURNING id",
        name,
        account_id,
    )
    assert row is not None
    return row["id"]


async def make_user(
    conn: asyncpg.Connection,
    *,
    account_id: UUID,
    tg_id: int = 1,
    name: str = "Test User",
    role: Role = Role.MEMBER,
) -> UserResponse:
    row = await conn.fetchrow(
        """
        INSERT INTO users (tg_id, name, role, account_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id, tg_id, name, role, account_id, created_at
        """,
        tg_id,
        name,
        role.value,
        account_id,
    )
    assert row is not None
    return UserResponse.model_validate(dict(row))


async def make_expense(
    conn: asyncpg.Connection,
    *,
    account_id: UUID,
    user_id: UUID,
    category_id: UUID,
    amount: int = 1000,
    comment: str | None = None,
    created_at: datetime | None = None,
    spent_at: date | None = None,
) -> ExpenseResponse:
    # spent_at defaults from created_at's calendar date (not the DB column's
    # own `current_date` default) so every existing caller that only sets
    # created_at keeps landing in the period it already appears in — same
    # reasoning as U0.3's spent_at backfill (D314).
    if spent_at is None:
        spent_at = created_at.date() if created_at is not None else date.today()
    row = await conn.fetchrow(
        """
        INSERT INTO expenses
            (amount, comment, category_id, user_id, account_id, created_at, spent_at)
        VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), $7)
        RETURNING id, amount, comment, category_id, user_id, account_id,
                  created_at, updated_at, spent_at
        """,
        amount,
        comment,
        category_id,
        user_id,
        account_id,
        created_at,
        spent_at,
    )
    assert row is not None
    return ExpenseResponse.model_validate(dict(row))


async def make_budget_plan(
    conn: asyncpg.Connection,
    *,
    account_id: UUID,
    category_id: UUID,
    amount: int = 10000,
    period: str = "monthly",
    notify_threshold: int = 80,
) -> BudgetPlanResponse:
    row = await conn.fetchrow(
        """
        INSERT INTO budget_plans (category_id, account_id, amount, period, notify_threshold)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, category_id, account_id, amount, period, notify_threshold,
                  created_at, updated_at
        """,
        category_id,
        account_id,
        amount,
        period,
        notify_threshold,
    )
    assert row is not None
    return BudgetPlanResponse.model_validate(dict(row))
