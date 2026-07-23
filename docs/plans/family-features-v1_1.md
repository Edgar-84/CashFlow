# Plan: Family Features V1.1

Companion plan to docs/plans/expense-tracker-mvp.md (V1 MVP — 18/20 units
done). Separate file per task-methodology: the MVP plan is ~1500 lines and
two units from finished; this is a new feature wave, not MVP scope creep.
Workflow per unit: /clear → /unit <id> docs/plans/family-features-v1_1.md
→ Stop-gate (verify.sh) → [reviewer for risky units] → human commits.

## Goal
Close the gaps between the shipped MVP and the family's real usage:
statistics over a chosen period with category/tag filters and a pie-chart
image in the bot, expense author visibility, expense edit/delete and
budget-plan CRUD from the bot, budget notifications to the whole family,
a permissions-management API, cross-account data validation, and a
family-timezone-correct "current month".

## Non-goals
- Mini App frontend, voice input, self-registration (V2, unchanged).
- Bot UI for permissions/user management (admin panel is V2; this plan
  adds admin-only API endpoints ONLY — locked by human decision, D103).
- Scheduled digests (V1 notifies on expense creation only, MVP D4 stands).
- Migrating the bot allowlist from .env to the users table (still the
  documented prerequisite for the V2 admin panel, root CLAUDE.md).

## Constraints
- All root CLAUDE.md rules (layering, async, BIGINT money, HTTP-only bot).
- MVP plan contracts stay valid; every delta here is additive and listed
  in Contracts below. MVP Decision log (D1–D45) remains binding — this
  plan's decisions start at D100 to avoid collisions.
- Sequencing vs the MVP plan: finish MVP **U5.1** (e2e smoke) BEFORE
  starting this plan; MVP **U6.1** (CD) stays last overall so the pipeline
  only ever auto-deploys the finished V1.1 (human may reorder).
- Two human sign-off gates baked in: U1.6 adds a file under
  `migrations/versions/` and U2.4 changes `uv.lock` (matplotlib) — both on
  root CLAUDE.md's do-not-edit-without-asking list. The implementing
  session STOPS and asks before touching them.

## Contracts (U0) — additive deltas only
- `config.Settings`: `family_tz: str = "UTC"` (IANA name, e.g.
  `Europe/Belgrade`; new optional env var `FAMILY_TZ`).
- New `services/period.py`: `month_bounds(now: datetime | None = None,
  tz: str = "UTC") -> tuple[datetime, datetime]` — THE single copy
  replacing the three duplicated `_current_month_bounds` (expense_service,
  budget_service, statistics_service, MVP D34/D35).
- `models/expense.py` `ExpenseResponse`: `user_name: str | None = None`
  (additive, populated by a repo JOIN on `users.name`; None tolerated for
  old fixtures — D102).
- `models/budget_plan.py` `BudgetPlanCreate.amount`: gains `Field(gt=0)`
  (closes the gap flagged since MVP D23; originally specified on
  `BudgetPlanBase`, corrected to `Create`-only by D112 — see Decision log).
  DB `CHECK (amount > 0)` on `budget_plans` AND `expenses` arrives in
  U1.6's migration.
- `services/statistics_service.py` methods gain optional tz-aware
  `start`/`end` params (default: family-tz current month); `by_period`
  additionally gains optional `category_id: UUID | None`,
  `tag_id: UUID | None` filters. `api/statistics.py` exposes them as
  optional ISO-8601 `start`/`end` (+ `category_id`/`tag_id` on by-period)
  query params; `start >= end` → 422.
- `bot/client.py`: the three `statistics_*` methods gain the same optional
  params (pass-through as query params). No other client changes — expense
  update/delete and budget-plan CRUD wrappers already exist (U4.1).
- `NotificationService.send(user, category, fill_pct)` signature is
  UNCHANGED; fan-out is the caller's job (`ExpenseService` loops over
  account members — D104).
- Permissions API reuses existing `PermissionCreate/Update/Response`
  (MVP U0.2) — no new models. Admin-only via existing `require_admin`
  (MVP D27).
- New `bot/charts.py`: `render_category_pie(totals:
  list[tuple[str, int]]) -> bytes` (PNG; names + minor-unit sums in,
  bytes out; pure function, no I/O).

## Units

### M0 — Contracts & foundation
- [x] **U0.1 Family timezone + shared period helper**: `family_tz` in
      config; new `services/period.py` `month_bounds(now, tz)` using
      `zoneinfo`; the three services import it and their private copies
      are deleted; existing `now=` test seams preserved.
      AC: parametrized tests — UTC+3 evening-of-the-31st lands in the
      right month, December→January rollover, naive-`now` rejected; all
      pre-existing month-bounds tests keep passing against the shared
      helper. Files: config.py, services/period.py, 3 service files,
      tests (yellow-zone file count, but purely mechanical consolidation).
      Model: sonnet.
- [x] **U0.2 Contract deltas**: `ExpenseResponse.user_name` (additive,
      default None), `BudgetPlanBase.amount Field(gt=0)` (model side only
      — DB CHECK comes with U1.6), statistics service/client signature
      stubs per Contracts (params accepted, default behavior unchanged).
      AC: mypy green; model tests — user_name optional round-trip,
      amount<=0 → ValidationError (API-level 422 test lands in U1.6).
      Model: sonnet. ⚠ Human-review — touches reviewed MVP contracts.

### M1 — Backend logic
- [ ] **U1.1 Cross-account validation** (closes MVP D33/D23 flags):
      `ExpenseService.create/update` verify `category_id` and every
      `tag_ids` entry belong to the caller's account (new narrow
      `TagRepositoryProtocol` dep); `BudgetService.create/update` verify
      `category_id`. Foreign/nonexistent ids → `NotFoundError` (404, not
      403 — no cross-account probing, MVP D29 precedent).
      AC: hermetic service tests — foreign category / foreign tag /
      mixed own+foreign tags all 404, own ids still pass; API-level test
      per endpoint. RISKY → reviewer subagent (permissions-adjacent).
- [ ] **U1.2 Statistics: period params + filters**: implement the U0.2
      signatures — service filters the `get_by_period` fetch window by
      caller-supplied bounds (default `month_bounds(family_tz)`), by_period
      applies optional category/tag filter before aggregation (own_only
      filter unchanged, MVP D35); routes parse/validate query params.
      AC: aggregation tests on seeded fake data for a custom 3-month
      window, last-month window, category filter, tag filter,
      start>=end → 422; default (no params) still equals current family
      month.
- [ ] **U1.3 Expense author**: `ExpenseRepository` `get/list/get_by_period/
      get_by_category` JOIN `users.name` → `user_name` in the row dicts.
      AC: @integration tests — user_name populated on all four read paths;
      unit fixtures updated. Model: sonnet (mechanical SQL).
- [ ] **U1.4 Notification fan-out to all members** (human decision D104):
      `ExpenseService` gains a narrow `UserRepositoryProtocol`
      (`list(account_id=...)`) dep; `_check_budget_and_notify` sends to
      EVERY account user, each send individually best-effort.
      AC: fake tests — 2 members → 2 sends; recipient #1 send failure →
      recipient #2 still notified AND expense still created; single-user
      account → 1 send (no dupes). RISKY → reviewer subagent
      (notification path, MVP D3/D36 invariants).
- [ ] **U1.5 Permissions API** (human decision D103):
      `services/permission_service.py` (account-scoped: target user must
      belong to the admin's account, 404 otherwise — D29 pattern;
      UniqueViolation → `ConflictError`, closes MVP D24's flagged gap) +
      `api/permissions.py` CRUD gated by `require_admin`; router wired in
      main.py.
      AC: HTTP tests — admin 200 grid, member/viewer → 403, duplicate
      (user, resource) → 409, foreign-account target → 404; a granted
      override row observably changes a subsequent PermissionChecker
      decision (end-to-end assert). RISKY → reviewer subagent
      (permissions). /effort high.
- [ ] **U1.6 amount > 0 migration** ⚠ STOP-AND-ASK GATE: new Alembic
      revision adding `CHECK (amount > 0)` to `budget_plans` AND
      `expenses` — `migrations/versions/` is on the do-not-edit list, the
      session must get explicit human approval before creating the file.
      AC: upgrade→downgrade→upgrade round-trip green in CI's integration
      job; API POST/PATCH with amount<=0 → 422 (model) and the CHECK
      proven by a direct-SQL @integration test. Model: sonnet.

### M2 — Bot
- [ ] **U2.1 Expense picker + delete flow**: `/expenses` lines gain
      author (`user_name`, requirement #7) and category name; new
      inline-keyboard expense picker (recent N) → detail view →
      Delete-with-confirm (guard against double-tap: answer + drop
      keyboard before the API call — same pattern U2.5 retrofits to
      add-expense confirm).
      AC: fake-client tests — list shows author+category, picker →
      detail → delete happy path, 403/404 → human message, double-tap →
      single API call; real-Dispatcher registration-order test
      (MVP D39/D40 precedent).
- [ ] **U2.1b Expense edit flow** (split from U2.1 — same rationale as
      MVP D43): from the detail view, `EditExpense` FSM: pick field
      (amount/category/comment/tags) → enter/select new value →
      `client.update_expense`. `/cancel` registered before per-state
      catch-alls (MVP D39).
      AC: fake-client walkthroughs per field, invalid amount re-prompt,
      cancel mid-flow, backend-error message; registration-order test.
- [x] **U2.2 Budget-plan CRUD in bot** (requirement #8; U4.4's shape):
      `BudgetManage` StatesGroup; `/budgets` keeps the U4.5 rendering,
      new add flow (category → amount → notify-threshold %) and
      rename-free update/delete flows via the existing keyboards pattern;
      409 (duplicate plan) and 403 → human messages.
      AC: fake-client tests — add/update/delete happy paths, duplicate →
      "already exists" message, permission-denied message, invalid
      amount/threshold re-prompts, cancel; registration-order test.
- [ ] **U2.3 Statistics period picker + drill-down** (requirement #6):
      `/statistics` gains inline buttons — period presets (this month
      default / last month / last 3 months) and "by category…"/"by tag…"
      pickers that re-render the by-period total filtered to the chosen
      category/tag; client passes start/end/filters (U0.2/U1.2 params).
      AC: fake-client tests — preset switch re-renders with the right
      bounds sent, category and tag drill-down send the right filter,
      empty result message; callback-data formats locked by tests.
- [ ] **U2.4 Pie chart PNG** ⚠ STOP-AND-ASK GATE (human decision D101):
      `uv add matplotlib` changes `uv.lock` (do-not-edit list) — get
      explicit approval first. New `bot/charts.py`
      `render_category_pie()` (Agg backend, no display); `/chart` command
      (and a "📊 chart" button on `/statistics`) sends the PNG via
      `BufferedInputFile` with a period-picker caption reusing U2.3's
      presets.
      AC: unit test — returned bytes start with the PNG magic number,
      one slice per category, zero-total → "nothing to chart" message
      without rendering; handler test with fake client (no Telegram
      network); verify.sh green with matplotlib imported nowhere outside
      `bot/charts.py`.
- [ ] **U2.5 Bot polish**: `/start` + `/help` (command list per role-
      agnostic text); `ExpenseRepository.list`/`get_by_period` gain
      `ORDER BY created_at DESC` (closes MVP D40 flag — repo-level, the
      one non-bot file); add-expense Confirm double-tap guard (clear
      state + strip keyboard before `create_expense`, closes MVP D39
      reviewer NIT).
      AC: /start and /help render; @integration test proves newest-first
      order; double-tap test → single create call. Model: haiku-friendly
      except the repo change.

### M3 — Smoke
- [ ] **U3.1 e2e smoke extension (@integration)**: extends MVP U5.1's
      scenario — member A adds expense → member B ALSO receives the
      threshold notification (fan-out); statistics with explicit
      start/end match seeded sums; foreign-account category on create →
      404.
      AC: scenario green on test DB; excluded from default verify.sh
      (integration marker).

## Live-test checkpoints (execution order for hand-testing in Telegram)
Units are grouped into feature slices so every checkpoint ends with
something the human can try live in the dev bot (`docker compose up
--build`, dev BOT_TOKEN, own tg_id in ALLOWED_TG_IDS, `docs/seed.sql`
applied). Unit CONTENTS are unchanged — only the recommended execution
order interleaves M1/M2. Dependencies allow it: every slice depends only
on U0.1/U0.2 and its own listed units.

- **CP0 — before any new unit**: live-test the whole MVP (never done
  yet): /add, /expenses, /categories, /tags, /budgets, /statistics;
  create a budget plan via curl and cross its threshold → notification
  arrives. This is the manual twin of MVP U5.1.
- **CP1** = U0.1 + U0.2 — no visible change; re-run CP0 commands to
  confirm nothing broke (foundation slice).
- **CP2 — budgets from the bot** = U2.2 (needs no new backend — client
  wrappers exist since U4.1): create/update/delete a budget plan in
  Telegram; threshold message on expense create.
- **CP3 — family fan-out** = U1.4: second family tg_id added to
  seed/allowlist; member A adds expense over threshold → member B gets
  the message too.
- **CP4 — who added what + delete** = U1.3 + U2.1: /expenses shows
  author + category; pick an expense → delete it.
- **CP5 — edit expense** = U2.1b: fix an amount/comment from Telegram.
- **CP6 — period statistics + chart** = U1.2 + U2.3 + U2.4 (U2.4 has the
  uv.lock ask-gate): switch period presets, drill into a category/tag,
  get the pie-chart PNG.
- **CP7 — hardening, API-only testing** = U1.1 + U1.5 + U1.6 (U1.6 has
  the migrations ask-gate): foreign-account ids → 404 via curl;
  permissions CRUD via curl changes a member's live bot behavior;
  amount<=0 → 422.
- **CP8 — polish + smoke** = U2.5 + U3.1: /start, /help, newest-first
  list, double-tap guard; automated smoke green.

## Risks
- `zoneinfo` on `python:3.13-slim`: Debian slim may lack system tzdata —
  if `ZoneInfo("Europe/...")` raises in-container, add the `tzdata` pip
  package (needs the same uv.lock sign-off as U2.4; check during U0.1).
- matplotlib in the single shared image (MVP D40: one image for api+bot)
  adds ~30–60MB for the api service too — accepted for V1.1; revisit only
  if image size becomes a deploy problem.
- Telegram send failures during fan-out (member never pressed /start on
  the prod bot → 403 from Bot API) — U1.4's per-recipient best-effort
  handles it, but log fields must NEVER include the exception object
  (bot-token leak class, MVP D36).
- U2.1/U2.1b picker keyboards: Telegram caps inline keyboards (~100
  buttons) and messages at 4096 chars — reuse MVP's `_MAX_EXPENSES_SHOWN`
  truncation pattern for the picker.
- `user_name` JOIN: if a user row is ever hard-deleted, historical
  expenses would break the JOIN — use LEFT JOIN, `user_name` stays None
  (already optional in the contract).
- Statistics custom periods make the "one fetch, aggregate in Python"
  design (MVP D35) fetch potentially large windows — fine for a family's
  data volume; flag if a "last 12 months" preset is ever added.

## Decision log
- D100 (2026-07-19, plan creation): separate plan file, decision ids from
  D100 — the MVP plan (D1–D45) is two units from done; mixing a feature
  wave into it would bury its STATE. Rejected: extending the MVP plan
  with an M5.5 milestone (original proposal, superseded by the 8-point
  requirements list).
- D101 (2026-07-19, HUMAN): category diagram = real PNG pie chart via
  matplotlib rendered bot-side, sent as a photo. Rejected: text
  percentage bars (no dependency, but not the asked-for "circle"),
  deferring the chart to the V2 Mini App. Backend stays JSON-only so the
  Mini App can render its own charts later (root CLAUDE.md HTTP-only
  rule). uv.lock change gated on explicit human sign-off at U2.4.
- D102 (2026-07-19): expense author exposed as an additive
  `ExpenseResponse.user_name: str | None` populated by a LEFT JOIN in the
  repo. Rejected: bot resolving names via a users endpoint — `users` API
  is admin-only (MVP D27) so member bots would 403, and `BackendClient`
  deliberately wraps no users methods (MVP D37).
- D103 (2026-07-19, HUMAN): permissions management = admin-only API
  endpoints only (`api/permissions.py` + service reusing U1.5's repo).
  Rejected: bot admin commands now (starts the V2 admin panel early;
  also blocked on the allowlist→DB migration prerequisite), defer
  entirely (leaves requirement #4 with zero management surface).
- D104 (2026-07-19, HUMAN): budget threshold notifications go to ALL
  account members, each send individually best-effort. Rejected:
  creator-only (current behavior — second family member never learns the
  budget is nearly spent), admins+creator (needless asymmetry for a
  2-member family). `NotificationService.send` signature unchanged —
  fan-out loop lives in `ExpenseService._check_budget_and_notify`.
- D105 (2026-07-19): foreign-account `category_id`/`tag_ids` on
  expense/budget create/update → `NotFoundError` (404). Rejected: 403
  (confirms the id exists — cross-account probing, contra MVP D29), 422
  (it's not a shape error).
- D106 (2026-07-19): statistics period selection = optional ISO-8601
  `start`/`end` query params, bot presets compute the bounds client-side
  from `family_tz`... NO — bounds are computed backend-side when params
  are absent; bot presets send explicit bounds it derives from its own
  clock in UTC (instant-correct per MVP D20; the backend never trusts the
  bot's idea of "month" for the default case). Rejected: named-period
  enum params (`period=last_month`) — less flexible, and the Mini App
  will want raw date ranges anyway.
- D107 (2026-07-19): `services/period.py` is the shared home for
  `month_bounds` (services layer — it's business-calendar logic used only
  by services). Rejected: a new top-level `utils/` package (nothing else
  would live there; root CLAUDE.md's architecture map has no utils entry).
- D108 (2026-07-21, U0.1): the Risks-section concern about `python:3.13-slim`
  lacking system tzdata did NOT materialize — verified by running
  `ZoneInfo("Europe/Belgrade")` inside a bare `python:3.13-slim` container
  (no packages installed) and it resolved correctly. No `tzdata` pip
  package added, no `uv.lock` sign-off needed for U0.1. `month_bounds(now,
  tz)` determines the month from `now`'s wall-clock time in `tz` (so a UTC
  instant still on the 31st but already the 1st in a UTC+N family timezone
  counts as the new month) and returns bounds converted back to UTC-aware
  datetimes, matching what repositories already compare against. `now`
  must be tz-aware — naive raises `ValueError` rather than guessing UTC or
  local. Scope check: only `config.family_tz` + `services/period.py` were
  added; the three services call `month_bounds(now)` with the default
  `tz="UTC"` unchanged (identical behavior to before) — wiring
  `settings.family_tz` into actual call sites is U1.2's job per the
  Contracts section (only `statistics_service` is listed there), not this
  unit's.

- D109 (2026-07-21, U0.2): `Field(gt=0)` added only to `BudgetPlanBase.amount`
  as the Contracts bullet literally names — `BudgetPlanCreate` inherits it
  (POST covered), but `BudgetPlanUpdate` does NOT inherit `Base` (four-schema
  pattern, models/CLAUDE.md) and was left with a plain `int | None`. U1.6's
  own AC wants "API POST/PATCH with amount<=0 → 422 (model)" — PATCH needs
  its own `Field(gt=0)` on `BudgetPlanUpdate.amount`, not yet added. Flagged
  for U1.6 rather than fixed here (contracts named Base only; Update wasn't
  this unit's contract to change).
- D110 (2026-07-21, U0.2): statistics signature stubs split by layer.
  `StatisticsService.by_period/by_category/by_tag` gained the `start`/`end`
  params (`by_period` also `category_id`/`tag_id`) but the body still calls
  `month_bounds(now)` unconditionally and ignores the new params — real
  filtering is U1.2's AC, not U0.2's (task-methodology: contracts unit ≠
  business logic unit). `bot/client.py`'s three `statistics_*` methods DO
  fully forward the new params as query strings (mechanical, and FastAPI
  silently ignores query params a route doesn't declare yet, so it's
  harmless ahead of U1.2 wiring `api/statistics.py`).
- D111 (2026-07-22, U2.2): implemented out of the plan's milestone order —
  M1 (U1.1-U1.6) and U2.1/U2.1b are still not done, but a live user-testing
  session hit MVP D45's "budgets are API-only" gap directly (a raw-API
  budget create used dollars where cents were required, with no bot-side
  guardrail) and asked for this unit specifically; nothing in U2.2's own
  AC depends on U1.1-U1.6/U2.1/U2.1b's code. Human confirmed proceeding
  out of order rather than waiting. Two implementation choices not spelled
  out by the Units entry: (1) `parse_amount_to_minor_units` is imported
  from `bot/handlers/expenses.py` rather than extracted to a shared module
  — one function, two call sites, extracting it would add a file for no
  behavior change; (2) update is "amount, then threshold, each
  independently skippable via /skip" rather than a single combined prompt,
  mirroring how `/add`'s comment step already uses `/skip` — lets a user
  change just one field without re-typing the other. Commands: `/addbudget`,
  `/updatebudget`, `/deletebudget` (no "rename" — budgets have no name).
  `BudgetPlanUpdate.amount` still has no `Field(gt=0)` (D109) but the bot
  path can't send a non-positive amount: `parse_amount_to_minor_units`
  already rejects `<= 0` before it reaches the model.
- D112 (2026-07-23, PR #27 CI): `Field(gt=0)` on `BudgetPlanBase.amount`
  (as D109/Contracts originally specified) broke
  `test_check_limit_zero_amount_plan_returns_none` in CI — that integration
  test inserts a `budget_plans` row with `amount=0` directly (the DB has no
  `CHECK` yet, U1.6) specifically to exercise `check_limit()`'s own
  `row["limit_amount"] <= 0 → None` guard, but the repo reads the row back
  via `BudgetPlanResponse.model_validate(...)`, and `BudgetPlanResponse`
  also inherits `BudgetPlanBase` (four-schema pattern) — so the Base-level
  constraint rejected a legitimate, currently-DB-permitted row on *read*,
  not just on write. Fix: moved `Field(gt=0)` to `BudgetPlanCreate.amount`
  only (overriding the plain `int` inherited from `Base`), so new writes
  through the API are still validated but reading back any existing row
  (test fixture or otherwise) isn't. Confirmed via
  `bash scripts/integration_docker.sh` (46 passed) and the fast unit gate
  (348 passed). Rejected: fixing the test instead — the zero-amount case is
  real product behavior `check_limit()` must keep tolerating until U1.6's
  DB `CHECK` actually prevents such rows from existing.

## STATE (handoff)
- Done: U0.1 (2026-07-21) — `config.family_tz` (default `"UTC"`), new
  `services/period.py::month_bounds(now, tz)`; `budget_service`,
  `expense_service`, `statistics_service` import it and their private
  `_current_month_bounds` copies are deleted; call sites unchanged
  (default `tz="UTC"` — no behavior change yet). `tests/test_period.py`
  covers the AC (mid-year, Dec→Jan rollover, UTC+3 evening-of-31st
  rollover, naive-`now` rejected); the three services' test files had
  their duplicated month-bounds tests removed and imports/assertions
  repointed at `services.period.month_bounds`. `tzdata`-in-container risk
  checked and closed (D108) — no `uv.lock` touch. `verify.sh` green.
- Done: U0.2 (2026-07-21) — `ExpenseResponse.user_name: str | None = None`
  (LEFT-JOIN-populated later, D102); `BudgetPlanCreate.amount` gained
  `Field(gt=0)` (moved off `BudgetPlanBase` post-CI, see D112 — originally
  landed on `Base` per D109/Contracts, broke reading back a pre-existing
  zero-amount row via `BudgetPlanResponse`; `BudgetPlanUpdate` still NOT
  touched, that part of D109 stands); `StatisticsService.by_period/
  by_category/by_tag` gained `start`/`end` params (`by_period` also
  `category_id`/`tag_id`) as accepted-but-unapplied stubs (D110);
  `bot/client.py`'s three `statistics_*` methods fully forward the same
  params as query strings. Tests added: `tests/test_models.py`
  (user_name round-trip, amount<=0 ValidationError on Create),
  `tests/test_statistics_service.py` (stub params don't change output),
  `tests/test_bot_client.py` (query-string pass-through and omission).
  `tests/README.md` updated. `verify.sh` green (348 unit); PR #27 opened,
  CI's integration job caught the `Field(gt=0)`-on-Base regression
  (D112) — fixed and confirmed via `bash scripts/integration_docker.sh`
  (46 passed). This unit is flagged Human-review in the plan (touches
  reviewed MVP contracts) — no reviewer subagent run, human sign-off
  pending. **Merged to master via PR #27.**
- Done: U2.2 (2026-07-22, out of milestone order — see D111) —
  `BudgetManage` StatesGroup (`bot/states.py`); `BudgetCallback` +
  `budgets_keyboard` (`bot/keyboards.py`); `bot/handlers/budgets.py` gained
  `/addbudget` (category → amount → notify-threshold%, threshold
  defaultable via `/skip`), `/updatebudget` (select plan → new amount →
  new threshold, both independently skippable, "Nothing changed." if both
  skipped), `/deletebudget` (select → delete), all reusing
  `parse_amount_to_minor_units` from `bot/handlers/expenses.py`; 409
  (duplicate plan) → "already exists" message, 403 → permission message.
  `/budgets` read-only rendering unchanged. Tests: 20 new cases in
  `tests/test_bot_handlers_budgets.py` (add/update/delete happy paths,
  duplicate, permission-denied, invalid amount/threshold re-prompts,
  cancel, registration-order) + 3 in `tests/test_bot_keyboards.py`
  (`budgets_keyboard`/`BudgetCallback`). `tests/README.md` updated.
  `verify.sh` green (369 non-integration tests). Branched off
  `U0.2_contract_deltas` before PR #27 merged; `origin/master` merged back
  into this branch to pick up the D112 fix and resolve the branch-order
  gap (one conflict, in this STATE section — resolved by keeping U0.2's
  master-side text above and this note). Reviewed by the reviewer
  subagent same session (APPROVE — one WARN + two NITs, all flagged not
  fixed: 404-on-stale-plan-id falls through to the generic error message
  instead of a specific one; amount/threshold parse-reprompt blocks are
  duplicated between add/update; `_parse_notify_threshold`'s bare `int()`
  accepts PEP 515 underscore literals as a side effect).
- Next: CP0 live MVP test (if not already done) → CP1 (re-run CP0 commands
  to confirm U0.1+U0.2 broke nothing) → follow Live-test checkpoints order
  (CP1…CP8), NOT strict milestone order. U1.2 is the next unit that
  actually wires the statistics stub params (D110) and `family_tz` into
  `statistics_service`'s default bounds. U2.2 (this unit) landed early per
  D111 — U1.1 through U1.6 and U2.1/U2.1b are still open ahead of it in
  the plan's own order.
- Gotchas: decision ids start at D100 (MVP plan owns D1–D45). Two
  stop-and-ask gates: U1.6 (migrations/versions/) and U2.4 (uv.lock).
  MVP plan's pending items still stand: U4.4b reviewer pass never ran;
  MVP U6.1 not implemented (U5.1 landed on master, PR #25). New packages
  need `__init__.py` (MVP D7). Never name a repo method after a builtin
  used in later annotations (MVP D22). `family_tz` is NOT yet wired into
  any service's default month calc — only `config` + the shared helper
  exist; U1.2 wires it into `statistics_service` per Contracts (budget/
  expense notification-check bounds stay UTC unless a later unit adds
  that — not currently listed). `BudgetPlanUpdate.amount` still lacks
  `Field(gt=0)` — U1.6 needs to decide whether to add it for PATCH 422s
  (D109).
