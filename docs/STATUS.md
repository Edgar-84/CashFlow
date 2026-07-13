# CashFlow — Implementation Status

Update this checklist manually after each completed session. Do not ask Claude
to update it — the root `CLAUDE.md` doesn't reference this file for autoloading.

## V1 — MVP

- [ ] `config.py` — pydantic-settings, loads `.env`
- [ ] `database.py` — asyncpg pool: `init_db()`, `close_db()`, `get_connection()`
- [ ] `main.py` — FastAPI app factory, lifespan events (pool + scheduler)
- [ ] `models/` — Pydantic v2 schemas (User, Expense, Category, Tag, BudgetPlan, Permission)
- [ ] `migrations/` — Alembic env (asyncpg) + initial migration from `docs/SCHEMA.sql`
- [ ] `repositories/` — BaseRepository + one per entity, plus extended queries
- [ ] `services/` — expense, budget, statistics, notification
- [ ] `api/` — deps (auth + PermissionChecker) + routers for all resources
- [ ] `bot/` — client, middlewares, keyboards, states, handlers (expenses first)
- [ ] `tests/` — permissions, expenses, budgets, notification flow
- [ ] `pyproject.toml` — dependencies, ruff/mypy/pytest config, markers registered
- [ ] `scripts/verify.sh` green end-to-end

## V2 (out of scope for now)

- [ ] Voice input parsing (leave `# TODO: V2` stubs in bot handlers).
- [ ] Telegram Mini App frontend (reuses the same API — no backend changes).
- [ ] User self-registration via bot.
- [ ] OAuth / JWT (tg_id header is enough for V1).
