# Plan: Mini App V4 — navigation, editing & settings

Fifth plan file, after `docs/plans/expense-tracker-mvp.md` (V1 MVP, D1–D45),
`docs/plans/family-features-v1_1.md` (V1.1, D100–D124),
`docs/plans/mini-app-v2.md` (Mini App v1, screens 01–05, D200–D211) and
`docs/plans/mini-app-v3.md` (periods, categories & tags, D300–D3xx) — all done.
Decision ids here start at **D400**.

Source of truth for appearance stays `docs/ui/`. The specs this plan
decomposes were written or revised on **2026-08-07**, in the session that
produced this file:

| Spec | Status |
|---|---|
| `docs/ui/design-system.md` | revised — `--scrim`, four icons, drawer motion, V4 sizing |
| `docs/ui/components/period-selector.md` | revised — jump-to-present control |
| `docs/ui/components/side-menu.md` | **new** — specified from `refs/side-menu/` |
| `docs/ui/screens/01-home.md` | revised — six V4 changes |
| `docs/ui/screens/02-add-expense.md` | revised — pill-3 slot rule, incoming date |
| `docs/ui/screens/02b-edit-expense.md` | **new** |
| `docs/ui/screens/03-expenses.md` | **new** (first spec for a shipped screen) |
| `docs/ui/screens/03b-expense-detail.md` | **new** (first spec for a shipped screen) |
| `docs/ui/screens/08-settings.md` | **new** |

Workflow per unit: `/clear` → `/unit <id> docs/plans/mini-app-v4.md` →
Stop-gate (`verify.sh`) → [reviewer subagent for risky units] → human commits.

## Goal
Eight fixes and features from the user's V4 brief (2026-08-07), which fall into
four groups:

1. **Navigation stops eating the screen.** The six-tile bottom row becomes a ☰
   drawer, and gains a seventh row, Settings, where the account's currency can
   be changed.
2. **Editing an expense stops being a puzzle.** The field-picker flow is
   replaced by the composer itself, pre-filled — which also makes an expense's
   **date** editable for the first time.
3. **Tapping a category means what it looks like it means.** A ranked row on
   Home opens that category's expenses **for the period on screen**, not
   all-time. That is a real backend gap: `GET /expenses` has no filters at all
   today and the client filters one fetched page in the browser.
4. **The chart stops lying about what it is.** An empty period draws an empty
   ring instead of a bare sentence; the donut is display-only; a
   jump-to-present control ends the walk back from eleven months ago.
5. **The chart stays on screen while the list scrolls** (added 2026-08-07, after
   the first four): past the donut it collapses into a pinned stacked bar of the
   same segments, and returns to a donut at the top of the list.

## Non-goals
- **Currency conversion, FX rates, or rewriting stored amounts** (D400). The
  currency is a display label; `expenses.amount` is untouched minor units.
- **Fixing the minor-unit exponent** (D411). JPY has no decimal subunit and
  `lib/money.ts` formats everything with two — pre-existing since D211, made
  more reachable by Settings, deliberately not fixed here. Named in Risks.
- **Any change to the bot.** No handler, no keyboard, no copy. The bot inherits
  the new `GET /expenses` params by not sending them, and a currency change by
  reading the same column it already reads.
- **Screen 05 (Statistics)** — untouched for the second plan running. It keeps
  `months_back` and its preset chips, so that alias still cannot be removed.
- **Screen 04 (Budgets)** — untouched.
- **A drawer on every screen** (D412). The menu opens from Home only; every
  other screen has a BackButton to Home.
- **Swipe-to-delete and the 5s undo toast.** Undo is removed, not relocated
  (D408); the swipe gesture named in `docs/design/mini-app-ux.md` §4 was never
  built and stays unbuilt.
- **Un-archiving, offline write queueing, voice input, self-registration, the
  admin panel** — unchanged from V2/V3's non-goals.
- **An `icons.ts` module.** The design system's icon list reaches exactly eight
  with V4's four additions; consolidating is the *next* icon's problem.
- **Renaming `GET /expenses`'s pagination `offset`** (D402). The bot calls that
  route.

## Constraints
- All root CLAUDE.md rules, plus `webapp/CLAUDE.md` under `webapp/` and
  `tests/CLAUDE.md` for tests. Layering unchanged: routes → services →
  repositories; the Mini App stays a pure HTTP client with zero business logic.
- **No period math on the client**, still (D120, D207). The expenses list names
  a period; `services/period.py::resolve_period` resolves it in `family_tz`.
  V4 adds a second caller of that function and **must not** add a second
  implementation.
- **Every period filter keys off `spent_at`** (D314), including the
  `AT TIME ZONE` conversion `expense_repo.get_by_period` already performs. A
  naive UTC-date comparison is the D323 bug.
- **No migration.** V4 adds no column and no table — `accounts.currency`,
  `expenses.spent_at` and the archive flags all exist. `migrations/versions/`
  is not touched, so there is **no stop-and-ask gate in this plan**.
- The bot's auth path and header pair stay untouched; every existing bot and
  API test stays green.
- Money is `BIGINT` minor units end to end.
- **Appearance comes from `docs/ui/`, never from this file.** A hex, size or
  radius not in `design-system.md` does not go into CSS — extend it first, in
  the same change.
- Unit budget per task-methodology: ≤ ~300 diff lines, ≤ 5 files, ≤ 1 new
  decision.

## Contracts (U0)

### Backend — `GET /expenses` query params (D402)

| Param | Type | Notes |
|---|---|---|
| `limit` | `int` 1–200, default 50 | unchanged |
| `offset` | `int` ≥ 0, default 0 | **pagination — unchanged, not renamed** |
| `category_id` | `UUID \| None` | new |
| `period` | `PeriodUnit \| None` | new; same enum the statistics routes take |
| `period_offset` | `int` (`le=0`), default 0 | new; **named to avoid colliding with pagination `offset`** |
| `start_date` | `date \| None` | new; only with `period=custom` |
| `end_date` | `date \| None` | new; inclusive |

Rules, identical in wording and status code to the statistics routes:

- `period` + `period_offset` and `period=custom` + `start_date`/`end_date` are
  the two selector families. Mixing them → **422** naming the conflict.
- `start_date`/`end_date` without `period=custom` → 422.
- `period_offset` with `period=custom` → 422.
- `period_offset > 0` → 422 (rejected by `le=0` before the route body).
- `period_offset` without `period` → 422 (D321's rule, inherited).
- No period params → no period filter, i.e. today's behaviour byte for byte.
- `category_id` is **orthogonal** — it combines with any of the above and with
  neither.
- `months_back` is **not** added here. It is a deprecated statistics alias
  (D300); a new route does not inherit deprecated surface.

Ordering and pagination are unchanged (`created_at DESC`, `limit`/`offset`).
Note the asymmetry and leave it: rows are **filtered** by `spent_at` and
**ordered** by `created_at`, matching `get_by_period` exactly.

### Backend — shared period-param validation (D403)

`api/statistics.py::_validate_period` becomes shared instead of being copied:
one module both routers import, so the two endpoints can never drift into
different 422 messages for the same mistake.

```python
# api/period_params.py (new)
def resolve_period_params(
    period: PeriodUnit | None,
    offset: int,
    start_date: date | None,
    end_date: date | None,
    *,
    offset_param_name: str,      # "offset" for statistics, "period_offset" here
    tz: str,
    months_back: int | None = None,   # statistics only; None here
    start: datetime | None = None,    # statistics only
    end: datetime | None = None,
) -> tuple[datetime, datetime] | None: ...
```

Returns `None` when no selector was supplied (meaning "no period filter"), and
raises `HTTPException(422)` with the conflict named. `offset_param_name` exists
so the message quotes the parameter the caller actually sent.

### Backend — repository and service

```python
# repositories/expense_repo.py
async def list(
    self,
    *,
    limit: int = 50,
    offset: int = 0,
    account_id: UUID,
    category_id: UUID | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    tz: str = "UTC",
) -> list[ExpenseResponse]: ...
```

Explicit keywords replace the current `**filters: Any` equality-builder for
this method's callers. The `spent_at` window uses the same
`(start AT TIME ZONE $n)::date` form as `get_by_period` — copied deliberately,
not re-derived.

```python
# services/expense_service.py
async def list(
    self,
    account_id: UUID,
    *,
    limit: int = 50,
    offset: int = 0,
    category_id: UUID | None = None,
    bounds: tuple[datetime, datetime] | None = None,
) -> list[ExpenseResponse]: ...
```

The service takes **resolved bounds**, not a period name — resolution is the
route's job, exactly as in `statistics_service`.

### Backend — `PATCH /accounts/me` (D401)

```python
# models/account.py
class AccountUpdate(BaseModel):
    currency: Currency | None = None
```

```
PATCH /accounts/me    body: {"currency": "EUR"}    → AccountResponse
```

- `Depends(require_admin)` — `accounts` is not in the `Resource` enum and gets
  no override row, the same tier `users` and `permissions` use.
- The account comes from the caller's `account_id`. There is no
  `/accounts/{id}`, and the body never carries an id.
- An invalid code is 422 from Pydantic.
- **No conversion, no backfill, no audit row** (D400).
- `services/account_service.py` is new and thin; `repositories/account_repo.py`
  exists and needs only `BaseRepository.update`.

### Frontend — `webapp/src`

Appearance and interaction are in `docs/ui/`, not here. Structural deltas only:

- `api/client.ts`: `listExpenses` takes `{limit, offset, categoryId, period}`;
  new `updateAccount({currency})`.
- `api/types.ts`: `AccountResponse`, `AccountUpdate`.
- `components/side-menu.ts` (new): pure render + thin mount, focus trap, scrim.
- `components/period-selector.ts`: the jump cell; **no new callback** — it
  calls `onOffsetChange(0)`.
- `screens/expenses.ts`: filter becomes `{categoryId?, period?}`, applied by
  the API; `groupByDay` keys off `spent_at`.
- `screens/expense-detail.ts`: the field-picker edit mode and the undo state
  machine are **deleted**; the screen keeps its read view and its two actions.
- `screens/add-expense.ts`: gains a `mode` of `create | edit` and an
  `initialExpense`; `datePillOptions` replaces pill 3 instead of appending a
  fourth.
- `screens/settings.ts` (new).
- `screens/home.ts`: empty ring; donut loses its tap target; ranked row carries
  the period; `HOME_TILES` and `renderTiles` are **deleted**; the ☰ button and
  the menu's open/closed state.
- `main.ts`: routes for 02b and 08, the menu's state, and the Day-tab date
  handoff.

## Units

### M0 — Backend (no migration; nothing here is a stop-and-ask gate)

- [x] **U0.1 `expense_repo.list` filters by category and `spent_at` window** —
      repository only, no route, no service wiring.
      AC: `list(account_id=…)` with no other filter returns exactly what it
      returns today, in the same order (the existing repo tests stay green
      untouched); `category_id` narrows to that category; `start`/`end` narrow
      to a half-open `spent_at` window; the two combine; an expense with
      `spent_at` 3 August and `created_at` 7 August is **inside** a 3 August
      window and **outside** a 7 August one; the window is computed with
      `AT TIME ZONE` from the passed `tz`, proven by a row at the boundary in a
      UTC+N zone (the D323 regression); `limit`/`offset` still paginate the
      filtered set, not the unfiltered one.
      Files: `repositories/expense_repo.py`, `tests/test_expense_repo.py`.
      Model: sonnet.
- [x] **U0.2 Shared period-param validation** (D403) — extract
      `api/statistics.py::_validate_period` into `api/period_params.py` and
      have all three statistics routes import it. **No behaviour change.**
      AC: every existing statistics 422 test passes unchanged, including each
      conflict message; the message quotes `offset` for the statistics routes;
      `api/statistics.py` no longer defines its own validator; a call with no
      period params still returns the current family month.
      Files: `api/period_params.py`(new), `api/statistics.py`,
      `tests/test_statistics_api.py`. Model: sonnet.
- [x] **U0.3 `GET /expenses` accepts category + period** (D402) — the route and
      service wiring on top of U0.1 and U0.2 (D415: may extend
      `api/period_params.py`).
      AC: `category_id` returns only that category's expenses **across pages**,
      not only within the first 50 (the concrete bug the client-side filter
      has); `period=day&period_offset=-1` returns yesterday's expenses and
      matches an equivalent explicit-bounds query; `period=month&period_offset=0`
      matches the month; `period=custom` with both dates works and without them
      is 422; `period_offset=1` is 422; `period_offset` without `period` is
      422; `start_date` without `period=custom` is 422; each 422 names the
      conflicting parameter using the name the caller sent (`period_offset`,
      not `offset`); a call with none of the new params is byte-for-byte
      today's response, proven by the existing `GET /expenses` tests staying
      green; `own_only` still filters after the query, as documented in the
      route's existing comment.
      Files: `api/expenses.py`, `services/expense_service.py`,
      `api/period_params.py`(may extend, D415),
      `tests/test_expenses_api.py`, `tests/test_expense_service.py`.
      Model: sonnet.
- [ ] **U0.4 `PATCH /accounts/me`** (D400/D401) — new thin service + router.
      AC: an **admin** changes the currency and `GET /users/me` reflects it on
      the next call; a **member** and a **viewer** each get 403 and the value is
      unchanged; an unknown code is 422; **no `expenses.amount` row changes** —
      asserted directly, because "relabel only" is the whole decision; the
      response is `AccountResponse`; the route derives the account from the
      caller and there is no path variant that accepts an id.
      Files: `models/account.py`, `services/account_service.py`(new),
      `api/accounts.py`(new), `main.py`, `tests/test_accounts_api.py`(new).
      RISKY (account-wide write, admin-gated) → reviewer subagent.
      Model: sonnet.

### M1 — Expenses list, detail, and the edit composer

Ordered before Home: Home's ranked-row tap and its Add-button date handoff both
navigate into screens that must already accept what they will be handed.

- [ ] **U1.1 Expenses list filters server-side** — implements
      `docs/ui/screens/03-expenses.md`'s Data section and filter/empty copy.
      `buildExpensesData`'s client-side category filter is **deleted**.
      AC: opening the screen with `{categoryId, period}` sends both to the API
      and renders what comes back, with no client-side filtering left in the
      module; the filter banner reads "Transport · August", with the period half
      rendered by the same `describe()` Home's label uses; the empty state names
      both halves ("Nothing in August for Transport."); "Load more" carries the
      same filter and never returns rows outside it; the unfiltered entry from
      the side menu still shows everything, newest first.
      Files: `webapp/src/api/client.ts`, `webapp/src/screens/expenses.ts`,
      `webapp/tests/expenses.test.ts`, `webapp/src/main.ts`. Model: sonnet.
- [ ] **U1.2 Day grouping and the detail date move to `spent_at`** (D410) —
      the V3 defect this plan found while specifying screen 03.
      AC: an expense with `spent_at` 3 August and `created_at` 7 August appears
      under **3 August** in the list and reads 3 August on the detail screen;
      that day's subtotal includes it and 7 August's does not; an expense whose
      two dates agree renders exactly as before, proven by the existing tests
      staying green; the row's colour dot renders at 9px for every category
      with a colour and falls back to the "Other" grey rather than disappearing.
      Files: `webapp/src/screens/expenses.ts`,
      `webapp/src/screens/expense-detail.ts`, `webapp/tests/expenses.test.ts`,
      `webapp/tests/expense-detail.test.ts`. Model: sonnet.
- [ ] **U1.3 Composer gains a `mode` contract** — pure refactor of
      `screens/add-expense.ts`: `mode: "create" | "edit"`, an optional
      `initialExpense`, and the submit action behind one function. **No
      behaviour change in create mode**, no new screen yet.
      AC: every existing `add-expense.test.ts` test passes **unchanged** (the
      unit is a no-op for the shipped screen); the module exports a mode-aware
      draft builder that, given an `ExpenseResponse`, produces a draft with its
      amount, category, date, tags and comment; the double-submit guard
      (D118/D123) is untouched and still covered.
      Files: `webapp/src/screens/add-expense.ts`,
      `webapp/tests/add-expense.test.ts`. Model: sonnet.
- [ ] **U1.4 Screen 02b — edit expense** — implements
      `docs/ui/screens/02b-edit-expense.md` on top of U1.3.
      AC: **every acceptance criterion in that spec**, notably — the screen
      opens pre-filled including the date (an expense from three weeks ago takes
      over the third pill); MainButton reads "Save changes" and is disabled
      until a field differs, and toggling a tag off and on returns it to
      disabled; the PATCH carries **only changed fields**; changing only the
      date moves the expense's day without touching its amount; BackButton with
      an unsaved change opens Telegram's discard popup; a double tap sends
      exactly one PATCH; there is no yellow button and no delete action on the
      screen; an archived current category renders as a selected, dimmed cell
      rather than vanishing.
      Files: `webapp/src/screens/add-expense.ts`, `webapp/src/main.ts`,
      `webapp/tests/add-expense.test.ts`, `webapp/src/styles/app.css`.
      Model: sonnet.
- [ ] **U1.5 Screen 03b — Edit routes to 02b, Delete confirms** (D407/D408) —
      implements `docs/ui/screens/03b-expense-detail.md`. The field-picker edit
      mode and the 5s undo state machine are **deleted**, not disabled.
      AC: "Edit" navigates to 02b carrying the loaded expense with no refetch;
      no field is editable in place and no field picker exists in the module;
      "Delete expense" opens Telegram's own popup reading "Are you sure you want
      to delete this expense?"; "Cancel" fires **no** request; "Yes" deletes and
      returns to the list with the row gone; no undo banner appears at any
      point; a failed delete returns to the ready view with a message and the
      expense intact; for a read-only viewer neither action renders.
      Files: `webapp/src/screens/expense-detail.ts`, `webapp/src/main.ts`,
      `webapp/tests/expense-detail.test.ts`. RISKY (destructive path changes
      shape) → reviewer subagent. Model: sonnet.

### M2 — Home

- [ ] **U2.1 Empty ring** (D405) — implements `01-home.md`'s Empty state and
      its five new copy strings; the eight period-named strings are deleted.
      AC: an empty period renders a complete ring at the same 200px box and
      30px stroke as a populated donut, in `--separator`, with no segment gaps;
      the hole shows the formatted zero for the account's currency in
      `--ink-secondary`; the sentence reads "There were no expenses on this
      day." on the Day tab and its unit's equivalent on the others; switching
      from a period with data to an empty one moves nothing above the ranked
      rows; MainButton, the yellow button and the ☰ button all stay enabled.
      Files: `webapp/src/screens/home.ts`, `webapp/src/styles/app.css`,
      `webapp/tests/home.test.ts`. Model: sonnet.
- [ ] **U2.2 Jump to present** — implements the revised
      `components/period-selector.md`.
      AC: **every new acceptance criterion in that spec**, notably — no jump
      control at offset 0 and one immediately right of `›` at offset −1; `‹`,
      the label and `›` sit at identical positions in both states (the reserved
      cell); a tap at offset −7 calls `onOffsetChange(0)` exactly once; the
      accessible name names the unit ("Back to this month"); the control is
      absent on the Period tab; it renders in `--ink`.
      Files: `webapp/src/components/period-selector.ts`,
      `webapp/tests/period-selector.test.ts`, `webapp/src/styles/app.css`.
      Model: sonnet.
- [ ] **U2.3 Donut goes display-only; ranked rows carry the period** (D404) —
      depends on U1.1.
      AC: tapping the donut — segment, hole or gap — does nothing: no
      navigation, no haptic, no state change, and the element is not focusable
      and carries no `button` semantics; with the Day tab at offset −1 and one
      5.00 Transport expense yesterday, tapping the Transport row opens a list
      of exactly that expense; with the Month tab on a month holding 6 Transport
      expenses, exactly those 6; the list's filter banner names both halves;
      `segmentTapTarget` and its tests are deleted rather than left unused.
      Files: `webapp/src/screens/home.ts`, `webapp/src/main.ts`,
      `webapp/tests/home.test.ts`. Model: sonnet.
- [ ] **U2.4 Pill 3 becomes a slot** (D406, half one) — `datePillOptions` stops
      appending a fourth pill.
      AC: choosing 3 August while today is 7 August leaves **three** pills, the
      third reading `8/3` over "Sun" and selected; the row never scrolls and
      never renders four pills; picking today/yesterday/two-days-ago restores
      the default third pill; the pills' own dates stay relative to the family's
      today, never to the chosen date; no future date is selectable.
      Files: `webapp/src/screens/add-expense.ts`,
      `webapp/tests/add-expense.test.ts`. Model: haiku-friendly.
- [ ] **U2.5 Home hands the Day tab's date to screen 02** (D406, half two) —
      depends on U2.4.
      AC: with the Day tab showing 3 August and today 7 August, both the yellow
      button and MainButton open screen 02 with the third pill reading `8/3` and
      selected; from the Month, Week, Year and Period tabs screen 02 opens on
      "today"; from the Day tab at offset −1 pill 2 is selected and pill 3 still
      reads "two days ago"; the incoming date does **not** make the draft dirty,
      so an immediate BackButton does not prompt; the date is the same
      `family_tz`-anchored value the period label renders, never
      `new Date()` on the device.
      Files: `webapp/src/main.ts`, `webapp/src/screens/home.ts`,
      `webapp/src/screens/add-expense.ts`, `webapp/tests/home.test.ts`.
      Model: sonnet.

### M3 — Side menu and Settings

- [ ] **U3.1 `components/side-menu.ts`** — implements
      `docs/ui/components/side-menu.md`. Pure render + thin mount; no screen
      wiring yet.
      AC: **every acceptance criterion in that spec** that does not require the
      host, notably — exactly seven rows in the specified order; the panel is at
      most 300px wide; `open: false` renders nothing focusable and nothing in
      the accessibility tree; a scrim tap calls `onClose` and never `onSelect`;
      a row tap calls `onSelect` with its id and does **not** close the menu
      itself; `readOnly` disables only "Add expense"; focus moves to the first
      row on open and is trapped; `prefers-reduced-motion` removes the slide;
      every colour resolves from `tokens.css` and none is a category colour or
      `--accent`.
      Files: `webapp/src/components/side-menu.ts`,
      `webapp/tests/side-menu.test.ts`, `webapp/src/styles/app.css`,
      `webapp/src/styles/tokens.css`. Model: sonnet.
      The spec is now measured off `docs/ui/refs/side-menu/` (saved
      2026-08-07), so this unit is **unblocked**. It includes the header band
      (account name + currency) and the last-synced footer taken from that
      reference, and **no row icons** — the reference has one per row and this
      app has no icon set (D413).
- [ ] **U3.2 Home adopts the ☰ button and drops the tile row** (D409) —
      depends on U3.1.
      AC: no navigation tiles render anywhere on the page and `HOME_TILES` /
      `renderTiles` are deleted; a 44px ☰ sits at the bottom-left **inside the
      chart card**, its centre on the same horizontal line as the yellow
      button's centre, and it scrolls with the card rather than being fixed;
      tapping it opens the menu with a light impact haptic; Telegram's
      BackButton appears **only** while the menu is open and closes it without
      navigating away from Home; the page behind the open menu does not scroll;
      selecting a row navigates and leaves no panel or scrim behind; for a
      read-only viewer the ☰ is visible and the menu's Add expense row is
      disabled; the menu opens while offline.
      Files: `webapp/src/screens/home.ts`, `webapp/src/main.ts`,
      `webapp/src/styles/app.css`, `webapp/tests/home.test.ts`.
      Model: sonnet.
- [ ] **U3.3 Screen 08 — Settings** — implements
      `docs/ui/screens/08-settings.md` on top of U0.4.
      AC: **every acceptance criterion in that spec**, notably — 15 currencies
      in the enum's order, each with code and name; only the account's current
      currency carries a `✓`; the no-conversion warning is visible before any
      selection; MainButton reads "Save currency", disabled until the selection
      differs; confirming the popup returns to Home where every amount renders
      with the new code **without reopening the app**; an expense of 5000 minor
      units still reads 50.00 afterwards; a non-admin sees inert rows, no
      MainButton and the admin-only line.
      Files: `webapp/src/screens/settings.ts`(new), `webapp/src/api/client.ts`,
      `webapp/src/api/types.ts`, `webapp/src/main.ts`,
      `webapp/tests/settings.test.ts`. Model: sonnet.
      The 15 currency names are drafted in the spec as `[inferred]` copy —
      correct them **there**, never at implementation time.

### M4 — Smoke

- [ ] **U4.1 e2e: filtered list + currency through `initData` (@integration)** —
      one signed-payload scenario over the real app: create a category → add an
      expense today and one backdated to yesterday → `GET /expenses?category_id`
      returns both → `+ period=day&period_offset=0` returns exactly the
      non-backdated one and `period_offset=-1` exactly the backdated one,
      **proving the filter keys off `spent_at`** → `PATCH /expenses/{id}` moves
      the backdated one to today and the two queries swap results → an admin
      `PATCH /accounts/me` to EUR leaves both `amount` values identical while
      `GET /users/me` reports EUR → a member's `PATCH /accounts/me` is 403.
      AC: scenario green on the test DB; excluded from default `verify.sh`
      (integration marker); the V2 and V3 smoke scenarios still pass unchanged.
      Files: `tests/test_e2e_smoke.py`(+). Model: sonnet.

### M5 — Collapsing chart header (D414)

Added 2026-08-07, after the rest of the plan. **Ordered last on purpose**: it is
the only part of V4 that is a genuine unknown on a real device, it touches the
screen three other units already touch, and nothing else depends on it. If it
proves unpleasant in a real Telegram client, it can be dropped without
unpicking anything.

- [ ] **U5.1 Stacked-bar geometry + the collapsed header's markup** — pure
      render and CSS; **no scroll behaviour yet**, the header is rendered from
      an explicit `collapsed: boolean` a test can set.
      AC: given the same input `buildHomeData` gives the donut, the bar renders
      the **same segments in the same order and colours**, including the
      six-slice fold into "Other"; each segment's width is proportional to its
      amount; a segment under 3px is clamped to 3px and the clamp never pushes
      the bar past 100% (the surplus comes off the largest segment); an empty
      period renders one unbroken `--separator` segment; the header is 68px with
      a 44px row (☰ · label · total) over the 10px bar; the bar is
      `role="img"` with the **donut's** label — real percentages, not clamped
      widths — and is not focusable; the yellow Add button is not rendered in
      the collapsed markup; renders in light and dark from `tokens.css` only.
      Files: `webapp/src/screens/home.ts`, `webapp/src/lib/donut.ts`,
      `webapp/src/styles/app.css`, `webapp/tests/home.test.ts`,
      `webapp/tests/donut.test.ts`. Model: sonnet.
- [ ] **U5.2 Scroll-driven collapse** — the `IntersectionObserver` sentinel, the
      transition, and the single-☰ rule. Depends on U3.2 (the ☰ must exist
      before it can move).
      AC: scrolling until the donut leaves the viewport pins the header;
      scrolling back to the top removes it and leaves the donut intact;
      appearing and disappearing move the ranked rows **by zero pixels**
      (the header is `position: fixed`, out of flow — assert the rows' offset
      before and after); exactly one ☰ is in the DOM at a time and tapping
      either opens the same menu; a period change from the collapsed state
      scrolls back to the top and restores the donut; with fewer rows than fill
      the viewport the header never appears; `prefers-reduced-motion` removes
      the slide; the observer is disconnected when the screen unmounts (no
      listener leak across navigations).
      Files: `webapp/src/screens/home.ts`, `webapp/src/main.ts`,
      `webapp/src/styles/app.css`, `webapp/tests/home.test.ts`.
      Model: sonnet. **The one unit whose acceptance is partly a real-device
      judgement** — see CP5.

## Live-test checkpoints
No database snapshot is needed — V4 writes no migration. What still wants a
human with a phone:

- **CP1 — after U1.5**: delete an expense from the Mini App. The popup asks,
  "Cancel" leaves it alone, "Yes" removes it, and the list is correct on
  return. This is the one destructive path that changed shape.
- **CP2 — after U2.5**: from Home's Day tab, arrow back three days, tap the
  yellow button, and confirm the third pill shows that day and is selected.
  Add the expense and confirm it lands on that day, not today.
- **CP3 — after U3.2**: on a real device, open and close the drawer, and check
  Telegram's BackButton appears only while it is open. (The "☰ scrolls out of
  view" worry this checkpoint originally carried is answered by M5.)
- **CP4 — after U3.3**: change the currency with a second family member's app
  open. Confirm nothing is converted and their app picks up the new label on
  its next load.
- **CP5 — after U5.2, and it is the real acceptance test for M5**: on a real
  device, in a real Telegram client, with an account holding enough categories
  to scroll. Does the header appear and disappear cleanly, or does it flicker at
  the threshold? Does it fight the client's own pull-to-refresh or swipe-to-
  close? Is 68px the right height, and is losing the tabs while collapsed
  annoying? None of this is answerable in a headless test, which is why M5 is
  last and separable.

## Risks
- **M5 is the one part of this plan that can fail on the device rather than in
  the tests.** A fixed overlay driven by an `IntersectionObserver` inside a
  Telegram webview shares the viewport with the client's own gestures
  (pull-to-refresh, swipe-to-close) and its dynamic `viewportStableHeight`.
  Everything M5 asserts in vitest can pass while the thing feels wrong in the
  app. Mitigations already built into the plan: M5 is **last**, depends on
  nothing, and is revertible as one or two commits; CP5 is its real gate.
- **The side menu drops the reference's row icons** (D413). Seven glyphs would
  take the design system's icon inventory from 8 to 15 and trigger the
  consolidation review that file describes. If the icons turn out to be wanted,
  that is a decision with its own unit, not a tweak inside U3.1.
- **The 15 currency names are `[inferred]`.** Drafted in `08-settings.md` so
  U3.3 is not blocked, but unreviewed — "Złoty" carries a diacritic and
  Denmark/Norway/Sweden's krone/krona differ by a letter. The escape hatch is
  codes only, which needs no copy at all.
- **JPY renders wrong and V4 makes it reachable** (D411). Someone can now set a
  zero-decimal currency from the UI in two taps and see every amount inflated
  100×. Pre-existing since D211, but "reachable in two taps" is a different risk
  from "reachable by SQL". If this is not acceptable, the cheap mitigation is to
  offer only two-decimal currencies in the picker; the real fix is an exponent
  in `lib/money.ts` and everywhere the backend parses an amount, including the
  bot.
- **`GET /expenses` grows a second `offset`-shaped concept.** `offset` paginates
  and `period_offset` selects a period. They are one letter apart in meaning and
  eight apart in spelling; the 422 messages quoting the parameter the caller
  sent (D403's `offset_param_name`) exist because of this.
- **Deleting code, not just adding it.** U1.5 removes the undo state machine,
  U2.3 removes `segmentTapTarget`, U3.2 removes `HOME_TILES`/`renderTiles`.
  Each has tests that must be deleted with it rather than left asserting
  behaviour that no longer exists — a green suite that tests a deleted feature
  is the failure mode to watch for in review.
- **Home's module is the busiest file in the app** and **five** units touch it
  (U2.1, U2.3, U3.2, U5.1, U5.2). They are ordered so each lands on a green
  tree, but a `/clear` between them is not optional. If `screens/home.ts` starts
  straining under M5, splitting the chart card into its own component module is
  a legitimate move — but as its own refactor unit, not smuggled into U5.1.
- ~~**Menu reachability after scrolling**~~ — **closed by M5.** The ☰ moves into
  the pinned header the moment the chart card leaves the viewport, so navigation
  is reachable at every scroll position and the Add button's "never
  `position: fixed`" constraint survives intact. CP3 folds into CP5.

## Decision log
- 2026-08-07: **D400 — a currency change relabels, it never converts.** The
  chosen currency is a display label over unchanged `BIGINT` minor units;
  `PATCH /accounts/me` rewrites one column and no expense row. Because
  `50.00 USD` becomes `50.00 EUR`, the warning copy is mandatory and visible
  *before* the change, not only in the confirm popup — HUMAN, 2026-08-07.
  Rejected: a one-time conversion at a user-supplied rate (an irreversible bulk
  write over money, needing an audit trail and a rounding policy — a milestone
  of its own); freezing the currency once expenses exist (safest, and it makes
  the feature useless for the case that prompted it).
- 2026-08-07: **D401 — `PATCH /accounts/me`, admin-only, account derived from
  the caller.** `accounts` is not in the `Resource` enum, so `PermissionChecker`
  does not apply and `require_admin` does — the tier `users` and `permissions`
  already use (api/CLAUDE.md). A member relabelling every family member's money
  is not a member's decision. Rejected: adding `accounts` to the `Resource`
  enum, which would imply per-user override rows for a resource with exactly one
  writable field.
- 2026-08-07: **D402 — the period offset on `GET /expenses` is
  `period_offset`.** That route's `offset` already paginates and the **bot**
  calls it, so renaming the pagination param is a breaking change to a shipped
  client for a cosmetic gain. The statistics routes keep their `offset`
  spelling; the two endpoints therefore differ, which is the price of not
  breaking the bot. Rejected: `offset` + a `page` param (breaks the bot);
  `period[offset]`-style nesting (not idiomatic FastAPI query parsing).
- 2026-08-07: **D403 — one period-param validator, imported by both routers.**
  Copying `_validate_period` into `api/expenses.py` would guarantee the two
  endpoints eventually 422 differently for the same conflict. The extracted
  helper takes the parameter's name so its messages quote what the caller sent.
- 2026-08-07: **D404 — the donut is display-only; a ranked row filters by
  category *and* period.** Supersedes V3's "donut/row taps filter by category
  only", whose stated rationale was that it "keeps `GET /expenses` out of the
  work". V4 accepts that work: a tap on Transport while looking at yesterday
  returned every Transport expense ever recorded, which answers a question the
  user did not ask. The donut loses its tap entirely rather than becoming a
  second route to the same list — two tap targets for one action on one chart
  is what made the ring feel like a control it never really was — HUMAN.
- 2026-08-07: **D405 — an empty period draws an empty ring, and the copy is
  deictic.** "There were no expenses on this day." replaces V3's period-named
  strings ("Nothing in August"). The rule that the empty state must name the
  period in force is **satisfied by position**: the sentence sits under a ring
  which sits under a label reading "Yesterday, August 3", and naming the date
  twice 100px apart is noise. Still forbidden: one string for all five units,
  and the word "data" — HUMAN (string verbatim).
- 2026-08-07: **D406 — only the Day tab hands a date to the composer, and it
  takes over pill 3.** A range names no single day, so Week/Month/Year/Period
  pass nothing rather than guessing at a range's last day. The incoming date
  replaces "two days ago" instead of appending a fourth pill, superseding an
  `[inferred]` rule in `02-add-expense.md` that was never built: a fixed 3 + 1
  row fits every phone width, and "two days ago" is the shortcut nobody reaches
  for when they already know the date — HUMAN (both examples verbatim).
- 2026-08-07: **D407 — editing reuses the composer (screen 02b); the
  field-picker is deleted.** One editing surface, pre-filled, which also makes
  `spent_at` editable for the first time — the V2 picker had no date field at
  all. The detail screen (03b) **survives** as the read view, per the brief.
  Rejected: tapping a list row straight into the editor (removes a screen, and
  the brief explicitly keeps "our old expense information menu").
- 2026-08-07: **D408 — delete confirms, then deletes immediately; the 5s undo
  is removed.** Confirm-then-undo is one interruption too many for one row.
  What is lost is recovery from a mis-tap; what replaces it is that a mis-tap
  no longer deletes anything — HUMAN (copy verbatim).
- 2026-08-07: **D409 — navigation moves into a left drawer; the six-tile row is
  deleted.** Six labels docked above the MainButton reserve cost ~100px of a
  phone viewport permanently to show destinations visited a handful of times a
  session. The ☰ sits inside the chart card at the bottom-left, on the Add
  button's axis, and inherits that button's "never `position: fixed`"
  constraint — which is also the open question in `01-home.md`, because it means
  navigation can scroll out of view — HUMAN (placement explicit).
- 2026-08-07: **D410 — the expenses list and detail read `spent_at`, not
  `created_at`.** Found while writing `03-expenses.md`: `groupByDay` and the
  detail's date line still key off `created_at`, so a backdated expense shows
  under the day it was typed. A V3 defect against D314, visible on these two
  screens and nowhere else.
- 2026-08-07: **D411 — the minor-unit exponent is not fixed in V4.**
  `lib/money.ts` assumes two decimals; JPY has none. Pre-existing since D211,
  but Settings makes it reachable in two taps rather than by SQL. Deferred
  deliberately, with the mitigation (offer only two-decimal currencies) and the
  real fix (an exponent per currency, client **and** server, including the bot)
  both named in Risks.
- 2026-08-07: **D413 — the drawer takes the reference's header and footer, and
  refuses its icons.** `docs/ui/refs/side-menu/panel-open.jpg` shows an identity
  band, an unruled row list and a last-synced footer; all three are adopted,
  with the account name and currency replacing the avatar and balance (this app
  has neither). The reference's 24px per-row glyph is **not** adopted: seven of
  them would take the design system's icon inventory from 8 to 15, past the
  threshold that file sets for consolidating into a module, in exchange for
  decoration on seven text rows. Row height goes to 48px against the
  reference's ~39px, because 39 is under this project's 44px touch floor.
  Rejected outright: the brand green, the translucent panel (page content behind
  menu text), and the reference's own rows — Accounts, Regular Payments,
  Reminders, ads, share, rate, support — which name features this app does not
  have.
- 2026-08-07: **D414 — the chart collapses into a pinned stacked bar on scroll**
  (HUMAN). The donut and the bar are one dataset in two geometries: same
  segments, same order, same colours, same six-slice fold. Mechanics that are
  decisions rather than details:
  - The header is **`position: fixed`, not `sticky`** — a sticky element
    reserves flow space, and appearing at the exact scroll offset that triggered
    it is a feedback loop. Fixed is out of flow, so the trigger cannot chase
    itself.
  - The trigger is an **`IntersectionObserver` sentinel** at the donut's bottom
    edge, not a scroll handler — scroll events in a Telegram webview fire at the
    client's discretion.
  - **The yellow Add button is not rendered while collapsed.** There is no room
    for 56px in 68px, and hoisting it into a fixed header would break the one
    constraint that lets it coexist with MainButton. MainButton is always there,
    so nothing is lost.
  - **The period tabs are not in the collapsed header.** 68px stays a summary;
    the range is still changeable through the tappable label.
  - This is **not** the reference's chart-type switch, which this spec rejects:
    that one changes shape when the *period* changes, making two periods
    incomparable. This one changes shape when the *scroll position* changes,
    with the period held constant.
  Rejected: morphing the ring into the bar (needs an SVG path or canvas
  animation for a 160ms effect); dropping sub-1% categories from the bar to
  avoid the 3px clamp (it would make the bar disagree with the donut).
- 2026-08-07: **D415 — U0.2 built `validate_period_params` (raise-only), not
  the Contracts section's `resolve_period_params` (validate + resolve,
  returning bounds).** U0.2's own AC was "extract `_validate_period`, no
  behaviour change" — building the combined resolver would have been new
  behaviour for the statistics routes, which still resolve their own bounds
  inside `statistics_service.py`. Consequence for U0.3: `api/period_params.py`
  is not necessarily closed after U0.2 — U0.3's Files list now names it as
  "may extend" so the combined shape (or whatever `GET /expenses` actually
  needs to turn `period`/`period_offset` into bounds) has a place to land
  without duplicating resolution logic outside the shared module. Flagged by
  the U0.2 reviewer as a plan/Contracts mismatch worth closing before U0.3
  starts.
- 2026-08-07: **D412 — the side menu opens from Home only.** Every other screen
  owns a BackButton to Home; a drawer reachable from a sub-screen would put two
  different "go somewhere else" gestures on one surface. Extending it app-wide
  later is a decision with its own units.

## STATE (handoff)
- **Plan written 2026-08-07.** No unit implemented yet. The nine spec files
  listed at the top of this file were written or revised in the same session
  and are the source of truth for every AC below; this plan intentionally
  restates none of their geometry.
- **Revised the same day**, after the user answered three open questions:
  Delete stays on 03b only (closing the `[?]` in `02b`/`03b`); the side-menu
  references arrived and are saved under `docs/ui/refs/side-menu/` (D413,
  U3.1 unblocked); and **M5 was added** for the collapsing chart header (D414).
- **U0.1 done.** `expense_repo.list` takes explicit `account_id`,
  `category_id`, `start`/`end`, `tz` keywords instead of `**filters: Any`;
  no route/service wiring yet (that's U0.3). `ExpenseRepositoryProtocol` in
  `services/expense_service.py` was updated to match — a type-only change,
  the service still calls `list(account_id=, limit=, offset=)` unchanged.
  The override is narrower than `BaseRepository.list(**filters)`, so the
  method carries `# type: ignore[override]` (the plan's own Contracts
  section mandates the narrower signature, D402/D403's callers).
- **U0.2 done.** `_validate_period` moved from `api/statistics.py` to
  `api/period_params.py::validate_period_params`, unchanged behaviour for the
  three statistics routes (default `offset_param_name="offset"` reproduces
  every existing message byte for byte). The function also gained the
  `offset_param_name` keyword D403's Contracts section calls for, so U0.3 can
  import it as-is with `offset_param_name="period_offset"` — U0.3's file list
  does not touch `api/period_params.py` again. Deliberately **not** built yet:
  the Contracts section's full `resolve_period_params` (validation *and*
  resolution combined, returning bounds or `None`) — statistics still
  resolves its own bounds inside `statistics_service.py`, and U0.2's own AC
  was the narrower "extract `_validate_period`, no behaviour change." If
  U0.3's route wiring needs the combined resolve+validate shape, that is
  U0.3's decision to add, not a silent U0.2 scope change.
- **U0.3 done.** `GET /expenses` gained `category_id`/`period`/`period_offset`/
  `start_date`/`end_date`, resolved through `api/period_params.py`'s new
  `resolve_period_params` (D415's combined validate+resolve shape, built here
  since this is its first caller) into `[start, end)` bounds the route passes
  to `ExpenseService.list(category_id=, bounds=)`. The service threads
  `bounds`/`category_id` plus its own `family_tz` (now also exposed as a
  read-only `family_tz` property, so the route sources tz from the service
  instance it already has instead of a second `get_settings()` call) to
  `expense_repo.list`, unchanged since U0.1. `api/statistics.py` is untouched —
  its three routes still call `validate_period_params` directly and resolve
  their own bounds inside `statistics_service.py`, per D415.
- **Next:** U0.4 (`PATCH /accounts/me`, D400/D401) — RISKY, reviewer subagent
  required (account-wide write, admin-gated).
- **Nothing is blocked on input any more.** U3.3's currency names are drafted
  in `08-settings.md` as `[inferred]` copy to correct in the spec, not at
  implementation time.
- **Gotchas for the next session:**
  - `GET /expenses`'s period offset is `period_offset`, **not** `offset` — the
    latter paginates and the bot depends on it (D402).
  - Filtering is by `spent_at` with an `AT TIME ZONE` conversion; a naive UTC
    date comparison reintroduces D323.
  - Five units touch `screens/home.ts` (U2.1, U2.3, U3.2, U5.1, U5.2) and two
    touch `screens/add-expense.ts` (U1.3/U1.4, U2.4). `/clear` between them.
  - M5 is last and depends on nothing. If it goes badly on a real device
    (CP5), drop it — the rest of V4 does not lean on it.
  - Several units **delete** code and must delete its tests with it — see
    Risks.
  - There is no migration in this plan and no stop-and-ask gate.
