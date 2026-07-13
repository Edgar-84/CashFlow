# repositories/ — data access (raw SQL via asyncpg)

<!-- Loaded only when Claude works inside repositories/. -->

## Purpose
This is the **only** layer that touches the database. Routes and bot handlers
must never import asyncpg or run queries. Services depend on repositories via
constructor injection.

## Structure
- `base.py` — `BaseRepository[T]` generic with CRUD (`get`, `list`, `create`,
  `update`, `delete`). Takes a table name and a Pydantic response model.
- One module per aggregate: `user_repo.py`, `expense_repo.py`, etc.
- Extended queries live on the specific repo (see "Query surface" below).

## Query surface (from the spec)
- `expense_repo`: `get_by_period`, `get_by_category`, `sum_by_category_month`.
- `budget_plan_repo`: `check_limit(category_id, account_id) -> float` — returns
  current fill percentage (0.0–100.0+) for the current month.
- `permission_repo`: fetch per-(user, resource) row for the auth pipeline.

## Rules
- **Raw SQL only.** No ORM, no query builder. Prepared statements via
  `conn.fetch(...)`, `conn.fetchrow(...)`, `conn.execute(...)` with `$1`, `$2`
  placeholders.
- **All I/O is async.** `async def`, `await`, no blocking calls.
- Connection is passed in via a context manager (`async with pool.acquire() as conn`).
  Repositories accept the pool or a connection — never both, pick one and stick to it.
- **Never call another repository from a repository.** No cross-repo coupling —
  services orchestrate multi-repo work.
- Return typed Pydantic response models (e.g. `ExpenseResponse`), never raw
  `Record` or `dict`. Map at the repo boundary.
- Money is `BIGINT` (minor units). Read/write as `int`.

## Error handling
- `asyncpg.PostgresError` subclasses bubble up. Do NOT wrap in generic
  `Exception`.
- Unique / FK violations that map to a domain error (e.g. duplicate budget plan)
  are translated to a domain exception here, so services can `except` on
  domain types, not driver types.

## Testing
- Repository tests hit a real Postgres (test DB or dockerized), not a mock.
  Marked `@pytest.mark.integration` if they require a live DB.
- Unit tests of services mock the repository interface.
