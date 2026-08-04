"""Integration coverage for the U0.3 migration's backfill logic
(`migrations/versions/2026_08_04_1829-a1d5976f1ce0_*.py`).

Real `alembic upgrade`/`downgrade` can't run on this dev machine (D18); the
generic "apply then round-trip" check for every migration already runs in
CI (`.github/workflows/ci.yml`). What these tests cover instead is the
backfill *formula* itself — the same SQL the migration runs, executed
directly against the already-migrated schema `db_conn` connects to, over
data inserted with controlled `created_at` values.
"""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import asyncpg
import pytest
from factories import make_account, make_category, make_expense, make_user


async def _backfill_color_slots(conn: asyncpg.Connection) -> None:
    await conn.execute("""
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY account_id ORDER BY created_at ASC
            ) AS rn
            FROM categories
        )
        UPDATE categories c
        SET color_slot = ranked.rn
        FROM ranked
        WHERE c.id = ranked.id AND ranked.rn <= 6
    """)


async def _backfill_spent_at(conn: asyncpg.Connection, tz: str) -> None:
    await conn.execute("UPDATE expenses SET spent_at = (created_at AT TIME ZONE $1)::date", tz)


async def _color_slots_by_created_at(
    conn: asyncpg.Connection, account_id: UUID
) -> list[int | None]:
    rows = await conn.fetch(
        "SELECT color_slot FROM categories WHERE account_id = $1 ORDER BY created_at ASC",
        account_id,
    )
    return [row["color_slot"] for row in rows]


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_color_slot_backfill_caps_at_six_by_created_at_order(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn)
    base = datetime(2026, 1, 1, tzinfo=UTC)
    for i in range(8):
        await make_category(
            db_conn, account_id=account_id, name=f"Cat{i}", created_at=base + timedelta(minutes=i)
        )

    await _backfill_color_slots(db_conn)

    assert await _color_slots_by_created_at(db_conn, account_id) == [1, 2, 3, 4, 5, 6, None, None]


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_color_slot_backfill_never_assigns_slots_seven_to_twelve(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn)
    base = datetime(2026, 1, 1, tzinfo=UTC)
    for i in range(8):
        await make_category(
            db_conn, account_id=account_id, name=f"Cat{i}", created_at=base + timedelta(minutes=i)
        )

    await _backfill_color_slots(db_conn)

    slots = await _color_slots_by_created_at(db_conn, account_id)
    assert all(slot is None or slot <= 6 for slot in slots)


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_category_defaults_to_active_without_backfill(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)

    row = await db_conn.fetchrow("SELECT is_active FROM categories WHERE id = $1", category_id)
    assert row is not None
    assert row["is_active"] is True


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_spent_at_backfill_uses_family_tz_not_naive_utc_date(
    db_conn: asyncpg.Connection,
) -> None:
    """A row created at 2026-07-20 00:30 Europe/Belgrade (CEST, UTC+2) is
    2026-07-19 22:30 UTC — the same class of boundary D120 already covers
    for `resolve_period`: a naive `created_at::date` (interpreted in UTC)
    would land on Jul 19, one day before the local date the expense actually
    happened on."""
    account_id = await make_account(db_conn)
    user = await make_user(db_conn, account_id=account_id)
    category_id = await make_category(db_conn, account_id=account_id)

    created_at = datetime(2026, 7, 19, 22, 30, tzinfo=UTC)
    expense = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        created_at=created_at,
    )

    await _backfill_spent_at(db_conn, "Europe/Belgrade")

    row = await db_conn.fetchrow("SELECT spent_at FROM expenses WHERE id = $1", expense.id)
    assert row is not None
    assert row["spent_at"] == date(2026, 7, 20)


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_expense_defaults_spent_at_to_current_date_without_backfill(
    db_conn: asyncpg.Connection,
) -> None:
    account_id = await make_account(db_conn)
    user = await make_user(db_conn, account_id=account_id)
    category_id = await make_category(db_conn, account_id=account_id)

    expense = await make_expense(
        db_conn, account_id=account_id, user_id=user.id, category_id=category_id
    )

    row = await db_conn.fetchrow("SELECT spent_at FROM expenses WHERE id = $1", expense.id)
    assert row is not None
    assert row["spent_at"] == date.today()
