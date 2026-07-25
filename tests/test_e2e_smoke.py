"""U5.1 e2e smoke (@integration), extended by U3.1: bot client -> real API ->
test DB.

Exercises the actual production path through bot.client.BackendClient (the
bot's only channel to the backend, bot/CLAUDE.md) against the real FastAPI
app wired to a real Postgres pool (main.lifespan) — no fakes or
dependency_overrides for expenses/budgets/DB. The one exception is the
outbound Telegram call inside NotificationService: swapped for a
MockTransport (same pattern as test_notification_service.py) so this smoke
test needs neither a live bot token nor network access, while still
exercising the real notification-flow invariant (services/CLAUDE.md,
expense_service._check_budget_and_notify) end to end.

U3.1 adds three ACs on top of U5.1's original scenario (plan D104, D106,
D105 respectively): fan-out notifies every account member, not just the
one who added the expense; statistics/by-period with explicit start/end
actually filters by that window rather than just happening to return the
one row that exists; a foreign-account category_id on create is a 404, not
a leak of another account's data.
"""

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import httpx
import pytest
import pytest_asyncio
from factories import make_account, make_budget_plan, make_category, make_expense, make_user
from httpx import ASGITransport, AsyncClient

from api import deps
from bot.client import BackendClient
from config import get_settings
from main import create_app
from models.enums import Role
from models.expense import ExpenseCreate
from services.notification_service import NotificationService


@pytest_asyncio.fixture(loop_scope="session")
async def smoke_fixtures(db_pool: asyncpg.Pool) -> AsyncIterator[dict[str, Any]]:
    """Seeds via a plain (committing) connection from the shared pool — NOT the
    rollback-wrapped `db_conn` fixture (tests/CLAUDE.md's other integration
    tests use that). The app under test acquires its own connection from its
    own pool (main.lifespan) and would never see rows sitting inside another
    connection's still-open, never-committed transaction. Cleaned up
    explicitly afterward, in FK order (docs/SCHEMA.sql: expenses/
    budget_plans/users all reference accounts/categories with no ON DELETE
    CASCADE back to accounts, so children must go first). The `try` wraps
    setup too, not just the yield: a failure partway through (e.g. account
    created, category insert fails) must still clean up whatever already
    committed, since this connection — unlike `db_conn` — never rolls back.

    U3.1 additions: a second member (`user_b`) of the same account, for the
    notification fan-out AC; two backdated expenses (fixed 2020 dates, well
    outside `services.period.month_bounds()`'s "current month" window so
    they can't move the budget-notification fill_pct in the first test), for
    the statistics-by-period AC; a second, unrelated account+category, for
    the foreign-category-404 AC.
    """
    tg_id_a = uuid4().int % 1_000_000_000
    tg_id_b = uuid4().int % 1_000_000_000
    account_id: UUID | None = None
    other_account_id: UUID | None = None
    async with db_pool.acquire() as conn:
        try:
            account_id = await make_account(conn, name="Smoke Account")
            category_id = await make_category(conn, account_id=account_id, name="Groceries")
            user_a = await make_user(
                conn, account_id=account_id, tg_id=tg_id_a, name="Member A", role=Role.MEMBER
            )
            user_b = await make_user(
                conn, account_id=account_id, tg_id=tg_id_b, name="Member B", role=Role.MEMBER
            )
            budget_plan = await make_budget_plan(
                conn,
                account_id=account_id,
                category_id=category_id,
                amount=10_000,
                notify_threshold=80,
            )
            await make_expense(
                conn,
                account_id=account_id,
                user_id=user_a.id,
                category_id=category_id,
                amount=500,
                created_at=datetime(2020, 1, 15, tzinfo=UTC),
            )
            await make_expense(
                conn,
                account_id=account_id,
                user_id=user_a.id,
                category_id=category_id,
                amount=700,
                created_at=datetime(2020, 1, 20, tzinfo=UTC),
            )

            other_account_id = await make_account(conn, name="Other Smoke Account")
            other_category_id = await make_category(
                conn, account_id=other_account_id, name="Foreign"
            )

            yield {
                "account_id": account_id,
                "category_id": category_id,
                "user_a": user_a,
                "user_b": user_b,
                "budget_plan": budget_plan,
                "other_category_id": other_category_id,
            }
        finally:
            if account_id is not None:
                await conn.execute("DELETE FROM expenses WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM budget_plans WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM users WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM categories WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM accounts WHERE id = $1", account_id)
            if other_account_id is not None:
                await conn.execute("DELETE FROM categories WHERE account_id = $1", other_account_id)
                await conn.execute("DELETE FROM accounts WHERE id = $1", other_account_id)


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_add_expense_appears_in_list_and_fires_budget_notification_for_every_member(
    smoke_fixtures: dict[str, Any],
) -> None:
    telegram_requests: list[httpx.Request] = []

    def fake_telegram_handler(request: httpx.Request) -> httpx.Response:
        telegram_requests.append(request)
        return httpx.Response(200, json={"ok": True})

    fake_telegram_client = AsyncClient(transport=httpx.MockTransport(fake_telegram_handler))
    app = create_app()
    app.dependency_overrides[deps.get_notification_service] = lambda: NotificationService(
        get_settings().bot_token, fake_telegram_client
    )

    try:
        async with app.router.lifespan_context(app):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as http_client:
                backend = BackendClient(
                    http_client,
                    tg_id=smoke_fixtures["user_a"].tg_id,
                    internal_token=get_settings().internal_token,
                )

                # add expense
                created = await backend.create_expense(
                    ExpenseCreate(
                        amount=9_000,
                        comment="smoke test",
                        category_id=smoke_fixtures["category_id"],
                    )
                )
                assert created.amount == 9_000
                assert created.category_id == smoke_fixtures["category_id"]

                # appears in list
                listed = await backend.list_expenses()
                assert any(expense.id == created.id for expense in listed)
    finally:
        app.dependency_overrides.clear()
        await fake_telegram_client.aclose()

    # budget threshold notification fan-out (D104): BOTH account members get
    # the message, not just member A who added the expense — 9_000 / 10_000
    # = 90% >= 80% threshold.
    assert len(telegram_requests) == 2
    payloads = [json.loads(request.content) for request in telegram_requests]
    notified_chat_ids = {payload["chat_id"] for payload in payloads}
    assert notified_chat_ids == {smoke_fixtures["user_a"].tg_id, smoke_fixtures["user_b"].tg_id}
    for payload in payloads:
        assert "Groceries" in payload["text"]
        assert "90" in payload["text"]


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_statistics_by_period_with_explicit_bounds_matches_seeded_sum(
    smoke_fixtures: dict[str, Any],
) -> None:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http_client:
            backend = BackendClient(
                http_client,
                tg_id=smoke_fixtures["user_a"].tg_id,
                internal_token=get_settings().internal_token,
            )

            # window covers only the two backdated expenses the fixture
            # seeds (500 + 700 = 1_200), never any "now" expense another
            # test in this module creates — proves start/end actually
            # filter, not just that the only existing row happens to match.
            totals = await backend.statistics_by_period(
                start=datetime(2020, 1, 1, tzinfo=UTC),
                end=datetime(2020, 2, 1, tzinfo=UTC),
            )

    assert totals.total == 1_200


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_expense_with_foreign_account_category_is_404(
    smoke_fixtures: dict[str, Any],
) -> None:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http_client:
            backend = BackendClient(
                http_client,
                tg_id=smoke_fixtures["user_a"].tg_id,
                internal_token=get_settings().internal_token,
            )

            with pytest.raises(httpx.HTTPStatusError) as exc_info:
                await backend.create_expense(
                    ExpenseCreate(
                        amount=1_000,
                        category_id=smoke_fixtures["other_category_id"],
                    )
                )

    assert exc_info.value.response.status_code == 404
