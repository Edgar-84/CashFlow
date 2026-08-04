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
- Docker, local full stack: `docker compose up --build`
  (db → alembic migrate → api on :8000 → bot; overrides DATABASE_URL/BACKEND_BASE_URL,
  rest read from `.env`)
- Docker, production (AWS, from master): `docker compose -f docker-compose.prod.yml up -d --build`
  (no db container — DATABASE_URL must point at Supabase's session pooler; no published ports)
- Mini App (dev): `cd webapp && pnpm dev` · build: `pnpm build` · its own
  checks: `pnpm typecheck && pnpm lint && pnpm test` (all three also run from
  `scripts/verify.sh`)

## Architecture map (flat layout, no `src/` wrapper)
- `models/` — Pydantic v2 schemas (Base/Create/Update/Response) — see its CLAUDE.md
- `repositories/` — raw SQL via asyncpg; only place with DB access — see its CLAUDE.md
- `services/` — business logic; DI'd repositories; triggers notifications — see its CLAUDE.md
- `api/` — FastAPI routes + PermissionChecker + auth deps — see its CLAUDE.md
- `bot/` — aiogram; pure HTTP client to the backend, zero DB imports — see its CLAUDE.md
- `webapp/` — Telegram Mini App (TS + Vite); second HTTP-only client, zero
  secrets, zero business logic — see its CLAUDE.md and `docs/design/mini-app-ux.md`
- `migrations/` — Alembic (asyncpg env) — see its CLAUDE.md
- `tests/` — pytest; unit tests never touch network or real DB — see its CLAUDE.md
- `docs/SCHEMA.sql` — canonical DB schema (source of truth for first migration)
- `docs/STATUS.md` — manual implementation checklist (updated by the human only)
- `docs/plans/` — active work plans; the model DOES update unit checkboxes,
  Decision log and STATE there (see task-methodology skill)
- `docs/ui/` — **source of truth for appearance and interaction**:
  `design-system.md` (tokens), `screens/`, `components/`, `refs/` (committed
  reference screenshots). Written by the `ui-spec` skill, corrected by the human

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
- The Mini App authenticates with Telegram-signed `initData` instead — a second,
  additive auth path; the bot's header pair is never changed or replaced.
  `INTERNAL_TOKEN` (and every other secret) must NEVER reach browser-shipped
  code; `scripts/verify.sh` greps the webapp build output and fails on a hit.
- Notifications are best-effort: send failures are logged and must never fail the expense operation that triggered them.
- UI values are **taken from `docs/ui/design-system.md`, never invented**. A hex
  literal, a font size or a radius that is not in that file does not go into
  CSS — extend the design system first. Any change to visual behaviour updates
  its spec under `docs/ui/` in the **same change** as the code, and `ui-spec`
  runs before task-methodology on frontend work (screenshots are not a spec).

## Environment (.env)
`DATABASE_URL`, `BOT_TOKEN`, `BACKEND_BASE_URL`, `INTERNAL_TOKEN`, `FAMILY_TZ`.
Mini App adds: `MINI_APP_URL` (the bot's link to it), `INITDATA_MAX_AGE_SEC`.
Backend-only — none of them are secrets, and none are injected into the
browser bundle. No CORS variable: the Mini App is served from the same
origin as the API (D201). Currency is **not** an env var — it's a per-account
`accounts.currency` column (`models.enums.Currency`, D211), set at account
creation (see api/CLAUDE.md's "Adding users manually").
One `.env` per machine, never committed; no `.env.dev`/`.env.prod` variants —
dev vs prod values (incl. the separate dev bot token) are documented in
README "Environments & .env".

## Out of scope (V2)
- Voice input · Bot self-registration · OAuth/JWT (tg_id + internal token is enough for now) · Scheduled digests/APScheduler (V1 notifies on expense creation only).
- The Mini App frontend is no longer out of scope — it is being planned in
  `docs/design/mini-app-ux.md`. Its §0 decisions (D200–D205) gate implementation.
- Admin panel for account/user management. Its prerequisite — migrating the
  bot allowlist from an `.env` var to a DB lookup — is DONE
  (`docs/plans/bot-allowlist-db.md`): adding a family member is now one
  `INSERT` into `users`, no `.env` edit, no bot restart. When this panel
  lands, account creation should let the user pick `accounts.currency`
  (D211) instead of the manual SQL `INSERT` being the only way to set it.

## Do not edit without asking
`migrations/versions/`, `.env*`, `uv.lock`, `webapp/pnpm-lock.yaml`.
