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
- `budget_plan_repo`: `check_limit(account_id, category_id, *, start, end) -> float | None`
  — fill percentage (0.0–100.0+) for the given period; `None` if no plan
  exists for that (account, category). Takes explicit tz-aware bounds from
  the caller rather than computing "current month" internally, same as
  `expense_repo`'s period methods (see plan Decision log D20) — the repo has
  no notion of the family's local timezone.
- `permission_repo`: fetch per-(user, resource) row for the auth pipeline.

## Connection & transaction model (how it works today)
- One `asyncpg.Pool` for the whole app, created in `main.py`'s lifespan via
  `database.init_pool(...)` and closed on shutdown. `database.get_pool()`
  raises if called before init (e.g. in unit tests that never touch the DB).
- Per HTTP request: `database.get_connection` is a FastAPI generator
  dependency — it acquires one connection from the pool, yields it, and
  releases it back when the response is done. FastAPI caches dependency
  results per request, so **every repository built for one request (in
  `api/deps.py`) shares the same connection**.
- There is **no request-wide transaction and no Unit-of-Work layer** (plan
  Decision log D31): each statement autocommits. Atomicity is a repository-
  level concern — any repo method with more than one write wraps them in
  `async with self._conn.transaction():` (see Rules below).
- Cross-service flows are deliberately non-atomic: a failed notification
  must never roll back the expense that triggered it (root CLAUDE.md
  invariant).
- If a genuinely atomic cross-repo write appears (expected first: V2 bot
  self-registration), introduce a small UoW or a transactional variant of
  `get_connection` then — see D31. Do not add request-wide transactions
  preemptively.

## Rules
- **Raw SQL only.** No ORM, no query builder. Prepared statements via
  `conn.fetch(...)`, `conn.fetchrow(...)`, `conn.execute(...)` with `$1`, `$2`
  placeholders.
- **All I/O is async.** `async def`, `await`, no blocking calls.
- Repositories take a **live `asyncpg.Connection`** in the constructor (the
  choice made in U1.1's `BaseRepository`), never the pool — acquiring from
  the pool is the caller's job (`database.get_connection` in production,
  fixtures in tests).
- **Never call another repository from a repository.** No cross-repo coupling —
  services orchestrate multi-repo work.
- Return typed Pydantic response models (e.g. `ExpenseResponse`), never raw
  `Record` or `dict`. Map at the repo boundary.
- Money is `BIGINT` (minor units). Read/write as `int`.
- SQL aggregates (`SUM`, `AVG`, ...) can change asyncpg's returned type even
  for `BIGINT`/money columns — `SUM(bigint)` is promoted to `numeric` by
  Postgres to avoid overflow, so asyncpg returns `decimal.Decimal`, not `int`.
  Always cast aggregates back explicitly (`SUM(amount)::bigint`) before
  returning from a repository method.
- Any repository method that performs more than one write statement (e.g. an
  insert plus junction-table rows, or a delete-then-reinsert) must wrap them
  in `async with self._conn.transaction():`. asyncpg does not implicitly
  group separate `fetchrow`/`execute`/`executemany` calls into one
  transaction — a constraint violation partway through would otherwise leave
  a partial write. asyncpg nests this as a `SAVEPOINT` when already inside a
  transaction, so it composes safely with tests' per-test transaction
  fixture.

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
