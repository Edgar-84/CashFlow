# UX brief: CashFlow Telegram Mini App

Design input for `docs/plans/mini-app-v2.md` (screens 01–05, shipped) and
`docs/plans/mini-app-v3.md` (period selection + screens 06–07). This file
describes **what each screen must do and which states it must survive**; the
plan files derive units and acceptance criteria from it. Written as a contract,
not as a mood board — every "States" list below is an acceptance criterion.

Visual reference (live, theme-aware mockups of all seven screens):
https://claude.ai/code/artifact/32fd8317-d2f0-4279-8709-af3b261b79fa

Companion plans: `docs/plans/expense-tracker-mvp.md` (V1 MVP, D1–D45),
`docs/plans/family-features-v1_1.md` (V1.1, D100–D124),
`docs/plans/mini-app-v2.md` (D200–D211), `docs/plans/mini-app-v3.md`
(D300–D312). Decision ids in this document and its plans start at **D200** to
avoid collisions.

**Amended 2026-08-03** for V3: period selection on screens 01 and 05, and
screens 06/07 un-deferred (D204 reversed by scope, not by argument — it said
"not in v1", and this is v3). Amendments are marked inline.

---

## 0. Blocking decisions

These are not design preferences — each one changes what the screens can do.
None of the units below can be written until every `DECIDE` here is resolved.
Record each answer in the plan's Decision log as D200+.

- **DECIDE D200 — Authentication.** The Mini App runs in the user's browser;
  `INTERNAL_TOKEN` can never ship to it (root CLAUDE.md: the bot's header pair
  is a shared secret). Options: (a) the backend validates Telegram's signed
  `initData` HMAC as a second auth path beside `get_current_user`, deriving the
  user from `initData.user.id` exactly as it derives one from
  `X-Telegram-User-Id` today; (b) a thin BFF holds the internal token and
  proxies. **Recommendation: (a)** — one new dependency in `api/deps.py`, no new
  service, and the permission pipeline downstream is untouched.
- **DECIDE D201 — Public origin.** `docker-compose.prod.yml` deliberately
  publishes no ports (the bot long-polls outward). A Mini App needs a public
  HTTPS origin: domain, TLS, reverse proxy, CORS allowlist. Decide the proxy
  (Caddy vs nginx) and whether the app is served by FastAPI `StaticFiles` or its
  own container.
- **DECIDE D202 — Frontend stack.** Recommendation: TypeScript + Vite, no
  framework or a small one. The app is seven screens with no shared client state
  beyond a cache; a heavyweight framework buys nothing and costs bundle size on
  mobile.
- **DECIDE D203 — Currency.** The mockups show `€`. `family_tz` exists in
  config; there is no currency setting. Decide: a `FAMILY_CURRENCY` env var (one
  currency per deployment) or a per-account column. Recommendation: env var —
  the family has one currency, and a column implies conversion logic nobody
  asked for.
  **Superseded by D211** (`docs/plans/mini-app-v2.md`, U0.5): currency is a
  per-account `accounts.currency` column (a fixed 15-code enum, not free-form),
  read via `GET /users/me`, not a `FAMILY_CURRENCY` env var. D211's reasoning
  still agrees with D203 on the part that matters — one currency per account,
  no conversion logic — it only moves *where* that one currency is chosen
  from (deployment-wide env var → per-account DB column).
- **DECIDE D204 — Scope parity.** Which bot commands the Mini App replaces in
  v1. Recommendation: screens 01–05 in v1 (home, add, expenses, budgets,
  statistics); categories and tags management stay bot-only until M3. The bot is
  never retired — it stays the fastest path for a one-line expense and the only
  surface for notifications.
- **DECIDE D205 — Bot allowlist.** The bot's `AllowlistMiddleware` in
  `bot/middlewares.py` gates on a `users`-table lookup. The Mini App does not
  go through that middleware, so its gate is the same `users` table lookup
  that `get_current_user` already does. This is either fine (the user row is
  the real allowlist) or it is the moment to do the allowlist→DB migration
  that root CLAUDE.md names as the V2 admin-panel prerequisite. Decide which.

---

## 1. Who it is for

Two adults sharing one account, on phones, one-handed, usually standing in a
shop or sitting in a car. Not accountants — they want to know whether this month
is going badly, and to record a purchase before they forget it.

The three jobs, in priority order:

1. **Record an expense in under ten seconds.** The bot's FSM needs five turns
   because chat has no other option. A form does not.
2. **See the month at a glance.** Today this requires `/statistics`, then
   `/chart`, then reading text. It should be the first thing on screen.
3. **See what the other person spent.** `user_name` already ships on every
   expense (U1.3) but the bot only appends it to a text line.

Anything else — managing categories, renaming tags, editing permissions — is
rare enough to stay in the bot or sit behind two taps.

---

## 2. Design principles

Three rules that resolve most detail questions without another round of review.

1. **Colour belongs to data.** Buttons, headers, nav and chrome are ink
   (near-black on light, near-white on dark). The only saturated colour on any
   screen is a spending category. Consequence: a glance at any screen tells you
   where money went, not where to tap.
2. **One screen per intent.** Adding an expense is amount, category, tags and
   comment on a single surface — no wizard, no confirm step. If a flow needs a
   second screen, question the flow.
3. **Native, not branded.** Grouped cards, 42px headers, a bottom main button.
   The app inherits the Telegram theme rather than fighting it; the only place
   it asserts an identity is the ink chrome.

---

## 3. Screen inventory

The table is the unit list in miniature. **One screen plus all of its states is
one unit.**

| # | Screen | Job | Data in | Actions out |
|---|--------|-----|---------|-------------|
| 01 | Home | The month as one shape | `GET /statistics/by-category`, `GET /budgets`, `GET /users/me` | navigate; open add-expense |
| 02 | Add expense | Record in <10s | `GET /categories`, `GET /tags` (cached) | `POST /expenses` |
| 03 | Expenses | What happened, and who did it | `GET /expenses?limit&offset` | `PATCH`/`DELETE /expenses/{id}` |
| 04 | Budgets | Am I about to overspend | `GET /budgets`, `GET /budgets/{id}/progress` | `POST`/`PATCH`/`DELETE /budgets` |
| 05 | Statistics | The same shape, deeper | `GET /statistics/by-period\|by-category\|by-tag` | period + grouping switch; drill-down |
| 06 | Categories | Where colour is assigned | `GET /categories`, `GET /statistics/by-category` | `POST`/`PATCH`/`DELETE /categories/{id}` |
| 07 | Tags | The cross-cutting axis | `GET /tags`, `GET /statistics/by-tag` | `POST`/`PATCH`/`DELETE /tags/{id}` |

### Five states every screen must handle

Not optional, and each one is a separate acceptance criterion:

1. **Loading** — a skeleton that occupies the final layout, so nothing reflows.
2. **Empty** — specific to the filter in force, never a generic "no data".
3. **Error** — what failed and a retry affordance; never a raw status code.
4. **Permission denied (403)** — reachable in this app: the permission matrix
   has `own_only` for expense update/delete, and override rows can restrict
   further (MVP D26/D33). A viewer sees read-only screens, not broken buttons.
5. **Offline** — Telegram webviews lose connectivity constantly. Show the last
   loaded data with a "last synced" marker rather than an empty screen.

---

## 4. Screen specifications

### 01 — Home

The donut answers "where did it go?" before a number is read. Total in the hole;
the three largest categories named underneath, so identity is never carried by
colour alone. An over-budget category gets a strip above the fold. Six tiles are
the whole app. MainButton is Add expense.

- **States**: loading (donut skeleton) · empty ("No expenses yet — add your
  first", tiles still reachable) · error retry · offline banner with last-synced
  time · single category (donut renders, no legend needed).
- **Telegram**: MainButton = Add expense; BackButton hidden (this is the root);
  selection haptic on tile tap.
- **Interaction**: tapping a donut segment shows the exact slice and navigates to
  that category's filtered expense list.
- **Period (V3, D300)**: three chips above the donut — **Today · Yesterday ·
  This month** — defaulting to This month, so someone who never taps sees
  exactly today's screen. The chip named in force is also the subject of the
  empty state ("Nothing yesterday", never a generic "no data"). The active chip
  is marked by shape *and* text, never by colour alone (§2's first principle:
  the only saturated colour on screen is a category).
  Home deliberately stops at three: the deeper menu, and every custom range,
  lives on screen 05. The over-budget strip is **hidden for the day-scoped
  periods** — budgets are monthly, and a monthly figure beside one day's
  spending compares two different things (D310).

### 02 — Add expense

The screen that justifies the project. Amount is focused on open so the numeric
keypad is up immediately. Category and tags are chips toggled in place. The
MainButton restates what will happen (`Add €38.40 to Groceries`) and is disabled
until a category is chosen.

- **States**: no category chosen (button disabled, labelled "Choose a category")
  · invalid amount (inline, never a popup) · 403 · 404 on a stale category id ·
  network failure with the draft preserved · duplicate rapid submit → exactly
  one `POST` (same double-tap guard as the bot's confirm step, D118/D123).
- **Telegram**: MainButton is the submit; BackButton asks to discard when the
  draft is dirty; success haptic, then close back to Home with the donut redrawn.
- **Rule**: amount parses to minor units in exactly one helper with its own
  tests, mirroring `bot/handlers/expenses.py::parse_amount_to_minor_units`
  (comma and dot, `1 234,56`, reject `<= 0`).

### 03 — Expenses

Grouped by day with a per-day subtotal — a flat list of 38 rows answers nothing,
the same list grouped answers "was Saturday expensive?" with no interaction.
Each row: category colour, title, author initial, tags, amount.

- **States**: loading skeleton rows · empty per filter ("Nothing in July for
  Transport") · `own_only` in force → only your own rows, silently (no error) ·
  end-of-list marker · delete failure restores the row.
- **Telegram**: BackButton → Home; haptic on swipe-delete; a 5s undo toast
  **before** the API call, not after.
- **Depends on**: real pagination (see §8). The bot truncates client-side at 30;
  a scrolling list cannot.

### 04 — Budgets

Every bar carries a tick at the notify threshold, so "80%" stops being a number
in a form and becomes a line you watch yourself approach. The bar is the
category's own colour, never repainted by status. State is spelled out in words
with an icon. Categories with no budget sit at the bottom as an invitation.

- **States**: no budgets at all · over budget · past threshold · 409 duplicate
  plan for a category · 403 for viewers · category deleted underneath a plan.
- **Telegram**: MainButton is contextual — it offers the next unbudgeted
  category.
- **Note**: threshold crossings still fire the existing fan-out notification to
  every account member (U1.4/D104). The Mini App changes nothing there.

### 05 — Statistics

Home's donut plus ranked bars underneath, so switching screens never re-teaches
the picture. Bars sorted by amount, leader at full width; value always printed,
never inferred from an axis. "By tag" is the same view with a different
grouping, not a different screen.

**Periods (V3, D300/D303)** — this is the screen where every period lives:

| Chip | Sends |
|------|-------|
| Today | `period=today` |
| Yesterday | `period=yesterday` |
| This month | `period=this_month` |
| Last month | `period=last_month` |
| Last 3 months | `period=last_3_months` |
| Select period… | opens the calendar → `period=custom&start_date&end_date` |

The **calendar** is a hand-rolled month grid (no dependency, no native
`<input type="date">`): tap the start day, tap the end day, the span between
them highlights, month arrows navigate without losing the selection, and quick
chips (Last 7 days · Last 30 days · This week) cover the common cases in one
tap. Apply is disabled until both ends exist. A reversed second tap re-anchors
the start rather than producing an invalid range; future days are not
selectable; ranges longer than a year are refused *with the reason shown*, not
silently truncated. The applied range is shown in words in the header
("9 – 17 Jul"), never as a pair of ISO strings.

The client picks **dates**; the API converts them to `family_tz` day bounds
(`end_date` inclusive of that whole day). No client ever computes an instant —
that is D120's bug and §2's zero-business-logic rule.

- **States**: loading (bars at zero width, no reflow) · empty period · single
  category · error retry · calendar open with an incomplete selection.
- **Telegram**: selection haptic on preset change; BackButton → Home, except
  while the calendar is open, where it closes the calendar.
- **Note**: this is where MVP D121's deferred "real chart" lands, and where
  D120's UTC-vs-`family_tz` boundary discrepancy should be fixed in the API
  rather than re-implemented in a second client.

### 06 — Categories

The one screen with a job the bot never had: it is where a category's colour is
chosen and stored, which is what makes every donut, dot and bar elsewhere
consistent. Each row doubles as a mini-report (count + month total).

**Colour (V3, D301/D308)** — the picker is the **six palette swatches from
`docs/ui/design-system.md`**
and nothing else: no hex field, no wheel, no seventh hue. Each swatch carries
its name and the chosen one is marked with a check, so the choice survives
greyscale. Two categories may share a slot (six colours, unbounded categories);
the picker shows which are already taken but does not forbid them. The value is
stored as the **slot index**, not a hex — each slot has a light and a dark
variant, so a stored hex would be right in exactly one theme.

**Delete (V3, D302)** — the `ON DELETE RESTRICT` dead end (MVP D5) is replaced,
not merely explained. Deleting a category that **has expenses hides it**: gone
from every picker, still named, coloured and counted in analytics for the
periods it was used in. Deleting one with no expenses really deletes it. The
row's own count tells the UI which will happen, so the confirmation says which —
"Hide Groceries? 42 expenses keep it for reports" vs "Delete Groceries?" —
*before* the tap, never as a 409 afterwards.

- **States**: hide-vs-delete named correctly in the confirmation · archived
  section (collapsed, with a plain-words explanation, absent when empty) · 403
  · duplicate name (warned, never blocked — names stay non-unique at the DB
  level, MVP D19/D311) · last remaining active category (deletable, with a
  warning that new expenses will have nowhere to go).
- **Telegram**: MainButton = Save, enabled only when the form is dirty;
  confirmation is Telegram's own popup, never a custom modal.
- **Depends on**: `categories.color_slot` and `categories.is_active` (see §8).

### 07 — Tags

Tags are the cross-cutting axis: `#vacation` spans groceries, transport and
cafés, which no category view can show. Renaming and deleting are the secondary
action at the bottom, because that is how often they happen.

**Delete (V3, D302)** — identical rule to screen 06: a tag on at least one
expense is **hidden**, one on none is deleted. This matters more here than for
categories, because `expense_tags` is `ON DELETE CASCADE`: without the rule, one
mis-tap silently strips a tag from every past expense and there is nothing to
recover.

- **States**: no tags yet (explain what a tag is for, then offer three starters)
  · unused tag (count 0, rendered as a fact, not as an error) · archived
  section · 403 · delete confirms in a Telegram popup, not a custom modal.
- **Resolved (D305)**: per-tag counts come from the API —
  `GET /tags?include_usage=true` — not a client-side roll-up of the expense
  list, which pagination would silently truncate.
- **Deferred (D309)**: tapping a tag to break it down *by category* needs a
  `tag_id` filter on `/statistics/by-category` that does not exist yet. The
  spec stands; it is not built in V3.

---

## 5. Flows

```mermaid
flowchart LR
  H[Home] -->|MainButton| A[Add expense]
  A -->|POST /expenses| H
  A -->|BackButton + dirty| C{Discard?}
  C -->|Keep| A
  C -->|Discard| H
  H -->|tile| E[Expenses]
  H -->|donut segment| EF[Expenses, filtered]
  E --> D[Expense detail]
  D --> ED[Edit]
  D --> DL[Delete + undo]
  H --> B[Budgets]
  H --> S[Statistics]
  S -->|bar tap| EF
  H --> CT[Categories]
  H --> TG[Tags]
```

Every flow that can lose typed input must confirm before discarding it. Every
flow that mutates must survive a double submit with exactly one write.

---

## 6. Visual system

**Moved.** The token table, category palette, type scale, geometry and motion
values now live in **`docs/ui/design-system.md`**, which is the source of truth
for anything an implementer types into CSS. `webapp/src/styles/tokens.css`
tracks that file.

This document keeps the *why*; `docs/ui/` keeps the *what to build*. New
screens and components are specified as their own files under
`docs/ui/screens/` and `docs/ui/components/`, produced by the `ui-spec` skill
from reference screenshots committed to `docs/ui/refs/`.

The two rules from §2 that govern every value there, restated because they are
design intent rather than numbers:

- **Colour belongs to data.** Chrome is ink; the only saturated colour on any
  screen is a spending category.
- **The category palette is assigned by fixed slot order and never cycled**, so
  a category keeps its colour when filters change. Status red is reserved for
  over-budget and never becomes a seventh category.

---

## 7. Content rules

- **Money** is `BIGINT` minor units end to end. Exactly one format helper and
  one parse helper on the client, each with its own tests. Never a float,
  including intermediate math.
- **Dates** render in `family_tz`, not the device timezone, so both members see
  the same "today".
- **Copy** names things the way a person would: "Over by €23.90", not
  "fill_pct 120". Errors say what went wrong and what to do. Buttons say what
  happens, then the result confirms it happened.
- **Language**: EN only in v1 unless D203's sibling decision says otherwise; the
  existing smoke runbook is bilingual, so RU is a plausible follow-up.

---

## 8. Backend deltas this design forces

Each item is a screen that cannot render without it. These belong in an **M0
milestone that lands before any screen unit**, exactly as U0.1/U0.2 preceded M1
in the family plan.

| Delta | Why | Blocking |
|-------|-----|----------|
| `initData` auth dependency | The browser cannot hold `INTERNAL_TOKEN` | All screens |
| Public HTTPS origin + CORS | Prod compose publishes no ports | All screens |
| `GET /users/me` | Home needs the viewer's own name and role; `api/users.py` is admin-only (MVP D27), so a member gets 403 asking who they are | 01 |
| `limit`/`offset` on `GET /expenses` | The bot truncates at 30 client-side; a scrolling list cannot. `ORDER BY created_at DESC` from U2.5 is already the right sort | 03 |
| `categories.color` column | Colour derived from list position changes every time a category is added. Assign from the fixed slot order on create, never random. **Migration — root CLAUDE.md stop-and-ask gate applies** | 06, and every donut |
| Period bounds computed server-side | D120's UTC-vs-`family_tz` discrepancy would be duplicated in a second client. Give the API a months-back parameter and let `services/period.py::month_bounds` do it | 05 |
| Per-tag expense counts | Either a count on `GET /tags` or a client roll-up — decide | 07 |

**V3 deltas** (`docs/plans/mini-app-v3.md`, M0 — all land before any V3 screen
unit, same rule as M0 in V2):

| Delta | Why | Blocking |
|-------|-----|----------|
| `period` enum + `start_date`/`end_date`, resolved in `family_tz` (D300) | `months_back` cannot express a day or an arbitrary range; the client must never compute bounds | 01, 05 |
| `categories.color_slot` (1–6, nullable) (D301/D308) | Settles the `categories.color` row above: a **slot index**, not a hex, backfilled from today's position rule so no colour moves. **Migration gate** | 06, every donut |
| `categories.is_active`, `tags.is_active` (D302/D304) | Delete must stop destroying analytics history; archived rows leave the pickers and stay in the reports | 06, 07 |
| `include_usage=true` on `GET /categories`\|`/tags` (D305) | The mini-report count, and the pre-tap knowledge of hide-vs-delete | 06, 07 |
| `include_archived` (default **false**, D306) | Default-false is what lets the bot inherit archiving with zero bot changes; analytics callers opt in to name an old category | 06, 07, 05 |
| 409 on writing into an archived category | Archiving closes new spending without freezing the history already in it | 02, 04 |

Two of these touch reviewed contracts: `categories.color` needs a migration
(explicit human approval, per root CLAUDE.md's do-not-edit list), and the
period-bounds change alters the statistics query contract from V1.1.

---

## 9. Non-functional acceptance criteria

- **No secret in the client bundle.** Add a grep step to `scripts/verify.sh`
  that fails on `INTERNAL_TOKEN`, `BOT_TOKEN` or `DATABASE_URL` appearing in
  build output. This is the one that must never regress.
- **Bundle** under 150 KB gzipped; first meaningful paint under 1.5 s on a
  throttled 3G profile.
- **Backend unchanged for the bot.** Every existing bot test stays green; the
  `initData` path is additive, never a replacement for the header pair.
- **Theme**: both light and dark rendered from Telegram's theme params, verified
  in both.
- **Layering unchanged**: the Mini App is another HTTP client, exactly like the
  bot. No new business logic leaves `services/`.

---

## 10. Screen → unit map

Proposed milestones for `docs/plans/mini-app-v2.md`.

| Milestone | Unit | Depends on | Ships |
|-----------|------|------------|-------|
| M0 | `initData` auth dependency | — | A second auth path; the bot's is untouched |
| M0 | Public origin, TLS, CORS | MVP U6.1 (CD) | Reachable from Telegram at all |
| M0 | Contract deltas: `/users/me`, pagination, `categories.color` | initData auth | The U0.2 equivalent. **Migration gate.** |
| M1 | App shell: theme tokens, routing, API client, error boundary | All of M0 | BackButton/MainButton wiring, 403 handling |
| M1 | Screen 01 — Home + donut | App shell | The pitch in one screen; demo-able |
| M1 | Screen 02 — Add expense | App shell | The reason the Mini App exists |
| M2 | Screen 03 — Expenses list, detail, edit, delete | Pagination | Parity with `/expenses`, `/editexpense`, `/deleteexpense` |
| M2 | Screen 04 — Budgets | Home | Parity with `/budgets` + the threshold tick |
| M2 | Screen 05 — Statistics | Home donut | Parity with `/statistics` and `/chart` |
| M3 | Screens 06 + 07 — Categories, Tags | `categories.color` | The management tail; lowest traffic, last |
| M3 | e2e smoke through `initData` | Everything | The U3.1 equivalent for the new client |

Risky units (reviewer subagent required, per the project's own rule): the
`initData` auth dependency and the CORS/origin unit — both are permission- and
secret-adjacent.

---

## 11. Open questions

Carry each into the plan's Decision log as it is answered.

- ~~D200–D205 in §0~~ — all answered in `docs/plans/mini-app-v2.md`
  (D203 later superseded by D211, D204 superseded by scope in V3, D206 by D301).
- ~~Category name uniqueness~~ — **answered (D311)**: the UI warns, the schema
  keeps MVP D19's non-uniqueness. Archiving makes a constraint actively
  awkward — an archived "Groceries" would block creating a new one.
- ~~Per-tag counts~~ — **answered (D305)**: a count on the list endpoint,
  behind `include_usage=true`.
- Does the Mini App need offline write queueing, or is read-only offline enough
  for v1? (Recommendation: read-only — a queued write that fails a permission
  check hours later is worse than no queue.) Still read-only through V3.
- Should the bot link to the Mini App from `/start`, and if so does that replace
  any bot command or merely add a button?
- **Un-archiving** (D312): the archived list is readable but nothing restores a
  row from the UI. Left open deliberately — revisit if it is ever asked for.
- **Removing `months_back`** (D300): kept as a deprecated alias through V3 so
  cached webviews keep working. Its removal is a follow-up unit, safe once
  every device has loaded a post-U1.2 build.
