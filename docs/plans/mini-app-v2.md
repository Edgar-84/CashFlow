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
- `family_currency: str = "EUR"` (env `FAMILY_CURRENCY`)
- `mini_app_url: str | None = None` (env `MINI_APP_URL`)
- `initdata_max_age_sec: int = 86400` (env `INITDATA_MAX_AGE_SEC`)

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

- [ ] **U0.1 `initData` authentication** — `validate_init_data` + the
      `get_current_user` second credential per Contracts; three new settings.
      AC: valid signed payload → the right user; tampered hash → 401; expired
      `auth_date` beyond `initdata_max_age_sec` → 401; well-formed signature for
      a tg_id with no `users` row → 401; **the whole existing suite green,
      proving the bot's header path is untouched**; a route reached with
      `initData` produces the same `PermissionDecision` as with the header pair.
      Files: `config.py`, `api/deps.py`, `tests/test_deps.py`(+).
      RISKY → reviewer subagent. `/effort high`. Model: sonnet.
- [ ] **U0.3 Expense pagination** — `limit`/`offset` through route → service →
      repo, defaults 50/0, `limit > 200` → 422.
      AC: page 1 + page 2 have no overlap and cover the seeded set; newest-first
      order preserved across pages (@integration); `own_only` filtering still
      applied *after* the DB page (documented — see Risks); default call is
      unchanged for existing callers.
      Files: `api/expenses.py`, `services/expense_service.py`,
      `repositories/expense_repo.py`, tests ×2. Model: sonnet.
- [ ] **U0.4 `months_back` period param** — server-side bounds via
      `month_bounds(now, family_tz)`; closes D120.
      AC: `months_back=0/1/2` produce the documented windows in a non-UTC
      `family_tz`; `months_back` + `start` together → 422; omitting everything
      still equals the current family month; a Belgrade-vs-UTC month-rollover
      case asserts the discrepancy D120 accepted is now gone.
      Files: `api/statistics.py`, `services/statistics_service.py`, tests ×2.
      Model: sonnet.

### M1 — Frontend foundation

- [ ] **U1.1 Toolchain + verify.sh lane** — `webapp/` scaffold: `package.json`,
      `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts` rendering a
      placeholder, vitest config, `.dockerignore`/`.gitignore` entries;
      `scripts/verify.sh` gains typecheck + lint + vitest + the secret-grep on
      build output; `.github/workflows/ci.yml` gains the toolchain.
      AC: `bash scripts/verify.sh` green end to end on a clean checkout with the
      toolchain installed, and **fails loudly** (not silently skips) without it;
      the secret-grep fails a deliberately planted `INTERNAL_TOKEN` string in a
      source file; `pnpm build` produces `webapp/dist`.
      Yellow-zone file count, all config. Model: haiku-friendly.
- [ ] **U1.2 Pure lib: money, dates, donut geometry** — no DOM, no I/O.
      AC: parametrized vitest — `parseAmount` on `12`, `12.5`, `12,50`,
      `1 234,56`, `0`, `-1`, `abc`, `1.234` (three decimals); `formatAmount`
      round-trips; `formatDay` renders in `family_tz` not the device tz;
      `segments()` — shares sum to the circumference minus gaps, slot order
      fixed, single-category and zero-total cases, more than six categories
      folds the tail to "Other". Model: sonnet.
- [ ] **U1.3 Telegram adapter + tokens.css** — `lib/telegram.ts` (initData,
      MainButton, BackButton, haptics, theme params, `expand()`), theme params
      mapped onto the token table from the design doc §6.
      AC: unit tests against a fake `window.Telegram.WebApp` — MainButton
      show/hide/label/enabled, BackButton handler wired and unwired on screen
      change, both light and dark param sets produce the documented token
      values, absent Telegram object degrades to a readable "open me from
      Telegram" state rather than throwing. Model: sonnet.
- [ ] **U1.4 ApiClient + types** — one method per v1 endpoint, `initData`
      header on every request, typed error mapping.
      AC: tests against a fake fetch — the header is present on every call;
      401 → "reopen from Telegram", 403 → permission message, 404 → not-found
      result, 5xx and network failure → retryable error; query params
      (`limit`/`offset`/`months_back`) serialized as specified; no method sends
      `account_id` or a user UUID. Model: sonnet.
- [ ] **U1.5 Serving, reverse proxy, TLS** ⚠ **STOP-AND-ASK GATE** — first
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

- [ ] **U2.1 Screen 01 — Home** — donut, top-three legend, over-budget strip,
      six tiles, MainButton.
      AC: renders from a fake `ApiClient`; loading skeleton occupies the final
      layout (no reflow assertion); empty account → "add your first" with tiles
      still reachable; API error → retry affordance; 403 → read-only render, no
      broken buttons; offline → last data + synced marker; donut segment tap
      routes to the filtered list; category→colour mapping is stable across two
      renders with a category appended.
- [ ] **U2.2 Screen 02 — Add expense** — the one-surface composer.
      AC: amount focused on open; MainButton disabled and labelled "Choose a
      category" until one is picked, then restates the action; invalid amount
      inline (never a popup); **double submit issues exactly one `POST`**;
      403/404-on-stale-category/network-failure each show a human message with
      the draft preserved; BackButton on a dirty draft confirms before
      discarding; success → haptic + close + Home refetched.
- [ ] **U2.3 Screen 03a — Expenses list** — grouped by day with per-day
      subtotals, pagination.
      AC: day grouping and subtotals match seeded data; second page appends
      without duplicating; end-of-list marker; empty-per-filter message names
      the filter; `own_only` response renders without an error state; loading
      skeleton rows.
- [ ] **U2.3b Screen 03b — Expense detail, edit, delete** (split from U2.3,
      same rationale as MVP D43 / V1.1 U2.1b).
      AC: detail shows category, author, tags, comment; edit round-trips one
      field at a time; delete shows a 5s undo **before** the API call and the
      row returns if it is used; delete failure restores the row; 403/404 →
      human messages.
- [ ] **U2.4 Screen 04 — Budgets** — bars in the category's own colour with a
      threshold tick, states in words plus an icon.
      AC: threshold tick lands at `notify_threshold`; over-budget renders the
      flag with icon **and** text (not colour alone); no-budgets empty state;
      unbudgeted categories listed with the contextual MainButton; 409 duplicate
      plan and 403 → human messages.
- [ ] **U2.5 Screen 05 — Statistics** — period presets via `months_back`
      (U0.4), donut + ranked bars, category/tag grouping toggle.
      AC: each preset sends the right `months_back` and nothing else; grouping
      toggle re-renders without refetching the period; bars sorted descending
      with the leader at full width and every value printed; empty period;
      single category renders without a legend; loading keeps bar slots at zero
      width with no reflow.

### M3 — Smoke

- [ ] **U3.1 e2e smoke through `initData` (@integration)** — a signed payload
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

## STATE (handoff)
- Done: nothing yet — this plan has just been written and is awaiting human
  approval. `docs/design/mini-app-ux.md`, `webapp/CLAUDE.md` and the root
  `CLAUDE.md` edits (architecture map, commands, auth rule, env vars,
  out-of-scope, do-not-edit list) are already on disk, uncommitted.
- Next: **`docs/plans/bot-allowlist-db.md` ships in full first** (D210). Then
  **CP0** (finish the V1.1 manual test pass + the prod `amount <= 0` check),
  then `/unit U0.1 docs/plans/mini-app-v2.md`.
- Gotchas:
  - Decision ids start at D200 (MVP owns D1–D45, V1.1 owns D100–D124;
    bot-allowlist-db owns D300+).
  - **There is no U0.2** — it moved to bot-allowlist-db U1 (D210). U0.3/U0.4
    were deliberately not renumbered. `GET /users/me` must already exist before
    U1.4 (ApiClient) and CP1.
  - Two gates: **U1.5** is a STOP-AND-ASK (first public exposure of the API,
    edits prod compose + deploy config). `webapp/pnpm-lock.yaml` is on root
    CLAUDE.md's do-not-edit list, so **U1.1** needs sign-off for the lockfile it
    creates.
  - The bot's auth path is a regression surface in U0.1 — the existing suite
    passing unchanged *is* an acceptance criterion, not a side effect.
  - `webapp/CLAUDE.md` currently documents the client-side colour rule (D206);
    it must be updated when screen 06 and `categories.color` eventually land.
  - V1.1's unresolved deploy-safety flag blocks the first deploy — see CP0.
