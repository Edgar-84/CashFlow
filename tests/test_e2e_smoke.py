"""U5.1 e2e smoke (@integration): bot client -> real API -> test DB.

Exercises the actual production path through bot.client.BackendClient (the
bot's only channel to the backend, bot/CLAUDE.md) against the real FastAPI
app wired to a real Postgres pool (main.lifespan) — no fakes or
dependency_overrides for expenses/budgets/DB. The one exception is the
outbound Telegram call inside NotificationService: swapped for a
MockTransport (same pattern as test_notification_service.py) so this smoke
test needs neither a live bot token nor network access, while still
exercising the real notification-flow invariant (services/CLAUDE.md,
expense_service._check_budget_and_notify) end to end.
"""

import json
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import httpx
import pytest
import pytest_asyncio
from factories import make_account, make_budget_plan, make_category, make_user
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
    committed, since this connection — unlike `db_conn` — never rolls back."""
    tg_id = uuid4().int % 1_000_000_000
    account_id: UUID | None = None
    async with db_pool.acquire() as conn:
        try:
            account_id = await make_account(conn, name="Smoke Account")
            category_id = await make_category(conn, account_id=account_id, name="Groceries")
            user = await make_user(conn, account_id=account_id, tg_id=tg_id, role=Role.MEMBER)
            budget_plan = await make_budget_plan(
                conn,
                account_id=account_id,
                category_id=category_id,
                amount=10_000,
                notify_threshold=80,
            )
            yield {
                "account_id": account_id,
                "category_id": category_id,
                "user": user,
                "budget_plan": budget_plan,
            }
        finally:
            if account_id is not None:
                await conn.execute("DELETE FROM expenses WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM budget_plans WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM users WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM categories WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM accounts WHERE id = $1", account_id)


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_add_expense_appears_in_list_and_fires_budget_notification(
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
                    tg_id=smoke_fixtures["user"].tg_id,
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

    # budget threshold notification fired: 9_000 / 10_000 = 90% >= 80% threshold
    assert len(telegram_requests) == 1
    payload = json.loads(telegram_requests[0].content)
    assert payload["chat_id"] == smoke_fixtures["user"].tg_id
    assert "Groceries" in payload["text"]
    assert "90" in payload["text"]
