# tests/ — pytest conventions (project-specific)

<!-- Loaded only when Claude works inside tests/. Complements the global
     `testing` skill; anything below overrides or specializes that skill. -->

## Runner
- Fast unit suite: `uv run pytest -q -m "not integration"`.
- Full suite (needs DB): `uv run pytest -q`.
- Integration tests, no reachable Postgres (e.g. local `alembic upgrade head`
  broken — see plan Decision log D18): `bash scripts/integration_docker.sh`.
  Spins up a throwaway `postgres:16` container, applies `docs/SCHEMA.sql`
  directly via `psql` (bypassing Alembic), runs `pytest -m integration`, and
  always removes the container on exit (trap on EXIT — safe to re-run,
  leaves nothing behind). Extra args pass through to pytest, e.g.
  `bash scripts/integration_docker.sh -k test_category_repo`.

## Markers (register in `pyproject.toml`)
- `integration` — requires a live Postgres. Skipped in fast runs and in the
  verify.sh gate.
- `slow` — long-running (e.g. scheduler tick tests).

## Layout
- `conftest.py` — session-scoped fixtures:
  - `app` — FastAPI app factory (with test settings).
  - `client` — `httpx.AsyncClient(transport=ASGITransport(app=app))`.
  - `db_pool` — asyncpg pool bound to a test DB (integration only).
- One test file per API resource / service: `test_expenses.py`,
  `test_budgets.py`, `test_permissions.py`, ...

## Rules
- Unit tests are **hermetic**: no network, no real Postgres, no real Telegram.
- Repository interfaces are **protocols/duck-typed** — services take them as
  constructor args, tests pass fakes. Do NOT patch asyncpg internals.
- Bot handlers are tested by mocking `BackendClient` — never a live backend.
- Auth: `PermissionChecker` gets a stub `User` from a fixture; permission
  matrix cases are parametrized.
- **Test behavior, not implementation.** Assert on returned models and
  observable side effects (e.g. `notification_service.send` called), not on
  which private method ran first.
- A failing test may be revealing a real bug — investigate before weakening
  the assertion. Never weaken a test just to make verify.sh pass.

## Money assertions
Always compare `int` minor units directly. If a test writes `1000` it means
10.00 in display. Never `pytest.approx` on money.

## Priority coverage
1. `PermissionChecker` — every row of the default matrix, plus at least one
   override case.
2. Budget-threshold notifications — fires exactly when `fill_pct >= threshold`,
   idempotent, does NOT roll back the expense on failure.
3. Money math — no floating-point drift in aggregates.
