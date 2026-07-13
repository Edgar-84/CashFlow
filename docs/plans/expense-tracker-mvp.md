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

- [ ] **U0.1 Skeleton**: config.py (pydantic-settings incl. INTERNAL_TOKEN),
      database.py (asyncpg pool, init/close/get_connection), main.py app
      factory with lifespan, GET /health.
      AC: app boots; /health returns 200 in a test with pool mocked/test DB.
      Model: sonnet.
- [ ] **U0.2 Contracts — all Pydantic models** (user, expense, category, tag,
      budget_plan, permission) in the 4-schema pattern; shared enums
      (Role, Resource, Action); typed domain errors (NotFoundError,
      PermissionDeniedError, LimitExceeded warning type).
      AC: mypy green; import-and-instantiate tests pass; expense.category_id
      REQUIRED (decision D2).
      Model: sonnet. ⚠ Human-review this diff — it locks the architecture.
- [ ] **U0.3 Initial migration**: full schema + indexes
      expenses(account_id, created_at), expenses(category_id),
      expense_tags(tag_id); categories.id referenced with ON DELETE RESTRICT.
      AC: alembic upgrade head on a clean DB, then downgrade base, both clean.
      Model: sonnet (mechanical — haiku acceptable).
- [ ] **U0.4 Test infrastructure**: conftest.py — async httpx client fixture,
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

## STATE (handoff)
- Done: plan approved? ← pending human review
- Next: U0.1
- Gotchas: update project CLAUDE.md status checklist manually (per its own
  rule); keep amounts int-only end to end — bot parses user input to minor
  units immediately.
