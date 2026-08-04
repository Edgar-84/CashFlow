# Plan: Mini App V3 — periods, categories & tags

Fourth plan file for this project, after `docs/plans/expense-tracker-mvp.md`
(V1 MVP, D1–D45, done), `docs/plans/family-features-v1_1.md` (V1.1, D100–D124,
done) and `docs/plans/mini-app-v2.md` (Mini App v1, screens 01–05, D200–D211,
done). Decision ids here start at **D300**.

Design source of truth stays **`docs/design/mini-app-ux.md`** — screens 06 and
07 are specified there and were deferred by D204; this plan builds them. Period
selection is added to §4's screens 01 and 05 by this plan; the design doc is
edited in the same session that writes this file, so both stay in step.

Workflow per unit: `/clear` → `/unit <id> docs/plans/mini-app-v3.md` →
Stop-gate (`verify.sh`) → [reviewer subagent for risky units] → human commits.

## Goal
Three things the shipped Mini App cannot do:

1. **Ask a different question of the same donut.** Home shows this month and
   nothing else; Statistics offers three month-shaped presets. Add today,
   yesterday, and an arbitrary `from → to` range picked on a real calendar.
2. **Manage categories from the app.** The Categories tile is a dead button
   today (M3 was never built). Ship screen 06: list, create, rename, delete,
   and — the part only this screen can do — **choose the colour** every donut,
   dot and bar elsewhere already draws with.
3. **Manage tags from the app.** Same for screen 07.

And one rule that cuts across all three: **deleting a category or a tag must
never delete history.** One that is still referenced by expenses becomes
*inactive* — gone from every picker, still named and counted in analytics for
the periods it was used in.

## Non-goals
- **Any change to the bot's commands or flows.** `/categories`, `/tags` and
  their add/rename/delete FSMs keep working exactly as they do. They inherit
  the new archive semantics for free (D306) — the one deliberate exception is
  U0.8, which corrects two now-inaccurate sentences of bot copy.
- **Period presets in the bot.** Today/yesterday/custom-range are Mini App
  surfaces. The bot's three period buttons are untouched.
- **Tag drill-down by category** (design §4, screen 07: "tapping a tag breaks
  it down by category"). Needs a `tag_id` filter on `/statistics/by-category`
  that does not exist; not asked for; deferred (D309).
- **Un-archiving from the UI.** The archived list is visible and readable; a
  restore action is a follow-up if it is ever wanted (D312).
- **Multi-currency, conversion, or any change to `accounts.currency`** (D211).
- Offline write queueing, voice input, self-registration, the admin panel —
  unchanged from v2's non-goals.
- **Removing `months_back`.** It stays as a deprecated alias (D300). Two
  reasons now: a webview pinned to an old bundle keeps working, and screen 05
  still sends it. `months_back=2` also has no `{period, offset}` equivalent —
  a 3-month span is not a unit. Its removal is a named follow-up, not part of
  this plan.
- **Screen 05 (Statistics) is untouched** (D316). It keeps its `months_back`
  chips and gains neither the period selector nor the calendar. The period
  story lives on Home for this plan; extending it to Statistics is a separate
  decision with its own units.
- **Category icons.** Categories are identified by a **colour circle plus a
  name**, never a glyph. No icon set, no `categories.icon` column, no icon
  picker (design-system Iconography, resolved 2026-08-04). What replaces the
  reference app's glyph vocabulary is user-chosen colour (D317).

## Constraints
- All root CLAUDE.md rules, plus `webapp/CLAUDE.md` under `webapp/` and
  `tests/CLAUDE.md` for tests. Layering unchanged: routes → services →
  repositories; the Mini App stays a pure HTTP client with zero business logic.
- **No period math on the client.** A period is named by the client and
  resolved to bounds by the API in `family_tz` — the direct lesson of D120,
  re-affirmed by D207. The calendar picker chooses *dates*; it never computes
  UTC instants.
- **The bot's auth path and header pair stay untouched.** Every existing bot
  and API test stays green.
- Money is `BIGINT` minor units end to end; counts are integers.
- **One migration, one human gate** — U0.3 adds all four columns
  (`categories.is_active`, `categories.color_slot`, `tags.is_active`,
  `expenses.spent_at`) in a single revision. `migrations/versions/` is on root
  CLAUDE.md's do-not-edit-without-asking list: that unit stops and asks before
  writing it.
- **Appearance comes from `docs/ui/`, never from a screenshot or this file.**
  `design-system.md` holds every token; the screen and component specs hold
  every layout, state and user-visible string. A hex, size or radius not in
  those files does not go into CSS — extend the design system first, in the
  same change (root CLAUDE.md).
- Unit budget per task-methodology: ≤ ~300 diff lines, ≤ 5 files, ≤ 1 new
  decision. Migration/boilerplate units may run larger.

## Contracts (U0)

### Backend — `models/enums.py`

**Revised by D313.** `PeriodPreset` (shipped in U0.1) is replaced by a unit +
offset pair, because an enum of named presets cannot express "three weeks back"
or "last year" and the Home tabs need exactly that:

```python
class PeriodUnit(StrEnum):
    DAY = "day"
    WEEK = "week"                # starts MONDAY (D315)
    MONTH = "month"
    YEAR = "year"
    CUSTOM = "custom"            # requires start_date AND end_date, forbids offset
```

`PeriodPreset` is **deleted**, not deprecated — it never reached a route (U0.2
was never built), so nothing outside `services/period.py` and its tests
references it. The deprecated selector that *does* have to survive is
`months_back`, which is a route-level query param, not this enum.

### Backend — `services/period.py`

```python
MAX_RANGE_DAYS = 366

def resolve_period(
    unit: PeriodUnit | None,
    *,
    offset: int = 0,             # <= 0 always; 0 = current, -1 = previous
    start_date: date | None = None,
    end_date: date | None = None,
    now: datetime | None = None,
    tz: str = "UTC",
) -> tuple[datetime, datetime]: ...
```

- `unit=None` → the current family month, byte-for-byte today's behaviour.
- `offset > 0` → `ValueError`. **The future is unreachable server-side**, not
  merely disabled in the UI.
- `offset` with `unit=CUSTOM` → `ValueError`.
- Week bounds start **Monday** local (D315), resolved in `tz` like every other
  bound. `WEEK`/`YEAR` are new shapes; `MONTH` keeps delegating to
  `month_bounds` rather than re-deriving month arithmetic.
- Everything U0.1 already established survives: half-open `[start, end)`
  UTC-aware pairs, per-midnight localization so DST yields 23h/25h days, and
  `end_date` inclusive of its whole local day.
- `CUSTOM` without both dates, `start_date > end_date`, or a span over
  `MAX_RANGE_DAYS` → `ValueError` (the route maps it to 422).
- `month_bounds` stays and keeps its callers.

### Backend — statistics routes (all three: `by-period`, `by-category`, `by-tag`)

New query params, on top of the existing ones:

| Param | Type | Notes |
|-------|------|-------|
| `period` | `PeriodUnit \| None` | the new primary selector (D313) |
| `offset` | `int` (`le=0`), default `0` | only with a non-custom `period`; positive → 422 |
| `start_date` | `date \| None` | `YYYY-MM-DD`, only with `period=custom` |
| `end_date` | `date \| None` | inclusive |
| `months_back` | `int \| None` | **deprecated** (D300); `0/1/2` → `month` offset `0`/`-1`, and `last_3_months` |
| `start` / `end` | `datetime \| None` | unchanged; the bot's explicit-bounds path |

Mutual exclusivity — **at most one selector family per request**, anything else
is 422 with a message naming the conflict. Four families now:

`{period + offset}` · `{period=custom + start_date/end_date}` ·
`{months_back}` · `{start/end}`

- `start_date`/`end_date` without `period=custom` → 422.
- `offset` with `period=custom` → 422.
- `offset > 0` → 422 (the future is closed at the API, not just the UI).
- Passing nothing at all → the current family month, byte-for-byte as today.

**`months_back` is not removable in this plan.** Screen 05 (Statistics) is out
of scope (D316) and still sends it, and so does the bot. `months_back=2`
(`last_3_months`) has **no `{period, offset}` equivalent** — a 3-month span is
not a unit — so the alias is not merely a compatibility shim, it is the only
way to express that window. Its removal stays a named follow-up.

### Backend — `expenses.spent_at` (D314)

The date an expense **happened**, distinct from `created_at`, which stays the
audit trail of when the row was written.

- Every period filter and every statistics aggregation moves from `created_at`
  to `spent_at`. Three SQL sites: `expense_repo.get_by_period` and the
  by-category query (`repositories/expense_repo.py`), and
  `budget_plan_repo.check_limit` (`repositories/budget_plan_repo.py:31`).
- **Budget progress follows** — a backdated expense counts toward the budget of
  the month it was spent in, not the month it was typed in. That is the
  intended meaning, and it is the reason `check_limit` is in the list.
- `ExpenseBase` gains `spent_at: date`; `ExpenseCreate`/`ExpenseUpdate` accept
  it, `ExpenseResponse` returns it.
- **The bot needs no change**: omitting `spent_at` defaults to the current
  family date, exactly today's behaviour.
- A `spent_at` in the future → 422, consistent with `offset > 0`.

### Backend — schema (U0.3, migration)

```sql
ALTER TABLE categories ADD COLUMN is_active  BOOLEAN  NOT NULL DEFAULT true;
ALTER TABLE categories ADD COLUMN color_slot SMALLINT;              -- 1..12, NULL = auto
ALTER TABLE tags       ADD COLUMN is_active  BOOLEAN  NOT NULL DEFAULT true;
ALTER TABLE expenses   ADD COLUMN spent_at   DATE     NOT NULL DEFAULT current_date;
```

**Still one revision and one human gate** — `spent_at` (D314) joins the three
archive/colour columns rather than getting a second gate. The constraint in
this plan's Constraints section is unchanged; only the column count is.

- `color_slot` is the **palette slot index**, not a hex value (D308) — each
  slot has a light and a dark variant in `tokens.css`, so a stored hex would
  break theming. Validated at the Pydantic layer (**1–12** or NULL, widened by
  D317), same "TEXT/INT + comment, no DB CHECK" convention as `users.role` and
  `accounts.currency`.
- Backfill in the same revision: `color_slot` = the category's 1-based position
  within its account ordered by `created_at ASC`, capped at **6** (NULL beyond)
  — i.e. exactly the colours the app renders today (D206), frozen. Slots 7–12
  exist for a **user to choose**, and are never auto-assigned by the backfill,
  so no colour moves on deploy.
- `spent_at` backfill: `(created_at AT TIME ZONE :family_tz)::date`, so every
  existing row keeps landing in the period it already appears in. A naive
  `created_at::date` would shift rows across a month boundary for expenses
  logged late at night in a UTC+N family timezone — the same class of bug as
  D120.
- Downgrade drops all four columns.

### Backend — categories & tags models

- `CategoryResponse` gains `is_active: bool`, `color_slot: int | None`, and
  `expense_count: int | None = None` (populated only when the caller asks for
  usage; `None` means "not requested", never "zero").
- `TagResponse` gains `is_active: bool` and the same `expense_count`.
- `CategoryCreate` gains `color_slot: int | None = None` — omitted means "the
  service picks the next free slot in this account". `CategoryUpdate` gains
  `color_slot: int | None`, which follows the established D30 convention: an
  explicit `null` is treated as omitted. **There is no "clear back to auto"
  affordance** — once set, a colour is one of the six (recorded in D308's
  note); the UI never offers it, so the convention costs nothing here.
- No new `*Create`/`*Update` field for `is_active`: archiving is a *consequence*
  of `DELETE`, never a client-settable flag (D302).

### Backend — categories & tags routes

```
GET    /categories?include_archived=false&include_usage=false
GET    /tags?include_archived=false&include_usage=false
DELETE /categories/{id}   -> 204   (archive if in use, hard-delete if not)
DELETE /tags/{id}         -> 204   (same rule)
```

- `include_archived=false` is the **default**, so every existing caller — the
  bot's category keyboard above all — silently gets active-only lists with no
  bot change (D306). Analytics callers (the Statistics screen naming a
  category from an old period) pass `include_archived=true`.
- `GET /categories/{id}` and `GET /tags/{id}` return archived rows regardless:
  a direct fetch by id is never a picker.
- `DELETE` stays `204` in both branches (D302). The client knows which branch
  it will take *before* the tap from `expense_count`, per the design doc's
  "explained before the tap, not as a 409 afterwards".

### Backend — repositories

- `CategoryRepository.list_with_usage(account_id, *, include_archived: bool) -> list[CategoryResponse]`
  — one `LEFT JOIN expenses … GROUP BY` query, `expense_count` populated.
- `CategoryRepository.count_expenses(category_id) -> int` and
  `.count_budget_plans(category_id) -> int` — the archive-vs-delete decision.
- `TagRepository.list_with_usage(...)` / `.count_expenses(tag_id)` — same
  shape over `expense_tags`.

### Backend — write-path guards

- `ExpenseService._validate_category` rejects an **archived** category on
  expense create and update with `ConflictError` → 409 (not 404: the category
  exists, it is just closed for new spending).
- `BudgetService` rejects a budget plan on an archived category the same way.

### Frontend — `webapp/src`

**Appearance and interaction are specified in `docs/ui/`, not here.** These
units implement `docs/ui/design-system.md`, `docs/ui/screens/01-home.md`,
`docs/ui/screens/02-add-expense.md`, and the three component specs under
`docs/ui/components/`. Their acceptance criteria are the units' acceptance
criteria; a value not in those files does not go into CSS.

- `lib/period.ts` (new, pure): `PeriodValue` = `{ unit, offset }` or
  `{ unit: "custom", start, end }` (`YYYY-MM-DD` strings); `toQuery(v)` → the
  query object `ApiClient` sends; `describe(v)` → the human label, per the
  label-format table in `docs/ui/components/period-selector.md`;
  `monthGrid(year, month)` → the 6×7 day matrix the calendar renders
  (**Monday-first**, leading/trailing days marked); `isValidRange(a, b)`;
  `clampOffset(n)`.
- `components/period-selector.ts` (new): the five tabs + `‹ label ›` row.
- `components/date-range-picker.ts` (new; first modules in the
  `src/components/` directory `webapp/CLAUDE.md` already reserves): pure
  `render()` + thin `mount()`, no fetching, no `window.Telegram` beyond the
  shared adapter.
- `components/category-picker.ts` (new): the 4-column colour-circle grid.
- `styles/tokens.css`: category slots grow 6 → 12; `--accent`/`--accent-ink`
  added for screen 01's Add button (the one declared exception to "chrome is
  ink", D318).
- `screens/categories.ts`, `screens/tags.ts` (new) — same layered shape as
  every existing screen: `load*` (never throws, cache fallback) /
  `build*Data` (pure) / `render*` (pure HTML string) / `mount` (DOM glue).
- `api/client.ts` gains: `createCategory`, `updateCategory`, `deleteCategory`,
  `createTag`, `updateTag`, `deleteTag`; `listCategories`/`listTags` gain the
  two flags; the three statistics methods take a `PeriodQuery` instead of
  `{ months_back }`.
- `api/types.ts` mirrors every model change above.
- `lib/category-colors.ts`: `assignCategoryColors` prefers the server's
  `color_slot` when set and falls back to the D206 position rule only for
  `null` slots — **D301 supersedes D206**; the fallback stays so a category
  created by the bot (which never sends a colour… until the service assigns
  one) can never render colourless.

## Units

### M0 — Backend

> **Execution order changed by D313/D314.** The migration (U0.3) now runs
> **before** U0.2, so the statistics work is written against `spent_at` once
> instead of being written against `created_at` and rewritten. Order:
> **U0.1a → U0.3 → U0.2 → U0.2a → U0.2b → U0.2c → U0.4 …**

- [x] **U0.1 `resolve_period` + `PeriodPreset`** — done, and its **contract is
      superseded by U0.1a** (D313). The work is not wasted: the tz-correct
      `[start, end)` shape, `_day_bounds`/`_local_midnight`, the DST handling
      and most of `tests/test_period.py` all survive. Only the selector changes
      from a preset enum to unit + offset.
- [x] **U0.1a `PeriodUnit` + offset replaces `PeriodPreset`** (D313) — pure,
      no route, no service wiring. Deletes `PeriodPreset`, adds `PeriodUnit`,
      reworks `resolve_period`'s signature, adds `WEEK`/`YEAR` bounds.
      AC: `day`/`week`/`month`/`year` at `offset=0` and `offset=-1` each
      produce the documented window in a non-UTC `family_tz` (Belgrade, as
      U0.1 used); **weeks start Monday** — a Sunday 23:30 local belongs to the
      week that began the preceding Monday, not the next one; `offset=-3` on
      `week` is exactly 21 days before `offset=0`'s start; `year` at
      `offset=-1` spans 1 Jan – 31 Dec of the previous year in local time;
      `offset > 0` raises `ValueError` for **every** unit; `offset != 0` with
      `unit=CUSTOM` raises; `unit=None` returns exactly `month_bounds(now, tz)`;
      every DST and inclusive-`end_date` guarantee U0.1 established still holds
      (its tests are edited, not deleted).
      Files: `models/enums.py`, `services/period.py`, `tests/test_period.py`.
      Model: sonnet.
- [x] **U0.3 Schema: archive flags, colour slot, `spent_at`** ⚠ **STOP-AND-ASK
      GATE** (`migrations/versions/` + `docs/SCHEMA.sql`) — one revision adding
      all **four** columns with both backfills; models updated to match.
      AC: `alembic upgrade head` then `downgrade -1` is clean on a fresh DB
      (@integration); after upgrade, an account with 8 categories has slots
      1–6 by `created_at ASC` and NULL for the last two — *the colours the app
      renders today do not move*, and **no row is given a slot 7–12** (those
      are for a user to choose); every existing row is `is_active = true`;
      every existing expense has `spent_at` equal to its `created_at` **as seen
      in `family_tz`**, proven by a row created at 23:30 local in a UTC+N zone
      landing on the local date, not the UTC one; `GET /categories` and
      `GET /tags` include the new fields and every existing test stays green;
      a `color_slot` of `0` or `13` fails Pydantic validation, not the DB.
      Files: `migrations/versions/`(new), `docs/SCHEMA.sql`,
      `models/category.py`, `models/tag.py`, `models/expense.py`, tests.
      RISKY (migration) → reviewer subagent. Model: sonnet.
- [x] **U0.2 Statistics adopts `period` + `offset`** — routes + service consume
      `resolve_period`; `months_back` stays as a deprecated alias; the
      four-family mutual-exclusivity table above is enforced.
      AC: `period=day&offset=0` returns the same totals as the equivalent
      explicit `start`/`end` call; `months_back=0` and `period=month&offset=0`
      return identical bounds, and `months_back=1` matches
      `period=month&offset=-1` (alias proven, not assumed); `months_back=2`
      still resolves its 3-month window, which no `{period, offset}` pair can
      express; every listed conflicting combination → 422 naming the conflict;
      `offset=1` → 422; `start_date` without `period=custom` → 422; a call with
      no period params is unchanged; **the whole existing suite green**,
      including the **v2 plan's** U3.1 `months_back=0` smoke (already shipped;
      not this plan's U4.1).
      Files: `api/statistics.py`, `services/statistics_service.py`,
      `tests/test_statistics_api.py`, `tests/test_statistics_service.py`.
      Model: sonnet.
- [x] **U0.2a Period filtering moves to `spent_at`** (D314) — the three SQL
      sites named in Contracts. No API surface change; this unit is purely
      "which column does a period mean".
      AC: an expense with `spent_at` in July and `created_at` in August appears
      in July's statistics and **not** August's; the same expense counts toward
      July's budget progress, not August's (`check_limit` moved too — this is
      the row that makes backdating meaningful rather than cosmetic); an
      expense whose two dates agree behaves exactly as before, proven by the
      existing statistics and budget suites staying green untouched.
      Files: `repositories/expense_repo.py`, `repositories/budget_plan_repo.py`,
      `tests/test_expense_repo.py`, `tests/test_budget_service.py`.
      Model: sonnet.
- [x] **U0.2b `spent_at` on the expense write path** (D314) —
      `ExpenseCreate`/`ExpenseUpdate`/`ExpenseResponse` carry it; the service
      defaults it to today **in `family_tz`**.
      AC: `POST /expenses` without `spent_at` stores the current family date —
      **the bot's existing tests pass with no bot change**, which is the whole
      point; with `spent_at` it stores that date; a future `spent_at` → 422 (at
      the boundary: today in `family_tz` is accepted, tomorrow is not, checked
      at 23:30 local in a UTC+N zone); `PATCH` can move an expense's date and
      the statistics for both the old and new period change accordingly.
      Files: `models/expense.py`, `services/expense_service.py`,
      `api/expenses.py`, `tests/test_expenses_api.py`.
      Model: sonnet.
- [x] **U0.2c `UserMeResponse.account_name`** — verified missing today:
      `models/user.py::UserMeResponse` adds only `currency`, so screen 02's
      Account line has nothing to render.
      AC: `GET /users/me` returns the caller's account name from the same
      `accounts` join that already supplies `currency` — no second query; the
      admin `users` routes still return plain `UserResponse` with no
      `accounts` join, unchanged; `api/types.ts` mirrors the field.
      Files: `models/user.py`, `repositories/user_repo.py`, `api/users.py`,
      `webapp/src/api/types.ts`, `tests/test_users_api.py`.
      Model: haiku.
- [x] **U0.4 Category usage counts + archive-or-delete** — the rule from D302
      in `CategoryService.delete`, plus `list_with_usage` and the two route
      flags. AC: deleting a category with zero expenses **and** zero budget
      plans removes the row; deleting one with expenses leaves the row with
      `is_active = false` and **all its expenses intact and still pointing at
      it** (the assertion that matters); a category with only a budget plan is
      archived, not deleted (D307); `GET /categories` omits archived rows by
      default and includes them with `include_archived=true`;
      `include_usage=true` populates `expense_count` and omitting it leaves it
      `None`; the 409 `ConflictError` path from `ON DELETE RESTRICT` is now
      unreachable but kept as a defensive branch and still tested.
      Files: `repositories/category_repo.py`, `services/category_service.py`,
      `api/categories.py`, `tests/test_category_service.py`,
      `tests/test_categories_api.py`.
      RISKY (delete semantics + data retention) → reviewer subagent.
      Model: sonnet.
- [x] **U0.5 Tag usage counts + archive-or-delete** — mechanical mirror of
      U0.4 over `expense_tags`. AC: a tag on at least one expense is archived,
      and **its `expense_tags` rows survive** (today's `ON DELETE CASCADE`
      would have deleted them — this is the regression this unit exists to
      prevent); an unused tag is hard-deleted; default list is active-only;
      `include_usage=true` counts distinct expenses, not join rows.
      Files: `repositories/tag_repo.py`, `services/tag_service.py`,
      `api/tags.py`, `tests/test_tag_service.py`, `tests/test_tags_api.py`.
      Model: sonnet.
- [x] **U0.6 Colour slot on create/update** — `CategoryCreate.color_slot`,
      `CategoryUpdate.color_slot`, and next-free-slot assignment when the
      client omits it. AC: creating without a colour assigns the lowest slot
      1–6 not already used by an **active** category in that account, and NULL
      once all six are taken; creating with `color_slot=3` keeps 3 even if 3 is
      taken (duplicates are allowed by design — six colours, unbounded
      categories); `0`/`7`/`-1` → 422; updating only the name leaves the colour
      untouched; an archived category's slot is free for reuse.
      Files: `models/category.py`, `services/category_service.py`,
      `tests/test_category_service.py`. Model: sonnet.
- [x] **U0.7 Archived categories are closed for writing** — expense
      create/update and budget-plan create reject them with 409.
      AC: `POST /expenses` with an archived `category_id` → 409 with a message
      naming the category, and **no expense row is written**; `PATCH /expenses`
      moving an expense *into* an archived category → 409; an expense already
      in a category that gets archived is untouched and still editable
      (amount/comment/tags) — archiving closes new assignment, it does not
      freeze history; `POST /budgets` on an archived category → 409.
      Files: `services/expense_service.py`, `services/budget_service.py`,
      `tests/test_expense_service.py`, `tests/test_budget_service.py`.
      Model: sonnet.
- [x] **U0.8 Bot copy follows the new semantics** — the only bot change in
      this plan. `bot/handlers/categories.py`'s "still in use by expenses or
      budget plans" 409 message and both handlers' "Category/Tag deleted."
      confirmation are now wrong for the in-use case.
      AC: deleting an in-use category from the bot reports that it was hidden
      and that past expenses keep it; deleting an unused one still reports a
      plain deletion; the 409 branch stays (defensively) with copy that is true
      if it ever fires; the bot's category keyboard shows no archived category
      **with no code change to the keyboard** (proving D306); existing bot
      tests green.
      Files: `bot/handlers/categories.py`, `bot/handlers/tags.py`,
      `tests/test_bot_categories.py`, `tests/test_bot_tags.py`.
      Model: haiku-friendly.

### M1 — Home redesign: period selection + layout (screen 01)

Implements `docs/ui/screens/01-home.md`, `docs/ui/components/period-selector.md`
and `docs/ui/components/date-range-picker.md`. **Screen 05 (Statistics) is not
touched** (D316) — it keeps its `months_back` chips.

- [x] **U1.1 `lib/period.ts`** — pure, no DOM, no I/O. AC: parametrized
      vitest — `toQuery` emits exactly one selector family and never
      `months_back`; `describe` renders **every row** of the label-format
      table in `docs/ui/components/period-selector.md` ("Today, August 4",
      "Yesterday, August 3", "August 2" with no weekday, "This week",
      "2 – 8 Aug", "28 Jul – 3 Aug", a cross-year week with both years,
      "August", "August 2025", "2026", "9 – 17 Jul"); `monthGrid` returns 6×7
      cells **Monday-first** for a 31-day month starting on a Sunday and for
      February in a leap year, with leading/trailing days flagged;
      `clampOffset` never returns a positive number; `isValidRange` rejects
      reversed and over-`MAX_RANGE_DAYS` ranges; **no function in this module
      converts a date to a UTC instant** (the constraint, asserted by the
      absence of any such export).
      Files: `webapp/src/lib/period.ts`, `webapp/tests/period.test.ts`.
      Model: sonnet.
- [ ] **U1.2 ApiClient period params + types** — the three statistics methods
      take a `PeriodQuery`; `api/types.ts` mirrors U0.2b's `spent_at` and
      U0.2c's `account_name`. AC: against a fake fetch — `period=custom`
      serializes `start_date`/`end_date` as `YYYY-MM-DD` and nothing else; a
      unit serializes `period` and `offset` and nothing else; `offset=0` is
      sent explicitly rather than omitted; `months_back` is no longer sent by
      any method; a 422 from a conflicting call surfaces as the typed
      validation result, not a crash.
      Files: `webapp/src/api/client.ts`, `webapp/src/api/types.ts`,
      `webapp/tests/client.test.ts`. Model: sonnet.
- [ ] **U1.3 Design tokens: 12 slots + accent** — `docs/ui/design-system.md`'s
      colour table, implemented. No behaviour change; nothing consumes
      `--accent` until U1.7. AC: `tokens.css` defines slots 1–12 and
      `--accent`/`--accent-ink` with **both** light and dark values, and every
      value matches the design-system table exactly; `lib/category-colors.ts`
      maps slots 1–12 (not 1–6) and still folds the donut at 6 slices;
      existing home/statistics snapshots are unchanged because no category
      yet has a slot above 6.
      Files: `webapp/src/styles/tokens.css`,
      `webapp/src/lib/category-colors.ts`,
      `webapp/tests/category-colors.test.ts`. Model: haiku.
- [ ] **U1.4 `components/period-selector.ts`** — pure render + thin mount, the
      first module in `src/components/`. AC: **every acceptance criterion in
      `docs/ui/components/period-selector.md`**, notably — five tabs in the
      documented order and wording; the active tab is 600 weight with a 2px
      `--ink` underline and no tab uses `--accent` or a category colour; `›` at
      `offset: 0` is rendered, dimmed, `aria-disabled`, and fires nothing;
      `unit: "custom"` hides both arrows; the label and the "Period" tab both
      call `onOpenPicker`; changing a unit calls `onUnitChange` and never
      `onOffsetChange`; every hit target ≥ 44×44.
      Files: `webapp/src/components/period-selector.ts`,
      `webapp/tests/period-selector.test.ts`, `webapp/src/styles/app.css`.
      Model: sonnet.
- [ ] **U1.5 Home wires the period selector** — Home owns `PeriodValue` state,
      clamps the offset, refetches, and names the period everywhere it speaks.
      AC: the default on a cold open is `month`/`offset 0` (nothing changes for
      someone who never taps); switching a unit resets the offset to 0;
      arrowing refetches and redraws donut, total and rows; **no tap sequence
      produces a label naming a date after today**; the period survives
      navigating to screen 02 and back, and survives a retry, but resets on a
      cold open; a stale in-flight response is discarded (last tap wins);
      loading between periods keeps the donut's 200px slot skeletonised with no
      reflow; an empty period says "Nothing today" / "Nothing in August" naming
      the period in force; the over-budget strip shows **only** on
      `month`/`offset 0`; offline freezes the control at the cached period.
      Files: `webapp/src/screens/home.ts`, `webapp/tests/home.test.ts`,
      `webapp/src/main.ts`, `webapp/src/styles/app.css`. Model: sonnet.
- [ ] **U1.6 Home layout: ranked rows + bottom nav** — the legend becomes the
      full ranked list, and the six tiles move to the bottom. AC: **all**
      categories with a non-zero total render as rows sorted descending, each
      with a filled colour circle, name, share % and amount — the donut still
      folds at six slices but the rows do not fold; a single category renders
      one row (the old "suppress the legend at ≤1" rule is gone); the six tiles
      sit at the very bottom as **two rows of three**, text-only, 32px tall,
      above `env(safe-area-inset-bottom)`; the donut stroke is 30px; a
      30-character category name ellipses on one line without shrinking the
      amount.
      Files: `webapp/src/screens/home.ts`, `webapp/tests/home.test.ts`,
      `webapp/src/styles/app.css`. Model: sonnet.
- [ ] **U1.7 Home yellow Add button** (D318) — the in-card Add affordance,
      alongside MainButton. AC: a 56px `--accent` circle with a `+` sits at the
      bottom-right **inside the chart card** and opens screen 02; **it is not
      `position: fixed`** and scrolls with the card, so it never overlaps
      MainButton — asserted on the computed style, not by eye; MainButton is
      still shown and still reads "Add expense", and both fire the **same**
      handler; medium impact haptic on the yellow button only; for a read-only
      viewer both are hidden while the Add-expense tile stays visible and
      disabled; `--accent` appears in exactly one rule in `app.css`.
      Files: `webapp/src/screens/home.ts`, `webapp/tests/home.test.ts`,
      `webapp/src/styles/app.css`. Model: sonnet.
- [ ] **U1.8 `components/date-range-picker.ts`** (D303) — the calendar sheet.
      AC: **every acceptance criterion in
      `docs/ui/components/date-range-picker.md`**, notably — opens on the
      current month with today ringed; first tap sets the start and clears any
      end; a second tap *before* the start re-anchors instead of reversing; the
      span includes both ends inclusively; **weeks start Monday**, matching
      `resolve_period`; dates after `maxDate` are dimmed and inert; a span over
      366 days shows the reason and keeps Apply disabled; the month heading
      opens a year list; `single` mode applies on one tap with no footer;
      `maxDate` is an input and the module calls `new Date()` nowhere.
      Files: `webapp/src/components/date-range-picker.ts`,
      `webapp/tests/date-range-picker.test.ts`, `webapp/src/styles/app.css`.
      Model: sonnet.
- [ ] **U1.9 "Period" tab wired into Home** — the custom range, end to end.
      AC: Apply issues exactly one fetch with `period=custom` and the two
      dates; dismissing without applying leaves the previous period intact and
      refetches nothing; the label reads "9 – 17 Jul", not a pair of ISO
      strings; the arrows are hidden while a custom range is in force; the
      range survives a retry; BackButton from the open picker closes the
      **picker**, not the screen.
      Files: `webapp/src/screens/home.ts`, `webapp/tests/home.test.ts`,
      `webapp/src/main.ts`. Model: sonnet.

### M2 — Categories & Tags (screens 06 + 07)

- [ ] **U2.0 Colour comes from the server** — `lib/category-colors.ts` prefers
      `color_slot`, position fallback for `null` (D301 supersedes D206);
      Home and Statistics pass the fetched categories through unchanged.
      AC: a category with `color_slot=4` renders slot 4 regardless of its
      position; **a category with `color_slot=11` renders slot 11** (the
      12-slot palette from U1.3, D317); a `null`-slot category still gets a
      stable position-derived colour capped at slot 6; **deleting an earlier
      category no longer shifts a later category's colour** (the D206 risk this
      closes — asserted directly); two categories sharing a slot both render
      it; Home and Statistics agree on every colour for the same input. Files: `lib/category-colors.ts`,
      `tests/category-colors.test.ts`, `screens/home.ts`,
      `screens/statistics.ts`, `webapp/CLAUDE.md` (its "colour is assigned
      client-side in v1" rule is what this unit replaces). Model: sonnet.
- [ ] **U2.1 Screen 06a — Categories list** — the dead tile finally opens.
      Rows: colour dot, name, expense count, this-month total; archived
      categories in a separate collapsed section below with a plain-words
      explanation. AC: the Home "Categories" tile navigates here and
      BackButton returns to Home (the reported bug, closed); rows show count
      and month total from `include_usage=true` + `GET /statistics/by-category`;
      the five states — loading skeleton in the final layout, empty ("No
      categories yet"), error with retry, 403 read-only with no broken buttons,
      offline with a last-synced marker; the archived section is absent when
      nothing is archived; an archived category is never offered anywhere a
      category is *chosen*. Files: `screens/categories.ts`,
      `tests/categories.test.ts`, `main.ts`, `styles/app.css`. Model: sonnet.
- [ ] **U2.2 Screen 06b — Create, rename, recolour** — one form surface,
      MainButton = Save enabled only when dirty (design §4). The colour picker
      is the **twelve** palette swatches (D317), each with its name, current one
      marked by a check, not by colour alone; a slot already used by another
      category is **marked as taken but still selectable**.
      ⚠ **Blocked on the design-system `[?]`**: slots 7–12 have not been run
      through the dataviz validator. Validate them before this unit ships a
      picker that offers them.
      AC: creating adds the category and returns to
      the list with it visible; renaming round-trips; recolouring updates every
      dot on Home and Statistics on the next render; picking an already-used
      slot succeeds after showing it is taken; Save disabled until dirty
      and disabled again after a successful save; a duplicate name warns but
      does not block (MVP D19 unchanged, D311); an empty/whitespace name is
      rejected inline, never as a popup; 403 and network failure preserve the
      draft; double submit issues exactly one write.
      Files: `screens/categories.ts`, `tests/categories.test.ts`,
      `api/client.ts`(if needed), `styles/app.css`. Model: sonnet.
- [ ] **U2.3 Screen 06c — Delete or hide** — the D302 rule made legible.
      AC: for a category with zero expenses the confirm popup says it will be
      deleted; for one with expenses it says it will be **hidden** and names
      the number of past expenses that keep it ("42 expenses keep it for
      reports"); confirmation is Telegram's own popup, never a custom modal;
      after an archive the row moves to the archived section without a full
      reload; after a hard delete it disappears; a failure restores the row and
      says what failed; 403 shows the read-only message rather than a broken
      button; the last remaining active category is deletable but warns that
      new expenses will have nowhere to go. Files: `screens/categories.ts`,
      `tests/categories.test.ts`. Model: sonnet.
- [ ] **U2.4 Screen 07a — Tags list** — mirror of U2.1 without colour: name,
      expense count, this-month total, archived section. AC: the Home "Tags"
      tile opens it, BackButton returns to Home; per-tag counts come from
      `include_usage=true` (D305), not a client-side roll-up of the expense
      list — this is the design doc's §4 open question, now answered; the empty
      state explains what a tag is *for* before offering to create one (design
      §4); an unused tag renders a count of 0 without looking like an error;
      all five states. Files: `screens/tags.ts`, `tests/tags.test.ts`,
      `main.ts`, `styles/app.css`. Model: sonnet.
- [ ] **U2.5 Screen 07b — Tag create, rename, delete-or-hide** — U2.2 + U2.3
      condensed for tags (no colour, so one unit is enough).
      AC: create/rename round-trip; a tag used by expenses is hidden with the
      count named, and **its expenses keep the tag** (asserted through the
      expense list, not just the tags response); an unused tag is deleted;
      double submit issues exactly one write; 403/failure paths as in U2.2.
      Files: `screens/tags.ts`, `tests/tags.test.ts`. Model: sonnet.

### M3 — Add expense redesign (screen 02)

Implements `docs/ui/screens/02-add-expense.md` and
`docs/ui/components/category-picker.md`.

**Ordered after M2 on purpose**: the redesigned screen's "More" cell navigates
to screen 06 and its "+ Add tag" chip to screen 07. Building it first would
mean shipping two buttons that go nowhere.

The existing composer is **extended, not rewritten** — the draft model, the
double-submit guard (D118/D123) and the MainButton contract are untouched by
every unit below.

- [ ] **U3.1 `components/category-picker.ts`** — the 4-column grid replacing
      the current inline chips. AC: **every acceptance criterion in
      `docs/ui/components/category-picker.md`**, notably — 64px filled circles
      with the name centred underneath and **no glyph, letter or emoji inside
      any circle**; selection turns the circle into a 12px-radius rounded
      square and bolds the name (shape + weight, never colour alone); two
      categories sharing a slot render the same colour without error; the last
      cell always reads "More" and calls `onMore`, never `onSelect`; a
      30-character name wraps to two lines then ellipses without misaligning
      the row; `disabled` suppresses every callback and hides "More".
      Files: `webapp/src/components/category-picker.ts`,
      `webapp/tests/category-picker.test.ts`, `webapp/src/styles/app.css`.
      Model: sonnet.
- [ ] **U3.2 Amount, account and the category grid** — the top of the screen.
      AC: the amount input is focused with the numeric keypad up **before any
      network call resolves**; the currency code renders beside it in
      `--ink-secondary` and is not tappable; the account name renders under an
      "Account" label from U0.2c's field and is not tappable; the grid is the
      U3.1 component; "More" navigates to screen 06 and returning refetches the
      list with the draft's amount, tags and comment intact; the loading state
      shows 8 circle skeletons in the final grid positions.
      Files: `webapp/src/screens/add-expense.ts`,
      `webapp/tests/add-expense.test.ts`, `webapp/src/styles/app.css`.
      Model: sonnet.
- [ ] **U3.3 Date row** — the three pills, the calendar button, and `spent_at`
      on the wire. AC: pills read "today", "yesterday" and "two days ago" with
      their dates above, dates resolved in `family_tz` and **not** from the
      device clock; "today" is selected on open and the created expense's
      `spent_at` matches the selected pill; the calendar button opens U1.8's
      picker in `single` mode and BackButton from it closes the **picker**, not
      the screen; a date chosen outside the three shortcuts appears as a fourth
      selected pill; **no future date is selectable** in pills or calendar;
      changing only the date does **not** make the draft dirty, so BackButton
      does not prompt.
      Files: `webapp/src/screens/add-expense.ts`,
      `webapp/tests/add-expense.test.ts`, `webapp/src/styles/app.css`.
      Model: sonnet.
- [ ] **U3.4 Tags and comment** — the bottom of the screen. AC: tag chips wrap
      over multiple rows with **no horizontal scroll and no fold**; "+ Add tag"
      is always the last chip and navigates to screen 07; a tag created there
      returns **pre-selected** with the rest of the draft intact; multi-select
      works and two selected tags both land on the created expense; the comment
      field has **no character counter** and is capped at 4096 by `maxlength`;
      focusing the comment scrolls it clear of the keyboard, laid out against
      `viewportStableHeight` rather than `100vh`.
      Files: `webapp/src/screens/add-expense.ts`,
      `webapp/tests/add-expense.test.ts`, `webapp/src/styles/app.css`.
      Model: sonnet.
- [ ] **U3.5 Archived-category error paths** — the two failure modes the
      redesign introduces surface as sentences. AC: a 404 on submit shows
      "That category no longer exists.", clears the selection and refetches,
      keeping the rest of the draft; a 409 (D302, writing into an archived
      category) shows "That category was archived. Choose another." with the
      same recovery; neither is a popup and neither shows a status code;
      MainButton returns to its enabled state afterwards.
      Files: `webapp/src/screens/add-expense.ts`,
      `webapp/tests/add-expense.test.ts`. Model: sonnet.

### M4 — Smoke

- [ ] **U4.1 e2e: period + archive through `initData` (@integration)** — one
      signed-payload scenario over the real app: create a category with an
      explicit colour → add an expense today and one **backdated** to
      yesterday via `spent_at` → `period=day&offset=0` and
      `period=day&offset=-1` each return exactly one of them, **proving the
      backdated row is filed by `spent_at` and not by `created_at`** →
      `period=custom` spanning both returns both → `period=week&offset=0`
      returns both → archive the category → it vanishes from `GET /categories`
      but is still present with `include_archived=true`, and the two expenses
      are still returned by `GET /expenses` and still counted by
      `/statistics/by-category` for the custom range → a `POST /expenses` into
      it now 409s.
      AC: scenario green on the test DB; excluded from default `verify.sh`
      (integration marker); the v2 smoke scenario still passes unchanged.
      Files: `tests/test_e2e_smoke.py`(+). Model: sonnet.

## Live-test checkpoints

- **CP0 — before U0.3**: back up / snapshot the Supabase database. U0.3 is the
  first migration since `accounts.currency` and it backfills existing rows.
- **CP1 — after U0.8**: from the **bot**, delete a category that has expenses.
  It disappears from `/categories` and from the expense-adding keyboard, and
  the old expenses still show its name in `/expenses`. This proves the whole
  M0 archive rule with no frontend involved.
- **CP1a — after U0.2b**: from the **bot**, add an expense. It still lands on
  today and still appears in `/statistics`. The bot must need no change for
  `spent_at` to work (D314) — if it does, the default is wrong.
- **CP2 — after U1.5**: in the Mini App, Home offers Day/Week/Month/Year with
  arrows; yesterday's number matches what the bot reports for the same window,
  and the `›` arrow is dead on arrival at the current period.
- **CP3 — after U1.9**: pick a range across a month boundary on the calendar;
  the total equals the sum of the two months' parts. Then arrow back a year on
  the Month tab and confirm nothing breaks on an empty period.
- **CP4 — after U2.3**: create a category, give it a colour, watch Home's donut
  adopt it, then hide the category and confirm the donut for an old period
  still names and colours it.
- **CP5 — after U2.5**: same round trip for a tag.
- **CP6 — after U3.3**: add an expense backdated to last month from the Mini
  App. It appears in last month's donut, not this month's, and it moves last
  month's budget progress rather than this month's (D314's whole point).

## Risks
- **The migration runs against production Supabase.** `is_active` has a
  `NOT NULL DEFAULT true`, which is a metadata-only change on modern
  PostgreSQL, and the `color_slot` backfill touches every category row — small
  at family scale, but CP0's snapshot is not optional. Downgrade drops the
  columns and therefore the colours; that is the accepted cost of a reversible
  migration.
- **Archiving changes what "delete" means for the bot, silently.** A family
  member who deletes a category from the bot after U0.4 but before U0.8 gets a
  "Category deleted." message for something that was hidden. The two units are
  adjacent for this reason; if only one ships, ship both.
- **`expense_tags` is `ON DELETE CASCADE`.** Hard-deleting a tag still destroys
  its links. U0.5 is the only thing standing between a mis-tap and permanently
  lost tag history — its AC asserts the join rows survive, and the hard-delete
  branch is reachable *only* when the count is zero.
- **A stale webview bundle can send a now-invalid combination.** `months_back`
  is kept alive precisely for this (D300); everything else the old bundle sends
  is unchanged. The removal unit must not run until every device has loaded a
  post-U1.2 build.
- **Six colours, unbounded categories.** Duplicates are allowed by design; a
  user can give two categories the same colour and the donut will look odd.
  The picker shows which slots are taken; it does not forbid them. Generating a
  seventh hue is not an option (design §6).
- **Counts are computed per request.** `list_with_usage` is a `GROUP BY` over
  the account's expenses on every Categories/Tags open. Correct and trivial at
  family scale; if a season of data ever makes it slow, the fix is a cached
  count column, not a client roll-up.
- **Day-scoped periods vs monthly budgets.** Budgets are monthly (V1.1); Home's
  over-budget strip has no meaning for "yesterday". U1.5 shows it **only** on
  `month`/`offset 0` rather than computing a fractional figure nobody asked for
  (D310, extended to Week/Year/custom by `docs/ui/screens/01-home.md`).
- **`accounts.currency` has no DB `CHECK`** (inherited from v2's Risks) —
  unchanged by this plan and still a candidate for its own unit.

## Decision log
- D300 (2026-08-03, HUMAN): periods are named by a **`period` enum**
  (`today|yesterday|this_month|last_month|last_3_months|custom`) plus
  `start_date`/`end_date` for the custom case, all resolved server-side in
  `family_tz`. **`months_back` is kept as a deprecated alias** mapped onto the
  enum rather than removed, so a Telegram webview pinned to a pre-U1.2 bundle
  keeps working instead of 422-ing after deploy; its removal is a later
  cleanup unit. Rejected: replacing `months_back` outright (cleaner contract,
  but breaks cached clients for no gain at this size); having the client send
  computed `start`/`end` datetimes (re-creates D120's bug exactly and violates
  webapp/CLAUDE.md's zero-business-logic rule).
- D301 (2026-08-03, HUMAN): **supersedes D206.** A category's colour lives in
  the database as `categories.color_slot`, backfilled from today's
  position-derived assignment so no colour moves on deploy. Rejected: keeping
  colour client-side in `localStorage` — it is per-device, so the two family
  members would see different colours for the same category, a webview cache
  clear would lose them, and colour could never appear in any other surface.
  D206's position rule survives only as the fallback for a `NULL` slot.
- D302 (2026-08-03, HUMAN): `DELETE` on a category or a tag **archives it when
  it is still referenced** (`is_active = false`: gone from every picker, still
  named and counted in analytics) and **hard-deletes it when it is not**. One
  button, two outcomes, and the client always knows which it will be because
  the list carries `expense_count`. Rejected: always archiving (uniform and
  fully reversible, but a category mistyped ten seconds ago becomes permanent
  clutter); keeping the `ON DELETE RESTRICT` 409 (the status quo — it makes the
  user choose between losing history and living with a category they cannot
  remove from the picker).
- D303 (2026-08-03, HUMAN): the custom range is picked on a **hand-rolled
  month-grid calendar** in `src/components/`, not native `<input type="date">`
  pairs and not a date-picker dependency. Rejected: native inputs (cheap and
  accessible, but rendered by the OS and visibly foreign to the app); any
  library (webapp/CLAUDE.md — no new runtime dependency without sign-off, and
  a picker is ~200 lines of pure logic that is already fully unit-testable).
- D304 (2026-08-03): archived state is a **boolean `is_active`**, not a
  nullable `archived_at` timestamp. Nothing in the product asks *when*
  something was archived, and a boolean reads correctly in the one place it
  matters — a `WHERE is_active` in the default list query. Rejected:
  `archived_at` (free audit trail, but an unused column that every query would
  have to write `IS NULL` against).
- D305 (2026-08-03): usage counts ride on the existing list endpoints behind
  `include_usage=true`, not on a new `/categories/{id}/usage` route and not
  always-on. The two screens that need counts ask for them in the same request
  they already make; the bot and the add-expense picker keep the cheap query.
  This also answers the design doc's §4 open question for screen 07 (per-tag
  counts) in favour of the API over a client-side roll-up of the expense list,
  which would have been wrong the moment pagination truncated it.
- D306 (2026-08-03): `include_archived` **defaults to false**. Chosen so the
  bot inherits correct behaviour with zero bot changes — its category keyboard
  calls `GET /categories` and simply stops seeing archived rows. The cost is
  that an analytics caller must remember the flag; U0.2's and U2.0's ACs pin
  the two places that must.
- D307 (2026-08-03): archiving a category with a budget plan **is allowed**;
  the plan row stays and the Budgets screen filters out plans whose category is
  archived. Rejected: refusing with 409 ("remove its budget first" — a second
  chore to complete a delete); cascading the plan away (destroys the budget
  history for the periods it applied to, which is the very thing archiving
  exists to protect).
- D308 (2026-08-03): `color_slot` stores the **palette slot index (1–6)**, not
  a hex string. Each slot has a light and a dark variant in `tokens.css`; a
  stored hex would be correct in exactly one theme. Consequence: the picker
  offers six swatches, duplicates are allowed, and there is no free-form colour
  input — which is also what design §6 requires ("never generate a seventh
  hue"). A slot, once set, is never cleared back to auto; there is no UI for it
  and no use case.
- D309 (2026-08-03): screen 07's tag→category drill-down (design §4) is **out
  of scope**. It needs a `tag_id` filter on `/statistics/by-category` that does
  not exist; the user's request was create/edit/delete. The design doc keeps
  the spec, marked deferred.
- D310 (2026-08-03): Home's over-budget strip is **hidden for day-scoped
  periods**. Budgets are monthly (V1.1); "35% of your monthly grocery budget"
  next to a single day's spending is a comparison between two different things.
  Rejected: pro-rating the budget to the period (invents a daily budget nobody
  set).
- D311 (2026-08-03): category/tag **name uniqueness stays a UI warning**, not a
  DB constraint — MVP D19 unchanged. Archiving makes a constraint actively
  awkward: an archived "Groceries" would block creating a new one. This closes
  the design doc's §11 open question.
- D312 (2026-08-03): **no un-archive action in this plan.** The archived list
  is visible and readable so nothing is hidden from the user, but restoring is
  a rare-enough operation to leave for a follow-up (or a manual `UPDATE`),
  and adding it now would mean a fourth state in every list unit. Revisit if
  it is ever asked for.
- D313 (2026-08-04, HUMAN): **supersedes D300's enum.** A period is a
  **`PeriodUnit` (`day|week|month|year|custom`) plus an `offset` (int ≤ 0)**,
  not a preset name. Home's tabs carry left/right arrows, and an enum of named
  presets cannot express "three weeks back" or "last year" — `last_week` has
  nowhere to go on a second tap. `offset > 0` is rejected **at the API**, so
  the future is unreachable rather than merely un-tappable. Cost, accepted:
  `PeriodPreset` and part of `resolve_period`, both merged in U0.1, are
  reworked before anything consumes them (U0.1a). Rejected: adding
  `this_week`/`last_week`/`this_year`/`last_year` to the enum (cheaper, but the
  arrows would stop after one step, which is the feature); keeping both the
  enum and an offset (two ways to name the same period, which is exactly the
  ambiguity D300's mutual-exclusivity rule exists to prevent).
- D314 (2026-08-04, HUMAN): **`expenses.spent_at DATE NOT NULL DEFAULT
  current_date`.** The Add-expense screen offers today / yesterday / two days
  ago / any date, and `created_at` cannot answer "when did this happen" once
  it is also answering "when was this typed". Every period filter, every
  statistic **and budget progress** move to `spent_at`; `created_at` survives
  as the audit trail. The bot needs no change — omitting the field defaults to
  today, which is its current behaviour. Backfilled as
  `(created_at AT TIME ZONE family_tz)::date` so no existing row moves period;
  a naive `created_at::date` would shift late-night expenses across a month
  boundary, which is D120's bug wearing a different hat. Rejected: letting the
  client set `created_at` (no migration, but the audit trail and the event date
  collapse into one column and the bot's writes silently change meaning).
- D315 (2026-08-04, HUMAN): **weeks start Monday**, resolved in `family_tz`
  like every other bound. The reference app starts weeks on Sunday; ISO and the
  family's locale do not. Binding: `resolve_period`'s `WEEK` bounds and the
  calendar picker's weekday header must agree — a picker whose weeks start on
  a different day than the Week tab is a bug users find within a week.
- D316 (2026-08-04, HUMAN): **screen 05 (Statistics) is out of scope.** It
  keeps its `months_back` chips; the period selector ships on Home only. This
  is why `months_back` cannot be deleted in this plan, and why the statistics
  routes end up accepting four mutually exclusive selector families rather
  than two. Accepted cost: two period vocabularies coexist in the client until
  Statistics is revisited.
- D317 (2026-08-04, HUMAN): **the category palette grows 6 → 12 slots and the
  user picks the slot** on screen 06. Six was enough while colour was assigned
  automatically by list position; it is thin once it is a choice, and the
  reference app shows eight distinct category colours. Two categories **may**
  share a slot — the picker marks a slot as taken but does not forbid it, which
  is survivable precisely because identity is always a colour *plus* a name.
  The backfill still only assigns 1–6, so no existing colour moves. Open: slots
  7–12 were chosen by eye and have not been run through the dataviz validator
  (`docs/ui/design-system.md`) — that is blocking for U2.2's picker, not for
  M1. This also settles the icon question: **no icons**, colour is the
  expressiveness.
- D318 (2026-08-04, HUMAN): **screen 01 ships both Telegram's MainButton and a
  yellow in-card Add button.** `references/telegram-miniapp.md` warns against a
  custom primary button competing with MainButton; the warning was raised and
  the answer was to build both. What makes it safe is position: the yellow
  button lives **inside the chart card** and scrolls with it, so it never
  overlaps or covers MainButton — the concrete failure the guidance is about.
  Binding constraint: it must **never** be `position: fixed`, and that is an
  acceptance criterion in U1.7, not a style note. `--accent` is a named,
  bounded exception to "chrome is ink" usable by that one element and nothing
  else. Rejected: FAB only with MainButton hidden (cleaner, one primary, but
  gives up the native button the user wanted kept); MainButton only (no
  redundancy, but not the requested design).
- D319 (2026-08-04): **U0.3 adds the four columns and the read-side model
  fields only** — `CategoryResponse`/`TagResponse` gain `is_active`,
  `CategoryResponse` gains `color_slot`, both gain `expense_count`, and
  `ExpenseResponse` gains `spent_at`. The **write-side** stays out:
  `CategoryCreate`/`Update.color_slot` is U0.6's contract, and
  `ExpenseCreate`/`Update.spent_at` is U0.2b's — both units' file lists
  already named `models/category.py`/`models/expense.py`, which only makes
  sense if U0.3 hadn't already put those fields on `Create`/`Update`. New
  response fields default to values matching the DB column defaults
  (`is_active=True`, `color_slot=None`, `expense_count=None`,
  `spent_at` via `default_factory=date.today`) purely so pre-existing test
  fixtures that construct these models positionally keep compiling —
  repositories return real rows via `SELECT *`/`RETURNING *`, so no
  repository change was needed for the fields to populate for real.
- D320 (2026-08-04): the AC's "`alembic upgrade head` then `downgrade -1`"
  check is **not** a new pytest test — it's already covered generically for
  every migration by `.github/workflows/ci.yml`'s "Apply migrations" +
  "Verify downgrade/upgrade round-trip" steps, which only run in CI (D18:
  `alembic` needs `greenlet`, missing on this macOS ARM dev machine —
  confirmed again while implementing this unit). What
  `tests/test_schema_backfill.py` covers instead, as `@pytest.mark.integration`,
  is the backfill *formula*: the same SQL the migration runs (color-slot
  ranking, `spent_at`'s `AT TIME ZONE`), executed directly against fixture
  rows with controlled `created_at` values, proven against a real throwaway
  Postgres via `scripts/integration_docker.sh`. This is the pattern future
  migration units with a backfill should follow.
- D321 (2026-08-04): **`offset` given without `period` is 422**, not silently
  ignored. The Contracts table only says offset is "only with a non-custom
  period" — it doesn't say what happens if a client sends `offset` alone.
  `resolve_period(None, offset=...)` would silently drop a non-zero offset
  (the `unit is None` branch returns `month_bounds` unconditionally), so
  without this check a client typo (`offset=-1` with no `period`) would
  silently resolve to the current month instead of failing loud. `api/
  statistics.py::_validate_period` rejects it before the service ever calls
  `resolve_period`.
- D322 (2026-08-04): **U0.2a's test-file split corrects the plan's Files
  list.** `check_limit`'s only integration coverage lives in
  `tests/test_budget_plan_repo.py` (real SQL) — `tests/test_budget_service.py`
  is a fully-mocked unit suite (`FakeExpenseSumRepo`) that never calls
  `check_limit` at all; the caller that does is `ExpenseService`, tested
  against a `FakeBudgetPlanRepo` in `tests/test_expense_service.py`, also
  mocked. The new `spent_at`-vs-`created_at` backdating test for
  `check_limit` was added to `test_budget_plan_repo.py` instead, where it can
  actually exercise the changed SQL. `tests/factories.py::make_expense` also
  gained a `spent_at` param (not in the plan's Files list either): it
  defaults from `created_at`'s calendar date so every pre-existing caller
  that only sets `created_at` keeps landing in the period it already
  appeared in, without editing those callers. One pre-existing test,
  `test_get_by_period_respects_month_boundaries_across_timezones`, asserted
  `get_by_period`'s old TIMESTAMPTZ-instant comparison behavior on
  `created_at` (same absolute instant, different tzinfo offsets) — that
  property doesn't exist for a bare `DATE` column, so it was rewritten as
  `test_get_by_period_respects_month_boundaries`, testing the same
  half-open-window boundary on explicit `spent_at` dates instead.
- D323 (2026-08-04, review-found BLOCKER, fixed same unit): **U0.2a's first
  pass compared `spent_at` (`DATE`) directly against the UTC-instant
  `datetime` bounds `resolve_period`/`month_bounds` already produced —
  correct for `TIMESTAMPTZ` (D314's premise), silently wrong for `DATE`.**
  asyncpg/Postgres resolve `spent_at >= $2` by inferring `$2` as `date` (to
  match the column) and take the raw `year/month/day` off the Python
  `datetime` with **no timezone conversion** — but `start`/`end` are local
  midnight *in `family_tz`* expressed as a UTC instant, so for any
  `family_tz` ahead of UTC (Europe/Belgrade — this project's own realistic
  default and `tests/test_period.py`'s primary non-UTC fixture — included)
  the UTC calendar date of that instant is one day earlier than the local
  one. Empirically reproduced by the `reviewer` subagent against real
  Postgres: a July-31-Belgrade expense wrongly appeared in August's
  statistics and wrongly moved 50% of August's budget fill. Fixed by giving
  `get_by_period`, `sum_by_category_month` and `check_limit` an explicit
  `tz: str = "UTC"` keyword param, converting in SQL with
  `(start AT TIME ZONE $tz)::date` instead of comparing the raw instant —
  see `repositories/CLAUDE.md`'s new "Timezone exception" note (repo-level
  tz-agnosticism holds for `TIMESTAMPTZ`, not `DATE`). `statistics_service.
  _expenses` — the one call site that already passes non-UTC bounds today
  (`self._family_tz`) — was updated to pass `tz=self._family_tz`; its
  Protocol and `tests/test_statistics_service.py`'s Fake were widened to
  match. `sum_by_category_month`/`check_limit` keep the `tz="UTC"` default
  unchanged at their call sites (`budget_service.get_progress`,
  `expense_service`'s notification check) because those already only ever
  pass UTC-aligned bounds (`month_bounds()` with no `tz` — a separate,
  pre-existing gap, not introduced or fixed here); flagged in Gotchas below
  so the next unit to plumb `family_tz` into budgets/notifications doesn't
  reintroduce this exact bug. Proven with three new
  `@pytest.mark.integration` tests (one per SQL site) using
  `tz="Europe/Belgrade"` with a real boundary expense on the last local day
  of the month, run against a real throwaway Postgres
  (`scripts/integration_docker.sh`) since this class of bug is invisible to
  mocked unit tests and to `verify.sh` alone.

- D324 (2026-08-04): **U0.2c's Files list named `repositories/user_repo.py`
  and `api/users.py`; the actual join already lived one layer up.** D211's
  `GET /users/me` currency read is done in `api/deps.py::
  get_current_user_with_currency`, which already calls `account_repo.get(user.
  account_id)` and had `AccountResponse.name` sitting unused right next to
  `.currency`. Adding `account_name` was therefore a one-line change to that
  existing dependency — no new repo method, no new query, exactly the "same
  `accounts` join" the AC asked for. `repositories/user_repo.py` and
  `api/users.py` are untouched. Function name/docstring kept and extended
  rather than renamed (single call site, minimal diff). Files actually
  touched: `models/user.py`, `api/deps.py`, `webapp/src/api/types.ts`,
  `tests/test_models.py`, `tests/test_users_api.py`,
  `webapp/tests/client.test.ts`, `tests/README.md`.
- D325 (2026-08-04): **U0.6's `CategoryCreate`/`CategoryUpdate.color_slot`
  validates `1–6`, not `1–12`**, even though `CategoryResponse.color_slot`
  already validates `1–12` (D317, U0.3) and the Contracts section doesn't
  itself pin a write-side range. The unit's own AC is explicit — "the lowest
  slot 1–6", "`0`/`7`/`-1` → 422", "six colours, unbounded categories" — and
  D317 says the 7–12 range exists for **U2.2's picker**, not for this unit's
  auto-assign, and is still unvalidated against the dataviz tool. Binding:
  `Response` and `Create`/`Update` are deliberately asymmetric until U2.2
  ships; that unit is expected to widen `Create`/`Update` to `1–12` once
  slots 7–12 are validated, not to touch this unit's range again.

## STATE (handoff)
- Done: **U0.1** — `PeriodPreset` added to `models/enums.py`; `resolve_period`
  added to `services/period.py`, delegating to `month_bounds` for the three
  month-shaped presets via a `_month_start_before` helper (mirrors the one in
  `statistics_service.py`, which U0.2 is expected to reconcile), and to a new
  `_day_bounds`/`_local_midnight` pair for `TODAY`/`YESTERDAY`/`CUSTOM`. 21
  tests in `tests/test_period.py` (Europe/Belgrade for the general cases,
  America/New_York for the local-vs-UTC-date edge case, both Belgrade 2026
  DST transitions for the 23h/25h span check). verify.sh green.
- **Replanned 2026-08-04** against the new UI specs in `docs/ui/` (D313–D318).
  U0.1's contract is superseded before anything consumed it; M1 was rewritten
  from the three-chip design to tabs + arrows; a new **M3 — Add expense
  redesign** was inserted, which pushed the smoke milestone to **M4/U4.1**.
  Screens 06/07 (M2) are unchanged apart from the 12-slot palette.
- Done: **U0.1a** — `PeriodPreset` deleted from `models/enums.py`, replaced by
  `PeriodUnit` (`day|week|month|year|custom`); `resolve_period` reworked to
  `(unit, *, offset=0, start_date, end_date, now, tz)`. `DAY`/`WEEK`/`MONTH`/
  `YEAR` each resolve via `offset` (`<= 0`, `ValueError` above zero); `WEEK`
  anchors on the local Monday of the target week (`_local_midnight`, D315);
  `MONTH` uses a new `_shift_month` calendar-arithmetic helper (replacing the
  now-unused `_month_start_before`) that reproduces `month_bounds` exactly at
  `offset=0`; `YEAR` is direct `(year + offset)` arithmetic; `CUSTOM` keeps
  its exact U0.1 body and now rejects any non-zero `offset`. `unit=None` still
  returns `month_bounds` unconditionally. 33 tests in `tests/test_period.py`
  (10 replaced/added for offset semantics — day/week/month/year at offset 0
  and -1, the Sunday-belongs-to-preceding-Monday case, the offset=-3-is-21-
  days-before-offset=0 case, year spanning the previous calendar year,
  offset>0 rejected for every unit, CUSTOM rejecting non-zero offset — every
  DST/inclusive-end-date/naive-`now` test from U0.1 kept, edited onto the new
  signature). verify.sh green. No new decisions — implemented exactly to
  D313's contract.
- Done: **U0.3** — one migration
  (`migrations/versions/2026_08_04_1829-a1d5976f1ce0_add_category_tag_archive_flags_color_.py`)
  adding `categories.is_active`/`color_slot`, `tags.is_active`,
  `expenses.spent_at`, with both backfills (color-slot ranking capped at 6;
  `spent_at` via `(created_at AT TIME ZONE family_tz)::date`, `family_tz`
  read from `config.get_settings()` at migration time). `docs/SCHEMA.sql`
  updated to match. Models: `CategoryResponse`/`TagResponse` gain
  `is_active`/`expense_count` (+`color_slot` on Category, `ge=1, le=12`
  validated), `ExpenseResponse` gains `spent_at` — read-side only, see D319.
  Backfill formula correctness proven by 5 new `@pytest.mark.integration`
  tests in `tests/test_schema_backfill.py`, run against a real throwaway
  Postgres via `scripts/integration_docker.sh` (real `alembic upgrade` still
  can't run locally, D18/D320). Reviewer: [pending — see report].
  verify.sh green.
  ⚠ **Not yet applied to production Supabase.** Before running
  `alembic upgrade head` there: take the CP0 snapshot first (STATE gotcha
  below still applies to the *deploy* step, even though the unit itself is
  done).
- Done: **U0.2** — `api/statistics.py`'s three routes (`by-period`,
  `by-category`, `by-tag`) and `services/statistics_service.py` now accept
  `period`/`offset`/`start_date`/`end_date` and resolve them via
  `resolve_period`; `months_back` stays as the deprecated alias (still the
  only way to express `months_back=2`'s 3-month window, D316). Mutual
  exclusivity across the four selector families is enforced in
  `api/statistics.py::_validate_period`; `resolve_period`'s `ValueError`
  (missing `start_date`/`end_date` under `period=custom`, `offset` with
  `period=custom`, oversized custom range) is mapped to 422 by each route.
  `offset` without `period` is a new 422 (D321) — not in the Contracts table,
  added to avoid a silently-dropped offset. verify.sh green. New tests in
  `tests/test_statistics_service.py` (period/offset ↔ explicit start/end and
  ↔ months_back equivalence, per AC) and `tests/test_statistics_api.py`
  (every named conflict combo → 422); `tests/README.md` updated.
- Done: **U0.2a** — `expense_repo.get_by_period`, `expense_repo.
  sum_by_category_month` and `budget_plan_repo.check_limit` all filter on
  `expenses.spent_at` instead of `expenses.created_at` (D314); no route/API
  change. Each also gained an explicit `tz: str = "UTC"` keyword param
  (D323 — a `reviewer`-found BLOCKER: naively comparing the `DATE` column
  against the UTC-instant bounds misfiled boundary expenses for any
  `family_tz` ahead of UTC; fixed with `(start AT TIME ZONE $tz)::date` in
  SQL). `statistics_service._expenses` now passes `tz=self._family_tz` to
  `get_by_period` (its Protocol + `tests/test_statistics_service.py`'s Fake
  widened to match) — the one live call site that already used non-UTC
  bounds; `sum_by_category_month`/`check_limit`'s callers
  (`budget_service`/`expense_service`) are untouched and still default to
  `tz="UTC"`, matching their current (separately pre-existing) UTC-only
  `month_bounds()` usage — see the new Gotcha below.
  `tests/factories.py::make_expense` gained a `spent_at` param defaulting
  from `created_at`'s calendar date, so every pre-existing caller keeps
  behaving exactly as before with zero edits. Verified against a real
  throwaway Postgres (`scripts/integration_docker.sh`) since the
  correctness hinges on `DATE`/`TIMESTAMPTZ`/timezone SQL semantics, not
  just mocked repos — full 75-test integration suite green. New/changed
  tests: `test_get_by_period_filters_by_spent_at_not_created_at`,
  `test_sum_by_category_month_filters_by_spent_at_not_created_at`,
  `test_check_limit_counts_by_spent_at_not_created_at` (new, the last one in
  `test_budget_plan_repo.py` not `test_budget_service.py` — see D322),
  `test_get_by_period_respects_month_boundaries` (rewritten, see D322), and
  three D323 non-UTC boundary tests (`..._filters_by_local_spent_at_not_utc_
  calendar_date` / `test_check_limit_counts_by_local_spent_at_not_utc_
  calendar_date`) using `tz="Europe/Belgrade"`. `tests/README.md` and
  `repositories/CLAUDE.md` updated. Reviewer: 2 rounds — round 1 found the
  D323 BLOCKER (fixed, re-verified against real Postgres); round 2 (APPROVE)
  raised one WARN — nothing proved `StatisticsService` itself passes
  `tz=self._family_tz` through to the repo, since the new D323 integration
  tests exercise the repos directly — closed by having
  `FakeExpensePeriodRepo.calls` record `tz` and asserting it in
  `test_by_period_default_uses_family_tz_not_utc`. verify.sh green.
- Done: **U0.2b** — `ExpenseBase` gains `spent_at: date | None = None`
  (`ExpenseCreate`/`ExpenseUpdate` inherit it optional; `ExpenseResponse`
  keeps its own required-with-fixture-default override, narrowing Base's
  Optional back to a concrete date). `ExpenseService` takes a `family_tz`
  (threaded from `get_settings().family_tz` in `api/deps.py::
  get_expense_service`, the same pattern `get_statistics_service` already
  uses) and a private `_local_today(tz, now=None)` helper — `now` is
  injectable, mirroring `resolve_period`'s own `now` param, so the DST/
  boundary AC ("23:30 local in a UTC+N zone") is deterministically testable.
  `create()` defaults an omitted `spent_at` to `_local_today`; both
  `create()`/`update()` reject a future `spent_at` with `ValueError`, mapped
  to 422 in `api/expenses.py` (same `except ValueError` pattern
  `api/statistics.py` already uses). `update()` folds `spent_at` into the
  existing D30/D32 "explicit null is ignored, not nulled" list alongside
  `amount`/`category_id` — it's a `NOT NULL` column with no clear semantics.
  13 new tests (8 in `test_expense_service.py` incl. the two boundary cases,
  5 in `test_expenses_api.py`); `tests/README.md` updated. No new decisions —
  implemented to the Contracts section and the gotcha below. verify.sh green.
- Done: **U0.2c** — `UserMeResponse.account_name: str` added next to
  `currency`. The read side needed no new query: `api/deps.py::
  get_current_user_with_currency` already fetched the account row for
  `currency` (D211) and now also reads `.name` off the same object — see
  D324 for why the plan's original Files list (`user_repo.py`/`api/users.py`)
  didn't match. `webapp/src/api/types.ts::UserMeResponse` mirrors the field;
  no screen consumes it yet (that's a later M2 unit). 3 tests
  touched/added: `test_models.py`'s `UserMeResponse` construction test,
  `test_users_api.py`'s currency test (renamed to assert both fields) and its
  "no leak on `/users`" test, plus `webapp/tests/client.test.ts`'s response-
  parsing fixture. `tests/README.md` updated. verify.sh green.
- Done: **U0.4** — `CategoryRepository` gains `list_with_usage(account_id, *,
  include_archived)` (one `LEFT JOIN expenses … GROUP BY`, `expense_count`
  populated), `count_expenses(category_id)`, `count_budget_plans(category_id)`.
  `CategoryService.list` gains `include_archived`/`include_usage` kwargs:
  without `include_usage` it stays on the generic `repo.list(**filters)`,
  adding `is_active=True` to the filters unless `include_archived` — no new
  SQL needed for the common case; with `include_usage` it delegates to
  `list_with_usage`. `CategoryService.delete` now checks both counts first
  (D302 "in use" = an expense **or** a budget plan, D307): either one present
  archives (`is_active=False`) instead of deleting; the old `try/except
  asyncpg.ForeignKeyViolationError → ConflictError` path is kept as a
  defensive branch (the counts should make `ON DELETE RESTRICT` unreachable)
  and stays covered by its existing test. `GET /categories` gains
  `include_archived`/`include_usage` query params, both defaulting to `false`
  (D306). One naming gotcha hit while wiring the `Protocol`/`FakeCategoryRepo`
  duck types: a class method named `list` shadows the builtin `list` for any
  *later*-defined method's `list[...]` annotation in the same class body
  (Python binds the name into the class namespace as soon as the `def`
  finishes, and annotations are resolved against that namespace at
  definition time even under normal, non-deferred evaluation) — `mypy` catches
  it as "Function ... is not valid as a type" and it's a real `TypeError` at
  import time, not just a lint nit. Fixed by declaring `list_with_usage`
  *before* `list` in both `CategoryRepositoryProtocol` and `FakeCategoryRepo`;
  no decision-log entry, just a landmine for whoever writes `TagRepository`'s
  mirror in U0.5. New/changed tests: 5 in `test_category_service.py` (list
  archived-filtering ×2, usage-population ×2, delete archives-on-expense,
  delete archives-on-budget-plan-only), 5 in `test_categories_api.py`
  (mirroring the list/delete cases at the HTTP layer), 4 in
  `test_category_repo.py` (`count_expenses`, `count_budget_plans`,
  `list_with_usage` usage + archived-filtering) — the last four run against a
  real throwaway Postgres via `scripts/integration_docker.sh` since they
  exercise a hand-written `LEFT JOIN`. `tests/README.md` updated. Reviewer:
  1 round, APPROVE, no BLOCKERs — 2 NITs left as-is (no `ORDER BY` on the
  plain `list()` path vs. `list_with_usage`'s `ORDER BY created_at`, both
  pre-existing/out of scope; two sequential count queries in `delete()`
  instead of one `EXISTS`, by design per the plan's two-method contract).
  verify.sh green.
- **U0.5 done**: `TagRepository.list_with_usage`/`count_expenses` (same
  `LEFT JOIN … GROUP BY` shape as U0.4, over `expense_tags` instead of
  `expenses`; no `count_budget_plans` equivalent — tags have no budget-plan
  FK), `TagService.list(include_archived, include_usage)` and `.delete()`'s
  archive-if-in-use rule, `GET /tags` gains the same two query flags. Unlike
  categories, `tags`' delete path has no `ForeignKeyViolationError` defensive
  branch: `expense_tags.tag_id` is `ON DELETE CASCADE`, not `RESTRICT` (per
  `TagService`'s existing docstring), so a hard-delete of an in-use tag would
  never raise — it would silently drop the join rows, which is exactly the
  regression the new `count_expenses`-gate prevents. Avoided the `list`/
  `list_with_usage` ordering landmine by defining `list_with_usage` first in
  both `TagRepositoryProtocol` and `FakeTagRepo`, as flagged above. New/changed
  tests: 6 in `test_tag_service.py` (list archived-filtering ×2,
  usage-population ×2, delete-hard-deletes, delete-archives-on-expense), 4 in
  `test_tags_api.py` (mirroring list/delete at the HTTP layer), 4 in
  `test_tag_repo.py` (`count_expenses`, `list_with_usage` usage +
  archived-filtering, plus `test_archiving_tag_preserves_expense_tags_rows` —
  the AC's CASCADE-survival assertion, run against a real throwaway Postgres
  via `scripts/integration_docker.sh`). `tests/README.md` updated. verify.sh
  green. Reviewer: 1 round, APPROVE, no BLOCKERs — 2 NITs left as-is
  (`count_expenses` has no `account_id` scoping, safe only because
  `TagService.delete` always 404s on cross-account first; `list_with_usage`'s
  `ORDER BY created_at` vs. plain `list()`'s no ordering) — both identical to
  already-accepted NITs from U0.4's own review, not new gaps.
- **U0.6 done**: `CategoryCreate`/`CategoryUpdate` gain `color_slot: int |
  None`, `ge=1, le=6` (see D325 for why 6, not `CategoryResponse`'s 12).
  `CategoryService.create` assigns the lowest free slot when `color_slot` is
  omitted (`_next_free_color_slot`: lists active categories in the account
  via the existing `list(account_id=..., is_active=True)`, picks the lowest
  of 1–6 not in their `color_slot` set, `None` once all six are taken); an
  explicit `color_slot` bypasses the search entirely, even if already taken
  (duplicates allowed by design). `update()` needed **no new code** — the
  existing `exclude_unset`-then-drop-`None`s filter (D30 pattern, already
  used for `name`) already gives `color_slot` both "omitted leaves it
  untouched" and "explicit null is ignored, not cleared" for free. 15 new
  tests in `test_category_service.py` (6 create free-slot cases incl.
  cross-account isolation and archived-slot reuse, 2 range-validation cases
  parametrized over `0`/`7`/`-1`, 3 update cases, plus the explicit-duplicate
  case) — all hermetic against `FakeCategoryRepo`, no DB needed since the
  logic is pure Python over `list()`'s existing output. `tests/README.md`
  updated. No route/repo change: `api/categories.py` already passes
  `CategoryCreate`/`Update` straight through, and `list(account_id=...,
  is_active=True)` already existed for U0.4's archived-filtering. verify.sh
  green.
- **U0.7 done**: `ExpenseService._validate_category` (called on `create()` and
  on `update()` only when `category_id` is part of the payload) now raises
  `ConflictError` (409) when the looked-up category has `is_active=False`, on
  top of its existing account-ownership check. `BudgetService.create` gets
  the same guard right after its existing account check. Because
  `update()` only calls `_validate_category` when `category_id` is present in
  the payload, an expense that stays in a since-archived category is
  untouched by this unit — amount/comment/tag-only updates never look the
  category up at all, which is exactly the "archiving closes new assignment,
  not history" AC and needed no extra code to satisfy. 4 new tests: 3 in
  `test_expense_service.py` (create into archived → `ConflictError` + no row
  written, update `category_id` into archived → `ConflictError`, update of
  other fields on an expense already in an archived category still succeeds
  — with no category in the fake repo at all, proving the lookup is never
  made), 1 in `test_budget_service.py` (create on archived category →
  `ConflictError` + no plan written). `tests/README.md` updated. No new
  decisions — implemented exactly to the plan's AC. verify.sh green.
- **U0.8 done**: `DELETE /categories/{id}` and `DELETE /tags/{id}` both still
  return bare 204 either way (no contract change — U0.4/U0.5 archive-or-delete
  is unchanged); the bot tells the two outcomes apart itself by following the
  delete with a `GET /categories/{id}`/`GET /tags/{id}` (`_delete_confirmation_
  message` in each handler module), which already returns the row un-filtered
  by `is_active` (`CategoryService.get`/`TagService.get` never applied the
  archived filter, only `list()` did). 404 or `is_active=True` → the existing
  "Category/Tag deleted." copy; `is_active=False` → new copy naming that it's
  hidden but past expenses keep it. The 409 `_error_message` branch and its
  copy are untouched — D302 archives in-use categories on the normal path, so
  409 only fires on the pre-existing defensive `ForeignKeyViolationError` race
  (count was 0, something referenced the category before the delete landed),
  where "still in use" stays literally true. No change to
  `bot/keyboards.py`/`categories_keyboard`/`tags_keyboard` or to
  `list_categories`/`list_tags` — `GET /categories`/`GET /tags` already default
  `include_archived=false` since U0.4/U0.5, so archived rows were already
  absent from the bot's pickers before this unit (D306, verified by reading
  the code, not a new test — nothing in the bot changes that path). Added
  `get_category`/`get_tag` to the two `Protocol` classes (the concrete
  `BackendClient` already had both methods, unused by these handlers until
  now). 2 new tests (one per module): in-use delete shows the "hidden" copy,
  not "deleted". `FakeCategoryBackendClient`/`FakeTagBackendClient` gained an
  `archive_on_delete` flag and a `get_category`/`get_tag` fake to drive both
  branches. `tests/README.md` updated. No new decisions — implemented exactly
  to the plan's AC. verify.sh green.
- **U1.1 `lib/period.ts`** — done. `PeriodValue`/`PeriodQuery` match
  `docs/ui/components/period-selector.md`'s TS snippet verbatim (component
  will import these types in U1.4, not redefine them). `describe`/`monthGrid`/
  `isValidRange` never touch a UTC instant: dates are parsed and formatted
  by hand (`parseDateString`/`toDateString`), never `new Date("YYYY-MM-DD")`
  or `.toISOString()` — the former parses as UTC midnight per spec, which
  would have reintroduced D120 inside the one module explicitly forbidden
  from doing tz math. `monthGrid` always returns 6 full weeks (42 cells)
  regardless of the month's actual layout, per the AC's "6×7 ... for a
  31-day month starting on a Sunday" — a fixed grid size, not a
  variable 5/6-row one. No new decisions; implemented to the plan's AC.
  33 new tests in `webapp/tests/period.test.ts`. verify.sh green.
- Next: **U1.2** — ApiClient period params + types. Start with `/clear`, then
  `/unit U1.2 docs/plans/mini-app-v3.md`. Its `PeriodQuery` should import
  `lib/period.ts`'s type rather than redeclare it.
- **Execution order in M0 (done)**: U0.1a → U0.3 → U0.2 → U0.2a → U0.2b →
  U0.2c → U0.4 → U0.5 → U0.6 → U0.7 → U0.8. The migration ran ahead of the
  statistics work so the period queries are written against `spent_at` once
  rather than written against `created_at` and rewritten a unit later.
- Gotchas:
  - **Take the CP0 Supabase snapshot before `alembic upgrade head` ever runs
    against production** for this migration — still not done as of U0.3
    landing; it happens at deploy time, not at unit-implementation time.
  - `spent_at`'s backfill must go through `family_tz`
    (`(created_at AT TIME ZONE family_tz)::date`). A plain `created_at::date`
    moves late-night expenses into the wrong month — D120 again. Implemented
    in U0.3; see D320 for how it's tested without real `alembic` locally.
  - U0.2a moves `budget_plan_repo.check_limit` to `spent_at` too. That is
    deliberate: a backdated expense counts toward the budget of the month it
    was spent in. Leaving `check_limit` on `created_at` would make budgets
    disagree with the statistics on the same screen.
  - **Any future unit that plumbs `family_tz` into `budget_service.
    get_progress` or `expense_service`'s budget-notification check must also
    pass `tz=family_tz` to `sum_by_category_month`/`check_limit`** — both
    currently default to `tz="UTC"` because their only callers still compute
    bounds via `month_bounds()` with no `tz` (D323). That's a pre-existing
    gap this unit didn't introduce and isn't fixing, but the moment it's
    closed elsewhere, forgetting the `tz=` kwarg here reintroduces D323's
    exact bug — silently, since every existing test uses UTC-aligned bounds.
  - **U2.2's Files list doesn't include `models/category.py`, but it needs
    to.** `CategoryCreate`/`CategoryUpdate.color_slot` currently validate
    `1–6` (U0.6, D325) — U2.2's twelve-swatch picker will send `7–12` the
    first time a user picks one of the new slots, and that 422s until
    someone widens the range to match `CategoryResponse`'s existing `1–12`.
    Don't discover this via a failing manual test; widen it as part of U2.2.
  - `months_back=2` (3 months) has **no** `{period, offset}` equivalent. Do not
    "simplify" the alias away — see D316.
  - M3 is ordered after M2 because screen 02's "More" and "+ Add tag" navigate
    to screens 06 and 07. Building M3 first ships two dead buttons.
  - `resolve_period` returns half-open `[start, end)` UTC-aware bounds because
    that is what `expense_repo.get_by_period` expects; `end_date` from the
    client is *inclusive*, so the conversion adds a day. Getting this backwards
    silently drops the last day of every custom range.
  - The bot must not need a single line changed for archived categories to
    disappear from its keyboards (D306). If a unit finds itself editing
    `bot/keyboards.py`, the default is wrong, not the keyboard.
  - In a `Protocol` or duck-typed fake, don't name a method `list` and then
    give a *later*-defined method in the same class a `list[...]` return/param
    annotation — the name `list` is bound into the class namespace as soon as
    the `def list(...)` statement finishes, so it shadows the builtin for
    every annotation evaluated afterward in that class body, and `list[...]`
    on a plain function object is a `TypeError` at import time (mypy also
    catches it: "Function ... is not valid as a type"). Define any
    `list[...]`-returning helper (e.g. `list_with_usage`) *before* `list`
    itself. Hit in U0.4's `CategoryRepositoryProtocol`/`FakeCategoryRepo`;
    U0.5's `TagRepositoryProtocol`/`FakeTagRepo` mirror will hit it too if
    methods are added in the wrong order.
