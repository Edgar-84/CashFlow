# webapp/ — Telegram Mini App (TypeScript + Vite)

<!-- Loaded only when Claude works inside webapp/. -->

> Decided: **D200** backend validates Telegram `initData` · **D201** served from
> the same origin as the API by FastAPI `StaticFiles` (so there is no CORS
> anywhere) · **D202** TypeScript + Vite, no framework · **D204** v1 is screens
> 01–05. See `docs/plans/mini-app-v2.md`.

## Purpose
Second UI in front of the same FastAPI backend, for the jobs chat is bad at:
seeing the month as one shape, and recording an expense on one surface instead
of a five-turn conversation. **Zero database access, zero business logic** — the
same contract `bot/` lives under. The bot is not retired; it stays the fastest
path for a one-line expense and the only surface that receives notifications.

Design source of truth, in two halves:
- **`docs/ui/`** — every value you type into CSS. `design-system.md` (tokens,
  spacing scale, type, geometry, motion), `screens/`, `components/`. Never
  invent a colour, size or radius that isn't there — extend the design system
  first, in the same change.
- **`docs/design/mini-app-ux.md`** — the why: principles, screen inventory,
  states, flows, copy rules. Do not invent a screen or a state that isn't in
  that document — add it there first.

New UI starts with the `ui-spec` skill (screenshots → spec files), then
task-methodology decomposes the spec.

## Structure
- `index.html`, `vite.config.ts` — entry + build.
- `src/main.ts` — boot: `Telegram.WebApp.ready()`, theme binding, router.
- `src/api/client.ts` — `ApiClient`: one method per endpoint. **All** backend
  calls go through this class (the exact role `bot/client.py` plays).
- `src/api/types.ts` — TypeScript mirrors of the Pydantic `*Response` models.
  Hand-written; when a model changes, this changes in the same unit.
- `src/screens/` — one module per screen, named as in the UX brief:
  `home.ts`, `add-expense.ts`, `expenses.ts`, `budgets.ts`, `statistics.ts`,
  `categories.ts`, `tags.ts`.
- `src/components/` — pure render functions (donut, ranked bars, rows, chips,
  cards). No fetching, no state.
- `src/lib/telegram.ts` — the only module touching `window.Telegram.WebApp`:
  MainButton, BackButton, haptics, theme params, `initData`.
- `src/lib/money.ts` — **the** minor-unit parse/format pair.
- `src/lib/dates.ts` — rendering in `family_tz`.
- `src/styles/tokens.css` — the token table from `docs/ui/design-system.md`,
  nothing else.
- `src/styles/app.css` — layout/geometry/type for every screen's markup
  (cards, rows, tiles, skeletons...). Colour always comes from a
  `tokens.css` custom property, never a literal here.
- `tests/` — vitest, colocated with nothing else.

## Ironclad rules
- **No secret ever reaches this code.** No `INTERNAL_TOKEN`, no `BOT_TOKEN`, no
  `DATABASE_URL` — not in source, not in `import.meta.env`, not in a build
  argument. Everything here ships to a browser. `scripts/verify.sh` greps the
  build output for these names and fails on a hit; that check must never be
  weakened.
- **Auth is `initData` only.** `src/lib/telegram.ts` reads
  `Telegram.WebApp.initData` and `ApiClient` forwards it verbatim on every
  request. The backend validates the HMAC and derives the user. This code never
  parses, trusts, or re-signs it.
- **Zero DB concepts.** No table names, no SQL, no UUID minting. Never send
  `account_id` or a user UUID — the backend derives both from `initData`.
- **Zero business logic.** No budget percentages, no aggregation, no
  month-boundary math. All of it comes from the API. This is the direct lesson
  of D120: the bot computing its own period bounds in UTC created a real
  off-by-hours discrepancy against `family_tz`. Do not reintroduce it here — if
  a screen needs a period, the API computes it.
- **All backend calls go through `src/api/client.ts`.** Screens never touch
  `fetch` directly.
- **Money is integer minor units end to end.** Parse once on input, format once
  at render, both via `src/lib/money.ts`. Never `Number` arithmetic on a
  displayed amount, never a float, including intermediate math.
- **No new runtime dependency without sign-off.** The lockfile is on root
  CLAUDE.md's do-not-edit-without-asking list, same as `uv.lock`.

## Every screen handles five states
Not optional; each is a separate acceptance criterion in its unit:
**loading** (skeleton in the final layout, no reflow) · **empty** (specific to
the filter in force) · **error** (what failed + retry, never a status code) ·
**403** (the permission matrix has `own_only`; a viewer sees read-only screens,
not broken buttons) · **offline** (last loaded data + last-synced marker).

## Add-expense flow (canonical, contrast with the bot's FSM)
One surface, no wizard: amount field focused on open → category chips (single
select, required) → tag chips (multi, optional) → comment → MainButton, whose
label restates the action (`Add €38.40 to Groceries`) and which is disabled
until a category is chosen. On success: haptic, close to Home, donut redrawn.
- Amount parses via `src/lib/money.ts`, mirroring
  `bot/handlers/expenses.py::parse_amount_to_minor_units` (comma and dot,
  `1 234,56`, reject `<= 0`).
- BackButton with a dirty draft asks before discarding.
- A double submit must produce exactly **one** `POST` — same guard shape as the
  bot's confirm step (D118/D123): disable and clear before the call, and treat a
  replayed call with no draft as a no-op, not a crash.

## Rules
- **Theme comes from Telegram.** Colours resolve from theme params into the
  tokens in `src/styles/tokens.css`; light and dark are both rendered and both
  tested. Never hardcode a background.
- **Colour belongs to data.** Chrome is ink; the only saturated colour on screen
  is a spending category, assigned from the fixed slot order and never cycled.
  Status red is reserved for over-budget and always ships with an icon and a
  word.
- **Category colour is assigned client-side in v1** — there is no
  `categories.color` column yet (deferred with screen 06). Assign by the
  category's position in the account's list sorted by `created_at ASC`, so the
  mapping is stable across sessions and devices. It shifts only if a category is
  deleted; that is the accepted cost of not shipping a migration in v1.
- **MainButton is the screen's primary action**, BackButton is always wired, and
  confirmations use Telegram's own popup rather than a custom modal.
- Backend errors surface as human messages — never a raw status or stack.
  Log to console with context; show a short sentence.
- Accessibility: visible focus states, `prefers-reduced-motion` respected,
  identity never carried by colour alone (a dot plus a name, always).

## Out of scope (leave `// TODO:` stubs)
- Offline write queueing — read-only offline in v1. A queued write that fails a
  permission check hours later is worse than no queue.
- Voice input, user self-registration.
- Notifications: they stay bot-side. This app never sends a Telegram message.
- Admin surfaces (users, permissions) — still the V2 admin panel. Its DB
  allowlist prerequisite is done (`docs/plans/bot-allowlist-db.md`); the
  panel itself is simply not built yet.
