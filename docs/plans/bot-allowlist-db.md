# Plan: Bot allowlist → DB

Fourth plan file, after `docs/plans/expense-tracker-mvp.md` (V1 MVP, D1–D45,
done), `docs/plans/family-features-v1_1.md` (V1.1, D100–D124, done) and
`docs/plans/mini-app-v2.md` (Mini App, D200–D209, not started). Decision ids
here start at **D300**.

Ships **before** the Mini App plan's U0.1. It is the prerequisite that root
`CLAUDE.md` names for the V2 admin panel, and it removes the last reason to
edit `.env` during normal operation.

Workflow per unit: `/clear` → `/unit <id> docs/plans/bot-allowlist-db.md` →
Stop-gate (`verify.sh`) → [reviewer subagent for risky units] → human commits.

## Goal
Adding a family member becomes one `INSERT` into `users` — no `.env` edit, no
bot restart. The `users` table becomes the single source of truth for who may
talk to the bot, which is exactly what the backend already enforces.

## Non-goals
- **Self-registration.** A human still writes the `INSERT` (or runs
  `docs/seed.sql`). This plan changes where the allowlist *lives*, not who
  creates rows. Bot self-registration stays V2.
- **The admin panel itself.** This unblocks it; it does not build it.
- Any change to roles, `permissions` rows, `PermissionChecker`, or the
  `X-Internal-Token` + `X-Telegram-User-Id` header pair.
- Any Mini App work. The one overlap is `GET /users/me` — see D301.

## Constraints
- All root `CLAUDE.md` rules, plus `bot/CLAUDE.md` for anything under `bot/`.
- **The bot keeps zero DB imports.** This is why the migration is not the
  "one change in `bot/middlewares.py`" that root `CLAUDE.md` currently claims:
  the middleware cannot query `users`, it has to ask the backend over HTTP.
  That line in root `CLAUDE.md` gets corrected in U3.
- The security property the current middleware provides must survive: a
  non-allowlisted tg_id reaches **no handler**, so no FSM state is created and
  no handler-level backend call is made on its behalf.
- Non-allowlisted updates stay **silently dropped** (log a WARNING, reply
  nothing) — unchanged from today.
- All backend calls go through `bot/client.py`; the middleware never touches
  `httpx` directly.

## Contracts (U0)

**Backend — `api/users.py`**
- `GET /users/me` → `UserResponse` for the caller. Guarded by
  `Depends(get_current_user)`, **not** `require_admin` — every authenticated
  user, any role, gets their own row. Unknown/missing credentials → 401 from
  the existing dependency, unchanged.
- The route must be declared **before** `GET /users/{user_id}`. Declared after,
  FastAPI matches `/{user_id}` first and `"me"` fails UUID parsing → 422.

**Bot — `bot/client.py`**
- `async def get_me(self) -> UserResponse | None` — 200 → the parsed row,
  401 → `None`. Any other status, or a transport error, raises (the middleware
  decides what to do with it, per D302).

**Bot — `bot/middlewares.py`**
- `AllowlistMiddleware.__init__(http_client, internal_token, *, ttl_ok=300,
  ttl_deny=60, max_entries=1024)` — `allowed_tg_ids` is gone from the signature.
- Per update: cache hit → decide immediately; miss → build the caller's
  `BackendClient`, `get_me()`, cache the verdict, decide. Allow → inject that
  same client as `data["client"]` (one client per update, as today).

## Units

- [x] **U1 `GET /users/me`** — the caller's own `UserResponse`, route declared
      above `/{user_id}`.
      AC: member **and** viewer both get 200 with their own row, not 403 (the
      regression this exists to prevent); the body matches the authenticated
      user; missing/invalid credentials → 401; an explicit test asserts
      `GET /users/me` is **not** captured by `/{user_id}` (i.e. no 422).
      Files: `api/users.py`, `tests/test_users_api.py`. Model: haiku-friendly.
      **Also satisfies mini-app-v2 U0.2 (D301).**
- [x] **U2 Middleware probes the backend** — `AllowlistMiddleware` replaces its
      in-memory set with a `get_me()` probe behind a TTL cache; `create_dispatcher`
      stops taking `allowed_tg_ids`.
      AC: a tg_id with a `users` row reaches the handler with `client` injected;
      a tg_id without one is dropped before the handler and logged; **a second
      update from the same tg_id inside the TTL issues no second probe**
      (assert the call count); an expired entry re-probes; a probe that raises
      (5xx/network) drops the update and logs an ERROR (D302); the cache never
      exceeds `max_entries`; the middleware still sits on
      `dp.update.outer_middleware` after `UserContextMiddleware`.
      Files: `bot/middlewares.py`, `bot/bot.py`, `bot/client.py`,
      `tests/test_bot_middlewares.py`, `tests/test_bot_bot.py`.
      RISKY (it is the bot's authentication gate) → reviewer subagent. Model: sonnet.
- [x] **U3 Retire `ALLOWED_TG_IDS`** — delete the setting and every reference.
      AC: `grep -ri allowed_tg_ids` over the repo returns nothing outside this
      plan file and the historical plan files; `bash scripts/verify.sh` green;
      the app and the bot both start with the var absent from `.env`; README's
      env table and "add a family member" instructions describe the `INSERT`
      path with no restart; root `CLAUDE.md`'s "one change in
      `bot/middlewares.py`" claim is corrected and the admin-panel PREREQUISITE
      note is marked done.
      **Caveat: `.env.example` is excluded from the grep AC** — it matches
      this repo's `Read(./.env.*)` deny rule, so Claude cannot read or edit
      it; the human removes its `ALLOWED_TG_IDS` line (and the var from their
      own `.env` files, dev/prod, and the deploy environment) by hand before
      this plan is truly closed. See STATE below.
      Files: `config.py`, `.env.example`, `tests/conftest.py`,
      `.github/workflows/ci.yml`, `docker-compose.yml`, `README.md`,
      `CLAUDE.md`, `bot/CLAUDE.md`, `webapp/CLAUDE.md`, `docs/seed.sql`,
      `tests/README.md`. Config/docs-only, so over the usual file budget by
      design (methodology §1.2). Model: haiku-friendly.

## Live-test checkpoint
**CP — after U3** (dev `BOT_TOKEN`, dev DB):
1. `INSERT` a new tg_id into `users`; message the bot from that account within
   a minute — it answers, with **no restart**.
2. `DELETE` that row; the same account is silently dropped again once the TTL
   expires.
3. Stop the API container and message the bot from an allowlisted account —
   the update is dropped and an ERROR is logged (fail-closed, D302).

## Risks
- **Fail-closed means a backend outage silences the bot entirely.** Acceptable:
  every handler already calls the API, so the bot is non-functional in that
  window regardless. The alternative — failing open on a probe error — would
  let anyone in exactly when the backend cannot check them.
- **The negative cache is attacker-writable.** Anyone can message a public bot,
  and each unknown tg_id costs one cache entry plus one probe per `ttl_deny`.
  Hence `max_entries`. At family scale this is theoretical, but an unbounded
  dict here would be a memory leak with a stranger holding the pen.
- **Auth-gate regression surface.** U2 rewrites the only thing standing between
  a stranger and the handler stack. The existing `test_bot_bot.py` /
  `test_bot_middlewares.py` cases passing (adapted to the new signature) *is* an
  acceptance criterion, not a side effect.
- **Route shadowing.** `/users/me` under `/users/{user_id}` silently becomes a
  422 for every caller. U1's AC tests it explicitly.
- **Bootstrap.** The first admin row still comes from `docs/seed.sql`. An empty
  `users` table now means nobody can use the bot at all — previously
  `ALLOWED_TG_IDS` would have let you through to a 401. Documented in README.
- **TTL vs revocation.** Removing a user takes effect after `ttl_ok` (5 min),
  not instantly. Fine for a family; worth revisiting if the admin panel ever
  needs immediate revocation.

## Decision log
- D300 (2026-07-27, HUMAN): the bot's allowlist becomes a **DB lookup via an
  HTTP probe** — `AllowlistMiddleware` calls `GET /users/me` with the caller's
  own headers and allows on 200, drops on 401 — with a per-tg_id TTL cache so it
  is one round-trip per user per few minutes, not per update. `ALLOWED_TG_IDS`
  is removed outright rather than kept as a second gate. Rejected: dropping the
  middleware and relying on the backend's existing 401 (strangers would reach
  handlers and create FSM state, and every handler would need its own
  "not registered" path instead of one drop point); fetching the whole list at
  startup with periodic refresh (`GET /users` is `require_admin` and the bot has
  no tg_id of its own to authenticate as, so it would need a new
  internal-token-only endpoint, and new users would wait for the next refresh).
- D301 (2026-07-27): `GET /users/me` is **owned by this plan** (U1). The Mini
  App plan's U0.2 specifies the same endpoint with the same AC; when this ships,
  mini-app-v2 U0.2 is checked off as satisfied rather than implemented twice.
  D205 is unaffected — it says the *Mini App plan* does not perform the
  allowlist migration, which stays true. Mini-app-v2's line 31 ("still blocked
  on the `ALLOWED_TG_IDS` → DB allowlist migration") becomes stale and is
  updated by U3.
- D302 (2026-07-27): a probe that fails with a transport error or 5xx **drops
  the update** (fail closed) and logs an ERROR. Rejected: failing open on the
  grounds that the backend is the real gate anyway — it opens the handler stack
  to anyone precisely during an outage, and the handler's own call would fail a
  moment later regardless, so nothing is gained.
- D303 (2026-07-27): the cache is a plain in-process dict with separate TTLs —
  300s for allows, 60s for denies — and a `max_entries` cap. Denies expire
  faster so a freshly added family member gets in within a minute. Rejected:
  Redis or any shared cache (a whole service for one bot process); caching only
  allows (a stranger spamming the bot would then probe the backend on every
  message).

## STATE (handoff)
- Done: U1 (`GET /users/me`, `api/users.py` + `tests/test_users_api.py`). U2
  (`AllowlistMiddleware` probes `GET /users/me` behind a per-tg_id TTL cache;
  `bot/middlewares.py`, `bot/client.py` (`get_me()`), `bot/bot.py`
  (`create_dispatcher` drops `allowed_tg_ids`), `tests/test_bot_middlewares.py`,
  `tests/test_bot_bot.py`, `tests/README.md`). Reviewer subagent: APPROVE, no
  blockers. U3 (removed the setting from `config.py`, `.github/workflows/ci.yml`,
  `docker-compose.yml`, `tests/conftest.py`; reworded every doc reference in
  `README.md`, `CLAUDE.md`, `bot/CLAUDE.md`, `webapp/CLAUDE.md`, `docs/seed.sql`,
  `tests/README.md`, `docs/plans/mini-app-v2.md`, `docs/design/mini-app-ux.md`;
  renamed an incidentally-named `allowed_tg_ids` test-helper parameter in
  `tests/test_bot_bot.py`/`tests/test_bot_middlewares.py` to `known_tg_ids` so
  the AC's repo-wide grep is clean; `verify.sh` green).
- Next: this plan is fully done. Live-test checkpoint CP (see above) is
  outstanding — run it before `/unit U0.1 docs/plans/mini-app-v2.md`.
- Gotchas:
  - Decision ids start at D300 (MVP D1–D45, V1.1 D100–D124, Mini App D200–D209).
  - U1 also closes mini-app-v2 U0.2 — check that box there when U1 lands (D301).
  - `.env.example` was **not** touched by U3 — it matches the repo's
    `Read(./.env.*)` deny rule, so Claude cannot read or edit it. The human
    removes the `ALLOWED_TG_IDS` line from `.env.example` and from their own
    `.env` files (dev and prod) and the deploy environment, by hand.
  - This plan must be fully done and committed before
    `/unit U0.1 docs/plans/mini-app-v2.md` — it now is, once `.env.example`
    is cleaned up by hand and the live-test CP passes.
