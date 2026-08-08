"""MVP U5.1 e2e smoke (@integration), extended by family-features-v1_1 U3.1,
mini-app-v2 U3.1, mini-app-v3 U4.1 and mini-app-v4 U4.1 (same-numbered but
unrelated units in different plan files — see each test's docstring for
which one it belongs to): bot client / initData -> real API -> test DB.

Exercises the actual production path through bot.client.BackendClient (the
bot's only channel to the backend, bot/CLAUDE.md) against the real FastAPI
app wired to a real Postgres pool (main.lifespan) — no fakes or
dependency_overrides for expenses/budgets/DB. The one exception is the
outbound Telegram call inside NotificationService: swapped for a
MockTransport (same pattern as test_notification_service.py) so this smoke
test needs neither a live bot token nor network access, while still
exercising the real notification-flow invariant (services/CLAUDE.md,
expense_service._check_budget_and_notify) end to end.

family-features-v1_1 U3.1 adds three ACs on top of U5.1's original scenario
(plan D104, D106, D105 respectively): fan-out notifies every account
member, not just the one who added the expense; statistics/by-period with
explicit start/end actually filters by that window rather than just
happening to return the one row that exists; a foreign-account category_id
on create is a 404, not a leak of another account's data.

mini-app-v2 U3.1 adds the same scenario driven through the Mini App's auth
path instead of the bot's: a signed X-Telegram-Init-Data payload ->
GET /users/me -> POST /expenses -> the expense in a paginated GET /expenses
-> GET /statistics/by-category?months_back=0 includes it, plus a tampered
payload -> 401. Proves the two auth paths (api/CLAUDE.md's "Choosing an auth
dependency") resolve to the same account/user against a real DB, not just at
the dependency-injection level test_deps.py already covers with fakes.

mini-app-v3 U4.1 adds one more initData scenario: `period`+`offset`
statistics (D313) filed by `spent_at` rather than `created_at` (D314), and
the category archive lifecycle (D302) — create with an explicit colour,
archive while in use, `include_archived`, and the archived-category write
guard (409) — all against the real app/DB.

mini-app-v4 U4.1 adds the last initData scenario: `GET /expenses`'s new
`category_id`/`period`/`period_offset` filters (D402) — proving they narrow
the same way the statistics routes do and key off `spent_at`, not
`created_at` — plus `PATCH /accounts/me`'s currency relabel (D401/D400): no
`expenses.amount` changes, `GET /users/me` reports the new code, and a
non-admin is 403.
"""

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import asyncpg
import httpx
import pytest
import pytest_asyncio
from factories import make_account, make_budget_plan, make_category, make_expense, make_user
from httpx import ASGITransport, AsyncClient
from test_deps import build_init_data

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


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_init_data_auth_round_trips_through_expenses_and_statistics(
    smoke_fixtures: dict[str, Any],
) -> None:
    """mini-app-v2 U3.1: the Mini App auth path (signed X-Telegram-Init-Data,
    no X-Internal-Token) through the real app/DB, not BackendClient. The
    posted amount (150) stays far under the fixture's budget_plan threshold
    (10_000 @ 80%) so no notification fires and no outbound Telegram call is
    needed here — that fan-out is already covered above.
    """
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http_client:
            headers = {
                "X-Telegram-Init-Data": build_init_data(
                    get_settings().bot_token, smoke_fixtures["user_a"].tg_id
                )
            }

            me = await http_client.get("/users/me", headers=headers)
            assert me.status_code == 200
            assert me.json()["id"] == str(smoke_fixtures["user_a"].id)

            created = await http_client.post(
                "/expenses",
                headers=headers,
                json={
                    "amount": 150,
                    "comment": "initData smoke",
                    "category_id": str(smoke_fixtures["category_id"]),
                },
            )
            assert created.status_code == 201
            expense_id = created.json()["id"]

            listed = await http_client.get("/expenses", headers=headers, params={"limit": 50})
            assert listed.status_code == 200
            assert any(expense["id"] == expense_id for expense in listed.json())

            by_category = await http_client.get(
                "/statistics/by-category", headers=headers, params={"months_back": 0}
            )
            assert by_category.status_code == 200
            totals = {row["category_id"]: row["total"] for row in by_category.json()}
            assert totals.get(str(smoke_fixtures["category_id"]), 0) >= 150


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_init_data_tampered_payload_against_real_app_is_401(
    smoke_fixtures: dict[str, Any],
) -> None:
    """mini-app-v2 U3.1 AC: a tampered payload in the same scenario -> 401.
    test_deps.py already proves this against a fake dependency chain; this
    repeats it against the real app/DB to guarantee the wiring in main.py
    doesn't accept it some other way.
    """
    tampered = dict(
        parse_qsl(build_init_data(get_settings().bot_token, smoke_fixtures["user_a"].tg_id))
    )
    tampered["user"] = json.dumps({"id": smoke_fixtures["user_a"].tg_id + 1})

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http_client:
            response = await http_client.get(
                "/users/me", headers={"X-Telegram-Init-Data": urlencode(tampered)}
            )

    assert response.status_code == 401


@pytest_asyncio.fixture(loop_scope="session")
async def period_archive_fixtures(db_pool: asyncpg.Pool) -> AsyncIterator[dict[str, Any]]:
    """mini-app-v3 U4.1: a fresh account with a single ADMIN user. Category
    create/archive need the `categories` resource's write access, which the
    default matrix (api/CLAUDE.md) grants only to `admin` — `member` is
    read-only there — so this can't reuse `smoke_fixtures`'s member users. A
    dedicated account also keeps this scenario's own expenses from changing
    the fixed totals the other tests in this module assert on.
    """
    tg_id = uuid4().int % 1_000_000_000
    account_id: UUID | None = None
    async with db_pool.acquire() as conn:
        try:
            account_id = await make_account(conn, name="Period Archive Smoke Account")
            admin = await make_user(
                conn, account_id=account_id, tg_id=tg_id, name="Admin", role=Role.ADMIN
            )
            yield {"account_id": account_id, "admin": admin}
        finally:
            if account_id is not None:
                await conn.execute("DELETE FROM expenses WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM users WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM categories WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM accounts WHERE id = $1", account_id)


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_period_and_archive_round_trip_through_init_data(
    period_archive_fixtures: dict[str, Any],
) -> None:
    """mini-app-v3 U4.1: one signed-initData scenario over the real app/DB —
    create a category with an explicit colour, add an expense today and one
    backdated to yesterday via `spent_at`, prove `period=day&offset=0/-1`
    file each by `spent_at` and not `created_at` (D314), `period=custom` and
    `period=week&offset=0` both span the two, then archive the category
    while it's in use and prove the `include_archived` split (D302): gone
    from the default list, present with the flag, its two expenses and
    their statistics total untouched, and a new expense into it now 409s.
    """
    admin = period_archive_fixtures["admin"]
    headers = {"X-Telegram-Init-Data": build_init_data(get_settings().bot_token, admin.tg_id)}

    family_tz = get_settings().family_tz
    local_today = datetime.now(UTC).astimezone(ZoneInfo(family_tz)).date()
    local_yesterday = local_today - timedelta(days=1)

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http_client:
            category = await http_client.post(
                "/categories",
                headers=headers,
                json={"name": "Smoke Colour Category", "color_slot": 7},
            )
            assert category.status_code == 201
            category_id = category.json()["id"]
            assert category.json()["color_slot"] == 7

            today_expense = await http_client.post(
                "/expenses",
                headers=headers,
                json={"amount": 1_200, "category_id": category_id},
            )
            assert today_expense.status_code == 201
            assert today_expense.json()["spent_at"] == local_today.isoformat()

            yesterday_expense = await http_client.post(
                "/expenses",
                headers=headers,
                json={
                    "amount": 3_400,
                    "category_id": category_id,
                    "spent_at": local_yesterday.isoformat(),
                },
            )
            assert yesterday_expense.status_code == 201
            assert yesterday_expense.json()["spent_at"] == local_yesterday.isoformat()

            day_today = await http_client.get(
                "/statistics/by-period", headers=headers, params={"period": "day", "offset": 0}
            )
            assert day_today.status_code == 200
            assert day_today.json()["total"] == 1_200

            day_yesterday = await http_client.get(
                "/statistics/by-period", headers=headers, params={"period": "day", "offset": -1}
            )
            assert day_yesterday.status_code == 200
            assert day_yesterday.json()["total"] == 3_400

            custom = await http_client.get(
                "/statistics/by-period",
                headers=headers,
                params={
                    "period": "custom",
                    "start_date": local_yesterday.isoformat(),
                    "end_date": local_today.isoformat(),
                },
            )
            assert custom.status_code == 200
            assert custom.json()["total"] == 4_600

            # Week starts Monday (D315): every day but Monday, "yesterday"
            # falls in the same Mon-Sun window as "today"; on a Monday it
            # falls in the previous one — computed, not assumed, so this
            # assertion holds regardless of which day the suite runs on.
            expected_week_total = 1_200 if local_today.weekday() == 0 else 4_600
            week = await http_client.get(
                "/statistics/by-period", headers=headers, params={"period": "week", "offset": 0}
            )
            assert week.status_code == 200
            assert week.json()["total"] == expected_week_total

            archived = await http_client.delete(f"/categories/{category_id}", headers=headers)
            assert archived.status_code == 204

            active_only = await http_client.get("/categories", headers=headers)
            assert active_only.status_code == 200
            assert category_id not in {c["id"] for c in active_only.json()}

            with_archived = await http_client.get(
                "/categories?include_archived=true", headers=headers
            )
            assert with_archived.status_code == 200
            archived_row = next(c for c in with_archived.json() if c["id"] == category_id)
            assert archived_row["is_active"] is False

            expenses = await http_client.get("/expenses", headers=headers, params={"limit": 50})
            assert expenses.status_code == 200
            assert {e["amount"] for e in expenses.json()} == {1_200, 3_400}

            by_category = await http_client.get(
                "/statistics/by-category",
                headers=headers,
                params={
                    "period": "custom",
                    "start_date": local_yesterday.isoformat(),
                    "end_date": local_today.isoformat(),
                },
            )
            assert by_category.status_code == 200
            totals = {row["category_id"]: row["total"] for row in by_category.json()}
            assert totals[category_id] == 4_600

            blocked = await http_client.post(
                "/expenses",
                headers=headers,
                json={"amount": 500, "category_id": category_id},
            )
            assert blocked.status_code == 409


@pytest_asyncio.fixture(loop_scope="session")
async def filtered_list_currency_fixtures(db_pool: asyncpg.Pool) -> AsyncIterator[dict[str, Any]]:
    """mini-app-v4 U4.1: a fresh account with an ADMIN and a MEMBER user —
    `PATCH /accounts/me` needs an admin for the success path and a member
    for the 403 path (`api/deps.py::require_admin`) — plus one category. A
    dedicated account keeps this scenario's own expenses and currency change
    from touching the fixed totals the other tests in this module assert on.
    """
    tg_id_admin = uuid4().int % 1_000_000_000
    tg_id_member = uuid4().int % 1_000_000_000
    account_id: UUID | None = None
    async with db_pool.acquire() as conn:
        try:
            account_id = await make_account(conn, name="Filtered List Currency Smoke Account")
            category_id = await make_category(conn, account_id=account_id, name="Smoke Category")
            admin = await make_user(
                conn, account_id=account_id, tg_id=tg_id_admin, name="Admin", role=Role.ADMIN
            )
            member = await make_user(
                conn, account_id=account_id, tg_id=tg_id_member, name="Member", role=Role.MEMBER
            )
            yield {
                "account_id": account_id,
                "category_id": category_id,
                "admin": admin,
                "member": member,
            }
        finally:
            if account_id is not None:
                await conn.execute("DELETE FROM expenses WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM users WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM categories WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM accounts WHERE id = $1", account_id)


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_filtered_expense_list_and_currency_relabel_through_init_data(
    filtered_list_currency_fixtures: dict[str, Any],
) -> None:
    """mini-app-v4 U4.1: one signed-initData scenario over the real app/DB —
    add an expense today and one backdated to yesterday into the same
    category; `GET /expenses?category_id` returns both, `+ period=day&
    period_offset=0` narrows to exactly the non-backdated one and
    `period_offset=-1` to exactly the backdated one (D402), proving the
    filter keys off `spent_at` not `created_at` (D314); `PATCH
    /expenses/{id}` moves the backdated one to today and both period
    queries update accordingly; an admin `PATCH /accounts/me` to EUR (D401)
    leaves both `amount` values untouched (D400 — relabel only, no
    conversion) while `GET /users/me` reports EUR; a member's `PATCH
    /accounts/me` is 403.
    """
    fixtures = filtered_list_currency_fixtures
    category_id = fixtures["category_id"]
    admin_headers = {
        "X-Telegram-Init-Data": build_init_data(get_settings().bot_token, fixtures["admin"].tg_id)
    }
    member_headers = {
        "X-Telegram-Init-Data": build_init_data(get_settings().bot_token, fixtures["member"].tg_id)
    }

    family_tz = get_settings().family_tz
    local_today = datetime.now(UTC).astimezone(ZoneInfo(family_tz)).date()
    local_yesterday = local_today - timedelta(days=1)

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http_client:
            today_expense = await http_client.post(
                "/expenses",
                headers=admin_headers,
                json={"amount": 2_000, "category_id": str(category_id)},
            )
            assert today_expense.status_code == 201
            today_id = today_expense.json()["id"]
            assert today_expense.json()["spent_at"] == local_today.isoformat()

            yesterday_expense = await http_client.post(
                "/expenses",
                headers=admin_headers,
                json={
                    "amount": 5_000,
                    "category_id": str(category_id),
                    "spent_at": local_yesterday.isoformat(),
                },
            )
            assert yesterday_expense.status_code == 201
            yesterday_id = yesterday_expense.json()["id"]

            both = await http_client.get(
                "/expenses",
                headers=admin_headers,
                params={"category_id": str(category_id), "limit": 50},
            )
            assert both.status_code == 200
            assert {e["id"] for e in both.json()} == {today_id, yesterday_id}

            day_today = await http_client.get(
                "/expenses",
                headers=admin_headers,
                params={"category_id": str(category_id), "period": "day", "period_offset": 0},
            )
            assert day_today.status_code == 200
            assert [e["id"] for e in day_today.json()] == [today_id]

            day_yesterday = await http_client.get(
                "/expenses",
                headers=admin_headers,
                params={"category_id": str(category_id), "period": "day", "period_offset": -1},
            )
            assert day_yesterday.status_code == 200
            assert [e["id"] for e in day_yesterday.json()] == [yesterday_id]

            moved = await http_client.patch(
                f"/expenses/{yesterday_id}",
                headers=admin_headers,
                json={"spent_at": local_today.isoformat()},
            )
            assert moved.status_code == 200
            assert moved.json()["spent_at"] == local_today.isoformat()

            # Both expenses now carry spent_at == today (D314): period_offset=-1
            # loses the expense it used to hold and period_offset=0 gains it.
            day_yesterday_after_move = await http_client.get(
                "/expenses",
                headers=admin_headers,
                params={"category_id": str(category_id), "period": "day", "period_offset": -1},
            )
            assert day_yesterday_after_move.status_code == 200
            assert day_yesterday_after_move.json() == []

            day_today_after_move = await http_client.get(
                "/expenses",
                headers=admin_headers,
                params={"category_id": str(category_id), "period": "day", "period_offset": 0},
            )
            assert day_today_after_move.status_code == 200
            assert {e["id"] for e in day_today_after_move.json()} == {today_id, yesterday_id}

            currency_update = await http_client.patch(
                "/accounts/me", headers=admin_headers, json={"currency": "EUR"}
            )
            assert currency_update.status_code == 200
            assert currency_update.json()["currency"] == "EUR"

            me = await http_client.get("/users/me", headers=admin_headers)
            assert me.status_code == 200
            assert me.json()["currency"] == "EUR"

            after_currency = await http_client.get(
                "/expenses",
                headers=admin_headers,
                params={"category_id": str(category_id), "limit": 50},
            )
            assert after_currency.status_code == 200
            assert {e["id"]: e["amount"] for e in after_currency.json()} == {
                today_id: 2_000,
                yesterday_id: 5_000,
            }

            member_forbidden = await http_client.patch(
                "/accounts/me", headers=member_headers, json={"currency": "USD"}
            )
            assert member_forbidden.status_code == 403
