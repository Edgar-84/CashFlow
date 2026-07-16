from datetime import datetime
from uuid import UUID

import asyncpg

from models.enums import Role
from models.expense import ExpenseResponse
from models.user import UserResponse


async def make_account(conn: asyncpg.Connection, *, name: str = "Test Account") -> UUID:
    row = await conn.fetchrow("INSERT INTO accounts (name) VALUES ($1) RETURNING id", name)
    assert row is not None
    return row["id"]


async def make_category(
    conn: asyncpg.Connection, *, account_id: UUID, name: str = "General"
) -> UUID:
    row = await conn.fetchrow(
        "INSERT INTO categories (name, account_id) VALUES ($1, $2) RETURNING id",
        name,
        account_id,
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
) -> ExpenseResponse:
    row = await conn.fetchrow(
        """
        INSERT INTO expenses (amount, comment, category_id, user_id, account_id, created_at)
        VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))
        RETURNING id, amount, comment, category_id, user_id, account_id,
                  created_at, updated_at
        """,
        amount,
        comment,
        category_id,
        user_id,
        account_id,
        created_at,
    )
    assert row is not None
    return ExpenseResponse.model_validate(dict(row))
