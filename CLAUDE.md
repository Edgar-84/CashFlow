# Project: CashFlow — Expense Tracker

## What this project does
Personal/family expense tracker. Telegram bot UI in front of a FastAPI backend. The bot talks to the backend over HTTP only — never to the database — so a future Telegram Mini App can reuse the same API unchanged.

## Stack
- Python 3.12+, FastAPI (fully async), aiogram 3.x
- DB: Supabase (PostgreSQL) via asyncpg — raw SQL, no ORM
- Schemas: Pydantic v2 · Migrations: Alembic
- HTTP client: httpx · Tests: pytest + httpx AsyncClient
- Package manager: uv

## Commands
- Install: `uv sync`
- Backend: `uv run uvicorn main:app --reload`
- Bot: `uv run python -m bot.bot`
- Verify everything: `bash scripts/verify.sh` ← run before finishing ANY task
- Single test: `uv run pytest tests/test_x.py -k name -q`
- Alembic: `uv run alembic revision --autogenerate -m "..."` / `alembic upgrade head`
- Integration tests without a reachable local Postgres: `bash scripts/integration_docker.sh`
  (throwaway Docker Postgres, schema applied via psql — see tests/CLAUDE.md)

## Architecture map (flat layout, no `src/` wrapper)
- `models/` — Pydantic v2 schemas (Base/Create/Update/Response) — see its CLAUDE.md
- `repositories/` — raw SQL via asyncpg; only place with DB access — see its CLAUDE.md
- `services/` — business logic; DI'd repositories; triggers notifications — see its CLAUDE.md
- `api/` — FastAPI routes + PermissionChecker + auth deps — see its CLAUDE.md
- `bot/` — aiogram; pure HTTP client to the backend, zero DB imports — see its CLAUDE.md
- `migrations/` — Alembic (asyncpg env) — see its CLAUDE.md
- `tests/` — pytest; unit tests never touch network or real DB — see its CLAUDE.md
- `docs/SCHEMA.sql` — canonical DB schema (source of truth for first migration)
- `docs/STATUS.md` — manual implementation checklist (updated by the human only)
- `docs/plans/` — active work plans; the model DOES update unit checkboxes,
  Decision log and STATE there (see task-methodology skill)

## Non-negotiable rules
- No direct DB access outside `repositories/`. Routes and bot handlers must not import asyncpg.
- Layering: routes → services → repositories. No business logic in routes or repos.
- Bot is a pure HTTP client. `bot/` contains zero DB imports. Calls backend via httpx.
- Money is `BIGINT` in minor units (kopecks/cents). Never float, never numeric — including all intermediate math.
- `expenses.category_id` is NOT NULL; every account gets a seeded default "General" category (initial migration).
- Async everywhere for I/O. `async def` + `await`.
- No `print()` — use stdlib `logging`.
- Type hints on every function signature.
- Auth: bot sends `X-Telegram-User-Id: <tg_id>` AND `X-Internal-Token: <shared secret>` on every request. Backend rejects requests without a valid token (401) and derives user/account from tg_id. Never trust client-supplied UUIDs.
- Notifications are best-effort: send failures are logged and must never fail the expense operation that triggered them.

## Environment (.env)
`DATABASE_URL`, `BOT_TOKEN`, `BACKEND_BASE_URL`, `INTERNAL_TOKEN`, `ALLOWED_TG_IDS` (comma-separated tg_ids).

## Out of scope (V2)
- Voice input · Mini App frontend · Bot self-registration · OAuth/JWT (tg_id + internal token is enough for now) · Scheduled digests/APScheduler (V1 notifies on expense creation only).
- Admin panel for account/user management. PREREQUISITE: migrate the bot
  allowlist from ALLOWED_TG_IDS in .env to a DB lookup against the users
  table (one change in bot/middlewares.py). Until then, adding a user
  requires editing .env + bot restart.

## Do not edit without asking
`migrations/versions/`, `.env*`, `uv.lock`.
