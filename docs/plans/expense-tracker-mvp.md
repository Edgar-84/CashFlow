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

- [x] **U1.1 BaseRepository[T] + user_repo**.
      AC: generic CRUD integration tests via test DB (create/get/update/delete).
- [x] **U1.2 category_repo + tag_repo**.
      AC: CRUD tests + unique-per-account behavior documented in tests.
- [x] **U1.3 expense_repo** incl. expense_tags junction handling,
      get_by_period, get_by_category, sum_by_category_month.
      AC: aggregation tests on seeded fixture data (known sums, month
      boundaries, timezone-safe created_at filtering).
- [x] **U1.4 budget_plan_repo + check_limit** → returns fill percent
      computed in SQL from BIGINT sums (no float money math).
      AC: parametrized tests — no plan, 0%, exactly threshold, >100%.
      RISKY → reviewer subagent.
- [x] **U1.5 permission_repo**.
      AC: CRUD + UNIQUE(user_id, resource) conflict test.
Model for M1: sonnet throughout.

## Milestone M2 — Auth, permissions, services, API

- [x] **U2.1 deps.py: get_current_user + PermissionChecker** implementing the
      6-step enforcement order from CLAUDE.md, plus X-Internal-Token check
      (decision D1).
      AC: parametrized test grid over the full default matrix
      (3 roles × 4 resources × 4 actions) + own_only cases + override-row
      cases + viewer-cannot-be-overridden case + missing/bad token → 401.
      MOST COMPLEX LOGIC IN PROJECT → /effort high, reviewer subagent,
      human reads the diff.
- [x] **U2.2 users: service + API** (admin-only CRUD).
      AC: route tests incl. member/viewer → 403.
- [x] **U2.3 categories + tags: services + API**.
      AC: HTTP CRUD tests; RESTRICT delete returns clean 409 with message.
- [x] **U2.4 expenses: service (CRUD only, no notification yet) + API**.
      AC: create/list/update/delete via HTTP; own_only enforced (member
      can't update someone else's expense); tag attach/detach works.
- [x] **U2.5 budgets: budget_service (progress calc — pure logic) + API**.
      AC: progress/summary math in parametrized unit tests (int math only).
- [x] **U2.6 statistics_service + API**.
      AC: by-period / by-category / by-tag aggregates match seeded data.
Model for M2: sonnet; U2.1 with /effort high.

## Milestone M3 — Business logic wiring

- [x] **U3.1 notification_service + trigger in ExpenseService.create**.
      Send via httpx to Bot API; failure MUST NOT fail expense creation
      (decision D3): wrap in try/except with logged error.
      AC: fake transport tests — threshold crossed → message sent exactly
      once; below threshold → nothing; transport error → expense still
      created, error logged.
      RISKY → reviewer subagent.

## Milestone M4 — Bot

- [x] **U4.1 client.py + middlewares**: httpx wrapper (all API calls),
      allowlist middleware, header injection (tg_id + internal token).
      AC: unit tests with mocked transport (respx); non-allowlisted tg_id
      is dropped before any API call.
- [x] **U4.2 Bot skeleton**: bot.py dispatcher, states.py, keyboards.py.
      AC: dispatcher builds; keyboards render expected callback_data.
      Model: haiku-friendly (boilerplate).
- [x] **U4.3 handlers/expenses — FSM add-expense flow**
      (category → amount → optional comment/tag → confirm) + list view.
      AC: FSM walkthrough test with fake API client: happy path, cancel
      mid-flow, invalid amount input re-prompts. Amount parsed to minor
      units in ONE helper with its own tests (comma/dot, "1 234,56").
      Largest bot unit — split list view into U4.3b if diff exceeds budget.
- [x] **U4.3b handlers/expenses — list view** (split from U4.3, D39):
      `/expenses` command rendering the account's expenses from
      `client.list_expenses()`, minor-units formatted for display.
      AC: rendering tests against a fake API client — non-empty list,
      empty list, comment shown when present.
- [x] **U4.4 handlers/categories** (split from "categories + tags", D41):
      list/add/rename/delete flows against fake API; permission-denied from
      API rendered as a human message, not a stack trace.
- [ ] **U4.4b handlers/tags** (split from U4.4, D41): mechanical mirror of
      U4.4 for tags — list/add/rename/delete against fake API,
      permission-denied rendered as a human message.
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

- D17 (U1.1): `BaseRepository[T]` takes a live `asyncpg.Connection` (not a
  `Pool`) in its constructor — chosen so repo instances can be handed the
  same connection `tests/conftest.py`'s `db_conn` fixture already opened a
  transaction on (U0.4's per-test rollback isolation pattern). If repos
  acquired their own connection from a pool internally, repo queries
  wouldn't participate in that transaction and test isolation would break.
  Production call sites (services, via a future FastAPI dependency) get a
  connection per request from `database.get_connection()` and construct the
  repo with it. `get`/`update` return `T | None` (not-found is not
  exceptional at this layer — services decide whether to raise
  `NotFoundError`); `create`/`update` take `dict[str, Any]` (callers pass
  `Create`/`Update.model_dump(exclude_unset=True)`); `delete` returns `bool`.
  `list(**filters)` does simple equality AND-filtering, sufficient for the
  generic case — richer queries (joins, aggregates) live on the concrete
  repo per repositories/CLAUDE.md's "Query surface", not here.
- D19 (U1.2): `docs/SCHEMA.sql` has no `UNIQUE(account_id, name)` constraint
  on `categories` or `tags` — the AC's "unique-per-account behavior
  documented in tests" is satisfied by a test that proves and documents the
  *actual* (unenforced) behavior (duplicate names within one account
  currently succeed), not by adding a DB constraint. No migration touched —
  `migrations/versions/` is in root CLAUDE.md's do-not-edit-without-asking
  list, and adding a real constraint is an unreviewed schema change beyond
  this unit's scope. Flag before any upstream code (service layer) assumes
  category/tag names are unique per account — they are not, at the DB level,
  today.
- D20 (U1.3): `ExpenseRepository.get_by_period`/`sum_by_category_month` take explicit
  tz-aware `start`/`end` datetime bounds from the caller rather than computing
  "current month" internally — the repo has no notion of the family's local
  timezone (not in config), so pushing boundary computation to the caller
  (future `statistics_service`/`budget_service`) keeps the repo timezone-
  agnostic while still being correct: TIMESTAMPTZ comparison is instant-based,
  so any tz-aware bound works regardless of the offset the caller expresses it
  in. Tested explicitly with equivalent instants expressed in different UTC
  offsets straddling a month boundary. Review follow-up (same session):
  `sum_by_category_month`'s SQL changed to `SUM(amount)::bigint AS total` —
  Postgres promotes `SUM(bigint)` to `numeric`, so asyncpg was returning
  `decimal.Decimal` instead of `int`, a real money-rule violation the
  original test didn't catch (`Decimal(3500) == 3500` passes despite the
  wrong type). Now asserted explicitly with `type(...) is int`. Also added
  account-scoping tests for `get_by_period` and `sum_by_category_month`
  (previously only `get_by_category` had one).
- D21 (U1.3): `ExpenseRepository` overrides `get`/`list`/`create`/`update` (not
  just adding new methods) to attach `tags` via a join on `expense_tags`,
  since `BaseRepository`'s generic CRUD has no notion of a junction table and
  `ExpenseResponse.tags` must be populated for these to be meaningful. `create`
  and `update` accept an optional `tag_ids` key in the input dict (matching
  `ExpenseCreate`/`ExpenseUpdate.model_dump()`); `update`'s `tag_ids` is
  replace-semantics (delete then reinsert), not a diff/merge. `delete` is not
  overridden — `expense_tags.expense_id` has `ON DELETE CASCADE` (docs/SCHEMA.sql),
  so removing the expense row is sufficient; confirmed by an explicit test.
  Review follow-up (same session): `create`/`update` now wrap their
  expense-row + junction-row writes in `async with self._conn.transaction():`
  (asyncpg nests this as a SAVEPOINT when already inside a transaction, so it
  composes safely with the test fixture's per-test transaction) — without it,
  a PK violation on a duplicate `tag_id` or an FK violation on a stale one
  would abort partway through and leave an expense created/updated with only
  some of its intended tags. Covered by
  `test_create_with_duplicate_tag_ids_rolls_back_whole_expense`.
- D22 (U1.3, mypy/runtime gotcha): defining a method literally named `list` on
  `ExpenseRepository` broke every other method's `list[...]` return-type
  annotation in the same class body — Python (and mypy, matching its scoping)
  resolves a bare name in a class body against names already bound earlier in
  that same class body before falling back to builtins, so `list[ExpenseResponse]`
  after the `list` method definition resolved to the method itself, not
  `builtins.list` (`TypeError: 'function' object is not subscriptable` at
  import time). Fixed by moving the `list` method to be the last definition in
  the class; `from __future__ import annotations` alone did not fix mypy's
  static check (it applies the same class-body scoping rule regardless).
  Flag if any future repository subclass needs a method that shadows a
  builtin used in its own class's later annotations.
- D23 (U1.4): `BudgetPlanRepository.check_limit`'s signature deviates from
  repositories/CLAUDE.md's originally-documented `check_limit(category_id,
  account_id) -> float`: now `check_limit(account_id, category_id, *, start,
  end) -> float | None`. (1) `account_id`-first parameter order matches
  `expense_repo`'s convention (`get_by_category`, `get_by_period`,
  `sum_by_category_month`). (2) Takes explicit tz-aware `start`/`end` month
  bounds from the caller instead of computing "current month" internally,
  consistent with D20 — the repo layer has no notion of the family's local
  timezone. (3) Returns `float | None`: `None` signals no `budget_plans` row
  exists for that (account, category), distinguishing "no plan" from "0%
  spent" — both are valid, distinct AC cases (parametrized tests: no plan,
  0%, exactly at `notify_threshold`, >100%). `repositories/CLAUDE.md` and
  `services/CLAUDE.md` (its notification-flow invariant referenced the old
  signature) updated to match. SQL: `COALESCE(SUM(e.amount), 0)::bigint`
  keeps the spent-total an exact `bigint` (no `Decimal` leak, per D20's
  precedent); `GROUP BY bp.id` (not `bp.amount` — grouping by a non-key
  column would silently merge/duplicate rows once a second `period` value
  exists alongside `Period = Literal["monthly"]`, a reviewer-caught latent
  bug fixed before merge, currently unreachable but cheap to close now).
  `check_limit` also returns `None` (not a `ZeroDivisionError`) for a
  non-positive `amount` — `models/budget_plan.py`'s `BudgetPlanBase.amount`
  has no positivity constraint (pre-existing model gap, not fixed here since
  `models/` is U0.2's reviewed contract and DB `CHECK` constraints require a
  migration; flagged for whoever adds `Field(gt=0)`/a schema `CHECK` later).
  Reviewed by the reviewer subagent same session (APPROVE, with WARNs — the
  `GROUP BY`/zero-amount items above fixed same session; a
  `test_duplicate_plan_raises_unique_violation` test added documenting that
  `budget_plans`' real `UNIQUE(category_id, account_id, period)` constraint
  — unlike categories/tags' unenforced case, D19 — raises a raw
  `asyncpg.UniqueViolationError`, untranslated to a domain exception, same
  pre-existing gap as every other repo today; not fixed here, flagged for
  M2 service-layer error translation).
- D24 (U1.5): `PermissionRepository.get_by_user_and_resource(user_id: UUID,
  resource: Resource) -> PermissionResponse | None` implements
  repositories/CLAUDE.md's "fetch per-(user, resource) row for the auth
  pipeline" query-surface line, which named the purpose but not an exact
  signature. Takes the `Resource` enum (not a raw `str`) to match the model
  layer (`PermissionBase.resource: Resource`); `resource.value` used for the
  SQL parameter since the `resource` column is `TEXT`. Duplicate
  `(user_id, resource)` inserts raise a raw `asyncpg.UniqueViolationError`
  (DB has `UNIQUE(user_id, resource)`, docs/SCHEMA.sql), untranslated to a
  domain exception — same pre-existing gap as `budget_plans` (D23), flagged
  again for the same M2 service-layer error-translation follow-up.
- D25 (U2.1): `api/deps.py` is the API layer's composition root — the one
  place under `api/` that imports from `repositories/`. `api/CLAUDE.md`'s
  blanket "Never import from `repositories/` here" rule contradicted the same
  doc's Structure/Auth sections (which put repo/service factories and the
  `user_repo` lookup inside `deps.py`); the rule line was clarified to
  "never in router modules; `deps.py` is the exception". `get_current_user`
  resolves tg_id via the generic `user_repo.list(tg_id=...)` filter instead
  of adding a `get_by_tg_id` method — no repo edit needed, keeps the unit
  inside `api/` + tests.
- D26 (U2.1): PermissionChecker design. The 6-step order is split into:
  `get_current_user` (step 1: `X-Internal-Token` via `secrets.compare_digest`
  + `X-Telegram-User-Id` → user, any failure → 401; the tg header is declared
  `str` and parsed by hand so a malformed value 401s instead of FastAPI's
  422), pure `resolve_permission(role, resource, action, permission_row) ->
  PermissionDecision(allowed, own_only)` (steps 2–5 — this is what the AC's
  48-cell grid tests directly), and `enforce_ownership(decision, user,
  owner_id)` (step 6 — the checker can't know the target record at
  dependency-resolution time, so `PermissionChecker.__call__` stores the
  decision on `request.state.permission_decision` and the route/service
  owning the record applies step 6; call-site choice deferred to U2.4).
  `__call__` returns the user per the api/CLAUDE.md route-pattern contract
  and accepts `Resource | str` / `Action | str` (contract shows string form).
  Literal step-order semantics locked in by tests: step 2 before 4 → an
  all-False row cannot restrict an admin; step 3 before 4 → a viewer can
  never be granted writes, but a row's `can_read=False` DOES restrict a
  viewer's reads (step 3 only blocks writes); an override row replaces role
  defaults entirely (a member can lose default expense create); in member
  defaults `own_only` applies only to expense update/delete (matrix C·R are
  unqualified). Repo factories (`get_user_repo`/`get_permission_repo`) are
  the dependency_overrides seam that keeps the unit tests hermetic.
- D27 (U2.2): `users`/`permissions` are admin-only CRUD with no override-row or
  `own_only` semantics in the matrix, and aren't in the `Resource` enum. Rather
  than extend that enum (a contract change to U0.2/U2.1's reviewed matrix
  types) or force them through `PermissionChecker`, `api/deps.py` gained a
  standalone `require_admin` dependency: authenticate via `get_current_user`,
  then a plain `role is Role.ADMIN` check, 403 otherwise. Resolves the open
  question left in U2.1's handoff note. `PermissionChecker`/`Resource` are
  unchanged.
- D28 (U2.2): added `ConflictError(DomainError)` to `models/errors.py` — no
  existing domain error fit "operation violates a uniqueness constraint".
  Anticipated by D23/D24 (repos raise raw `asyncpg.UniqueViolationError`,
  M2 services own translating it). `UserService.create` catches
  `asyncpg.UniqueViolationError` (duplicate `tg_id`, `users.tg_id UNIQUE`) and
  raises `ConflictError`; `main.py` gained its first domain-exception→HTTP
  mapping (`NotFoundError`→404, `ConflictError`→409, `PermissionDeniedError`→403,
  via `@app.exception_handler`, per api/CLAUDE.md's "global handler in
  main.py" option) since no route needed one before this unit.
- D29 (U2.2): `UserService.create`/`update`/`delete`/`get` take an explicit
  `account_id` param (the calling admin's own, from `require_admin`'s
  returned user) and ignore/override `UserCreate.account_id` even though
  that field is part of the U0.2 contract — root CLAUDE.md's "never trust
  client-supplied UUIDs" applies regardless of what the model shape allows;
  not a model change, just a service-layer rule. `get`/`update`/`delete`
  404 (not 403) when a `user_id` exists but belongs to a different account,
  so admins can't probe for other accounts' user ids. `UserService` depends
  on a `UserRepositoryProtocol` (structural, tests/CLAUDE.md's "repository
  interfaces are protocols/duck-typed"), not the concrete `UserRepository`,
  so `tests/test_user_service.py` passes an in-memory `FakeUserRepo` with no
  DB.
- D30 (U2.2 review fix): `UserService.update` filters explicit `None` values
  out of the `UserUpdate.model_dump(exclude_unset=True)` payload before
  calling the repo. Without this, `PATCH /users/{id}` with `{"name": null}` or
  `{"role": null}` reached `UserRepository.update` as `SET name = NULL`
  against `users.name`/`users.role`, both `NOT NULL` columns — an uncaught
  `asyncpg.NotNullViolationError` surfacing as an unhandled 500. Since
  neither field has a legitimate null state at the DB level, an explicit
  null is now treated the same as an omitted field (silently ignored, not a
  422) rather than adding a new domain error type for this one case. Covered
  by `test_update_explicit_null_fields_are_ignored_not_nulled`,
  `test_update_mixes_real_value_with_ignored_null` (service level) and
  `test_update_user_explicit_null_is_ignored_not_500` (API level). Found by
  a review pass on this unit's diff.
- D32 (U2.3): `CategoryService`/`TagService` follow `UserService`'s D29/D30
  patterns exactly: constructor-DI'd structural `*RepositoryProtocol`,
  `account_id` always the caller's own (never client-supplied), and
  `update()` drops explicit `None` values from the payload before calling
  the repo — `categories.name`/`tags.name` are `NOT NULL` columns with no
  "clear" semantics, same gap D30 fixed for `users.name`/`users.role`.
  `CategoryService.delete` additionally catches
  `asyncpg.ForeignKeyViolationError` (raised by `expenses.category_id`/
  `budget_plans.category_id`'s `ON DELETE RESTRICT`, D5) and translates it
  to `ConflictError`, reusing D28's domain type rather than adding a new
  one — `main.py`'s existing `ConflictError`→409 handler covers it with no
  new wiring. `TagService.delete` has no equivalent try/except:
  `expense_tags.tag_id` is `ON DELETE CASCADE` (docs/SCHEMA.sql), so a tag
  delete cannot raise a FK violation. Routes use `PermissionChecker`
  (not `require_admin` — categories/tags are in the `Resource` enum, D27
  doesn't apply) with no `enforce_ownership` call: the default matrix has
  no `own_only` concept for these two resources (api/CLAUDE.md, D26).
  `api/categories.py`/`api/tags.py`'s `PermissionChecker(...)` call sites use
  the `Resource`/`Action` enum members, not string literals — these are
  categories/tags being the first routes to actually wire `PermissionChecker`
  (U2.1 built and tested it, U2.2's `users` used `require_admin` instead).
  `api/CLAUDE.md`'s route-pattern example updated to match (enum form is now
  the documented default for new call sites; string form still supported,
  D26, and still covered by `test_permission_checker_accepts_enum_and_string_forms`).
- D31 (post-U2.2 architecture review): no Unit-of-Work / request-wide
  transaction layer in V1 — evaluated and deliberately deferred. Rationale:
  (1) UoW buys atomicity, not performance — asyncpg's pool already covers
  connection reuse, and a request-wide BEGIN/COMMIT would only hold
  connections in a transaction longer on read-only routes; (2) V1 has no
  cross-repo multi-write anywhere in the plan: multi-statement writes inside
  one repo are already wrapped in `conn.transaction()` per
  repositories/CLAUDE.md, and the one cross-service flow (expense →
  notification, U3.1) is explicitly anti-transactional (a failed send must
  NOT roll back the expense); (3) the retrofit is cheap because the
  architecture is already UoW-shaped — `database.get_connection` is a
  per-request dependency and FastAPI caches it, so all repos in one request
  already share a single connection. ADD IT WHEN the first cross-repo
  atomic write appears — expected first case: V2 bot self-registration
  (account + user + seeded "General" category + permission row must commit
  together). Implementation then: a small UoW class (connection +
  `conn.transaction()` + repo accessors) or a transactional variant of
  `get_connection`, wired in `api/deps.py`; no repo/service rewrites
  required. Current session/transaction model is documented in
  repositories/CLAUDE.md ("Connection & transaction model").
- D18 (U1.1, environment gotcha, not fixed): `alembic upgrade head` fails
  locally on this machine (macOS arm64) with
  `ValueError: the greenlet library is required...` — `uv.lock`'s
  `sqlalchemy` dependency marks `greenlet` as required only when
  `platform_machine` is `aarch64`/`x86_64`/etc., but macOS ARM reports
  `arm64`, so `uv sync` never installs it here. Pre-existing gap, unrelated
  to this unit, and `uv.lock` is in root CLAUDE.md's do-not-edit-without-asking
  list, so not fixed. CI runs on ubuntu (`x86_64`, marker matches) and is
  unaffected. Worked around for this unit's local verification only: started
  a throwaway `postgres:16` Docker container and applied `docs/SCHEMA.sql`
  directly via `psql` (bypassing Alembic) to get a real schema to run the
  new integration tests against; container removed after. Flag before
  relying on local `alembic upgrade head` again.
- D33 (U2.4): `ExpenseService` has no notion of permissions/`own_only` at all —
  unlike the U2.4 handoff note's literal wording ("the route... passes it into
  the service"), ownership enforcement (step 6) is done entirely in
  `api/expenses.py`, not the service: the route calls `service.get(...)` first
  (404 + fetches `owner_id`), then `api.deps.enforce_ownership(request.state.
  permission_decision, user, expense.user_id)` directly, then calls
  `service.update`/`service.delete`. Rejected: passing `PermissionDecision` (or
  `request`) into `ExpenseService` — `api/deps.py` imports service classes for
  its factories (`get_expense_service`), so a service importing anything from
  `api.deps` would be a circular import; passing a bare `own_only: bool` was
  also considered but decided against since `enforce_ownership` already exists,
  is unit-tested (U2.1), and raises `HTTPException` directly, which services
  must not do (services/CLAUDE.md: only domain exceptions). Net effect for
  `own_only`-gated routes (update/delete, plus the single-record `GET`): the
  target record is fetched twice (once by the route for the ownership check,
  once more inside `service.get`/`update`/`delete`) — acceptable per D31 (no
  request-wide transaction/UoW in V1, extra reads have no atomicity cost).
  `enforce_ownership` is also called on single-record `GET`, not just
  update/delete: api/CLAUDE.md's step 6 says "target record belongs to another
  user", not "only on write" — this matters if a future per-user `permissions`
  override row sets `own_only=true` for `read` (the *default* matrix only sets
  `own_only` for expense update/delete, per D26, but an override row could
  still do it for read). Review fix (same session): `GET /expenses` (list)
  initially had no ownership filtering at all — a BLOCKER, since an override
  row's `own_only` applies per (user, resource), not per action, and
  `permissions.own_only` defaults to `true` (`models/permission.py`), so any
  admin granting a member, say, `can_delete=true` on expenses without
  explicitly setting `own_only=false` would silently leave `GET /expenses`
  showing every account expense while `GET /expenses/{id}` on someone else's
  403s. Fixed: `list_expenses` reads `request.state.permission_decision` and
  filters to `user.id` when `decision.own_only` is set — `enforce_ownership`
  itself isn't reused here (it 403s against one `owner_id`; a list has no
  single target record to 403 against), so this is a plain filter, not a call
  to that function. Covered by
  `test_list_expenses_with_own_only_override_filters_to_own`.
  `ExpenseService.update` also has a
  finer-grained null-handling rule than `CategoryService`/`TagService`'s D30/
  D32 precedent: `amount`/`category_id` are `NOT NULL` (explicit null dropped,
  same as D30), but `comment` IS nullable (`docs/SCHEMA.sql`) — an explicit
  `{"comment": null}` is a real "clear the comment" and is NOT dropped, unlike
  the single-mutable-field categories/tags case where every field was
  `NOT NULL`. `tag_ids` needs no special-casing here — `ExpenseRepository`
  (U1.3, D21) already treats an explicit `null`/absent `tag_ids` identically
  ("don't touch tags"), only an explicit `[]` clears them. No new category/
  account-scoping validation added for `category_id`/`tag_ids` on create/
  update (categories/tags belonging to a foreign account are accepted without
  error, same latent gap as `budget_plans` in D23) — flagged, not fixed, since
  it's beyond this unit's AC (create/list/update/delete + own_only + tag
  attach/detach) and would be a genuinely new validation decision.

- D34 (U2.5): `BudgetService.get_progress` computes its own spent/limit percentage
  from two *existing* repo methods — `budget_plan_repo.get(id)` (limit, as `int`)
  and `expense_repo.sum_by_category_month(account_id, start, end)` (spent per
  category, as `int`, D20's `Decimal`-leak fix already applied) — rather than
  reusing `BudgetPlanRepository.check_limit` (U1.4, D23), per the plan's own
  U2.5 handoff note ("no new repo method expected"). Rejected: delegating to
  `check_limit`, whose float-only return can't power `remaining`/`spent` as
  real `int` money for the API/bot (U4.5 AC needs "totals formatted from minor
  units"), and whose `None`-for-no-plan case doesn't apply here anyway (the
  service already 404s via `get()` before computing progress). The pure
  `calculate_progress(spent, limit, notify_threshold)` function mirrors
  `check_limit`'s zero/negative-`limit` guard (`fill_pct=None`, not a
  `ZeroDivisionError`) and is fully unit-testable without a DB — this is the
  AC's "progress calc — pure logic, int math only" (parametrized in
  `tests/test_budget_service.py`: 0%, exactly at threshold, >100%, zero/negative
  limit). `get_progress`'s "current month" bounds default to UTC (`datetime.now(UTC)`,
  overridable via a `now` kwarg for tests) since `config.py` has no family-timezone
  setting yet — same gap D20/D23 already left for `expense_repo`'s period methods'
  callers; flag again if/when a family timezone is added to config.
  `BudgetService.create` also translates the real `UNIQUE(category_id, account_id,
  period)` violation to `ConflictError` (closing the D23/D24-flagged gap, following
  the D28/D32 translation pattern). `models/budget_plan.py` gained an additive
  `BudgetProgress` model (not one of the four-schema-pattern entities — a computed
  summary built directly by the service, never `from_attributes`). `api/budgets.py`
  routes are `PermissionChecker(Resource.BUDGET_PLANS, ...)`-gated with no
  `enforce_ownership` call, matching D32's categories/tags pattern — `budget_plans`
  has no `user_id` column and no `own_only` concept in the matrix.

- D35 (U2.6): `StatisticsService` (by_period/by_category/by_tag, current-month only,
  `_current_month_bounds` helper duplicated from `budget_service.py` — same
  small pure function, D34 precedent, not promoted to a shared module since
  that would touch `budget_service.py` outside this unit's scope) is built on
  a single existing repo method, `expense_repo.get_by_period` (already attaches
  tags per D21) — no new repo method needed for by-tag after all, contrary to
  the U2.5 handoff note's guess. All three aggregates are computed in Python
  from that one fetched list rather than reusing `sum_by_category_month` for
  by-category, so `own_only` filtering (see below) can apply uniformly before
  aggregation. Statistics has no `Resource` enum entry of its own — routes are
  gated by `PermissionChecker(Resource.EXPENSES, Action.READ)` since it's a
  derived read-only view over expense data, not a new resource (no `Resource`/
  matrix contract change). `StatisticsService` methods take an optional
  `user_id` filter, applied before aggregation; `api/statistics.py`'s routes
  pass `user.id` when `request.state.permission_decision.own_only` is set,
  mirroring D33's `list_expenses` own_only handling. This is a deliberate,
  narrow divergence from D33's "services have no notion of permissions" rule:
  `user_id` here is a plain data filter (like `account_id`), not a
  `PermissionDecision`/`request` object, so it doesn't reintroduce the
  circular-import or service-raises-HTTPException problems D33 rejected — and
  D33's own alternative (filter the route's returned list post-hoc) doesn't
  work here since these methods return aggregates, not raw records.

- D36 (U3.1): `NotificationService.send(user, category, fill_pct)` (services/CLAUDE.md's
  literal invariant signature) POSTs directly to the Telegram Bot API
  (`https://api.telegram.org/bot{token}/sendMessage`) via an injected
  `httpx.AsyncClient`, `chat_id=user.tg_id` — the expense creator, not every
  account member (simplest reading of "user" in the invariant; no AC calls
  for a fan-out to all admins). `ExpenseService.create` gained three new
  constructor deps (`budget_plan_repo`, `category_repo`, `notification_service`,
  all narrow Protocols per the existing pattern) and a `_check_budget_and_notify`
  step: `check_limit()` for `fill_pct`, then a second `budget_plan_repo.list(
  account_id=, category_id=)` call to recover the plan's `notify_threshold`
  (`check_limit` itself only returns the percentage, not the plan row — no
  new repo method needed, same "no new repo method expected" precedent as
  D34/D35), then `category_repo.get()` for the display name. The whole check
  (not just the HTTP send) is wrapped in `try/except Exception` — root
  CLAUDE.md's best-effort rule is applied to the entire notification path,
  not only `NotificationService.send`'s own internal try/except, so a DB
  hiccup on the budget/category lookup can't undo an already-committed
  expense either. `api/deps.py` gained an `lru_cache`d module-level
  `httpx.AsyncClient` singleton (`_http_client()`, mirrors `config.
  get_settings()`'s pattern) plus `close_http_client()`, called from `main.py`'s
  lifespan `finally` alongside `database.close_pool()` — a full
  lifespan-managed client (like `database.py`'s pool) was initially skipped
  as unnecessary for V1's request volume, then added back in review to avoid
  an unclosed client at process shutdown.
  Reviewed by the reviewer subagent same session (REQUEST_CHANGES — BLOCKER:
  `httpx.HTTPStatusError`'s own message embeds the full request URL, which
  contains the live bot token (`/bot{token}/sendMessage`); the original
  `logger.exception(...)` logged that message verbatim, leaking the token to
  wherever logs ship. Fixed same session: `NotificationService.send` now
  catches `HTTPStatusError` separately and logs only `response.status_code`
  plus structured `extra={tg_id, category_id, fill_pct}` — never `exc`/`str(exc)`
  — with a regression test (`test_send_on_http_status_error_never_logs_the_bot_token`)
  asserting a planted secret token never appears in any log record. WARNs
  fixed same session: the `_http_client()` singleton is now closed via
  `close_http_client()`; `plans[0]`/`category_repo.get()`'s reliance on
  `check_limit`'s prior account+category scoping is now commented in place;
  logging switched to `extra={...}` per services/CLAUDE.md's structured-fields
  convention. WARN not fixed, flagged for a future unit: `check_limit()` +
  `list()` are two separate `budget_plan_repo` round trips per expense create
  to recover `notify_threshold` — harmless today [worst case: a skipped or
  stale-threshold notification, never a money-correctness bug] but an
  avoidable extra query on the hot `POST /expenses` path; consider folding
  `notify_threshold` into `check_limit`'s return in a later unit).

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
- Done: U1.1 (repositories/base.py — `BaseRepository[T]` generic CRUD
  [get/list/create/update/delete] over a live `asyncpg.Connection`, D17;
  repositories/user_repo.py — `UserRepository(BaseRepository[UserResponse])`;
  repositories/__init__.py added per D7. tests/test_user_repo.py —
  `@pytest.mark.integration`, create/get/update/delete round-trip + get/delete
  on missing id + list(**filters) case). verify.sh green; integration suite
  (this unit's + pre-existing D16 test) run and confirmed green against a
  real local Postgres this session (D18) — D16's "unconfirmed in CI" note
  from the U0.4 handoff is stale, since master now already contains U0.4
  merged (PR #4).
- Done: U1.2 (repositories/category_repo.py — `CategoryRepository(BaseRepository[CategoryResponse])`;
  repositories/tag_repo.py — `TagRepository(BaseRepository[TagResponse])`, both same
  thin-subclass pattern as U1.1's `user_repo.py` (D17). tests/test_category_repo.py,
  tests/test_tag_repo.py — `@pytest.mark.integration`, create/get/update/delete
  round-trip, get/delete on missing id, list(**filters) by account, and a test
  documenting the current lack of a DB-level unique-per-account constraint on
  names (D19)). verify.sh green (24 tests total, 9 non-integration); full
  integration suite (15 tests incl. this unit's 10) run and confirmed green
  against a throwaway local Docker Postgres with `docs/SCHEMA.sql` applied
  via psql (same D18 workaround as U1.1).
- Done: U1.3 (repositories/expense_repo.py — `ExpenseRepository(BaseRepository[ExpenseResponse])`;
  overrides `get`/`list`/`create`/`update` to attach `tags` via an
  `expense_tags` JOIN `tags` query (D21), `create`/`update` wrapped in
  `self._conn.transaction()` (D21 review follow-up); `get_by_period`,
  `get_by_category`, `sum_by_category_month` — the two period-based methods
  take explicit tz-aware `start`/`end` bounds (D20), `sum_by_category_month`
  casts `SUM(amount)::bigint` to avoid a `Decimal` leak (D20 review
  follow-up). tests/factories.py — `make_expense` gained an optional
  `created_at` override (single `COALESCE`-based query, no branch
  duplication), added `make_tag`. tests/test_expense_repo.py —
  `@pytest.mark.integration`, CRUD round-trip, tag attach/replace/cascade-on-
  delete, get_by_category account+category filtering, get_by_period/
  sum_by_category_month with known sums, cross-timezone month-boundary
  cases, account-scoping cases for get_by_period/sum_by_category_month, an
  `int`-not-`Decimal` type assertion, and a duplicate-tag_ids atomicity
  test proving the transaction wrap rolls back the whole expense). Reviewed
  by the reviewer subagent same session (BLOCKER: Decimal leak; WARN: no
  transaction wrap; WARN: missing account-scoping/atomicity tests; NIT:
  factories duplication) — all four fixed. verify.sh green (36 tests total,
  9 non-integration); full integration suite (27 tests incl. this unit's 18)
  run and confirmed green against a throwaway local Docker Postgres (D18
  workaround, Docker Desktop started this session to run it).
- Done: U1.4 (repositories/budget_plan_repo.py — `BudgetPlanRepository(BaseRepository[BudgetPlanResponse])`;
  `check_limit(account_id, category_id, *, start, end) -> float | None` — LEFT
  JOIN `expenses` aggregated as `COALESCE(SUM(e.amount), 0)::bigint`, grouped
  by `bp.id`, percentage = exact-bigint spent / exact-bigint limit (D23).
  tests/factories.py — `make_budget_plan` added. tests/test_budget_plan_repo.py
  — `@pytest.mark.integration`, CRUD round-trip, duplicate-plan unique-violation
  documentation test, get/delete on missing id, and the AC's parametrized
  `check_limit` cases [no plan → `None`, 0% spent, exactly at `notify_threshold`
  (80%), >100%] plus zero-amount-plan → `None`, out-of-period exclusion, and
  account-scoping. repositories/CLAUDE.md and services/CLAUDE.md's notification-
  flow invariant updated to the real signature (D23). tests/README.md gained the
  new section per its living-index rule). Reviewed by the reviewer subagent same
  session (APPROVE with WARNs — `GROUP BY bp.id` fix and zero-amount guard
  applied same session; duplicate-plan behavior test added; doc-drift WARNs
  fixed). verify.sh green (9 non-integration tests); full integration suite
  (47 tests total: 9 unit + 38 integration, this unit's 11) run and confirmed
  green against a throwaway local Docker Postgres (D18 workaround).
- Done: U1.5 (repositories/permission_repo.py — `PermissionRepository(BaseRepository[PermissionResponse])`;
  `get_by_user_and_resource(user_id, resource) -> PermissionResponse | None` (D24).
  tests/test_permission_repo.py — `@pytest.mark.integration`, CRUD round-trip, get/delete
  on missing id, `UNIQUE(user_id, resource)` conflict test documenting the raw untranslated
  `asyncpg.UniqueViolationError` (D24, same gap as D23), and `get_by_user_and_resource`
  found/not-found/scoped-by-user cases. tests/README.md gained the new section). verify.sh
  green (9 non-integration tests); full integration suite (54 tests total: 9 unit + 45
  integration, this unit's 7) run and confirmed green against a throwaway local Docker
  Postgres (D18 workaround).
- Done: U2.1 (api/deps.py — `verify_internal_token`, `get_current_user`,
  `get_user_repo`/`get_permission_repo` factories, pure `resolve_permission`
  (steps 2–5) + `PermissionDecision(allowed, own_only)`, `enforce_ownership`
  (step 6), `PermissionChecker` returning the user per the route-pattern
  contract and exposing the decision on `request.state.permission_decision`
  (D25, D26); api/__init__.py added per D7; api/CLAUDE.md rule line
  clarified (D25). tests/test_deps.py — hermetic (fake repos via
  dependency_overrides, no DB): explicit 48-cell default-matrix grid,
  override-row widen/narrow/own_only cases, admin-ignores-row,
  viewer-cannot-be-overridden(+row-can-restrict-viewer-read), step-6
  ownership cases, and HTTP-level 401/403 cases through ASGITransport
  incl. missing/wrong token, missing/malformed/unknown tg_id.
  tests/README.md gained the new section). Reviewed by the reviewer subagent
  same session (APPROVE; WARNs fixed same session: `resolve_permission` now
  fails closed on an unrecognized role instead of falling through to allow —
  `users.role` has no DB CHECK; admin-ignores-row test asserts full decision
  equality so a leaked `own_only` can't slip past; async-fixture NIT fixed).
  verify.sh green (76 non-integration tests). Human still to read the diff
  per plan (MOST COMPLEX LOGIC IN PROJECT).
- Done: U2.2 (services/user_service.py — `UserService`, DI'd via a structural
  `UserRepositoryProtocol` (D29); `list`/`get`/`create`/`update`/`delete` all
  scoped to an explicit `account_id` param (the admin's own, never the
  client-supplied `UserCreate.account_id`, D29); `create` translates
  `asyncpg.UniqueViolationError` (duplicate `tg_id`) to `ConflictError` (D28).
  api/deps.py — `require_admin` (D27), `get_user_service` factory. api/users.py
  — `GET/POST /users`, `GET/PATCH/DELETE /users/{id}`, all gated by
  `require_admin`. main.py — registers the router and the project's first
  domain-exception→HTTP handlers (`NotFoundError`→404, `ConflictError`→409,
  `PermissionDeniedError`→403, D28). models/errors.py — `ConflictError` added
  (D28). services/__init__.py added per D7.
  tests/test_user_service.py — hermetic, `FakeUserRepo`, account-scoping,
  account_id-override, duplicate-tg_id→`ConflictError`, not-found cases.
  tests/test_users_api.py — hermetic HTTP tests via the real app +
  `app.dependency_overrides`, admin/member/viewer 200-vs-403 per route,
  404/409 mapping, spoofed-account_id-ignored case. tests/README.md gained
  both new sections). Review fix (D30): `UserService.update` drops explicit
  `None` values from the update payload — an unfiltered `{"name": null}` was
  reaching the DB as `SET name = NULL` against a `NOT NULL` column and
  surfacing as an unhandled 500; 3 tests added for this. verify.sh green
  (102 non-integration tests: 76 + 23 new + 3 review-fix).
- Done: U2.3 (services/category_service.py — `CategoryService`, DI'd via a
  structural `CategoryRepositoryProtocol`; services/tag_service.py —
  `TagService`, DI'd via a structural `TagRepositoryProtocol`; both
  account-scoped, both drop explicit-`None` update payloads (D30 pattern,
  D32); `CategoryService.delete` translates a `RESTRICT`-triggered
  `asyncpg.ForeignKeyViolationError` to `ConflictError` (D32). api/deps.py
  — `get_category_repo`/`get_tag_repo`/`get_category_service`/
  `get_tag_service` factories. api/categories.py, api/tags.py — full CRUD
  routers gated by `PermissionChecker(Resource.CATEGORIES/TAGS, Action...)`
  (enum form, D32), no `enforce_ownership` call (no `own_only` concept for
  these resources).
  main.py — registers both routers (no new exception handler needed,
  reuses the existing `ConflictError`→409 mapping).
  tests/test_category_service.py, tests/test_tag_service.py — hermetic,
  `FakeCategoryRepo`/`FakeTagRepo`, account-scoping, explicit-null-ignored,
  not-found cases; category service also covers the RESTRICT→`ConflictError`
  translation. tests/test_categories_api.py, tests/test_tags_api.py —
  hermetic HTTP tests via the real app + `app.dependency_overrides`
  (user/permission/category/tag repos all faked), admin/member/viewer
  200-vs-403 per route, 404 mapping, category RESTRICT-delete→409 case.
  tests/README.md gained all four new sections). verify.sh green
  (144 non-integration tests: 102 + 42 new).
- Done: U2.4 (services/expense_service.py — `ExpenseService`, DI'd via a
  structural `ExpenseRepositoryProtocol`; no permissions/`own_only` knowledge
  in the service at all — ownership enforcement lives entirely in the route
  (D33). `list`/`get`/`create`/`delete` follow the D29/D32 account-scoping
  pattern (`account_id` always the caller's own); `create` also stamps
  `user_id` from the caller (never client-supplied). `update` drops explicit
  `None` for `amount`/`category_id` (`NOT NULL`, D30/D32 pattern) but NOT for
  `comment` (nullable — explicit null really clears it, D33) or `tag_ids`
  (`ExpenseRepository` already handles absent-vs-null-vs-empty-list, D21).
  api/deps.py — `get_expense_repo`/`get_expense_service` factories. api/expenses.py
  — full CRUD router gated by `PermissionChecker(Resource.EXPENSES, Action...)`;
  update/delete/single-`GET` routes fetch the record via the service then call
  `enforce_ownership(request.state.permission_decision, user, expense.user_id)`
  before mutating — the first real wiring of U2.1's step 6 (D33). main.py —
  registers the router (no new exception handler needed, reuses the existing
  `NotFoundError`→404 mapping; `PermissionDeniedError`→403 isn't even hit by
  this unit since `enforce_ownership` raises `HTTPException` directly, not a
  domain error). `list_expenses` also filters to `user.id` when
  `request.state.permission_decision.own_only` is set (review fix, D33 —
  BLOCKER: list had no ownership filtering at all, reachable the moment an
  override permission row sets `own_only=true` on read).
  tests/test_expense_service.py — hermetic, `FakeExpenseRepo`, account-scoping,
  tag attach/replace/clear, the three-way null-handling split (amount/
  category_id dropped, comment cleared), not-found cases incl. update on a
  foreign-account expense (review NIT — symmetry with get/delete).
  tests/test_expenses_api.py — hermetic HTTP tests via the real app +
  `app.dependency_overrides`, admin/member/viewer 200-vs-403 per route, the
  own_only grid (member own vs. another member's expense on update/delete,
  admin bypass), unqualified list/read, an override-row own_only-on-read case
  for list (review fix), tag attach/replace via HTTP.
  tests/README.md gained both new sections). Reviewed by the reviewer
  subagent same session (REQUEST_CHANGES — BLOCKER: list own_only gap, fixed
  same session; WARNs: `category_id`/`tag_ids` accepted without an
  account-scoping check — same latent gap as `budget_plans`, D23 — flagged
  in D33, not fixed, beyond this unit's AC; double-fetch per own_only-gated
  request — accepted per D31; NIT: pre-existing TOCTOU-to-`AssertionError`
  path inherited from `category_service.py`'s pattern, not introduced here,
  not fixed). verify.sh green (175 non-integration tests: 144 + 31 new);
  full integration suite (45 tests, all pre-existing — this unit touches no
  repository code) run and confirmed green against a throwaway local Docker
  Postgres (D18 workaround).
- Done: U2.5 (services/budget_service.py — `BudgetService`, DI'd via
  `BudgetPlanRepositoryProtocol` + a narrow `ExpenseSumRepositoryProtocol`
  (just `sum_by_category_month`); `list`/`get`/`create`/`update`/`delete`
  follow the D32 account-scoping pattern (no own_only concept, `budget_plans`
  has no `user_id`); `create` translates `asyncpg.UniqueViolationError`
  (`UNIQUE(category_id, account_id, period)`) to `ConflictError`, closing the
  D23/D24-flagged gap; `update` drops explicit `None` for all three fields
  (`amount`/`period`/`notify_threshold`, all `NOT NULL`, D30/D32 pattern).
  Module-level pure `calculate_progress(spent, limit, notify_threshold) ->
  BudgetProgress` (zero/negative `limit` guard mirrors `check_limit`'s, D23)
  and `get_progress()` orchestrating `budget_plan_repo.get` +
  `expense_repo.sum_by_category_month` (both pre-existing — no new repo
  method, D34). models/budget_plan.py — additive `BudgetProgress` model (not
  a four-schema entity). api/deps.py — `get_budget_plan_repo`/
  `get_budget_service` factories. api/budgets.py — full CRUD router +
  `GET /budgets/{id}/progress`, all `PermissionChecker(Resource.BUDGET_PLANS,
  ...)`-gated, no `enforce_ownership` call (D34). main.py — registers the
  router (no new exception handler needed, reuses the existing
  `ConflictError`→409/`NotFoundError`→404 mappings).
  tests/test_budget_service.py — hermetic, `FakeBudgetPlanRepo` +
  `FakeExpenseSumRepo`, parametrized `calculate_progress` cases (0%, exactly
  at threshold, >100%, zero/negative limit, `int`-typed `remaining`), CRUD
  account-scoping/explicit-null/not-found/conflict cases, `get_progress`
  orchestration cases. tests/test_budgets_api.py — hermetic HTTP tests via
  the real app + `app.dependency_overrides`, admin/member/viewer 200-vs-403
  per route, progress endpoint, duplicate-create→409, not-found→404.
  tests/README.md gained both new sections). Reviewed by the reviewer
  subagent same session (APPROVE with WARNs, fixed same session:
  `_current_month_bounds` had no direct test coverage and `FakeExpenseSumRepo`
  ignored its `start`/`end` args, so no test could catch a wrong-month-bounds
  bug — added `test_current_month_bounds` [mid-year + December→January
  rollover] and made the fake record its call args, asserted in
  `test_get_progress_combines_plan_and_spent`; the null-drop test only
  covered `amount`, not `period`/`notify_threshold` — added the two missing
  cases). verify.sh green (211 non-integration tests: 175 + 36 new); full
  integration suite (45 tests, all pre-existing — this unit touches no
  repository code) run and confirmed green against a throwaway local Docker
  Postgres (D18 workaround).
- Done: U2.6 (models/statistics.py — additive `PeriodTotal`/`CategoryTotal`/
  `TagTotal` models, same non-four-schema-entity precedent as `BudgetProgress`
  (D34). services/statistics_service.py — `StatisticsService`, DI'd via a
  narrow `ExpensePeriodRepositoryProtocol` (just `get_by_period`); `by_period`/
  `by_category`/`by_tag` all aggregate the current month's expenses in Python
  from that one fetch (no new repo method — D35); `_current_month_bounds`
  duplicated from `budget_service.py` (D34/D35). api/deps.py —
  `get_statistics_service` factory. api/statistics.py — `GET /statistics/
  by-period`, `/by-category`, `/by-tag`, all `PermissionChecker(Resource.EXPENSES,
  Action.READ)`-gated (statistics has no `Resource` entry of its own, D35);
  routes pass `user_id` to the service when the resolved permission decision
  has `own_only` set, mirroring D33's `list_expenses` handling (D35). main.py
  — registers the router.
  tests/test_statistics_service.py — hermetic, `FakeExpensePeriodRepo`,
  `_current_month_bounds` cases (mid-year, December rollover), by_period/
  by_category/by_tag aggregation (incl. multi-tag expenses, untagged expenses
  excluded, `int`-typed totals), own_only user_id filtering per aggregate,
  account-scoping. tests/test_statistics_api.py — hermetic HTTP tests via the
  real app + `app.dependency_overrides`, member/viewer 200s, default-matrix
  (not own_only) case, override-row own_only-filters-to-own case, missing-auth
  → 401. tests/README.md gained both new sections). verify.sh green (230
  non-integration tests: 211 + 19 new); full integration suite (45 tests, all
  pre-existing — this unit touches no repository code) run and confirmed
  green against a throwaway local Docker Postgres (D18 workaround).
- Done: U3.1 (services/notification_service.py — `NotificationService.send(user,
  category, fill_pct)`, POSTs to the Telegram Bot API via an injected
  `httpx.AsyncClient`, catches `httpx.HTTPStatusError`/`httpx.HTTPError`
  separately and logs only safe structured fields, never the exception itself
  (D36 — token-leak review fix). services/expense_service.py —
  `ExpenseService` gained `budget_plan_repo`/`category_repo`/
  `notification_service` deps (all narrow Protocols); `create()` now calls
  `_check_budget_and_notify()` after persisting the expense — `check_limit()`
  for `fill_pct`, `budget_plan_repo.list()` for `notify_threshold`,
  `category_repo.get()` for the display name, `notification_service.send()`
  if `fill_pct >= notify_threshold`; the whole check wrapped in a blanket
  `try/except Exception` so a DB hiccup here can't undo an already-committed
  expense either (D36). api/deps.py — `_http_client()` `lru_cache`d
  `httpx.AsyncClient` singleton + `close_http_client()`, `get_notification_service`
  factory, `get_expense_service` now wires all three new deps. main.py —
  lifespan closes the http client (`close_http_client()`) alongside the DB
  pool. tests/test_notification_service.py — hermetic, `httpx.MockTransport`,
  send happy path, transport-error/HTTP-status-error swallowed not raised,
  ERROR-level log on failure, and a regression test proving a planted secret
  token never appears in any log record (review fix). tests/test_expense_service.py
  — `FakeBudgetPlanRepo`/`FakeCategoryRepo`/`FakeNotificationService`/
  `RaisingNotificationService`/`RaisingBudgetPlanRepo`, threshold-crossed/
  at-threshold/below-threshold/no-plan cases, both try/except layers proven
  independently, `_current_month_bounds` cases. tests/test_expenses_api.py —
  `override_repos` fixture now also fakes the three new deps (all pre-existing
  non-create-flow tests still pass with no real budget plan); one new
  end-to-end HTTP test through the real `get_expense_service` factory.
  tests/README.md gained all new sections/rows). Reviewed by the reviewer
  subagent same session (REQUEST_CHANGES — BLOCKER: bot-token log leak via
  `httpx.HTTPStatusError`'s message, fixed same session with a regression
  test; three WARNs fixed same session [unclosed http client, `plans[0]`/
  `category_repo.get()` scoping-reliance comments, logging `extra={}`
  convention]; one WARN flagged not fixed [two `budget_plan_repo` round trips
  per create — see D36]). verify.sh green (245 non-integration tests: 230 +
  15 new); full integration suite (45 tests, all pre-existing — this unit
  touches no repository code) run and confirmed green against a throwaway
  local Docker Postgres (D18 workaround).
- Done: U4.1 (bot/client.py — `BackendClient`, one method per endpoint the
  bot milestone drives: expenses/categories/tags/budget_plans (incl.
  `get_budget_plan_progress`)/statistics (by-period/category/tag) CRUD+reads;
  `users` intentionally not wrapped, no admin UI planned (D37). Every request
  goes through a shared `_request()` helper that attaches
  `X-Telegram-User-Id`/`X-Internal-Token` headers and calls
  `response.raise_for_status()` — non-2xx surfaces as `httpx.HTTPStatusError`
  for handlers (U4.3+) to translate into user-facing messages. bot/middlewares.py
  — `AllowlistMiddleware`, an aiogram outer middleware: reads
  `data["event_from_user"]` (populated by aiogram's built-in
  `UserContextMiddleware`), drops the update (returns `None`, handler never
  runs) if the tg_id is `None` or not in the configured allowlist, otherwise
  constructs a `BackendClient` with that tg_id's headers and injects it as
  `data["client"]` (D37). tests/test_bot_client.py — hermetic,
  `httpx.MockTransport` (D37 — respx not a dependency), one fixture per
  response-model JSON shape, header-injection assertion, per-resource
  CRUD/progress/statistics round trips, non-2xx → `HTTPStatusError`.
  tests/test_bot_middlewares.py — non-allowlisted tg_id dropped before
  handler runs (AC), missing `event_from_user` dropped, allowlisted tg_id
  reaches handler with an injected `BackendClient`, injected client's
  requests carry the right headers, drop is logged. tests/README.md gained
  a Bot section for both files. Reviewed by the reviewer subagent same
  session (APPROVE — two WARNs fixed same session: `bot/middlewares.py`
  now reads `aiogram.dispatcher.middlewares.user_context.EVENT_FROM_USER_KEY`
  instead of a bare `"event_from_user"` string literal, and its docstring
  now states the registration-order requirement (must be added via
  `dp.update.outer_middleware(...)` after `Dispatcher()` construction so
  `UserContextMiddleware` populates `event_from_user` first); `bot/client.py`'s
  `_request()` gained a comment warning future callers never to log
  `exc.request`/`exc.request.headers` on a caught `httpx.HTTPStatusError`,
  since httpx only auto-redacts `Authorization`, not `X-Internal-Token`
  [same class of bug as the U3.1 bot-token leak]; two NITs, both folded into
  the same fixes). verify.sh green (261 non-integration tests:
  245 + 16 new); this unit touches no repository/DB code, so the pre-existing
  integration suite wasn't re-run.
- Done: U4.2 (bot/bot.py — `create_dispatcher(http_client, allowed_tg_ids,
  internal_token)` factory registering `AllowlistMiddleware` via
  `dp.update.outer_middleware(...)` after `Dispatcher()` construction
  (satisfies U4.1's registration-order requirement — aiogram pre-registers
  `UserContextMiddleware` inside `Dispatcher.__init__`), with a marked
  router-registration point for U4.3+; `main()` polling entrypoint
  (`python -m bot.bot`) wiring settings → `Bot`/`httpx.AsyncClient`/dispatcher,
  closing the http client on shutdown (`start_polling` closes the bot session
  itself). bot/states.py — `AddExpense` StatesGroup (category → amount →
  comment → tags → confirm, the bot/CLAUDE.md canonical flow). bot/keyboards.py
  — pure builders `categories_keyboard`/`tags_keyboard` (multi-select with ✅
  prefix + Done button)/`confirm_keyboard`, callback wire formats via
  `CallbackData` factories + string constants (D38). tests/test_bot_bot.py —
  dispatcher builds (AC), middleware-order assertion, and two full-stack
  `dp.feed_update` cases (allowlisted update reaches a handler with the
  injected `BackendClient`; non-allowlisted never reaches it).
  tests/test_bot_keyboards.py — expected callback_data per keyboard (AC),
  pack/unpack UUID round trips, selected-tag labels. tests/README.md gained
  both new sections). verify.sh green (271 non-integration tests: 261 + 10
  new); this unit touches no repository/DB code, so the pre-existing
  integration suite wasn't re-run.
- Done: U4.3 (bot/handlers/__init__.py added per D7; bot/handlers/expenses.py —
  FSM add-expense flow (category → amount → [comment] → [tags] → confirm),
  `parse_amount_to_minor_units` helper (`Decimal`-based, comma/dot/thousands-
  separator parsing, D39), `ExpenseBackendClient` Protocol (structural subset
  of `BackendClient`, D39), `create_router() -> Router` factory (not a module
  singleton, D39). bot/bot.py — wires `create_expenses_router()` into
  `create_dispatcher` at the marked point. tests/test_bot_handlers_expenses.py
  — amount-parsing parametrized cases, full happy-path walkthrough (handler
  functions called directly against a real `FSMContext`/`MemoryStorage`),
  no-categories/no-tags branches, invalid-amount reprompt, cancel from two
  states, create-expense/list-categories/list-tags backend-error paths, plus
  two real-`Dispatcher` dispatch tests locking in the D39 cancel-ordering fix.
  tests/README.md gained the new section). Reviewed by the reviewer subagent
  same session (REQUEST_CHANGES — BLOCKER: `/cancel` shadowed by catch-all
  amount/comment handlers due to registration order, fixed same session, D39;
  two WARNs fixed same session: missing error handling on `list_categories`/
  `list_tags`, `on_confirm`'s catch widened to `httpx.HTTPError`; two NITs
  flagged, not fixed, see D39). verify.sh green (295 non-integration tests:
  271 + 24 new). List view split to **U4.3b** (plan contingency note, D39).
- Done: U4.3b (bot/handlers/expenses.py — `cmd_list_expenses` (plain
  `Command("expenses")` handler, no FSM), `_format_expenses_list`/
  `_format_amount` reuse (D39), `ExpenseBackendClient` Protocol gained
  `list_expenses`; registered in `create_router()` before the per-state
  catch-alls (D40). tests/test_bot_handlers_expenses.py — `FakeBackendClient`
  gained an `expenses` param + `list_expenses()`; AC cases (non-empty render,
  empty → "No expenses yet.", comment shown-vs-omitted) plus a backend-error
  case and a real-`Dispatcher` registration-order regression test (D40).
  tests/README.md gained the new rows). Reviewed by the reviewer subagent
  same session (APPROVE; two WARNs fixed same session — unbounded list could
  exceed Telegram's 4096-char limit [`_MAX_EXPENSES_SHOWN`/`_MAX_COMMENT_CHARS`
  truncation added], missing registration-order regression test [added]; two
  NITs flagged not fixed — see D40). verify.sh green (301 non-integration
  tests: 295 + 6 new).
- Done: U4.4 (bot/states.py — `CategoryManage` StatesGroup (`add_name`,
  `rename_select`, `rename_name`, `delete_select`, D41). bot/handlers/
  categories.py — `cmd_list_categories` (plain, no FSM); add/rename
  single-field "enter a name" forms; rename/delete reuse `categories_keyboard`/
  `CategoryCallback` from bot/keyboards.py to pick a target by name instead of
  a typed UUID; `CategoryBackendClient` Protocol (structural subset of
  `BackendClient`); `_error_message()` maps 403 → permission message, 409 →
  "still in use" message (category delete is `ON DELETE RESTRICT`, D5),
  anything else → generic message; `create_router()` registers `/cancel`
  before the per-state catch-alls (D39/D40 precedent). bot/bot.py wires
  `create_categories_router()`. tests/test_bot_handlers_categories.py —
  list (non-empty/empty/backend-error), add (happy path/empty-name reprompt/
  permission-denied/backend-error), rename (happy path/no-categories/
  permission-denied), delete (happy path/no-categories/409-conflict), cancel,
  plus a real-`Dispatcher` registration-order regression test. tests/README.md
  gained the new section). Reviewed by the reviewer subagent same session
  (APPROVE — see D41 for the one WARN and three NITs, all handled/flagged
  same session). verify.sh green (316 non-integration tests: 301 + 15 new);
  this unit touches no repository/DB code, so the pre-existing integration
  suite wasn't re-run.
- Next: U4.4b (handlers/tags, split from U4.4, D41). `models/budget_plan.py`'s
  `amount` still has no positivity constraint (flagged since D23, not touched
  by U2.5/U2.6/U3.1) — flag again if any future unit's math assumes
  `amount > 0`. `budget_plan_repo`'s two-round-trip notification check (D36)
  is a candidate for a follow-up optimization, not urgent. `repositories/base.py`'s
  `list()` has no `ORDER BY` (D40) — flag if `/expenses` or any future list
  view needs a defined display order.
- Gotchas: update project CLAUDE.md status checklist manually (per its own
  rule); keep amounts int-only end to end — bot parses user input to minor
  units immediately. No `.env` file exists yet — tests set env vars directly
  via monkeypatch; real `.env` still needed before running the app/bot for real.
  New packages under repositories/services/api/bot will need an empty
  `__init__.py` each (see D7) or mypy will fail with duplicate-module errors.
  `docs/seed.sql` now exists (manual account/user onboarding, V1 has no
  self-registration) — matches the Account-model deferral below.
  `alembic upgrade head` doesn't work on this machine locally — see D18;
  use a throwaway Docker Postgres + `docs/SCHEMA.sql` via `psql` for local
  integration-test runs until the `uv.lock`/greenlet marker gap is fixed.
  See D11 for the FK `ON DELETE` gap left for
  M1 to pick up. See D22 before naming any repository method after a builtin
  (`list`, `dict`, etc.) used in that class's later type annotations.
  See D23: `budget_plans`' real unique constraint raises a raw
  `asyncpg.UniqueViolationError` on duplicate `(category_id, account_id,
  period)` inserts, untranslated to a domain exception — same gap as every
  other repo today (no repo yet implements repositories/CLAUDE.md's
  "translate unique/FK violations" rule); flag for M2 service-layer error
  translation. `models/budget_plan.py`'s `amount` has no positivity
  constraint (no `Field(gt=0)`, no DB `CHECK`) — `check_limit` guards against
  it (returns `None`), but `create`/`update` still accept `amount <= 0`
  silently; flag if a future unit tightens the model/schema.
- D37 (U4.1): `bot/client.py`'s `BackendClient` wraps only expenses/
  categories/tags/budget_plans/statistics — no `users` methods, since the
  bot has no user-management UI planned (admin panel is V2, root CLAUDE.md
  "Out of scope") and nothing in M4's units calls it. `bot/middlewares.py`'s
  `AllowlistMiddleware` realizes bot/CLAUDE.md's "injects X-Telegram-User-Id
  header into every outgoing API call" by constructing a per-update
  `BackendClient` (headers baked in at construction) and putting it on
  `data["client"]` for the handler to use, rather than the middleware
  touching httpx calls directly — handlers (U4.2+) call backend endpoints
  only through that injected client, so no call site can omit or forge the
  header. Non-allowlisted tg_ids are dropped before the handler (and thus
  before any possible API call) runs at all. Test transport: AC text says
  "respx", but respx isn't a project dependency; used `httpx.MockTransport`
  instead, matching the existing `tests/test_notification_service.py`
  precedent. Not a contract change.
- D38 (U4.2): callback-data wire formats live in `bot/keyboards.py` as aiogram
  `CallbackData` factories for id-carrying buttons (`CategoryCallback` →
  `"category:<uuid>"`, `TagCallback` → `"tag:<uuid>"` — aiogram packs UUIDs as
  dashless hex) and plain string constants for static buttons
  (`tags:done`, `expense:confirm`, `expense:cancel`); U4.3+ handler filters
  must match on these (e.g. `CategoryCallback.filter()`), and the formats are
  locked in by tests/test_bot_keyboards.py. `create_dispatcher` takes its
  deps (`http_client`, `allowed_tg_ids`, `internal_token`) explicitly rather
  than reading `get_settings()` so tests build a fully hermetic dispatcher
  (MockTransport http client, no env); only `main()` touches settings.
  `bot/states.py` ships only the `AddExpense` group — U4.4/U4.5 add their own
  groups when their flows need multi-step state, not before. No handlers in
  this unit (skeleton only, per the plan's unit list — `bot/handlers/` starts
  at U4.3).

- D39 (U4.3): list view split out of this unit into U4.3b — the FSM flow alone
  (implementation + the test coverage its AC requires: happy path, cancel
  mid-flow from two different states, invalid-amount reprompt, backend-error
  paths) already ran ~500 diff lines across 2 files, over the ~300-line unit
  budget; the plan's own contingency note authorized this split. `bot/handlers/
  expenses.py` exposes `create_router() -> Router` (not a module-level `Router()`
  singleton) because a `Router` can only ever attach to one parent `Dispatcher`
  — `tests/test_bot_bot.py` calls `create_dispatcher()` fresh per test, which
  would otherwise raise `RuntimeError` on the second call. Handlers are plain
  module-level functions registered functionally (`router.message.register(fn,
  *filters)`) rather than via `@router.message(...)` decorators, so they stay
  directly importable/callable for unit tests. FSM state stores fetched
  `CategoryResponse`/`TagResponse` objects directly (not just ids), safe only
  because `bot/bot.py`'s `Dispatcher()` uses aiogram's default `MemoryStorage`
  (shallow `dict.copy()`, no serialization) — flag if V1 ever adds a persistent
  FSM storage backend (e.g. Redis), which would need JSON-safe state instead.
  `parse_amount_to_minor_units` uses `Decimal` (not the illustrative
  `int(round(value * 100))` float snippet in `bot/CLAUDE.md`) for exact
  comma/dot/thousands-separator parsing with no float rounding risk; accepts
  `.`/`,` as the decimal separator and space/`\xa0` as a thousands separator,
  rejects non-positive and multi-separator input.
  Reviewed by the reviewer subagent same session (REQUEST_CHANGES — BLOCKER:
  `create_router()`'s registration order let `on_amount_entered`/
  `on_comment_entered` (catch-all per-state text handlers, no command
  exclusion) shadow `/cancel` during the `amount`/comment` states — aiogram
  dispatches to the first handler whose filters match in registration order,
  so `/cancel` was either stored as the literal comment or rejected as an
  invalid amount instead of cancelling. The unit's own tests couldn't catch
  this because they call handler functions directly, bypassing the router
  entirely. Fixed same session by registering `on_cancel_command` immediately
  after `cmd_add_expense`, before the catch-all handlers; two new tests
  dispatch through a real `Dispatcher` + `create_router()` (Telegram network
  mocked via `Message.answer` patched to an `AsyncMock`) to lock this in.
  Two WARNs also fixed same session: `cmd_add_expense`'s `list_categories()`
  and `_prompt_tags_or_confirm`'s `list_tags()` calls had no error handling
  [violated bot/CLAUDE.md's "errors surface as human messages, never raw
  tracebacks" for any path but `create_expense`] — both now catch
  `httpx.HTTPError` and show a friendly message; `on_confirm` widened its
  catch from `httpx.HTTPStatusError` to `httpx.HTTPError` so a connection/
  timeout failure (not just a non-2xx response) also degrades gracefully
  instead of crashing the handler. Two NITs flagged, not fixed [stale FSM
  data merged rather than reset on `/add` restart — currently harmless, every
  field consumed before use is overwritten by a later step; `_confirm_summary`
  uses bare `dict` subscript access rather than `.get()` with a fallback —
  low risk now that the registration-order bug is fixed, but would raise a
  raw `KeyError` instead of a friendly message if state were ever entered
  incomplete]. A second reviewer pass on the same diff independently re-verified
  the BLOCKER/WARN fixes above and returned APPROVE, re-confirming the two NITs
  and adding one more, also flagged not fixed as out of this unit's AC:
  `on_confirm` (`bot/handlers/expenses.py`) has no guard against a double-tap
  on the Confirm button (e.g. under network lag) — `callback.answer()` fires
  immediately but nothing disables/removes the keyboard before the
  `create_expense` call completes, so two taps in quick succession could both
  reach `client.create_expense` and create a duplicate expense. Flag for a
  future unit (e.g. clearing state/disabling the keyboard optimistically
  before the API call, or an idempotency key if the backend gains one).

- D40 (U4.3b): `cmd_list_expenses` is a plain `Command("expenses")` handler with
  no FSM state at all — `client.list_expenses()` already returns only the
  caller's account's expenses (backend-side scoping, `api/expenses.py`,
  unchanged), so the bot side needs no own_only/account filtering, matching
  bot/CLAUDE.md's "zero business logic" rule. `_format_expenses_list` reuses
  `_format_amount` (D39) rather than introducing new money-formatting code.
  Registered in `create_router()` right after `cmd_add_expense`/before the
  per-state catch-alls (`on_amount_entered`/`on_comment_entered`), the same
  position that kept `/cancel` reachable in D39 — `/expenses` has no
  `StateFilter`, so it matches regardless of FSM state and is dispatched
  before those catch-alls can shadow it (locked in by a new real-`Dispatcher`
  regression test, `test_expenses_command_reaches_list_handler_not_amount_catchall`,
  same pattern as D39's two `/cancel` tests).
  Reviewed by the reviewer subagent same session (APPROVE — no BLOCKERs).
  Two WARNs fixed same session: (1) an unbounded expense list could produce a
  message over Telegram's 4096-char limit and raise an uncaught
  `TelegramBadRequest`, violating bot/CLAUDE.md's "never a raw traceback" rule
  — fixed with `_MAX_EXPENSES_SHOWN = 30` (list truncated, "...and N more not
  shown." appended) and `_MAX_COMMENT_CHARS = 100` (long comments truncated
  with "…"), covered by `test_list_expenses_truncates_long_list_and_long_comments`;
  (2) no real-dispatch regression test existed proving `/expenses` isn't
  shadowed the way `/cancel` was in D39 — added, see above. Two items flagged,
  not fixed (out of this unit's AC, pre-existing/backend-side): `/expenses`
  (like pre-existing `/add`) has no `StateFilter`, so sending it mid-FSM
  doesn't clear state — the FSM stays parked and the user's next plain-text
  message gets misinterpreted by whatever catch-all handler owns that state;
  same pre-existing pattern as `/add`, not newly introduced by this unit.
  `repositories/base.py`'s generic `list()` has no `ORDER BY`, so `/expenses`
  display order is whatever Postgres/asyncpg returns — no bot-side or
  backend-side sort exists yet; flag for a future unit if newest-first display
  is wanted (would need a repo-level change, out of bot/ scope).

- D41 (U4.4): "handlers/categories + tags" split into U4.4 (categories only)
  and U4.4b (tags, deferred), same class of split as D39/D40. Unlike D39's
  list-view split, no contingency note pre-authorized this in the unit list —
  the split was made against task-methodology's hard budget criteria (≤5
  changed files, ≤~300 diff lines) directly: full CRUD (list/add/rename/
  delete) for two resources plus their tests would have touched bot/states.py,
  two new handler modules, bot/bot.py, two new test files, and tests/README.md
  in one commit — 7 files, well over budget — for what is a mechanical
  near-duplicate between categories and tags (same shape: a `name`-only
  entity). Splitting by resource keeps each unit at 5 files and lets U4.4b
  reuse this unit's design decisions (states/handler/test shape) without
  re-deciding them. Rejected: splitting by CRUD verb (e.g. list+add in one
  unit, rename+delete in another) — would cut across a single resource's
  natural cohesion and double the number of Protocol/router/keyboard-reuse
  decisions instead of halving them.
  Reviewed by the reviewer subagent same session (APPROVE — no BLOCKERs).
  One WARN fixed same session: this D41 entry was missing (unit checkbox
  text and STATE referenced D41 before the Decision log entry existed).
  Three NITs flagged, not fixed (pre-existing pattern, same as D40): (1)
  `cmd_add_category`/`cmd_rename_category`/`cmd_delete_category` have no
  `StateFilter`, so invoking one mid-flow silently abandons the prior FSM
  state instead of being rejected — same gap as `/add`/`/expenses` (D40); (2)
  `on_rename_category_name_entered`'s `UUID(data["rename_target_id"])` has no
  guard for a missing key — low risk, the FSM always sets it immediately
  beforehand; (3) `cmd_rename_category`/`cmd_delete_category` don't call
  `state.clear()` on a `list_categories()` failure — harmless today since
  no new state has been set yet at that point.


## Deferred decisions (tracked, not forgotten)
- Account Pydantic model: intentionally absent in V1. Accounts are seeded
  via docs/seed.sql. Trigger to add: first service needing a typed account
  row, or V2 self-registration. See models/CLAUDE.md.
- Bot allowlist in .env: replace with users-table lookup before building
  the admin panel. See root CLAUDE.md → Out of scope.
