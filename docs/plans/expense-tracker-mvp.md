# Plan: Expense Tracker MVP (Telegram bot + FastAPI backend)

Companion to the project context doc (CLAUDE.md). This file is the work
plan: units, acceptance criteria, ordering, model routing.
Workflow per unit: /clear → /unit <id> docs/plans/expense-tracker-mvp.md
→ Stop-gate (verify.sh) → [reviewer for risky units] → human commits.

## Goal
Working family expense tracker: Telegram bot UI over an HTTP-only FastAPI
backend, permissions enforced per the two-level model, budget threshold
notifications on expense creation.

## Non-goals (V1)
Voice input, Mini App, self-registration, OAuth/JWT, scheduled digest jobs
(APScheduler removed from V1 scope — see Decision log).

## Constraints
- Architecture rules from project CLAUDE.md are law (layering, async, no ORM,
  money as BIGINT minor units, Base/Create/Update/Response).
- Bot ↔ backend only via HTTP with X-Telegram-User-Id + X-Internal-Token.
- Contracts (M0 models) are immutable for later units; changes go through
  this file's Decision log first.

---

## Milestone M0 — Foundation & contracts

- [x] **U0.1 Skeleton**: config.py (pydantic-settings incl. INTERNAL_TOKEN),
      database.py (asyncpg pool, init/close/get_connection), main.py app
      factory with lifespan, GET /health.
      AC: app boots; /health returns 200 in a test with pool mocked/test DB.
      Model: sonnet.
- [x] **U0.2 Contracts — all Pydantic models** (user, expense, category, tag,
      budget_plan, permission) in the 4-schema pattern; shared enums
      (Role, Resource, Action); typed domain errors (NotFoundError,
      PermissionDeniedError, LimitExceeded warning type).
      AC: mypy green; import-and-instantiate tests pass; expense.category_id
      REQUIRED (decision D2).
      Model: sonnet. ⚠ Human-review this diff — it locks the architecture.
- [x] **U0.3 Initial migration**: full schema + indexes
      expenses(account_id, created_at), expenses(category_id),
      expense_tags(tag_id); categories.id referenced with ON DELETE RESTRICT.
      AC: alembic upgrade head on a clean DB, then downgrade base, both clean.
      Model: sonnet (mechanical — haiku acceptable).
- [x] **U0.4 Test infrastructure**: conftest.py — async httpx client fixture,
      test-DB fixture with per-test transaction rollback, factory helpers
      (make_user/make_expense).
      AC: one dummy repo-less test and one DB round-trip test pass;
      pytest markers registered.
      Model: sonnet.

## Milestone M1 — Data layer (repositories)

- [ ] **U1.1 BaseRepository[T] + user_repo**.
      AC: generic CRUD integration tests via test DB (create/get/update/delete).
- [ ] **U1.2 category_repo + tag_repo**.
      AC: CRUD tests + unique-per-account behavior documented in tests.
- [ ] **U1.3 expense_repo** incl. expense_tags junction handling,
      get_by_period, get_by_category, sum_by_category_month.
      AC: aggregation tests on seeded fixture data (known sums, month
      boundaries, timezone-safe created_at filtering).
- [ ] **U1.4 budget_plan_repo + check_limit** → returns fill percent
      computed in SQL from BIGINT sums (no float money math).
      AC: parametrized tests — no plan, 0%, exactly threshold, >100%.
      RISKY → reviewer subagent.
- [ ] **U1.5 permission_repo**.
      AC: CRUD + UNIQUE(user_id, resource) conflict test.
Model for M1: sonnet throughout.

## Milestone M2 — Auth, permissions, services, API

- [ ] **U2.1 deps.py: get_current_user + PermissionChecker** implementing the
      6-step enforcement order from CLAUDE.md, plus X-Internal-Token check
      (decision D1).
      AC: parametrized test grid over the full default matrix
      (3 roles × 4 resources × 4 actions) + own_only cases + override-row
      cases + viewer-cannot-be-overridden case + missing/bad token → 401.
      MOST COMPLEX LOGIC IN PROJECT → /effort high, reviewer subagent,
      human reads the diff.
- [ ] **U2.2 users: service + API** (admin-only CRUD).
      AC: route tests incl. member/viewer → 403.
- [ ] **U2.3 categories + tags: services + API**.
      AC: HTTP CRUD tests; RESTRICT delete returns clean 409 with message.
- [ ] **U2.4 expenses: service (CRUD only, no notification yet) + API**.
      AC: create/list/update/delete via HTTP; own_only enforced (member
      can't update someone else's expense); tag attach/detach works.
- [ ] **U2.5 budgets: budget_service (progress calc — pure logic) + API**.
      AC: progress/summary math in parametrized unit tests (int math only).
- [ ] **U2.6 statistics_service + API**.
      AC: by-period / by-category / by-tag aggregates match seeded data.
Model for M2: sonnet; U2.1 with /effort high.

## Milestone M3 — Business logic wiring

- [ ] **U3.1 notification_service + trigger in ExpenseService.create**.
      Send via httpx to Bot API; failure MUST NOT fail expense creation
      (decision D3): wrap in try/except with logged error.
      AC: fake transport tests — threshold crossed → message sent exactly
      once; below threshold → nothing; transport error → expense still
      created, error logged.
      RISKY → reviewer subagent.

## Milestone M4 — Bot

- [ ] **U4.1 client.py + middlewares**: httpx wrapper (all API calls),
      allowlist middleware, header injection (tg_id + internal token).
      AC: unit tests with mocked transport (respx); non-allowlisted tg_id
      is dropped before any API call.
- [ ] **U4.2 Bot skeleton**: bot.py dispatcher, states.py, keyboards.py.
      AC: dispatcher builds; keyboards render expected callback_data.
      Model: haiku-friendly (boilerplate).
- [ ] **U4.3 handlers/expenses — FSM add-expense flow**
      (category → amount → optional comment/tag → confirm) + list view.
      AC: FSM walkthrough test with fake API client: happy path, cancel
      mid-flow, invalid amount input re-prompts. Amount parsed to minor
      units in ONE helper with its own tests (comma/dot, "1 234,56").
      Largest bot unit — split list view into U4.3b if diff exceeds budget.
- [ ] **U4.4 handlers/categories + tags**.
      AC: CRUD flows against fake API; permission-denied from API rendered
      as a human message, not a stack trace.
- [ ] **U4.5 handlers/budgets + statistics rendering**.
      AC: rendering tests on fixed API responses (progress bars, totals
      formatted from minor units).
Model for M4: sonnet; repetitive handler/keyboard parts → haiku.

## Milestone M5 — Smoke

- [ ] **U5.1 e2e smoke (@integration)**: bot client → real API → test DB:
      add expense → appears in list → budget threshold notification fired.
      AC: scenario green on test DB; run excluded from default verify.sh
      (integration marker).

---

## Risks
- Permission matrix subtleties (own_only vs override rows) — mitigated by
  the U2.1 test grid; do not hand-wave any cell.
- Timezone handling in period aggregation (TIMESTAMPTZ vs "current month"
  for the family's local time) — decide in U1.3, record in Decision log.
- Supabase connection pooling (pgbouncer) vs asyncpg prepared statements —
  if connection errors appear in U0.4, set statement_cache_size=0.

## Decision log
- D1 (plan review): bot→backend requests carry X-Internal-Token shared
  secret; backend rejects requests without it. Rejected: exposing backend
  with tg_id header only — spoofable by anyone with the URL.
- D2 (plan review): expenses.category_id is NOT NULL; a default "General"
  category is seeded per account in the initial migration. Rejected:
  nullable category — complicates stats and budget matching.
- D3 (plan review): notification send is best-effort; failures logged,
  never propagate to expense creation. Rejected: synchronous hard fail.
- D4 (plan review): APScheduler dropped from V1; threshold notifications
  fire on create only. Rejected: scheduled digests — no V1 requirement.
- D5 (plan review): category delete = ON DELETE RESTRICT + API returns 409.
  Rejected: SET NULL (contradicts D2), soft delete (V2 complexity).
- D6 (U0.1): added `pythonpath = ["."]` and an `asyncpg.*` mypy override to
  pyproject.toml. Required for the flat layout (no `src/`) to let pytest
  import root modules (`main`, `database`, `config`) and for mypy to accept
  asyncpg's missing type stubs. Not a contract change — tooling config only.
- D7 (U0.2): added `models/__init__.py` (empty). Without it, mypy scanning
  `.` resolved `models/tag.py` under two module names ("tag" and
  "models.tag") and failed with a duplicate-module error. Tooling fix only;
  other currently-empty packages (`repositories/`, `services/`, `api/`,
  `bot/`) will need the same `__init__.py` once they gain `.py` files.
- D8 (U0.2): `Resource.BUDGET_PLANS` enum value is `"budget_plans"`, matching
  the table name. SCHEMA.sql's comment on `permissions.resource` lists
  `budgets` instead — that comment is stale/inconsistent with the actual
  table name `budget_plans`; the table name was treated as authoritative.
  Flag if `permissions.resource` ever needs to literally read `"budgets"`.
- D9 (U0.2): `LimitExceeded` implemented as `LimitExceededWarning(DomainError)`
  in `models/errors.py` — a typed signal for "budget threshold crossed", not
  necessarily raised to abort a request (consistent with D3: notification
  failures/threshold crossings must never fail expense creation). Services
  wiring this up (M3) decide whether it's raised-and-caught or just
  constructed and passed to notification_service.
- D11 (U0.3): `docs/SCHEMA.sql` gained explicit `ON DELETE RESTRICT` on the
  two FKs to `categories(id)` (`expenses.category_id`, `budget_plans.category_id`)
  to match D5 and the "never rely on the FK default" rule in
  `migrations/CLAUDE.md`, plus the three indexes named in this unit's AC
  (`ix_expenses_account_id_created_at`, `ix_expenses_category_id`,
  `ix_expense_tags_tag_id`). Scope was kept to exactly what D5/the AC called
  for — the other FKs (`account_id`, `user_id` refs) still rely on the
  Postgres default (`NO ACTION`), which is a latent inconsistency with
  `migrations/CLAUDE.md`'s explicit-`ON DELETE` rule; not fixed here since
  choosing CASCADE/RESTRICT for each is an unreviewed architecture call
  beyond this unit's budget. Flag before or during M1 (repositories touch
  delete behavior directly).
- D10 (post-U0.2 correction): added `updated_at TIMESTAMPTZ DEFAULT now()` to
  `expenses` and `budget_plans` in `docs/SCHEMA.sql`, plus a `set_updated_at()`
  trigger function and a `BEFORE UPDATE` trigger on each table (DB-maintained,
  app code must never set it). `models/CLAUDE.md` updated to require the field
  on `ExpenseResponse`/`BudgetPlanResponse` only, never `Create`/`Update`.
  Contract change to already-reviewed U0.2 output. Follow-up applied same
  session: `ExpenseResponse`/`BudgetPlanResponse` gained `updated_at: datetime`
  (required, no default — matches "trigger always sets it"); `tests/test_models.py`
  updated, incl. a case proving each `Response` rejects a payload missing
  `updated_at`.
- D12 (U0.3 review fixes): three findings from PR review, all fixed same
  session:
  1. BLOCKER — `expenses.category_id` was missing `NOT NULL` in both
     `docs/SCHEMA.sql` and the migration (copy-paste of a pre-existing gap
     in the canonical SQL). This directly contradicted D2 and the
     non-negotiable rule in root `CLAUDE.md` ("`expenses.category_id` is
     NOT NULL") — `models/expense.py`'s `ExpenseBase.category_id: UUID`
     (non-optional) already assumed this was enforced at the DB level.
     Fixed in both files.
  2. Downgrade correctness was untested against a real DB (offline `--sql`
     mode only proves syntax, not that Postgres accepts it). Fixed by
     adding an "upgrade head → downgrade base → upgrade head" round-trip
     step to CI's `integration` job (`.github/workflows/ci.yml`), ahead of
     the "Run integration tests" step — closed now rather than deferred to
     U0.4.
  3. NIT — `migrations/env.py`'s `target_metadata = None` means
     `alembic revision --autogenerate` can never detect a diff (no ORM
     layer to diff against, by design — raw SQL, no ORM). Documented in
     `migrations/CLAUDE.md`: autogenerate is not usable in this project,
     every migration uses the blank-revision + hand-written `op.execute()`
     path.

- D13 (U0.4): `tests/conftest.py`'s env-defaults fixture only sets a var via
  `monkeypatch.setenv` when it isn't already present in `os.environ`
  (`os.environ.get(key, default)`), instead of unconditionally overwriting
  it as `test_health.py`'s old local fixture did. Required so the same
  autouse fixture can be shared by every test: in CI's `integration` job the
  real `DATABASE_URL`/`INTERNAL_TOKEN`/etc. are already exported by the
  workflow, and unconditional overwrite would have clobbered them with the
  dummy unit-test values. `db_pool` (session-scoped asyncpg pool) similarly
  reads `os.environ.get("DATABASE_URL", ...)` directly rather than going
  through `get_settings()`, avoiding a session/function fixture-scope
  mismatch with the (function-scoped) monkeypatch env fixture; its fallback
  DSN matches the CI `integration` job's postgres service
  (`postgresql://postgres:postgres@localhost:5432/cashflow_test`) so
  `pytest -m integration` also works against a local docker Postgres with no
  extra config. Not a contract change — test tooling only.
- D14 (U0.4): `tests/factories.py` helpers (`make_account`, `make_category`,
  `make_user`, `make_expense`) insert directly via raw `asyncpg` SQL rather
  than going through a repository layer, since `repositories/` doesn't exist
  yet (M1). They return the Pydantic `Response` models via
  `model_validate(dict(row))`. Once M1 lands real repos, M1 tests may prefer
  calling repos directly; these factories stay useful as thin DB-seeding
  helpers for tests that aren't testing the repo itself (e.g. service/API
  tests in M2+).
- D15 (U0.4): `tests/test_sanity.py` (the pre-U0.4 bootstrap placeholder)
  deleted per its own comment now that real coverage exists
  (`test_health.py` via the new `client` fixture = the "dummy repo-less"
  case; `test_db_roundtrip.py` = the DB round-trip case).

- D16 (U0.4 PR #4 CI fix): CI's `integration` job failed
  `test_expense_round_trip` with
  `asyncpg.exceptions._base.InterfaceError: cannot perform operation:
  another operation is in progress` (root cause:
  `RuntimeError: ...Future ... attached to a different loop`). Cause:
  `db_pool` was session-scoped but `pytest-asyncio` gives each async test
  its own event loop by default, so the pool's connections were bound to
  one test's loop and broke when reused from another. Fixed by switching
  `db_pool`/`db_conn` in `tests/conftest.py` to
  `pytest_asyncio.fixture(..., loop_scope="session")`, and marking
  `test_expense_round_trip` with `@pytest.mark.asyncio(loop_scope="session")`
  — scoped to just the integration fixtures/test, not a global
  `asyncio_default_fixture_loop_scope` change, so unit tests are
  unaffected. Not yet confirmed green in CI (pushed for re-run).

## STATE (handoff)
- Done: U0.1 (config.py, database.py, main.py app factory + /health,
  tests/test_health.py). U0.2 (models/enums.py, models/errors.py,
  models/{user,category,tag,expense,budget_plan,permission}.py,
  models/__init__.py, tests/test_models.py), incl. the D10 `updated_at`
  follow-up on `ExpenseResponse`/`BudgetPlanResponse`; human-reviewed. U0.3
  (alembic.ini, migrations/env.py — async engine built from
  `config.get_settings().database_url`, driver rewritten to
  `postgresql+asyncpg://` — migrations/script.py.mako (`file_template` in
  alembic.ini prefixes future revisions with a sortable date/time),
  migrations/versions/2026_07_14_2005-1fd1bea5a842_initial_schema.py —
  full schema as raw
  `op.execute()` DDL: all 8 tables, the 3 indexes, `set_updated_at()` +
  both triggers; `docs/SCHEMA.sql` updated to match, D11). Review fixes
  applied same session (D12): `expenses.category_id NOT NULL` restored,
  CI now round-trips upgrade/downgrade/upgrade against real Postgres,
  `migrations/CLAUDE.md` documents autogenerate as unusable here.
  verify.sh green.
- Done: U0.4 (tests/conftest.py — `_test_env` autouse fixture, `app`/`client`
  fixtures [mocked pool, ASGITransport], `db_pool`/`db_conn` fixtures [real
  asyncpg pool, per-test transaction + rollback]; tests/factories.py —
  `make_account`/`make_category`/`make_user`/`make_expense` raw-SQL seed
  helpers; tests/test_health.py simplified to use the `client` fixture
  [the dummy repo-less test]; tests/test_db_roundtrip.py added
  [`@pytest.mark.integration`, full account→category→user→expense insert +
  read-back]; tests/test_sanity.py deleted, D13-D15). verify.sh green.
- Next: M1 — U1.1 BaseRepository[T] + user_repo.
- Gotchas: update project CLAUDE.md status checklist manually (per its own
  rule); keep amounts int-only end to end — bot parses user input to minor
  units immediately. No `.env` file exists yet — tests set env vars directly
  via monkeypatch; real `.env` still needed before running the app/bot for real.
  New packages under repositories/services/api/bot will need an empty
  `__init__.py` each (see D7) or mypy will fail with duplicate-module errors.
  `docs/seed.sql` now exists (manual account/user onboarding, V1 has no
  self-registration) — matches the Account-model deferral below.
  No local Postgres/docker was available in this session either (Docker
  Desktop installed but its daemon wasn't running) — `test_db_roundtrip.py`
  was verified by collection only (`pytest -m integration --collect-only`,
  confirms imports/fixtures wire up) and manual review, NOT executed against
  a live DB locally. First CI run of PR #4's `integration` job caught a real
  bug (D16, event-loop scope mismatch on `db_pool`) — fixed same session,
  still unconfirmed green in CI as of this handoff since Docker remained
  unavailable locally for a live re-check; confirm the re-run passes.
  See D11 for the FK `ON DELETE` gap left for
  M1 to pick up.


## Deferred decisions (tracked, not forgotten)
- Account Pydantic model: intentionally absent in V1. Accounts are seeded
  via docs/seed.sql. Trigger to add: first service needing a typed account
  row, or V2 self-registration. See models/CLAUDE.md.
- Bot allowlist in .env: replace with users-table lookup before building
  the admin panel. See root CLAUDE.md → Out of scope.
