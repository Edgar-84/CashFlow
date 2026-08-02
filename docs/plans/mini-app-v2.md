# Plan: Telegram Mini App V2

Third plan file for this project, after `docs/plans/expense-tracker-mvp.md`
(V1 MVP, D1–D45, done) and `docs/plans/family-features-v1_1.md` (V1.1,
D100–D124, done). Decision ids here start at **D200**.

Design source of truth: **`docs/design/mini-app-ux.md`** — screens, per-screen
states, tokens, palette, copy rules. A unit implements a screen *as specified
there*; it does not invent screens or states. If implementation needs a change
to a screen spec, that is a design change: edit the design doc and record a
D-number here.

Workflow per unit: `/clear` → `/unit <id> docs/plans/mini-app-v2.md` →
Stop-gate (`verify.sh`) → [reviewer subagent for risky units] → human commits.

## Goal
A Telegram Mini App that does the two things chat is bad at: show the month as
one shape (donut, above the fold, no commands), and record an expense on one
surface in under ten seconds. It is a second HTTP client of the existing
backend — the bot keeps working unchanged and remains the only surface that
receives notifications.

## Non-goals
- **Retiring the bot.** It stays the fastest path for a one-line expense and
  the only notification surface. No bot command is removed by this plan.
- **Screens 06 (Categories) and 07 (Tags)** — specified in the design doc,
  deferred past v1 (D204). Management stays bot-only. Consequence: no
  `categories.color` migration in v1 (D206).
- Offline write queueing (read-only offline only), voice input, self-
  registration, admin surfaces (users/permissions) — still V2 admin panel. Its
  DB allowlist prerequisite is done (`docs/plans/bot-allowlist-db.md`,
  shipped before U0.1).
- Any change to notification behaviour. Fan-out (D104) is untouched.
- CORS anything — the app is same-origin (D201).

## Constraints
- All root CLAUDE.md rules, plus `webapp/CLAUDE.md` for anything under
  `webapp/`. Layering unchanged: the Mini App is another HTTP client, no
  business logic leaves `services/`.
- **The bot's auth path is never changed or replaced** — `initData` is
  strictly additive. Every existing bot and API test stays green.
- **No secret in browser-shipped code.** `verify.sh` greps the build output;
  that check may never be weakened.
- MVP/V1.1 contracts stay valid. Every delta is listed under Contracts.
- Unit budget per task-methodology: ≤ ~300 diff lines, ≤ 5 files, ≤ 1 new
  decision. Config-only/boilerplate units may run larger (methodology §1.2).
- One human sign-off gate: **U1.5** publishes a port and puts the API on the
  public internet for the first time. The session stops and asks before
  editing `docker-compose.prod.yml` / deploy config.

## Contracts (U0)

**Backend — `config.Settings`**
- `mini_app_url: str | None = None` (env `MINI_APP_URL`)
- `initdata_max_age_sec: int = 86400` (env `INITDATA_MAX_AGE_SEC`)
- ~~`family_currency`~~ superseded by D211 (U0.5) — currency is per-account,
  not a deployment-wide env var.

**Backend — currency (U0.5, supersedes D203)**
- `models/enums.py::Currency` — `StrEnum` of the 15 supported ISO 4217 codes
  (see U0.5 below for the list).
- `accounts.currency` — `TEXT NOT NULL DEFAULT 'USD'`, same "TEXT + comment,
  no DB CHECK" convention as `users.role`; validated at the Pydantic layer.
- `models/account.py::AccountResponse` — `id, name, currency, owner_id,
  created_at`. No `Create`/`Update` models yet — no account-creation API
  exists (self-registration/admin panel are still V2); accounts are created
  by hand via SQL, per `api/CLAUDE.md`.
- `repositories/account_repo.py::AccountRepository` — generic
  `BaseRepository[AccountResponse]` over `accounts`, no custom queries.
- `models/user.py::UserMeResponse(UserResponse)` — adds `currency: Currency`.
  Used **only** by `GET /users/me`; the shared `UserResponse` (used by every
  other `users` route, `PermissionChecker`, etc.) is untouched, so this has
  zero ripple into existing routes/tests.
- `api/deps.py::get_account_repo` (factory, same pattern as the other
  `get_*_repo` functions) and `get_current_user_with_currency` (composes
  `get_current_user` + `get_account_repo`, mirrors how `PermissionChecker`
  already composes user + permission repo without a service layer — auth
  composition lives in `deps.py` by established convention here).
- `GET /users/me` → `UserMeResponse` instead of `UserResponse` (the only
  route affected).

**Backend — `api/deps.py`**
- New pure `validate_init_data(init_data: str, bot_token: str, max_age_sec: int)
  -> int` → the Telegram user id, or raises. HMAC key is
  `HMAC_SHA256(key=b"WebAppData", msg=bot_token)`, per Telegram's spec — *not*
  the bot token directly.
- `get_current_user` gains a second accepted credential: header
  `X-Telegram-Init-Data`. Resolution order: if that header is present, validate
  it and derive the tg_id from it; otherwise fall back to the existing
  `X-Internal-Token` + `X-Telegram-User-Id` pair, unchanged. Either path then
  resolves the user row exactly as today. Missing/invalid both ways → 401.
  Everything downstream (`PermissionChecker`, `resolve_permission`,
  `enforce_ownership`) is untouched.

**Backend — routes**
- `GET /users/me` → `UserResponse` for the caller. **Not** `require_admin`
  (that is the whole point — MVP D27 makes the rest of `users` admin-only).
  **Built by `docs/plans/bot-allowlist-db.md` U1, which ships first** (D210).
  This plan consumes the endpoint; there is no unit here that creates it.
- `GET /expenses` gains `limit: int = 50` (max 200) and `offset: int = 0`,
  threaded route → service → repo. Order stays `created_at DESC` (U2.5).
- `GET /statistics/by-period|by-category|by-tag` gain
  `months_back: int | None` (0 = current month, 1 = last month, 2 = last three
  months). Computed server-side via `services/period.py::month_bounds` in
  `family_tz`. Passing `months_back` together with `start`/`end` → 422.

**Frontend — `webapp/src`**
- `lib/money.ts`: `parseAmount(input: string) -> number | null` (minor units,
  comma/dot, `1 234,56`, rejects `<= 0`), `formatAmount(minor: number) -> string`.
- `lib/dates.ts`: `formatDay(iso: string, tz: string) -> string`.
- `lib/donut.ts`: `segments(totals: {id, label, minor}[], opts) ->
  {dash, gap, offset, slot}[]` — pure geometry, 2px gap, fixed slot order.
- `lib/telegram.ts`: the only module touching `window.Telegram.WebApp`.
- `api/client.ts`: `ApiClient`, one method per endpoint used in v1, sends
  `X-Telegram-Init-Data` on every request, maps 401/403/404/5xx/network to typed
  results.
- `api/types.ts`: hand-written mirrors of the `*Response` models in use.

## Units

### M0 — Backend deltas (Python; same shape as every unit already shipped)

- [x] **U0.1 `initData` authentication** — `validate_init_data` + the
      `get_current_user` second credential per Contracts; three new settings.
      AC: valid signed payload → the right user; tampered hash → 401; expired
      `auth_date` beyond `initdata_max_age_sec` → 401; well-formed signature for
      a tg_id with no `users` row → 401; **the whole existing suite green,
      proving the bot's header path is untouched**; a route reached with
      `initData` produces the same `PermissionDecision` as with the header pair.
      Files: `config.py`, `api/deps.py`, `tests/test_deps.py`(+).
      RISKY → reviewer subagent. `/effort high`. Model: sonnet.
- [x] **U0.5 Per-account currency** (supersedes D203; human-requested
      mid-plan revision, not originally scoped) — `accounts.currency` column
      + `Currency` enum + `GET /users/me` returns it via `UserMeResponse`.
      `config.family_currency` removed (superseded, unused by any consumer).
      AC: migration adds `accounts.currency TEXT NOT NULL DEFAULT 'USD'` and
      backfills existing rows; `GET /users/me` response includes `currency`
      matching the caller's account; every other `users` route/response is
      byte-for-byte unchanged (still `UserResponse`, no `currency` field);
      an account row with a currency outside the `Currency` enum's 15 codes
      fails Pydantic validation, not a raw DB error; the whole existing
      suite green.
      Files: `models/enums.py`, `models/account.py`(new),
      `models/user.py`, `repositories/account_repo.py`(new), `api/deps.py`,
      `api/users.py`, `config.py`, `migrations/versions/`(new),
      `docs/SCHEMA.sql`, `api/CLAUDE.md`, `CLAUDE.md`, tests ×2+.
      RISKY (migration + shared-model contract change) → reviewer subagent.
      Model: sonnet.
- [x] **U0.3 Expense pagination** — `limit`/`offset` through route → service →
      repo, defaults 50/0, `limit > 200` → 422.
      AC: page 1 + page 2 have no overlap and cover the seeded set; newest-first
      order preserved across pages (@integration); `own_only` filtering still
      applied *after* the DB page (documented — see Risks); default call is
      unchanged for existing callers.
      Files: `api/expenses.py`, `services/expense_service.py`,
      `repositories/expense_repo.py`, tests ×2. Model: sonnet.
- [x] **U0.4 `months_back` period param** — server-side bounds via
      `month_bounds(now, family_tz)`; closes D120.
      AC: `months_back=0/1/2` produce the documented windows in a non-UTC
      `family_tz`; `months_back` + `start` together → 422; omitting everything
      still equals the current family month; a Belgrade-vs-UTC month-rollover
      case asserts the discrepancy D120 accepted is now gone.
      Files: `api/statistics.py`, `services/statistics_service.py`, tests ×2.
      Model: sonnet.

### M1 — Frontend foundation

- [x] **U1.1 Toolchain + verify.sh lane** — `webapp/` scaffold: `package.json`,
      `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts` rendering a
      placeholder, vitest config, `.dockerignore`/`.gitignore` entries;
      `scripts/verify.sh` gains typecheck + lint + vitest + the secret-grep on
      build output; `.github/workflows/ci.yml` gains the toolchain.
      AC: `bash scripts/verify.sh` green end to end on a clean checkout with the
      toolchain installed, and **fails loudly** (not silently skips) without it;
      the secret-grep fails a deliberately planted `INTERNAL_TOKEN` string in a
      source file; `pnpm build` produces `webapp/dist`.
      Yellow-zone file count, all config. Model: haiku-friendly.
- [x] **U1.2 Pure lib: money, dates, donut geometry** — no DOM, no I/O.
      AC: parametrized vitest — `parseAmount` on `12`, `12.5`, `12,50`,
      `1 234,56`, `0`, `-1`, `abc`, `1.234` (three decimals); `formatAmount`
      round-trips; `formatDay` renders in `family_tz` not the device tz;
      `segments()` — shares sum to the circumference minus gaps, slot order
      fixed, single-category and zero-total cases, more than six categories
      folds the tail to "Other". Model: sonnet.
- [x] **U1.3 Telegram adapter + tokens.css** — `lib/telegram.ts` (initData,
      MainButton, BackButton, haptics, theme params, `expand()`), theme params
      mapped onto the token table from the design doc §6.
      AC: unit tests against a fake `window.Telegram.WebApp` — MainButton
      show/hide/label/enabled, BackButton handler wired and unwired on screen
      change, both light and dark param sets produce the documented token
      values, absent Telegram object degrades to a readable "open me from
      Telegram" state rather than throwing. Model: sonnet.
- [x] **U1.4 ApiClient + types** — one method per v1 endpoint, `initData`
      header on every request, typed error mapping.
      AC: tests against a fake fetch — the header is present on every call;
      401 → "reopen from Telegram", 403 → permission message, 404 → not-found
      result, 5xx and network failure → retryable error; query params
      (`limit`/`offset`/`months_back`) serialized as specified; no method sends
      `account_id` or a user UUID. Model: sonnet.
- [x] **U1.5 Serving, reverse proxy, TLS** ⚠ **STOP-AND-ASK GATE** — first
      public exposure of the API. Dockerfile gains a node build stage producing
      `webapp/dist`; `main.py` mounts `StaticFiles(html=True)` at `/` **after**
      every router; prod compose publishes a port behind a TLS reverse proxy;
      README gains a Mini App deployment section (BotFather `/newapp`, menu
      button, cert renewal, rollback).
      AC: `docker compose -f docker-compose.prod.yml config` validates and still
      resolves `CASHFLOW_IMAGE`; a local prod-mode container serves the built
      app at `/` **and** `GET /health` + `GET /expenses` still route to FastAPI,
      not to the static mount (explicit test — this is the failure mode);
      hashed asset filenames so Telegram's webview cache can't pin an old build;
      `verify.sh` green. Human runs the server-side bootstrap per README.
      RISKY → reviewer subagent. Model: sonnet.
      **→ CP1 live-test after this unit.**

### M2 — Screens (each = one screen + all five states from design §3)

- [x] **U2.1 Screen 01 — Home** — donut, top-three legend, over-budget strip,
      six tiles, MainButton.
      AC: renders from a fake `ApiClient`; loading skeleton occupies the final
      layout (no reflow assertion); empty account → "add your first" with tiles
      still reachable; API error → retry affordance; 403 → read-only render, no
      broken buttons; offline → last data + synced marker; donut segment tap
      routes to the filtered list; category→colour mapping is stable across two
      renders with a category appended.
- [x] **U2.2 Screen 02 — Add expense** — the one-surface composer.
      AC: amount focused on open; MainButton disabled and labelled "Choose a
      category" until one is picked, then restates the action; invalid amount
      inline (never a popup); **double submit issues exactly one `POST`**;
      403/404-on-stale-category/network-failure each show a human message with
      the draft preserved; BackButton on a dirty draft confirms before
      discarding; success → haptic + close + Home refetched.
- [x] **U2.3 Screen 03a — Expenses list** — grouped by day with per-day
      subtotals, pagination.
      AC: day grouping and subtotals match seeded data; second page appends
      without duplicating; end-of-list marker; empty-per-filter message names
      the filter; `own_only` response renders without an error state; loading
      skeleton rows.
- [x] **U2.3b Screen 03b — Expense detail, edit, delete** (split from U2.3,
      same rationale as MVP D43 / V1.1 U2.1b).
      AC: detail shows category, author, tags, comment; edit round-trips one
      field at a time; delete shows a 5s undo **before** the API call and the
      row returns if it is used; delete failure restores the row; 403/404 →
      human messages.
- [x] **U2.4 Screen 04 — Budgets** — bars in the category's own colour with a
      threshold tick, states in words plus an icon.
      AC: threshold tick lands at `notify_threshold`; over-budget renders the
      flag with icon **and** text (not colour alone); no-budgets empty state;
      unbudgeted categories listed with the contextual MainButton; 409 duplicate
      plan and 403 → human messages.
- [x] **U2.5 Screen 05 — Statistics** — period presets via `months_back`
      (U0.4), donut + ranked bars, category/tag grouping toggle.
      AC: each preset sends the right `months_back` and nothing else; grouping
      toggle re-renders without refetching the period; bars sorted descending
      with the leader at full width and every value printed; empty period;
      single category renders without a legend; loading keeps bar slots at zero
      width with no reflow.

### M3 — Smoke

- [x] **U3.1 e2e smoke through `initData` (@integration)** — a signed payload
      built with the test bot token traverses the real app: authenticate →
      `GET /users/me` → `POST /expenses` → the expense appears in a paginated
      `GET /expenses` → `GET /statistics/by-category?months_back=0` includes it.
      AC: scenario green on the test DB; excluded from default `verify.sh`
      (integration marker); a tampered payload in the same scenario → 401.

## Live-test checkpoints
Each ends with something to try in the dev bot's Mini App (dev `BOT_TOKEN`, own
tg_id seeded via `docs/seed.sql`).

- **CP0 — before U0.1**: finish the V1.1 CP0–CP8 manual pass, and run the
  outstanding prod check `SELECT count(*) FROM expenses WHERE amount <= 0`
  (and the same for `budget_plans`) — V1.1's U1.6 migration hard-fails against
  prod otherwise, and this plan requires a deploy.
- **CP1 — after U1.5**: open the Mini App from the bot's menu button; the shell
  loads over HTTPS, greets you by name from `GET /users/me`, and matches your
  Telegram theme. Proves auth + TLS + serving + theme in one shot.
- **CP2 — after U2.1**: the donut shows real family spending for this month.
- **CP3 — after U2.2**: record an expense in the app; it appears in the bot's
  `/expenses`. This is the payoff.
- **CP4 — after U2.3b**: edit and delete from the app, undo a delete.
- **CP5 — after U2.5**: switch periods, confirm the month boundary now agrees
  with the bot's "this month" (D120 closed by U0.4).

## Risks
- **`initData` HMAC is easy to get subtly wrong.** The key is
  `HMAC_SHA256(b"WebAppData", bot_token)`, not the token; the data-check string
  is the sorted `k=v` pairs joined by `\n` with `hash` removed. A wrong
  implementation either rejects everything or accepts anything. U0.1 is RISKY
  for this reason; test a tampered payload explicitly, not just a valid one.
- **The static mount can swallow API routes.** `app.mount("/", StaticFiles(...))`
  must come after every `include_router`, and U1.5's AC asserts a real API path
  still routes. A regression here is a total outage, not a cosmetic bug.
- **`verify.sh` gains a toolchain dependency.** After U1.1 the Stop-gate needs
  node/pnpm. Deliberate (D208) — a gate that silently skips is not a gate — but
  it means a fresh clone can't run `verify.sh` until the toolchain is installed.
  README must say so.
- **Pagination vs `own_only`.** `GET /expenses` filters by owner *after* the DB
  page (MVP D33's route-level filter), so an `own_only` caller can receive a
  short page. Acceptable at family scale; documented in U0.3's AC. Revisit if a
  `permissions` override row ever makes `own_only` the common case.
- **Telegram webview caching** is aggressive; without hashed asset filenames a
  user can be pinned to an old build with no way to force a refresh.
- **Category colours are client-side in v1** (D206). Deleting a category shifts
  every later category's colour. Accepted; fixed when screen 06 lands with the
  `categories.color` column.
- **Image size and build time** grow with the node stage. Multi-stage keeps the
  runtime layer Python-only; check the final image size in U1.5.
- **Prod deploy-safety flag inherited from V1.1 U1.6** — see CP0. Unresolved at
  the time of writing.
- **`accounts.currency` has no DB `CHECK` constraint** (U0.5, same "TEXT +
  comment" convention as `users.role`). A row manually corrupted to a value
  outside the 15-code `Currency` enum makes `GET /users/me` raise an
  uncaught `pydantic.ValidationError` — an unhandled 500, not a controlled
  4xx (`main.py` has no global `ValidationError` handler). Flagged by
  reviewer on U0.5; accepted as consistent with `role`'s pre-existing,
  identical gap rather than fixed ad hoc for currency alone — a global
  `ValidationError` → 500-with-log handler (or per-field DB `CHECK`
  constraints) would fix both at once and is a candidate for its own unit if
  it ever bites.

## Decision log
- D200 (2026-07-27, HUMAN): the Mini App authenticates with Telegram-signed
  `initData`, validated backend-side, added as a **second accepted credential
  inside the existing `get_current_user`** rather than a parallel router tree or
  a separate dependency. One edit point, so every route and the whole
  `PermissionChecker` pipeline inherit it with no per-route change. Rejected:
  a BFF holding `INTERNAL_TOKEN` (an extra service to run and secure for no
  gain); shipping the internal token to the browser (unacceptable — it is a
  shared secret).
- D201 (2026-07-27, HUMAN): the built app is served by FastAPI `StaticFiles`
  from the **same origin** as the API, baked into the existing image via a node
  build stage. Consequences: no CORS middleware, no `WEBAPP_ORIGIN`, one image,
  one deploy, CD workflow essentially unchanged. Rejected: a separate webapp
  container plus CORS (two images, a cross-origin `initData` header, more moving
  parts); a static host such as Pages (splits deploys across two systems and
  lets frontend and API versions drift).
- D202 (2026-07-27, HUMAN): TypeScript + Vite, **no framework**. Seven screens
  with no shared client state beyond a fetch cache; render functions over a tiny
  router keep the bundle small and leave no framework idioms for a future
  session to get wrong. Rejected: Preact (small, but still machinery this app
  does not need), React (~45KB gzipped for a family expense tracker).
- D203 (2026-07-27): currency is a single deployment-wide `FAMILY_CURRENCY` env
  var, not a per-account column — one family, one currency, and a column implies
  conversion logic nobody asked for.
- D204 (2026-07-27, HUMAN): v1 ships **screens 01–05**; Categories and Tags
  management stay bot-only. Rejected: all seven (adds a migration gate and two
  units to reach the same payoff); walking skeleton only (Home + Add alone
  leaves the month view without the drill-down that makes it useful).
- D205 (2026-07-27): the Mini App's gate is the `users`-table lookup
  `get_current_user` already performs; the bot's allowlist is **not** migrated
  to the DB by this plan. A tg_id with no user row gets 401, which is the same
  practical outcome. The allowlist→DB migration remains the documented
  prerequisite for the V2 admin panel.
  **Amended 2026-07-27 (see D210):** still accurate as scoped — this plan does
  not perform the migration — but the migration is no longer pending. It has
  its own plan, `docs/plans/bot-allowlist-db.md`, sequenced before U0.1.
- D206 (2026-07-27, follows D204): **no `categories.color` migration in v1.**
  Colour is assigned client-side from the category's position in the account's
  list sorted by `created_at ASC` — stable across sessions and devices, shifting
  only when a category is deleted. Rejected: shipping the migration anyway
  (a stop-and-ask gate and a schema change for two screens that are not in v1);
  hashing the category UUID to a slot (stable, but gives no control over which
  category gets which colour and can collide two large categories onto adjacent
  hues).
- D207 (2026-07-27): `months_back` is an integer, not a named-period enum, and
  it is **mutually exclusive** with `start`/`end` (both → 422) rather than one
  silently winning. The bot's existing explicit-bounds presets keep working
  unchanged; only the Mini App uses `months_back`. This is what actually closes
  D120 — the discrepancy existed because a *client* computed month bounds.
- D208 (2026-07-27): `verify.sh` **fails** rather than skips when the JS
  toolchain is missing. A gate that silently degrades is not a gate, and the
  Stop-hook depends on it being total. Rejected: skipping the webapp lane with a
  warning (the first session without pnpm installed would ship untypechecked
  frontend code and the hook would report green).
- D209 (2026-07-27): screens are split into units one screen at a time, and
  screen 03 is split again into list (U2.3) and detail/edit/delete (U2.3b) —
  same sizing rationale as MVP D43 and V1.1 U2.1/U2.1b, both of which landed
  cleanly at that granularity.
- D210 (2026-07-27, HUMAN): **U0.2 (`GET /users/me`) is removed from this plan**
  and built by `docs/plans/bot-allowlist-db.md` U1 instead, which ships first —
  that plan's bot middleware needs the same endpoint as its allowlist probe, and
  building it twice is how two subtly different `/users/me` routes happen. The
  endpoint stays in this plan's Contracts as a consumed dependency, and CP1 still
  proves it end to end. **Unit ids are not renumbered** — U0.3 and U0.4 keep
  their numbers, which are referenced from U2.5 and CP5; a gap at U0.2 is
  cheaper than stale cross-references. Rejected: keeping a duplicate unit in both
  plans (whichever ran second would be a no-op unit that still had to be read,
  reviewed and checked off).
- D211 (2026-07-28, HUMAN): **supersedes D203.** Currency moves from a
  single deployment-wide `FAMILY_CURRENCY` env var to a per-account
  `accounts.currency` column, chosen from a fixed 15-code `Currency` enum
  (not a free-form string). Raised mid-plan by the human after U0.1 shipped;
  not originally scoped as U0.5, added as a new unit rather than folding into
  U0.1 (different risk profile: schema migration + a contract change, vs.
  U0.1's pure auth logic). D203's original reasoning ("one family, one
  currency, a column implies conversion logic nobody asked for") still holds
  for *conversion* — this does not add multi-currency math, budgets/statistics
  still assume one currency per account. It only moves *where* that one
  currency is chosen from an env var (deployment-wide, requires a restart to
  change) to a DB column (per-account, settable at account-creation time,
  which matters once self-registration/the admin panel — currently V2 —
  gives accounts a real creation flow instead of a manual SQL `INSERT`).
  Exposed via `GET /users/me` (`UserMeResponse`, additive) rather than the
  shared `UserResponse` or a new `GET /accounts/me` route, to keep the diff
  contained to one route with zero ripple into the `users` CRUD
  routes/tests/`PermissionChecker`. Rejected: a new `GET /accounts/me`
  endpoint (real new surface — model + repo + route — for one field, with no
  current second consumer to justify a dedicated resource); adding `currency`
  directly to the shared `UserResponse` (would have required every
  `UserRepository` read to `JOIN accounts`, rippling into `UserService`,
  every `users` route, and every existing test constructing a `UserResponse`
  fixture).
- D212 (2026-07-29, U1.1): pnpm **11.x** (installed via Homebrew alongside
  Node 22.13+ — pnpm 11 hard-requires it, CI first shipped with Node 20 and
  crashed with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`, fixed same-day)
  introduces a build-script approval gate — native `postinstall`
  scripts (e.g. `esbuild`'s) are skipped by default and recorded in
  `webapp/pnpm-workspace.yaml`'s `allowBuilds` map, which is what actually
  creates that file (not hand-written). `esbuild: true` is committed there
  so `pnpm install --frozen-lockfile` in `verify.sh`/CI builds esbuild's
  binary non-interactively; `pnpm approve-builds --all` is the non-interactive
  way to regenerate it if a future dependency adds another native postinstall
  step. Lockfile format is `lockfileVersion: '9.0'`. No contract change —
  purely a toolchain-behavior note for whoever next runs `pnpm install` here
  cold.
- D213 (2026-07-29, U1.5, HUMAN): **Caddy** as the TLS reverse proxy in front
  of the api, run **as a compose service in `docker-compose.prod.yml`** (not
  a system-level proxy on the host). `caddy:2-alpine`, one-block Caddyfile
  driven by `$MINI_APP_HOST`, two named volumes (`caddy_data`,
  `caddy_config`) persist LE cert material across `up -d --force-recreate`.
  Rejected: nginx + certbot (two services or a combined image, manual
  renewal orchestration for zero gain at family scale); Traefik (label-based
  routing is overkill for one backend service); a system-level Caddy/nginx
  bound to 443 on the host with compose publishing to `127.0.0.1:8000`
  (splits the deploy story — the `docker compose up` you already have stops
  being enough, and adds a second thing to reason about on every server
  bootstrap). Consequence: only the `proxy` service publishes ports (80/443
  + UDP 443 for HTTP/3); the `api` service stays unpublished, reached over
  the internal compose network exactly as before. Cert renewal is fully
  automatic (Caddy handles ACME + renewal timers itself); the only ongoing
  ops burden is not deleting the `caddy_data` volume.
- D214 (2026-07-29, U1.5): the `StaticFiles(html=True)` mount at `/` is
  **conditional on `webapp/dist` existing** — `create_app(webapp_dist=…)`
  takes an optional `Path` and only mounts when the directory is present.
  Rationale: bare-host dev (`uvicorn main:app --reload` with no prior
  `pnpm build`) and the existing pytest suite must keep working with no
  build present; the Dockerfile's `webapp-builder` stage always populates
  `dist` in the image, so prod is unaffected. Also lets `tests/test_static.py`
  point `create_app` at a `tmp_path` fixture and drive the mount from tests
  without polluting the real `webapp/dist`. Rejected: unconditional mount
  (every bare-host dev run and every existing test would have to `pnpm build`
  first — bad ratio for what's a purely additive feature); env-var flag to
  enable the mount (two switches for what's one signal — is dist there or
  not — is worse than one).

- D215 (2026-08-02, U2.3, HUMAN): Expenses-list day grouping uses the
  **device** timezone, not `family_tz` — no Contract exposes `family_tz` to
  the browser (`GET /users/me`'s `UserMeResponse` doesn't carry it, and no
  other endpoint does either). Asked mid-unit: extend `UserMeResponse` with
  `family_tz` (a small additive backend change, same shape as D211's
  `currency` addition) vs. accept the device-tz gap now, documented, same
  category as U1.2's non-locked `formatDay` string format. Human chose the
  device-tz gap. Rationale accepted: day-grouping is list *presentation*
  (which visual bucket a row's date badge falls under), not the
  month-boundary *financial* math D120/webapp/CLAUDE.md's ironclad rule is
  about (budgets, statistics, notification thresholds) — a family member in a
  different tz seeing a near-midnight expense grouped under the "wrong" local
  day is a much lower-stakes cosmetic mismatch than a miscalculated total.
  `lib/dates.ts::formatDay` and the new `screens/expenses.ts::groupByDay` both
  already take an explicit `tz` param for exactly this reason — fixing this
  later means threading `family_tz` onto `UserMeResponse` and passing it at
  `main.ts`'s call site, not touching `expenses.ts`'s grouping logic itself.
  Rejected (for now): adding `family_tz` to `UserMeResponse` in this unit
  (would have made a frontend-only unit touch a reviewed backend contract
  again, so soon after D211, for a cosmetic gap with an already-documented,
  reversible workaround).

- D216 (2026-08-02, U2.3b): Both delete's 5s-undo and edit's "one field at a
  time" are scoped to the **detail screen itself**, not the list row the AC's
  wording ("the row returns if it is used") most literally describes. Reasons:
  (1) the plan's own flow diagram (§5) routes `E[Expenses] --> D[Expense
  detail] --> DL[Delete + undo]`, i.e. delete hangs off detail, not the list;
  (2) a real swipe-to-delete gesture on the list needs either a new runtime
  dependency (webapp/CLAUDE.md's do-not-edit-without-asking lockfile gate) or
  nontrivial custom touch handling neither the AC nor the design doc's states
  spell out in enough detail to build untested. Implementation: tapping
  Delete on the detail screen swaps its action buttons for an inline
  "Expense deleted. Undo" banner; undo cancels with **no API call ever
  made**; the 5s timeout (DOM/mount glue, `setTimeout`) then fires exactly
  one `DELETE`; a failed delete flips back to the normal detail view with a
  human message — "the row returns" in the sense that the expense was never
  actually removed from the account. Edit similarly mirrors the bot's
  `/editexpense` field-picker (Amount/Category/Comment/Tags) rather than one
  combined form — each field commits with its own immediate `PATCH`
  (category/tag chip taps commit on tap; amount/comment need an explicit
  Save), satisfying the AC's "round-trips one field at a time" literally: one
  request per edited field, independent of the others.

## STATE (handoff)
- Done: **U0.1** — `validate_init_data` (`api/deps.py`) verifies the Telegram
  HMAC (`WebAppData` key, sorted `k=v\n`-joined data-check string, `hash`
  removed) and returns the tg_id; `get_current_user` now resolves
  `X-Telegram-Init-Data` first, falling back unchanged to
  `X-Internal-Token` + `X-Telegram-User-Id`. Three new `Settings` fields
  (`family_currency`, `mini_app_url`, `initdata_max_age_sec`). Tests added to
  `tests/test_deps.py` cover valid/tampered/expired/unknown-user payloads and
  assert the same `PermissionDecision` via either credential, plus one
  hardcoded vector computed out-of-band via `openssl dgst -hmac` (reviewer
  flagged that a self-consistent test suite alone can't catch a systematic
  HMAC error). Full suite green (514 passed) — the bot's header path is
  unaffected. Shipped as PR #45.
- Done: **U0.5** (D211, human-requested mid-plan revision) — `accounts.currency`
  column (migration `0231c6bd4dfa`, `TEXT NOT NULL DEFAULT 'USD'`); new
  `Currency` enum (15 codes); `models/account.py::AccountResponse`;
  `repositories/account_repo.py::AccountRepository` (plain
  `BaseRepository`, no custom queries); `GET /users/me` now returns
  `UserMeResponse` (`UserResponse` + `currency`) via a new composed
  dependency `get_current_user_with_currency` in `api/deps.py` — every
  other `users` route/response is untouched. `config.family_currency`
  removed (superseded, had zero consumers). Full suite green (518 passed);
  schema + `AccountRepository` also verified against a real Postgres via
  `scripts/integration_docker.sh`.
- Done: **U0.3** — `GET /expenses` gains `limit` (default 50, `Query(ge=1, le=200)`
  → 422 over 200) and `offset` (default 0, `Query(ge=0)`), threaded through
  `ExpenseService.list` to `ExpenseRepository.list`, which now takes explicit
  `limit`/`offset` keyword args (separate from the equality `**filters`) and
  adds `LIMIT`/`OFFSET` to the SQL, still `ORDER BY created_at DESC`. Default
  call (`list(account_id=...)` with no limit/offset) is unchanged for every
  existing caller. `own_only` filtering in the route is untouched — it still
  runs after the DB page, per the plan's documented Risk. Tests added at all
  three layers (service pass-through, API 422 + no-overlap pagination,
  integration repo test proving newest-first order holds across a page
  boundary) plus `test_list_default_limit_is_50`. Full suite green (523
  passed) and the 21 `test_expense_repo.py` cases green against a real
  Postgres via `scripts/integration_docker.sh`.
- Done: **U0.4** — `GET /statistics/by-period|by-category|by-tag` gain
  `months_back: int | None` (`Query(ge=0, le=2)`; anything else → 422),
  mutually exclusive with `start`/`end` (both → 422, `api/statistics.py::
  _validate_period`). `services/statistics_service.py` gets a new
  `_window_for_months_back(months_back, now, tz)`: 0/`None` = current month
  (delegates straight to `month_bounds`), 1 = the single prior calendar
  month, 2 = the three calendar months before the current one — all
  family-tz-correct. It computes "N months back" by feeding
  `month_bounds` the instant just before each boundary
  (`_month_start_before`) rather than duplicating month/DST arithmetic, so
  `services/period.py` needed no changes (stayed inside the plan's Files
  list for this unit). This is what actually closes D120: the bot's
  `preset_bounds()` (`bot/handlers/statistics.py`) still computes "last
  month"/"last 3 months" in plain UTC for its own presets — unchanged, out
  of scope — but the Mini App's `months_back` param now gets the
  family-tz-correct version server-side, which is the discrepancy D120
  accepted. No new decision: implementation stayed inside D207's contract
  (`months_back` is a plain int, mutually exclusive with `start`/`end`).
  Tests: 4 new in `test_statistics_service.py` (0/1/2 presets +
  a Europe/Belgrade rollover case mirroring the existing family_tz test,
  proving the D120 discrepancy is gone for `months_back=1`), 4 new in
  `test_statistics_api.py` (422 on `months_back`+`start`, 422 on
  `months_back=3`, `by-period` end-to-end with `months_back=1`,
  `by-category` passthrough). `tests/README.md` updated. Full suite green
  (531 passed).
- Done: **U1.1** — `webapp/` scaffold (TypeScript + Vite, no framework, D202):
  `package.json` (scripts `dev`/`build`/`typecheck`/`lint`/`test`),
  `tsconfig.json` (strict), `vite.config.ts` (via `vitest/config`, `test.
  environment: "node"`), `eslint.config.js` (flat config, `typescript-eslint`
  recommended, non-type-aware), `index.html`, `src/main.ts` (placeholder —
  `placeholderText()` extracted as a pure function so it's testable without a
  DOM; the `document` write is guarded with a `typeof document !== "undefined"`
  check since the vitest suite imports the module directly under Node),
  `tests/main.test.ts`. `.gitignore`/`.dockerignore` gained
  `webapp/node_modules`/`webapp/dist` entries (`webapp/pnpm-lock.yaml` stays
  tracked, same convention as `uv.lock`). `scripts/verify.sh` gained a webapp
  lane: toolchain check (fails loudly, not silently, per D208) →
  `pnpm install --frozen-lockfile` → typecheck → lint → vitest → build →
  secret-grep (`INTERNAL_TOKEN|BOT_TOKEN|DATABASE_URL`) over `webapp/dist`.
  `.github/workflows/ci.yml`'s `verify` job gained `pnpm/action-setup`
  (pointed at `webapp/package.json` — the `packageManager` field isn't at
  repo root) + `actions/setup-node` (Node 22, pnpm-store cache) ahead of the
  `bash scripts/verify.sh` step. D212: pnpm 11's build-script approval gate
  (`webapp/pnpm-workspace.yaml`'s `allowBuilds`) needed `esbuild: true`
  committed for `--frozen-lockfile` installs to build esbuild's binary
  non-interactively. Verified by hand: `verify.sh` green with the toolchain
  present; re-run with `pnpm` removed from `PATH` (`uv` still present) fails
  loudly with a clear error and non-zero exit, doesn't silently skip; a
  secret string referenced from `main.ts`'s entry graph and rebuilt into
  `dist` was caught by the grep, then removed and reconfirmed clean. Full
  Python suite unaffected (531 passed). No tests deleted or modified outside
  `webapp/`.
- Done: **U1.2** — `webapp/src/lib/money.ts` (`parseAmount`/`formatAmount`),
  `webapp/src/lib/dates.ts` (`formatDay`), `webapp/src/lib/donut.ts`
  (`segments`), no DOM/I/O in any of them.
  `parseAmount` mirrors `bot/handlers/expenses.py::parse_amount_to_minor_units`
  byte-for-byte in accepted/rejected input shape (whitespace incl. nbsp
  stripped via JS's Unicode-aware `\s`, comma→dot, reject >1 decimal
  separator, reject non-positive) but returns `number | null` instead of
  throwing, since this is a UI input helper, not a command parser. Cents are
  rounded half-up on the decimal **string**, not `Math.round(value * 100)` on
  the parsed float — review caught that the float form silently disagrees
  with the bot's `Decimal(ROUND_HALF_UP)` at the half-cent boundary
  (`1.005 * 100 === 100.49999999999999` in IEEE 754, rounding to 100 instead
  of 101). Fixed by reading the third fractional digit directly off the
  string to decide the carry (sufficient for round-half-up to 2 places: a
  third digit < 5 can never reach 0.5 regardless of trailing digits, and
  ≥ 5 always rounds up), with `1.005`/`1.995` (carry into the whole part)
  added to `money.test.ts` as regression cases.
  `donut.ts::segments()` is a new contract with no prior art (the bot's
  `charts.py` renders text bars, not SVG geometry): given
  `{id, label, minor}[]` it returns one `{dash, gap, offset, slot}` per
  input row in the same order (`slot` = array index, so the fixed
  slot-order/never-cycled rule from D206/design §6 falls out of "don't
  reorder the input" rather than needing its own logic here); more than
  `maxSlots` (default 6) rows fold the tail into a synthetic trailing "Other"
  row (sum of the remainder) so the returned array is never longer than
  `maxSlots + 1` — the caller is responsible for labelling that last slot
  "Other" when `totals.length > maxSlots`, since the return type
  per Contracts is geometry-only (no id/label). Gap is a fixed 2px per the
  design doc; dash shares are computed against `circumference - gap * n` so
  `sum(dash) + n*gap === circumference`. Zero-total input draws `dash: 0` for
  every row (a plain empty ring, no arcs) rather than a special case object.
  `dates.ts::formatDay(iso, tz)` uses `Intl.DateTimeFormat` with the `tz`
  option — the exact display string (`"Wed, Jul 29"`, short weekday + short
  month + numeric day) isn't specified anywhere in the design doc, so this is
  a reasonable default, not a locked contract; free to change in a later unit
  without a Decision-log entry since no consumer exists yet.
  Tests: `webapp/tests/money.test.ts` (parametrized `parseAmount` table incl.
  the three-decimal/half-up case and the `1.005`/`1.995` half-cent boundary
  regressions, round-trip through `formatAmount`),
  `webapp/tests/dates.test.ts` (same instant renders a different calendar
  day in `UTC` vs `Europe/Belgrade` and vs `America/New_York`, proving
  family_tz-not-device-tz), `webapp/tests/donut.test.ts` (share-sum invariant,
  fixed slot order, single-category, zero-total, >6-categories fold, offset
  accumulation). No Python files touched; full suite still 531 passed.
  `bash scripts/verify.sh` green end to end (webapp vitest: 24 tests across 4
  files). No new decision — every choice here fills in geometry/format detail
  the Contracts section left unspecified, none of it contradicts a design-doc
  decision or needs one.
- Done: **U1.3** — `webapp/src/lib/telegram.ts` (the only module touching
  `window.Telegram.WebApp`) and `webapp/src/styles/tokens.css` (the §6 token
  table, nothing else). `getWebApp()` guards with `typeof window ===
  "undefined"` first (mirrors `main.ts`'s `typeof document` guard) so the
  module never throws when opened outside Telegram, then every export
  (`mainButton.show/hide/setEnabled`, `setBackButtonHandler`, `haptics.impact/
  notification/selection`, `expand()`, `getInitData()`) no-ops safely absent a
  `WebApp`; `isAvailable()` plus the exported `NOT_IN_TELEGRAM_MESSAGE` string
  is the "readable open-me-from-Telegram state" the AC asks for — no screen
  wiring yet, that lands with M2. `setBackButtonHandler(handler | null)` keeps
  one module-level `currentBackHandler` and calls `offClick` on it before
  wiring the next one (or hiding on `null`) — the wired/unwired-on-screen-
  change shape the AC specifies. Theme: `resolveThemeTokens(colorScheme)` is a
  pure function returning the exact light/dark hex values from the design
  doc's first §6 table (Telegram's `colorScheme` only selects which fixed set
  applies — its own arbitrary theme colours are never read), so both variants
  are testable without a DOM; `applyTheme()` reads `webApp.colorScheme`,
  defaults to `"light"` absent Telegram, and writes the CSS custom properties
  plus a `data-theme` attribute onto `document.documentElement`, guarded the
  same way as `main.ts` (untestable under vitest's `node` environment, same
  gap `main.test.ts` already accepts for its `document` branch). `tokens.css`
  declares the light values as `:root` defaults (initial paint / no-Telegram
  fallback) plus a `:root[data-theme="dark"]` override block that
  `applyTheme()`'s `data-theme` write activates; it also carries the §6
  category-palette and status-red tables since those are still part of the
  same design-doc token table and need a home before the donut/statistics
  screens land. Tests: `webapp/tests/telegram.test.ts` — a hand-built fake
  `TelegramWebApp` with `vi.fn()` members; MainButton show/hide/enable/disable;
  BackButton wiring uses `vi.resetModules()` + a dynamic re-import to get an
  isolated `currentBackHandler` for the sequential wire→rewire→unwire
  assertions; both theme variants against the documented hex values; an
  "absent Telegram" block asserting every export is a no-op rather than a
  throw. No new decision — mapping `colorScheme` onto fixed design-doc hex
  values (rather than reading Telegram's own arbitrary theme palette) fills in
  a Contracts detail ("theme params mapped onto the token table") the same way
  U1.2's `formatDay` string format did, and doesn't contradict D206 (category
  colour is still assigned client-side, unaffected by this unit) or any other
  locked decision. Full suite still 531 passed (Python untouched); webapp
  vitest now 34 tests across 5 files; `bash scripts/verify.sh` green end to
  end.
- Done: **U1.4** — `webapp/src/api/types.ts` (hand-written mirrors of the
  Pydantic `*Response` models used by v1: `UserMeResponse`, `Currency`,
  `ExpenseResponse`/`Create`/`Update`, `CategoryResponse`, `TagResponse`,
  `BudgetPlanResponse`/`Create`/`Update`, `BudgetProgress`, `PeriodTotal`,
  `CategoryTotal`, `TagTotal`) and `webapp/src/api/client.ts` (`ApiClient`
  class, 16 methods — one per v1 endpoint across users/expenses/categories/
  tags/budgets/statistics). Every request funnels through one private
  `request()` that (a) attaches `X-Telegram-Init-Data` on every call — value
  is `getInitData() ?? ""` so a missing initData produces a clean backend
  401 instead of a header-shape 400, (b) sets `Content-Type: application/json`
  only when a body is present, (c) skips undefined query params entirely
  but sends `months_back=0` (the U0.4 "current month" value would be
  silently dropped by a truthy check — bug guarded by a dedicated test).
  Typed errors thrown by `request()`: `AuthError`(401), `ForbiddenError`(403),
  `NotFoundError`(404), `RetryableError`(5xx or fetch-rejection); any other
  non-2xx is a plain `ApiError` with the status — screens (M2) translate
  these into human strings, never a raw status. `fetch` rejects only on
  network-layer failure (DNS/TCP/CORS…), not on HTTP status, so a bare
  `catch` on the fetch call is the correct place to map to `RetryableError`.
  DI-friendly constructor (`{baseUrl?, fetch?, getInitData?}`) — same shape
  as `lib/telegram.ts`'s testable exports; real boot wires
  `getInitData: getInitData` from `lib/telegram` in a later screen unit.
  Tests: `webapp/tests/client.test.ts` (20 cases) — header present on all 16
  endpoints (whole-surface sweep, not just `request()` proxy), header sent
  as `""` when initData is null (proves clean-401 path), 401/403/404/500/503
  → their respective typed errors with the right `status` and message,
  network reject → `RetryableError` with `undefined` status, unmapped 409 →
  plain `ApiError` (not retryable — a duplicate-plan 409 is not a
  retry-and-hope situation), `limit`/`offset` serialized, `months_back=0`
  survives the falsy trap, `createExpense`/`createBudgetPlan` bodies
  contain no `account_id`/`user_id` (the webapp/CLAUDE.md ironclad rule),
  Content-Type set on POST/PATCH and absent on GET/DELETE, 204 resolves to
  `undefined` without JSON parsing, typed response shapes round-trip.
  No new decision — every choice fills in a Contracts detail (throwing
  typed errors vs Result union; DI constructor shape; header on missing
  initData) rather than contradicting a locked decision. `bash
  scripts/verify.sh` green end to end (webapp vitest now 54 tests across 6
  files; Python still 531 passed; secret-grep clean).
- Done: **U1.5** (D213, D214, STOP-AND-ASK gate — human sign-off obtained
  on both decisions before any deploy-config edit) — the Mini App now
  ships in the same image as the api and is served over TLS from the
  same origin. `Dockerfile` gains a `webapp-builder` stage
  (`node:22-alpine` + corepack-pinned pnpm via `packageManager`) that
  runs `pnpm install --frozen-lockfile && pnpm run build`; the runtime
  stage `COPY --from=webapp-builder --chown=app:app /webapp/dist
  ./webapp/dist` (node never ships to the final image, keeping it
  Python-only). `main.py`: `create_app(webapp_dist: Path | None = None)`
  now mounts `StaticFiles(directory=dist, html=True)` at `/` **after
  every `include_router()` call** (the plan's "static mount can swallow
  API routes" failure mode), gated on `dist.is_dir()` per D214 so
  bare-host dev + the existing pytest suite still work with no build
  present. `docker-compose.prod.yml` gains a **`proxy`** service
  (`caddy:2-alpine`, D213) publishing 80/443 + UDP 443, mounting a repo-
  root `Caddyfile` (one block: `{$MINI_APP_HOST} { reverse_proxy
  api:8000 }`) read-only, with `caddy_data`/`caddy_config` named
  volumes for LE cert persistence; the api service stays unpublished.
  Hashed asset filenames come for free from Vite's defaults
  (`assets/index-<hash>.js`) — confirmed against a real `pnpm build`
  output; no vite.config change needed. `tests/test_static.py` (new, 5
  cases) drives `create_app(webapp_dist=tmp_path/"dist")` against a
  fake dist tree: `GET /` returns the fixture index; `GET
  /assets/app-DEADBEEF.js` returns the fixture asset; `GET /health`
  still returns JSON (router wins); `GET /expenses` reaches FastAPI
  (401 via a `get_current_user` dep override — the point is routing,
  not permissions) — this is the plan's explicit U1.5 no-swallow AC;
  and `create_app` skips the mount when the directory is absent.
  `README.md`: env-var table gains `MINI_APP_HOST`/`MINI_APP_URL`/
  `INITDATA_MAX_AGE_SEC`; new "Mini App deployment" section covers
  BotFather `/newapp` + `/setmenubutton`, DNS + firewall (80/443, UDP
  443 for HTTP/3), Caddy first-deploy cert issuance, rollback (same
  pathway as api/bot — pin `CASHFLOW_IMAGE`), automatic renewal
  (Caddy handles ACME itself; the only ops burden is not deleting the
  `caddy_data` volume), and the hashed-asset cache-bust invariant
  (don't add unhashed files to `dist`). `tests/README.md` gains the
  `test_static.py` section. Verification: `bash scripts/verify.sh`
  green (Python 536 passed, webapp vitest 54 across 6 files, secret-
  grep clean); `docker compose -f docker-compose.prod.yml config`
  validates with `CASHFLOW_IMAGE` resolving correctly and the placeholder
  `MINI_APP_HOST=miniapp.example.invalid` default in the compose file
  keeping laptop `config` runs green even without `MINI_APP_HOST` set;
  `docker build --target=webapp-builder` and full `docker build` both
  succeed and the runtime image has `/app/webapp/dist/index.html` +
  `assets/` owned by `app:app`. Not run: the actual server-side
  bootstrap (DNS record, first `up -d`, BotFather registration) — that
  step is on the human per the plan's AC and the new README section.
- Done: **U2.1** — Screen 01 (Home). Three new modules: `lib/category-colors.ts`
  (D206's slot assignment as its own pure function — sorts categories by
  `created_at ASC`, slots 1..6, `null` past the sixth — factored out of
  `home.ts` since screens 03/05/06 will need the same mapping);
  `screens/home.ts` (data/interaction/presentation layers, see its own file
  header); `main.ts` rewritten from the U1.1 placeholder into the real boot
  (`applyTheme` → `ApiClient` wired to `lib/telegram::getInitData` →
  `loadHome` → `applyHomeChrome` → `mount`), guarded by the same
  `typeof document` check every DOM-touching export in this codebase already
  uses. `index.html` gained a `<link>` to `tokens.css` (U1.3 wrote the file
  but nothing loaded it yet — this is the first screen that needs it
  rendered).
  `HomeState` is a six-way discriminated union (loading/error/forbidden/
  empty/ready/offline) built by `loadHome()`, which never throws — every
  `ApiClient` failure resolves to one of the states instead. `renderHome()`
  is a pure `HomeState -> HTML string` function (testable without a DOM,
  string-content assertions), and `mount()` is the thin, deliberately
  untested `innerHTML` + click-delegation glue — same accepted gap as
  `lib/telegram.ts::applyTheme`'s `document`-guarded branch.
  Three implementation choices filled gaps the design doc/Contracts left
  open, none contradicting a locked decision (same "no new decision"
  precedent as U1.2/U1.3/U0.4):
  - **The six tiles** are the six non-Home screens in the full 7-screen
    inventory (§3): Add expense, Expenses, Budgets, Statistics, Categories,
    Tags. The design doc only says "six tiles are the whole app" without
    naming them; the exploratory UI-concept artifact shows a 6th "Family"
    tile that isn't among the plan's 7 screens at all, so it wasn't treated
    as a contract. Categories/Tags tiles point at screens M3 hasn't built
    yet (same as Expenses/Budgets/Statistics, not built until U2.2-U2.5) —
    tiles are tappable and haptic-confirmed ("still reachable" per the AC)
    but `main.ts`'s `onTileTap`/`onSegmentTap` handlers are no-ops until
    their target screens exist.
  - **Home also calls `GET /statistics/by-period` (`months_back: 0`)**,
    one endpoint beyond the design doc's Data-in list for this screen. The
    donut hole needs a total, and summing `by-category` totals client-side
    would be exactly the "no aggregation" webapp/CLAUDE.md's ironclad rule
    forbids — `by-period` already returns the total pre-computed server-side.
  - **Over-budget detection calls `GET /budgets/{id}/progress` per plan**
    (N small calls, family-scale N) rather than comparing `by-category`
    spend against `budgets[].amount` client-side. `is_exceeded`/`remaining`
    are `budget_service.calculate_progress`'s job (screen 04's Data-in
    already names this endpoint); computing the same comparison again in
    the client would be the budget-percentage logic the ironclad rule
    explicitly forbids.
  - **No MainButton `onClick` wiring yet.** `lib/telegram.ts`'s `mainButton`
    export never gained a click method in U1.3 (BackButton did) since no
    screen needed it. It still doesn't here: Home's MainButton shows/hides/
    enables correctly, but wiring "tap → open Add-expense" has nothing to
    navigate to until U2.2 builds that screen — deferred there rather than
    added speculatively now.
  Tests: `webapp/tests/category-colors.test.ts` (slot assignment order,
  >6-categories → `null`, stability across an appended category),
  `webapp/tests/home.test.ts` (20 cases) — `buildHomeData` (segment order
  matches creation order not spend order, legend is top-3 **by spend**,
  >6-category donut fold, colour-mapping stability across a re-render with
  an appended category, over-budget strip amount = `spent - amount`),
  `loadHome` (ready/empty/forbidden/error/offline against a fake `HomeApi`,
  including the offline fallback reading a previously cached snapshot),
  `segmentTapTarget`, `applyHomeChrome` (fake `TelegramWebApp`, same pattern
  `telegram.test.ts` established — MainButton shown for ready, hidden for
  loading/forbidden, BackButton always hidden), `renderHome` (string-content
  assertions per state, incl. the single-category "no legend" case and the
  403 state's Add-expense tile rendering `disabled` with no retry button).
  `webapp/tests/main.test.ts` rewritten — `placeholderText()` no longer
  exists (superseded by the real boot); the new test asserts `boot()`
  resolves without throwing when no DOM is present (vitest's `node`
  environment), the same guard-clause smoke test the file always had.
  Verification: `bash scripts/verify.sh` green end to end (Python 536
  passed, webapp vitest 79 across 8 files, typecheck/lint/build/secret-grep
  clean, bundle 11.12 KB gzipped — well under the 150 KB budget). Not run:
  a live browser/Telegram smoke test — that needs a running backend and a
  real or forged `initData`, which this session didn't have; `pnpm dev`
  wasn't exercised interactively either. CP2 (below) is still open.
  **Review fix, same unit**: `main.ts::boot()` originally awaited
  `loadHome()` before ever calling `mountHome()`, so the tested-and-built
  `"loading"` `HomeState` (skeleton) never actually reached `#app` on a real
  boot — `#app` stayed blank until the fetch settled, contradicting the
  AC's "loading skeleton occupies the final layout." Fixed: `boot()` now
  mounts `{status:"loading"}` synchronously before the `await`, then
  re-mounts with the resolved state, reusing one `handlers` object for both
  calls (`HomeHandlers` exported from `screens/home.ts` for this). Two other
  review findings deliberately deferred, not fixed in this unit: (1) no
  component CSS yet for `.tiles`/`.card`/`.strip`/`.home-skeleton` —
  `tokens.css` only carries colour custom properties, so beyond the donut
  SVG itself the screen has no real layout; worth doing before a serious
  CP2 check, tracked as a fast-follow, not blocking since the AC explicitly
  excuses reflow/visual assertions. (2) `renderOverBudgetStrip` only shows
  `overBudget[0]` — a second exceeded category is silently dropped, no
  "+N more" affordance; minor, deferred.
  **Follow-up, post-merge (human live-tested after the SDK-script fix
  below and saw unstyled/run-together text)**: added
  `webapp/src/styles/app.css` — layout/geometry/type for every class
  `screens/home.ts` renders (`.card`, `.row`/`.dot`/`.nm`/`.val`/`.pct`
  legend rows, `.tiles`/`.tile`, `.strip`, `.donut-wrap`/`.donut-c`/`.amt`,
  `.donut-skeleton`/`.legend-skeleton`, `.offline-banner`, the retry
  button), per §6's geometry (14px card radius, tabular-nums amounts at
  700 weight/-0.035em tracking). `tokens.css` stays token-only per its own
  doc comment; this new file is deliberately everything else, and is
  meant to be extended, not duplicated, once U2.3-U2.5 need the same
  `.card`/`.row` patterns. Skeleton dimensions (196px donut, 126px = 3×42px
  legend rows) exactly match the real donut/row sizing so swapping loading
  → ready never reflows — the AC's explicit requirement. Skeleton pulse
  animation is gated behind `prefers-reduced-motion: no-preference`.
  `index.html` links it alongside `tokens.css`. Resolves deferred item (1)
  above; (2) is still open. Verified: `bash scripts/verify.sh` green
  (Python 536 passed; webapp vitest 79/8 files; typecheck/lint/secret-grep
  clean; build now 11.12 KB JS + 1.31 KB CSS gzipped, still well under the
  150 KB budget).
- Done: **U2.2** — Screen 02 (Add expense), the one-surface composer.
  `lib/telegram.ts` gained `mainButton.onClick`/`offClick` (the gotcha
  flagged after U2.1) mirroring `setBackButtonHandler`'s wire-then-unwire-
  before-rewire shape via a new module-level `currentMainButtonHandler`, and
  `confirmDiscard(message)` wrapping Telegram's `showConfirm` (falls back to
  the browser's native `confirm()` outside Telegram, or `true` with neither
  available, so the discard flow can never get stuck) — fills the "Telegram's
  own popup, never a custom modal" Contracts detail, same "no new decision"
  precedent as U1.2/U1.3/U2.1 gap-fills. `screens/home.ts::applyHomeChrome`
  gained an optional second `onAddExpense` parameter so Home's own MainButton
  now also routes to Add-expense (the design doc §5 flow diagram's
  `H -->|MainButton| A`), backward-compatible with every existing call site
  and test.
  New `screens/add-expense.ts`, same three-layer split as `home.ts`:
  - **data**: `loadAddExpenseData` fetches categories/tags/currency
    (`GET /users/me`, `/categories`, `/tags`) via `Promise.all`, mirroring
    `loadHome`'s never-throws/cache-fallback-on-offline contract exactly
    (loading/error/forbidden/empty/ready/offline). `empty` (no categories at
    all) is defensive — root CLAUDE.md guarantees a seeded "General"
    category on every account, so this is expected to be unreachable in
    practice, but the five-states contract (webapp/CLAUDE.md) isn't optional.
  - **draft**: `createController` owns the in-progress `Draft` (amount input,
    category id, tag ids, comment) and the double-submit guard. `submitting`
    is flipped synchronously before the first `await`, so two `submit()`
    calls issued back-to-back both run before either resolves and only the
    first reaches `createExpense` (AC: exactly one POST, same shape as the
    bot's D118/D123 confirm-step guard) — verified directly with
    `Promise.all([controller.submit(), controller.submit()])` against a
    manually-resolved fake, no DOM/timing trick needed. On success the draft
    resets; a replayed call after that is rejected by `submitButtonState`
    (no category) as `{status: "blocked"}`, not a second write. Errors
    (403/404-stale-category/5xx-network) map to human messages via
    `submitErrorMessage` without touching the draft, so it survives exactly
    as the AC requires — verified with each typed `ApiClient` error class.
  - `submitButtonState` fills a gap the AC names only the "no category"
    case for: once a category is picked but the amount isn't valid yet, the
    button stays disabled with an "Enter an amount" label rather than
    promising a submit that would fail — "Add {amount} {currency} to
    {category}" only ever appears once both are true. A stale/removed
    category id also keeps it disabled (category lookup misses).
  - **presentation**: `renderAddExpense`/`renderForm` (pure, string
    assertions per state, same pattern as `renderHome`) and `mount` (thin DOM
    glue, the one part with no meaningful unit test — same accepted gap as
    `home.ts::mount`). `mount` re-renders only the form container
    (`.outerHTML` swap + re-wire) on category/tag chip taps and submit
    errors; the amount field's own `input` listener updates only the inline
    error `<p>` and MainButton chrome directly, never touching the input
    node itself, so typing never loses focus or cursor position. The amount
    input carries `autofocus` and `mount` also calls `.focus()` once at the
    end of the initial mount (AC: focused on open) — not re-called on
    chip-triggered re-renders, so a chip tap can't steal focus back.
    `wireBackButton` (exported, directly tested) wires the BackButton once:
    a clean draft closes immediately, a dirty one awaits `confirmDiscard`
    first (Telegram's popup, not a custom modal).
  `main.ts` rewritten from the single `boot()`/Home-only shape into
  `showHome()`/`showAddExpense()`, both reachable from either screen (Home's
  "Add expense" tile *and* its MainButton go through `showAddExpense`; the
  Add-expense screen's `onClose`/`onSuccess` both go through `showHome`,
  which re-fetches — AC: "Home refetched" on success comes for free from
  reusing the same `loadHome` call every `showHome()` invocation already
  made). `boot()` stays the exported entry point `main.test.ts` calls, now a
  thin `applyTheme()` + `showHome()`.
  `styles/app.css` gained the form/chip styles (`.field`, `.amount-input`,
  `.chip`/`.chip.active`, `.comment-input`, `.field-error`/`.submit-error`,
  loading skeletons) — extended the existing file per its own doc comment
  rather than a new stylesheet.
  Tests: `webapp/tests/add-expense.test.ts` (37 cases) — the pure helpers
  (`amountError`, `isDirty`, `submitButtonState`), `loadAddExpenseData`
  (ready/empty/forbidden/error/offline, mirroring `home.test.ts`'s
  `loadHome` suite), `createController.submit` (blocked-when-invalid,
  success with tag_ids/comment round-tripped and draft reset, tag_ids/
  comment omitted when unset, the duplicate-rapid-submit race via a
  manually-resolved promise, 403/404/5xx/unmapped-`ApiError` message
  mapping with draft preservation asserted after each), `renderAddExpense`/
  `renderForm` (string-content assertions per state, inline error, active
  chip, offline banner, no tag-chip row when the account has none),
  `applyAddExpenseChrome`, `wireBackButton` (clean draft closes with no
  popup; dirty draft awaits `showConfirm` and only closes on `true`).
  `webapp/tests/telegram.test.ts` gained `mainButton.onClick`/`offClick`
  wiring tests (same shape as the existing `setBackButtonHandler` test) and
  `confirmDiscard` tests (via `showConfirm` and the no-Telegram fallback);
  `webapp/tests/home.test.ts` gained two `applyHomeChrome` cases for the new
  optional `onAddExpense` param. Both files' `fakeWebApp()` helpers gained
  `showConfirm: vi.fn()` (now a required `TelegramWebApp` member).
  Verification: `bash scripts/verify.sh` green end to end (Python 536
  passed, unaffected; webapp vitest 121 across 9 files, up from 79/8;
  typecheck/lint/build/secret-grep clean; bundle 6.29 KB JS + 1.60 KB CSS
  gzipped, still well under the 150 KB budget). Not run: a live
  browser/Telegram smoke test (needs a running backend + real/forged
  `initData`, same gap U2.1 left open) — **CP3 is still open**, and per the
  still-open U2.1 gotcha below, CP1/CP2 should be re-run alongside it now
  that the SDK-script fix is in place.
- Done: **U2.3** (D215) — Screen 03a (Expenses list): grouped by day with a
  per-day subtotal, real pagination, optional category filter.
  New `screens/expenses.ts`, same three-layer split as `home.ts`/
  `add-expense.ts`:
  - **data**: `buildExpensesData` (pure) turns an accumulated page of
    `ExpenseResponse[]` + `CategoryResponse[]` into day groups —
    `groupByDay(rows, tz)` buckets already-newest-first rows by calendar day
    (via `Intl.DateTimeFormat("en-CA", {timeZone: tz, ...})` for a stable
    sortable `dayKey`, `lib/dates.ts::formatDay` for the display label),
    days come out in first-seen order (no re-sort needed, since the API's
    `ORDER BY created_at DESC` already orders the input). The optional
    category filter (`buildExpensesData`'s `categoryId`) is applied
    client-side over whatever page(s) are already loaded — `GET /expenses`
    has no `category_id` query param (only `limit`/`offset`, per Contracts),
    so this is the only option without a backend change. An unknown/deleted
    `categoryId` falls back to a generic "this category" label rather than
    throwing.
  - **controller**: `createExpensesController` owns the accumulated raw
    pages, current `offset`, and `hasMore`, mirroring `loadHome`/
    `loadAddExpenseData`'s never-throws/cache-fallback contract exactly
    (loading/error/forbidden/empty/ready/offline). Critical detail for the
    plan's documented "Pagination vs own_only" risk: `offset` always advances
    by the **requested** `limit` (a fixed `PAGE_SIZE = 50`), never by
    `page.length` — an own_only-shortened page must not desync the next raw
    DB page's offset. `hasMore` is the standard `page.length === PAGE_SIZE`
    heuristic, which inherits the same documented risk (a short own_only
    page can under-report `hasMore`); not solved here, consistent with
    U0.3's accepted scope. `loadMore()` on a network failure keeps whatever
    is already rendered (`hasMore` stays `true`) rather than losing state —
    a retry is just tapping "Load more" again.
  - **presentation**: `renderExpenses` (pure, string-content assertions per
    state, same pattern as `renderHome`/`renderAddExpense`) and `mount`
    (thin DOM glue, the one part with no meaningful unit test — same
    accepted gap as the other two screens' `mount`). Each row shows the
    category dot/name (`assignCategoryColors`/`categorySlotCssVar` reused
    from `lib/category-colors.ts`, same D206 slot rule as Home), the
    author's initial (from `ExpenseResponse.user_name`, absent for a
    single-member account), tags (comma-joined, no separate title field
    exists on `ExpenseResponse` — mirrors the bot's own
    `_format_expenses_list`, which has no title concept either, confirmed
    by reading `bot/handlers/expenses.py` before writing this), and the
    comment if present. Footer is either a "Load more" button (`hasMore`)
    or an end-of-list marker.
  `applyExpensesChrome(onBack)`: no MainButton on this screen (the design
  doc names none, unlike Home/Add-expense) — `mainButton.hide()` always;
  BackButton always wired to `onBack` (→ Home, per the design's flow
  diagram).
  `main.ts` gained `showExpenses(filter?)`: Home's "Expenses" tile routes
  there unfiltered; the donut segment tap (a no-op since U2.1, per its
  STATE) now routes there filtered to the tapped category — the folded
  "Other" slot's `categoryId: null` falls back to the unfiltered list, same
  as the tile, since there's no single category to filter by. Row taps are
  wired to a handler that's currently a no-op (`onRowTap`) — expense
  detail/edit/delete is U2.3b, not built yet, same "tappable but no-op
  until the target screen exists" pattern U2.1 set for its own tiles.
  `styles/app.css` gained the day-group/row/load-more/end-of-list styles
  (`.exp-day-header`, `.exp-row`, `.exp-title`/`.exp-comment`/`.exp-tags`,
  `.exp-author`, `.exp-amount`, `.load-more`, `.end-of-list`,
  `.exp-day-skeleton` wired into the existing `prefers-reduced-motion`
  pulse rule) — extended the existing file per its own doc comment.
  D215 (asked mid-unit, human-confirmed): day grouping uses the device
  timezone, not `family_tz` — no Contract exposes it to the browser yet;
  accepted as a documented, reversible gap (see Decision log) rather than
  extending `UserMeResponse` again so soon after D211 for what is list
  presentation, not the month-boundary financial math D120 was about.
  Tests: `webapp/tests/expenses.test.ts` (26 cases) — `groupByDay`
  (day-bucket + subtotal correctness, a UTC-vs-Europe/Belgrade late-night
  timestamp landing on different local days), `buildExpensesData`
  (unfiltered grouping, category filter + label, unknown-category-id
  fallback, colour-slot mapping), `createExpensesController` (ready from a
  fake `ExpensesApi`; second-page-appends-without-duplicating asserting the
  exact `{limit: 50, offset: 50}` second call and 60 unique ids across both
  pages; end-of-list via a short first page; empty naming the filter;
  plain empty with no filter; a short own_only-style page rendering ready
  with no special-cased error; forbidden/error/offline mirroring
  `home.test.ts`'s suite shape; `loadMore` network failure preserving the
  already-rendered page), `renderExpenses` (loading/error/forbidden/empty
  variants incl. the filter-named empty message, day groups with subtotal/
  row/tag/comment/author content, load-more vs. end-of-list footer,
  offline marker, filter banner), `applyExpensesChrome` (MainButton hidden,
  BackButton wired to `onBack`, fake `TelegramWebApp` — same pattern
  `telegram.test.ts`/`home.test.ts` established).
  Verification: `bash scripts/verify.sh` green end to end (Python 536
  passed, unaffected; webapp vitest 147 across 10 files, up from 121/9;
  typecheck/lint/build/secret-grep clean; build 23.53 KB JS + 6.80 KB CSS
  raw / 7.70 KB + 1.86 KB gzipped, still well under the 150 KB budget).
  Not run: a live browser/Telegram smoke test (needs a running backend +
  real/forged `initData`, same gap U2.1/U2.2 left open) — CP3 (after U2.2)
  is still open, and CP4 (after U2.3b) covers this screen's own live check
  once detail/edit/delete land.
- Done: **U2.3b** (D216) — Screen 03b (Expense detail, edit, delete). No
  backend/Contract change: `GET/PATCH/DELETE /expenses/{id}` and their
  `ApiClient` methods (`getExpense`/`updateExpense`/`deleteExpense`) already
  existed from earlier units — this is a frontend-only unit.
  New `screens/expense-detail.ts`, same three-layer split as the other
  screens:
  - **data**: `buildDetailData` (pure) turns an `ExpenseResponse` +
    categories/tags into the screen's shape (category label/colour via the
    same `assignCategoryColors`/`categorySlotCssVar` D206 rule as
    `expenses.ts`, day label via `lib/dates.ts::formatDay` on the **device**
    tz — same accepted D215 gap, not a new decision). `loadDetail` fetches
    `getMe`/`getExpense`/`listCategories`/`listTags` in parallel, never
    throws (mirrors `loadHome`/`loadAddExpenseData`), with a `not-found`
    branch a list screen doesn't need (a single record can 404 on its own).
  - **controller**: `createDetailController` owns a field-picker edit mode
    (`"closed" | "picker" | "amount" | "comment" | "category" | "tags"`),
    per-field drafts, and the delete/undo state machine
    (`requestDelete`/`cancelDelete`/`confirmDelete`, guarded against a
    double-fire the same shape as `add-expense.ts`'s submit guard).
  - **presentation**: `renderDetail`/`renderDetailView` (pure, string-content
    assertions per state) and `mount` (thin DOM glue, the one part with no
    meaningful unit test — same accepted gap as every other screen).
  D216 (see Decision log): delete's 5s-undo and edit's one-field-at-a-time
  round trips are both scoped to the **detail screen**, not a list-row
  swipe/toast — tapping Delete swaps the action buttons for an inline
  "Expense deleted. Undo" banner; the 5s wait itself is `setTimeout` in
  `mount` (untested DOM glue, same category as the timer-free parts of every
  other screen's mount); undo cancels with zero API calls; a failed delete
  restores the normal detail view with a human message. Edit mirrors the
  bot's `/editexpense` field-picker rather than one combined form — category/
  tag chip taps commit immediately, amount/comment need an explicit Save,
  each its own `PATCH`. Review fix (pre-commit): `#app` is a single root
  shared by every screen (`main.ts`), so a delete timer or in-flight save
  left running past a Back tap could resolve after a *different* screen was
  already mounted there and stomp on it. `mount` now re-wires BackButton
  itself for the ready state (clearing `deleteTimer` and flipping a local
  `active` flag before calling `handlers.onBack`), and every async
  callback that touches `root` (`rerender`, the delete timer's `.then`)
  checks `active` first. Not unit-tested — `vitest.config.ts` runs the
  `node` environment (no DOM), so `mount` stays the one accepted
  no-meaningful-unit-test layer every screen already has; adding `jsdom`
  to close that gap would be a config change outside this unit's scope.
  `main.ts` gained `showExpenseDetail(id, onBack)`, wired to the list's
  previously no-op `onRowTap`; `onBack` is the calling `showExpenses`'s own
  closure, so returning from detail preserves whatever category filter was
  in force. `applyDetailChrome`: no MainButton (same choice as
  `expenses.ts` — actions are in-content buttons), BackButton -> `onBack`.
  `styles/app.css` gained the detail-card/actions/field-picker/edit/undo
  styles (`.detail-*`), extending the existing file per its own doc comment.
  Tests: `webapp/tests/expense-detail.test.ts` (29 cases) —
  `buildDetailData` (happy path, stale/deleted category fallback),
  `loadDetail` (ready/forbidden/not-found/error), `createDetailController`
  (each field's independent PATCH and drafted-value round trip, invalid
  amount blocked client-side with no API call, a failed save keeping the
  edit open with the human message, `cancelEdit` discarding with no API
  call; delete's full state machine — request/cancel/confirm, blocked
  without a pending delete, a failed delete clearing `pendingDelete` with the
  right 403/404/unmapped-`ApiError` message), `renderDetail`/
  `renderDetailView` (all five load states, field picker, category chips
  marking the active pick, the undo banner replacing the action buttons),
  `applyDetailChrome` (MainButton hidden, BackButton wired — same
  `fakeWebApp()` pattern as every other chrome test).
  Verification: `bash scripts/verify.sh` green end to end (Python 536
  passed, unaffected; webapp vitest 176 across 11 files, up from 147/10;
  typecheck/lint/build/secret-grep clean; build 34.01 KB JS + 8.82 KB CSS
  raw / 9.71 KB + 2.14 KB gzipped, still well under the 150 KB budget). Not
  run: a live browser/Telegram smoke test — **CP4 (after U2.3b) is now
  unblocked but still open**, same gap every prior M2 unit's STATE has left
  (CP1-CP3 are also still open, per U2.1/U2.2/U2.3's STATE).
- Done: **U2.4** — Screen 04 (Budgets): parity with `/budgets` plus the
  threshold tick. No backend/Contract change — `GET/POST/PATCH/DELETE
  /budgets` and `GET /budgets/{id}/progress` already existed from earlier
  units; frontend-only, same as U2.3b.
  New `screens/budgets.ts`, same three-layer split as every other screen:
  - **data**: `buildBudgetsData` (pure) splits an account's categories into
    `budgeted` (one row per plan, joined against its own
    `GET /budgets/{id}/progress` call — same N-small-calls shape U2.1's
    Home over-budget strip already established, family-scale N) and
    `unbudgeted` (an invitation row per category with no plan), both in
    `created_at ASC` order. `loadBudgets` mirrors every other screen's
    never-throws/cache-fallback contract (loading/error/forbidden/empty/
    ready/offline); `empty` is the defensive "no categories at all" case
    (mirrors `add-expense.ts`), not "no budgets yet" — that's a `ready`
    sub-case (`budgeted.length === 0`) so the unbudgeted invitations still
    render alongside the AC's "no-budgets empty state" copy.
  - **controller**: `createBudgetsController` owns one shared create/edit
    form (`BudgetEditMode`, keyed by category id for create or plan id for
    edit) rather than two separate flows. A successful save/delete updates
    `data` locally from the mutation's own response plus a fresh
    `getBudgetPlanProgress` call (create/update return a
    `BudgetPlanResponse`, not progress) — same "update from the response"
    shape as `expense-detail.ts`'s `applyUpdated` — instead of reloading
    the whole screen.
  - **presentation**: `renderBudgets`/`renderBudgetsView` (pure,
    string-content assertions per state) and `mount` (thin DOM glue, the one
    part with no meaningful unit test — same accepted gap as every other
    screen). Bar fill and the threshold tick are both plain CSS
    percentages positioned from `BudgetProgress.fill_pct`/`notify_threshold`
    directly — no percentage/aggregation math is recomputed client-side
    (webapp/CLAUDE.md's ironclad rule, the direct D120 lesson). Status text
    is three words-plus-icon states (`On track` / `⚠ Approaching limit` /
    `⚠ Over by {amount} {currency}`), with `--status-red` reserved for
    `is_exceeded` only, per design doc §6 — a past-threshold-but-not-yet-
    exceeded bar gets the icon and word but not the red text, so status
    is never colour-alone either way.
  MainButton is contextual (design doc §4): `nextUnbudgeted` (first
  unbudgeted category in creation order) drives its label and tap target,
  hidden once every category has a plan. Unlike every prior screen's chrome
  (keyed only to top-level load status), this needs to react to in-screen
  mutations — creating a plan changes what "next" means — so `mount`
  re-applies `applyBudgetsChrome` after every create/edit/delete instead of
  once at load; `applyBudgetsChrome` stays the single reusable export both
  `main.ts` (initial/loading chrome) and `mount` (post-mutation chrome) call.
  Delete uses `confirmDiscard` (Telegram's own popup, already
  screen-agnostic despite its name) rather than expense-detail's 5s-undo —
  the design doc's Telegram note for this screen names no undo affordance,
  unlike D216's expense-delete AC. `main.ts` gained `showBudgets()`, wired
  to Home's previously no-op "Budgets" tile.
  **Known gap, same accepted shape as expense-detail.ts's stale-category
  fallback**: design doc §4 lists "category deleted underneath a plan" as a
  state, but `budget_plans.category_id REFERENCES categories(id) ON DELETE
  RESTRICT` (docs/SCHEMA.sql) means a category with a live plan can never
  actually be deleted — `buildBudgetsData` still keeps the defensive
  "Unknown category"/neutral-colour fallback every other screen has, in
  case the client's own categories fetch is out of sync with its plans
  fetch, but the scenario can't be triggered end-to-end to prove it live.
  **Review fixes, same unit, two passes** (reviewer subagent run
  proactively both times — this unit touches money/budget math). First
  pass: (1) `save()`'s local `data` update originally happened only after
  *both* the create/update call and the follow-up `getBudgetPlanProgress`
  call succeeded, so a plan that was successfully written server-side but
  then hit a transient failure on the progress read-back left `data` stale
  (category still shown "unbudgeted" client-side; a retry would re-`POST`
  and surface a spurious 409). Fixed with `fetchProgress`: the mutation is
  always committed to `data` once the create/update call itself succeeds,
  falling back to a zero-spend/`fill_pct: null` placeholder row if only the
  progress read fails — self-heals on the next full `loadBudgets` (leaving
  and returning to the screen). (2) Moving a category between
  `budgeted`/`unbudgeted` on create/delete was appending to the end of the
  target array, contradicting `nextUnbudgeted`'s documented "first in
  creation order" contract after an in-session mutation. Fixed by adding
  `categoryOrder` (every fetched category id in `created_at ASC` order) to
  `BudgetsData` and re-sorting through it (`sortByCategoryOrder`) on every
  create/delete.
  Second pass, on the first pass's own fix: (3) the exceeded-state "Over
  by X" text was computed client-side as `spentMinor - amountMinor`
  instead of using `BudgetProgress.remaining`, which the API already
  computes for exactly this (`budget_service.calculate_progress`) —
  violated webapp/CLAUDE.md's "never `Number` arithmetic on a displayed
  amount" rule and could silently drift from the server's formula. Fixed:
  `BudgetRow` gained `remainingMinor` (straight from `progress.remaining`),
  and the display is `formatAmount(-row.remainingMinor)` — a sign flip on
  the server's own number, not a re-derivation from two separate fields.
  (4) `fetchProgress`'s failure fallback set `fill_pct: null` to mean
  "couldn't read progress," but the renderer read `fillPct === null` as
  the real API's "no limit set" (an `amount <= 0` plan) — so a budget that
  was just successfully created could show its real amount next to the
  false label "No limit set" if the follow-up progress read failed. Fixed:
  `BudgetRow`/`rowFrom` gained `spentKnown` (`false` only for the fallback
  path), and `renderBudgetRow` checks it before `fillPct === null`,
  rendering "Spend unknown — reopen to refresh" instead.
  Tests: `webapp/tests/budgets.test.ts` (48 cases) — `buildBudgetsData`
  (budgeted/unbudgeted split, stale-category fallback, all-unbudgeted with
  no plans, a plan with a missing progress fetch skipped rather than
  crashing), `loadBudgets` (ready/empty/forbidden/error/offline mirroring
  every other screen's suite shape), `nextUnbudgeted`, `amountFieldError`/
  `thresholdFieldError`/`budgetFormValid`, `createBudgetsController`
  (start/cancel create and edit populating the right draft, save on create
  and on edit incl. creation-order re-insertion, the progress-fallback
  regression case asserting `spentKnown: false`, a real `amount<=0`
  "no limit" plan asserting `spentKnown: true` (distinct from the
  fallback), save blocked with no API call on an invalid draft, 409/403/404
  error-message mapping, delete moving a row back to unbudgeted incl.
  creation-order re-insertion, delete closing an open edit form for the
  deleted plan, delete 403/404 mapping), `renderBudgets`/`renderBudgetsView`
  (all five load states, the threshold-tick CSS position, the
  exceeded-vs-approaching status distinction incl. the status-red class
  only on exceeded, "Spend unknown" rendering distinctly from "No limit
  set" for a `spentKnown: false` row, the offline banner, the create form's
  disabled-until-valid Save with no Delete button vs. the edit form's
  Delete button), `applyBudgetsChrome` (contextual MainButton label/target,
  hidden once fully budgeted, hidden while loading, BackButton wired —
  same `fakeWebApp()` pattern every chrome test in this repo uses).
  Verification: `bash scripts/verify.sh` green end to end (Python 536
  passed, unaffected; webapp vitest 224 across 12 files, up from 176/11;
  typecheck/lint/build/secret-grep clean; build 45.05 KB JS + 11.33 KB CSS
  raw / 12.16 KB + 2.48 KB gzipped, still well under the 150 KB budget). Not
  run: a live browser/Telegram smoke test — no live-test checkpoint is
  defined for this screen specifically (the plan's checkpoints stop at
  CP5/U2.5); CP1-CP4 remain open per every prior M2 unit's STATE.
- Done: **U2.5** — Screen 05 (Statistics): "Home's donut plus ranked bars
  underneath" (design doc §4), period presets via `months_back` (U0.4),
  category/tag grouping toggle. No backend/Contract change —
  `GET /statistics/by-period|by-category|by-tag` (with `months_back`) and
  their `ApiClient` methods already existed from U0.4/U1.4; frontend-only,
  same as U2.3b/U2.4.
  New `screens/statistics.ts`, same three-layer split as every other screen:
  - **data**: `buildStatisticsData` (pure) builds a category donut exactly
    like `home.ts::buildHomeData` (same `donutSegments`/
    `assignCategoryColors`/D206 slot rule, reused directly rather than
    factored into a shared helper — the ~15 lines of donut-building glue
    stays screen-local, same as every prior screen that touches the donut)
    plus two ranked-bar arrays (`categoryBars`/`tagBars`) via a new
    `rankedBars` helper: positive-total rows only, sorted descending, width
    **relative to the leader** (`widthPct: 100` for the top row), not to the
    period total — a ranked-bar chart, not a share-of-total chart like the
    donut (AC: "leader at full width"). Tag rows get `colorVar: null` — there
    is no `categories.color`-style slot contract for tags (D206 is
    category-only), so the donut always reflects the category breakdown
    regardless of which grouping is active; only the ranked-bar list switches.
    `loadStatistics` fetches `GET /users/me`, `/categories`, `/tags`, and all
    three statistics endpoints in one `Promise.all` for a given
    `months_back` — **both groupings' totals are always fetched together**,
    so the grouping toggle (AC: "re-renders without refetching the period")
    never needs a second network call. Never-throws/cache-fallback contract
    identical to every other screen's loader; `empty` is a top-level status
    (period total `=== 0`, mirrors `home.ts`), not a `ready` sub-case, since
    there's nothing to rank.
  - **presentation**: `renderStatistics`/`renderReady` (pure, string-content
    assertions per state) and `mount` (thin DOM glue, the one part with no
    meaningful unit test — same accepted gap as every other screen). The
    ranked-bar list **is** this screen's legend — a fuller one than Home's
    top-three — so `renderBars` reuses Home's exact "hidden for <=1 row" rule
    (AC: "single category renders without a legend") rather than adding a
    second, separate legend component. A grouping with fetched-but-all-zero
    totals (e.g. no tagged expenses this period while the category total is
    non-zero) gets its own "No tagged/categorised expenses" note instead of
    silently rendering nothing. Loading skeleton uses fixed-height
    `.stats-bar-skeleton` placeholders (no `.stats-bar-fill`, i.e. genuinely
    zero-width per the AC) sized to match a real `.stats-bar-row`'s rendered
    height so the ready state doesn't reflow. `mount`'s grouping-toggle click
    handler re-renders locally (`render({ ...current, grouping: next })`)
    with **no handler call and no API call** — the concrete mechanism behind
    the "no refetch" AC line, verified indirectly by a `loadStatistics` test
    asserting each statistics-by-grouping method is called exactly once
    regardless of which grouping was requested.
  - Category-bar tap drills into Expenses filtered to that category (design
    doc §5's `S -->|bar tap| EF`), wired in `main.ts::showStatistics` through
    the same `showExpenses({categoryId})` Home's donut-segment tap already
    uses. **Tag-bar tap is a no-op** — `GET /expenses` has no tag filter
    (U2.3's own documented scope, `ExpensesFilter` is category-only) — same
    "tappable but no target screen/contract yet" precedent U2.1 set for its
    own tiles; not a new decision.
  - Preset labels ("This month"/"Last month"/"Last 3 months") mirror
    `bot/keyboards.py`'s statistics period buttons exactly, same
    mirror-the-bot's-copy convention as `lib/money.ts`'s parser.
  `main.ts` gained `showStatistics(monthsBack, grouping)`, wired to Home's
  previously no-op "Statistics" tile; `monthsBack`/`grouping` are carried in
  the closure across preset taps and retries, same shape as `showExpenses`'s
  `filter` closure. `styles/app.css` gained the ranked-bar-row/skeleton/
  empty-note styles (`.stats-bar-*`, `.statistics-*`); the preset and
  grouping-toggle chips reuse the existing `.chip`/`.chip-row`/
  `.chips-skeleton` classes from `add-expense.ts` as-is, no new CSS needed
  for those.
  No new decision — every choice here fills a Contracts/design-doc gap (bar
  width basis, tag colour, skeleton sizing, preset copy) without contradicting
  a locked decision, same "no new decision" precedent as U1.2/U1.3/U2.1/U2.3b.
  Tests: `webapp/tests/statistics.test.ts` (25 cases) — `buildStatisticsData`
  (descending sort + leader-at-100 width for both groupings incl. a
  floating-point-safe `toBeCloseTo` on the non-leader row, zero-total rows
  dropped, stale-id fallback for both category and tag, donut built from
  category totals only and unaffected by `grouping`), `loadStatistics`
  (ready; the exact `{months_back: X}` param on all three endpoints for
  every preset in `PERIOD_PRESETS`; both groupings fetched exactly once;
  empty/forbidden/offline-from-cache/error mirroring every other screen's
  loader suite shape), `renderStatistics` (loading skeleton has no
  `.stats-bar-fill`, active preset chip, printed values + leader/non-leader
  bar widths, tag-grouping content swap, single-category hides the bar list
  entirely, grouping-specific empty note, empty-period state keeps presets/
  toggle reachable, retry affordance with no raw status code, offline banner
  with the sync marker), `applyStatisticsChrome` (BackButton wired,
  MainButton always hidden — same `fakeWebApp()` pattern every chrome test
  in this repo uses).
  Verification: `bash scripts/verify.sh` green end to end (Python 536
  passed, unaffected; webapp vitest 248 across 13 files, up from 224/12;
  typecheck/lint/build/secret-grep clean; build 51.57 KB JS + 12.64 KB CSS
  raw / 13.38 KB + 2.59 KB gzipped, still well under the 150 KB budget). Not
  run: a live browser/Telegram smoke test — **CP5 (after U2.5) is now
  unblocked but still open**, same gap every M2 unit's STATE has left;
  CP1-CP4 remain open too (per U2.1-U2.4's STATE).
- Done: **U3.1** — e2e smoke through `initData` (`@integration`), the last
  unit in the plan. Two tests added to `tests/test_e2e_smoke.py` (which
  already existed from MVP U5.1 / family-features-v1_1 U3.1 — an unrelated,
  same-numbered unit in a different plan file; docstrings in the test file
  disambiguate), reusing its `smoke_fixtures`: a happy path
  (`test_init_data_auth_round_trips_through_expenses_and_statistics`) —
  a signed `X-Telegram-Init-Data` header, no `X-Internal-Token` at all, drives
  the real app/DB through `GET /users/me` → `POST /expenses` → the expense
  in a paginated `GET /expenses` → `GET /statistics/by-category?months_back=0`
  includes its total — and a tamper AC
  (`test_init_data_tampered_payload_against_real_app_is_401`), repeating
  `test_deps.py`'s fake-dependency-chain tamper test against the real
  app/DB instead. The posted amount (150) stays far under
  `smoke_fixtures`' budget threshold (10_000 @ 80%) so no notification
  fires — deliberate, to keep this unit's scope to auth + the read-your-
  write path rather than re-covering fan-out (already U3.1-of-the-other-plan's
  job). No `BackendClient` used here (that's the bot's client, not the Mini
  App's); raw `httpx.AsyncClient` calls against `ASGITransport(app=app)`
  instead, same shape `test_deps.py` already uses for the hermetic version
  of this same check. No new decision — implements the Contracts' `initData`
  auth path exactly as U0.1 already built it. `tests/README.md` updated in
  the same commit per `tests/CLAUDE.md`.
  Verification: `bash scripts/integration_docker.sh -k init_data` green (2
  passed); full `bash scripts/verify.sh` green (Python 536 passed, unit-only
  as always — integration stays excluded from the default gate per the AC;
  webapp unaffected, no webapp files touched this unit).
- Next: **nothing left in this plan's Units list.** The one open item is the
  combined live-test pass covering **CP1-CP5** (open the Mini App from the
  bot's menu button; donut for the month; record an expense and confirm it
  appears in the bot's `/expenses`; edit/delete/undo; switch Statistics
  periods and confirm the month boundary agrees with the bot's "this
  month") — every M2 screen unit left this open and U3.1 doesn't close it
  (it's an automated DB-level smoke, not a live Telegram session, same gap
  MVP U5.1/family-features-v1_1 U3.1 left for their own scope). Do that pass,
  then this plan is done.
- Gotchas:
  - **`webapp/index.html` was missing the Telegram Mini Apps SDK script**
    (`https://telegram.org/js/telegram-web-app.js`) from U1.3 through U2.1 —
    `window.Telegram.WebApp` never existed, so `getInitData()` always
    returned `null` and every request went out unauthenticated (401,
    "Reopen this app from Telegram to continue."), even when opened
    correctly from the bot's menu button. Fixed post-U2.1, outside the unit
    workflow (`fix_missing_telegram_webapp_sdk_script`, PR #57) once the
    human hit it live after deploy. This means **CP1 (after U1.5) and CP2
    (after U2.1) were never actually proven live** — re-run both alongside
    CP3.
  - Decision ids start at D200 (MVP owns D1–D45, V1.1 owns D100–D124;
    bot-allowlist-db owns D300+).
  - **There is no U0.2** — it moved to bot-allowlist-db U1 (D210). U0.3/U0.4
    were deliberately not renumbered. `GET /users/me` must already exist before
    U1.4 (ApiClient) and CP1.
  - No STOP-AND-ASK gates remain in this plan — U1.5's (first public
    exposure of the API, deploy-config edits) resolved with human
    sign-off during U1.5 itself. U1.1's lockfile sign-off
    (`webapp/pnpm-lock.yaml` was on root CLAUDE.md's do-not-edit list)
    was similarly asked for and granted during U1.1.
  - Any machine running `scripts/verify.sh`/`webapp/` cold needs Node 22.13+
    (pnpm 11 hard-requires it) and pnpm on `PATH` (this session installed both
    via `brew install node pnpm`).
    A future clean-checkout session hitting "pnpm not found" should do the
    same rather than treating it as a bug — that failure mode is D208,
    deliberate.
  - `webapp/CLAUDE.md` currently documents the client-side colour rule (D206);
    it must be updated when screen 06 and `categories.color` eventually land.
  - `Currency`/account currency (D211, U0.5): future units reading the
    family's currency for display (`lib/money.ts::formatAmount`, U1.2/U1.4)
    must read it from `GET /users/me`'s `currency` field, not
    `config.family_currency` — that setting no longer exists.
  - `migrations/versions/0231c6bd4dfa_add_accounts_currency.py` was validated
    against a real Postgres via `scripts/integration_docker.sh` (D18: local
    `alembic upgrade head` still doesn't work on this machine — missing
    `greenlet`), not `alembic upgrade head` directly. Same gap as every prior
    migration; not new to U0.5.
  - V1.1's unresolved deploy-safety flag blocks the first deploy — see CP0.
  - **U1.5 deploy-time gotchas**: the compose file uses a placeholder
    `MINI_APP_HOST=miniapp.example.invalid` default so `docker compose
    config` stays green on laptops; the server's `/opt/bot/.env` MUST
    set a real hostname before the first deploy or Caddy will fail ACME
    loudly (safe but useless). Port 80 must be reachable from the
    internet for ACME HTTP-01 renewal, not just for the plaintext
    redirect. Never `docker volume rm cashflow_caddy_data` casually —
    re-issuance is LE-rate-limited.
