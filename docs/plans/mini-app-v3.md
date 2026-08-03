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
- **Removing `months_back`.** It stays as a deprecated alias for one deploy
  cycle (D300); its removal is a named follow-up unit, not part of this plan.

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
- **One migration, one human gate** — U0.3 adds all three columns
  (`categories.is_active`, `categories.color_slot`, `tags.is_active`) in a
  single revision. `migrations/versions/` is on root CLAUDE.md's
  do-not-edit-without-asking list: that unit stops and asks before writing it.
- Unit budget per task-methodology: ≤ ~300 diff lines, ≤ 5 files, ≤ 1 new
  decision. Migration/boilerplate units may run larger.

## Contracts (U0)

### Backend — `models/enums.py`

```python
class PeriodPreset(StrEnum):
    TODAY = "today"
    YESTERDAY = "yesterday"
    THIS_MONTH = "this_month"
    LAST_MONTH = "last_month"
    LAST_3_MONTHS = "last_3_months"
    CUSTOM = "custom"          # requires start_date AND end_date
```

### Backend — `services/period.py`

```python
MAX_RANGE_DAYS = 366

def resolve_period(
    preset: PeriodPreset | None,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    now: datetime | None = None,
    tz: str = "UTC",
) -> tuple[datetime, datetime]: ...
```

- Returns a **half-open [start, end) pair of UTC-aware datetimes**, exactly the
  shape `month_bounds` already returns and `expense_repo.get_by_period`
  already expects.
- Day boundaries are wall-clock midnights **in `tz`**, then converted to UTC.
  `end_date` is **inclusive of that whole day** — `end` is the following local
  midnight. A user picking `9 → 9 July` gets one full day.
- `preset=None` → the current family month (today's behaviour, unchanged).
- `CUSTOM` without both dates, `start_date > end_date`, or a span over
  `MAX_RANGE_DAYS` → `ValueError` (the route maps it to 422).
- `month_bounds` stays and keeps its callers; `resolve_period` delegates to it
  for the three month-shaped presets rather than re-deriving month arithmetic.

### Backend — statistics routes (all three: `by-period`, `by-category`, `by-tag`)

New query params, on top of the existing ones:

| Param | Type | Notes |
|-------|------|-------|
| `period` | `PeriodPreset \| None` | the new primary selector |
| `start_date` | `date \| None` | `YYYY-MM-DD`, only with `period=custom` |
| `end_date` | `date \| None` | inclusive |
| `months_back` | `int \| None` | **deprecated** (D300); `0/1/2` → `this_month`/`last_month`/`last_3_months` |
| `start` / `end` | `datetime \| None` | unchanged; the bot's explicit-bounds path |

Mutual exclusivity — **at most one selector family per request**, anything else
is 422 with a message naming the conflict:
`{period + start_date/end_date}` · `{months_back}` · `{start/end}`.
`start_date`/`end_date` without `period=custom` → 422. Passing nothing at all →
the current family month, byte-for-byte as today.

### Backend — schema (U0.3, migration)

```sql
ALTER TABLE categories ADD COLUMN is_active  BOOLEAN  NOT NULL DEFAULT true;
ALTER TABLE categories ADD COLUMN color_slot SMALLINT;              -- 1..6, NULL = auto
ALTER TABLE tags       ADD COLUMN is_active  BOOLEAN  NOT NULL DEFAULT true;
```

- `color_slot` is the **palette slot index**, not a hex value (D308) — each
  slot has a light and a dark variant in `tokens.css`, so a stored hex would
  break theming. Validated at the Pydantic layer (1–6 or NULL), same
  "TEXT/INT + comment, no DB CHECK" convention as `users.role` and
  `accounts.currency`.
- Backfill in the same revision: `color_slot` = the category's 1-based position
  within its account ordered by `created_at ASC`, capped at 6 (NULL beyond) —
  i.e. exactly the colours the app renders today (D206), frozen. Downgrade
  drops all three columns.

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

- `lib/period.ts` (new, pure): `PeriodSelection` = a preset id, or
  `{ preset: "custom", startDate, endDate }` (`YYYY-MM-DD` strings);
  `toQuery(sel)` → the query object `ApiClient` sends; `describe(sel)` → the
  human label ("Yesterday", "9 – 17 Jul"); `monthGrid(year, month)` → the
  6×7 day matrix the calendar renders (Monday-first, leading/trailing days
  marked); `isValidRange(a, b)`.
- `components/date-range-picker.ts` (new; first module in the `src/components/`
  directory `webapp/CLAUDE.md` already reserves): pure `render()` + thin
  `mount()`, no fetching, no `window.Telegram` beyond the shared adapter.
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

- [ ] **U0.1 `resolve_period` + `PeriodPreset`** — pure, no route, no service
      wiring. AC: each of the five presets produces the documented window in a
      non-UTC `family_tz` (use Belgrade, as U0.4 did); `today` at 23:30 local
      on the last day of a month is that local day, not the UTC one; a custom
      range is inclusive of `end_date`'s whole local day (a one-day range spans
      exactly 24h, or 23/25h across a DST switch); `custom` missing a date,
      reversed dates, and a span over `MAX_RANGE_DAYS` each raise `ValueError`;
      `preset=None` returns exactly `month_bounds(now, tz)`.
      Files: `models/enums.py`, `services/period.py`, `tests/test_period.py`.
      Model: sonnet.
- [ ] **U0.2 Statistics adopts `period`** — routes + service consume
      `resolve_period`; `months_back` becomes a deprecated alias mapped onto
      the enum; the mutual-exclusivity table above is enforced.
      AC: `period=today|yesterday|...` returns the same totals as the
      equivalent explicit `start`/`end` call; `months_back=1` and
      `period=last_month` return identical bounds (alias proven, not assumed);
      every listed conflicting combination → 422 naming the conflict;
      `start_date` without `period=custom` → 422; a call with no period params
      is unchanged; **the whole existing suite green**, including U3.1's
      `months_back=0` smoke.
      Files: `api/statistics.py`, `services/statistics_service.py`,
      `tests/test_statistics_api.py`, `tests/test_statistics_service.py`.
      Model: sonnet.
- [ ] **U0.3 Schema: archive flags + colour slot** ⚠ **STOP-AND-ASK GATE**
      (`migrations/versions/` + `docs/SCHEMA.sql`) — one revision adding all
      three columns with the `color_slot` backfill; models updated to match.
      AC: `alembic upgrade head` then `downgrade -1` is clean on a fresh DB
      (@integration); after upgrade, an account with 8 categories has slots
      1–6 by `created_at ASC` and NULL for the last two — *the colours the app
      renders today do not move*; every existing row is `is_active = true`;
      `GET /categories` and `GET /tags` include the new fields and every
      existing test stays green; a `color_slot` of `0` or `7` fails Pydantic
      validation, not the DB.
      Files: `migrations/versions/`(new), `docs/SCHEMA.sql`,
      `models/category.py`, `models/tag.py`, tests.
      RISKY (migration) → reviewer subagent. Model: sonnet.
- [ ] **U0.4 Category usage counts + archive-or-delete** — the rule from D302
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
- [ ] **U0.5 Tag usage counts + archive-or-delete** — mechanical mirror of
      U0.4 over `expense_tags`. AC: a tag on at least one expense is archived,
      and **its `expense_tags` rows survive** (today's `ON DELETE CASCADE`
      would have deleted them — this is the regression this unit exists to
      prevent); an unused tag is hard-deleted; default list is active-only;
      `include_usage=true` counts distinct expenses, not join rows.
      Files: `repositories/tag_repo.py`, `services/tag_service.py`,
      `api/tags.py`, `tests/test_tag_service.py`, `tests/test_tags_api.py`.
      Model: sonnet.
- [ ] **U0.6 Colour slot on create/update** — `CategoryCreate.color_slot`,
      `CategoryUpdate.color_slot`, and next-free-slot assignment when the
      client omits it. AC: creating without a colour assigns the lowest slot
      1–6 not already used by an **active** category in that account, and NULL
      once all six are taken; creating with `color_slot=3` keeps 3 even if 3 is
      taken (duplicates are allowed by design — six colours, unbounded
      categories); `0`/`7`/`-1` → 422; updating only the name leaves the colour
      untouched; an archived category's slot is free for reuse.
      Files: `models/category.py`, `services/category_service.py`,
      `tests/test_category_service.py`. Model: sonnet.
- [ ] **U0.7 Archived categories are closed for writing** — expense
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
- [ ] **U0.8 Bot copy follows the new semantics** — the only bot change in
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

### M1 — Period selection (screens 01 + 05)

- [ ] **U1.1 `lib/period.ts`** — pure, no DOM, no I/O. AC: parametrized
      vitest — `toQuery` emits exactly one selector family and never
      `months_back`; `describe` renders "Today", "Yesterday", "This month",
      "9 – 17 Jul", and a cross-year range with both years; `monthGrid` returns
      6×7 cells for a 31-day month starting on a Sunday and for February in a
      leap year, with leading/trailing days flagged; `isValidRange` rejects
      reversed and over-`MAX_RANGE_DAYS` ranges; **no function in this module
      converts a date to a UTC instant** (the constraint, asserted by the
      absence of any such export). Model: sonnet.
- [ ] **U1.2 ApiClient period params + types** — the three statistics methods
      take a `PeriodQuery`; `api/types.ts` mirrors the U0.3–U0.6 model changes.
      AC: against a fake fetch — `period=custom` serializes `start_date`/
      `end_date` as `YYYY-MM-DD` and nothing else; a preset serializes only
      `period`; `months_back` is no longer sent by any method; a 422 from a
      conflicting call surfaces as the typed validation result, not a crash.
      Files: `api/client.ts`, `api/types.ts`, `tests/client.test.ts`.
      Model: sonnet.
- [ ] **U1.3 Home period chips** — Today / Yesterday / This month above the
      donut (design §4 screen 01, amended). AC: the default on open is still
      This month (nothing changes for someone who never taps); tapping a chip
      refetches with that `period` and redraws donut, total and legend;
      selection haptic on change; the active chip is marked by shape **and**
      text, never colour alone; loading between periods keeps the donut slot
      (no reflow); an empty period says "Nothing yesterday", naming the period
      in force; the over-budget strip stays month-scoped and is hidden for
      day-scoped periods (budgets are monthly — D310).
      Files: `screens/home.ts`, `tests/home.test.ts`, `main.ts`,
      `styles/app.css`. Model: sonnet.
- [ ] **U1.4 Statistics presets extended** — five presets (Today, Yesterday,
      This month, Last month, Last 3 months) replacing the three
      `months_back` ones. AC: each preset sends exactly its `period` and
      nothing else; the grouping toggle still re-renders without refetching;
      the previously selected preset survives a retry; the bars/donut/empty
      states are unchanged for the three month presets (a pure superset — the
      existing statistics tests keep passing with only the call shape edited).
      Files: `screens/statistics.ts`, `tests/statistics.test.ts`, `main.ts`.
      Model: sonnet.
- [ ] **U1.5 Calendar range picker component** — `components/date-range-picker.ts`
      (D303): month grid, tap start → tap end, the span between highlighted,
      month navigation, quick chips (Last 7 days · Last 30 days · This week),
      Apply disabled until both ends are chosen. AC: pure-render tests —
      first tap sets the start and clears any previous end; a second tap
      *before* the start re-anchors instead of producing a reversed range; the
      highlighted span matches the chosen ends inclusively; navigating months
      preserves the selection; a range over `MAX_RANGE_DAYS` shows the reason
      and keeps Apply disabled; a "today" cell is marked and future dates are
      not selectable; renders correctly in both themes from tokens only.
      Files: `components/date-range-picker.ts`,
      `tests/date-range-picker.test.ts`, `styles/app.css`. Model: sonnet.
- [ ] **U1.6 "Select period" wired into Statistics** — a sixth chip that opens
      the picker; applying it refetches with `period=custom` and puts the
      human range in the header. AC: Apply issues exactly one fetch with the
      two dates; dismissing without applying leaves the previous period intact
      and refetches nothing; the custom label reads "9 – 17 Jul", not a pair of
      ISO strings; the custom range survives a retry and a grouping toggle;
      BackButton from the open picker closes the picker, not the screen.
      Files: `screens/statistics.ts`, `tests/statistics.test.ts`, `main.ts`.
      Model: sonnet.

### M2 — Categories & Tags (screens 06 + 07)

- [ ] **U2.0 Colour comes from the server** — `lib/category-colors.ts` prefers
      `color_slot`, position fallback for `null` (D301 supersedes D206);
      Home and Statistics pass the fetched categories through unchanged.
      AC: a category with `color_slot=4` renders slot 4 regardless of its
      position; a `null`-slot category still gets a stable position-derived
      colour; **deleting an earlier category no longer shifts a later
      category's colour** (the D206 risk this closes — asserted directly);
      two categories sharing a slot both render it; Home and Statistics agree
      on every colour for the same input. Files: `lib/category-colors.ts`,
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
      is the six palette swatches, each with its name, current one marked by a
      check, not by colour alone. AC: creating adds the category and returns to
      the list with it visible; renaming round-trips; recolouring updates every
      dot on Home and Statistics on the next render; Save disabled until dirty
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

### M3 — Smoke

- [ ] **U3.1 e2e: period + archive through `initData` (@integration)** — one
      signed-payload scenario over the real app: create a category with an
      explicit colour → add an expense today and one yesterday →
      `period=today` and `period=yesterday` each return exactly one of them →
      `period=custom` spanning both returns both → archive the category →
      it vanishes from `GET /categories` but is still present with
      `include_archived=true`, and the two expenses are still returned by
      `GET /expenses` and still counted by `/statistics/by-category` for the
      custom range → a `POST /expenses` into it now 409s.
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
- **CP2 — after U1.4**: in the Mini App, Home and Statistics both offer Today
  and Yesterday, and yesterday's number matches what the bot reports for the
  same window.
- **CP3 — after U1.6**: pick a range across a month boundary on the calendar;
  the total equals the sum of the two months' parts.
- **CP4 — after U2.3**: create a category, give it a colour, watch Home's donut
  adopt it, then hide the category and confirm the donut for an old period
  still names and colours it.
- **CP5 — after U2.5**: same round trip for a tag.

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
  over-budget strip has no meaning for "yesterday". U1.3 hides it rather than
  computing a fractional month figure nobody asked for (D310).
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

## STATE (handoff)
- Done: nothing yet — the plan file is written and its four blocking decisions
  (D300–D303) are answered by the human. `docs/design/mini-app-ux.md` updated
  in the same session (§4 screens 01/05/06/07, §8 backend deltas, §11 open
  questions resolved).
- Next: **U0.1** — `PeriodPreset` + `resolve_period` in `services/period.py`,
  pure, with `tests/test_period.py`. Start with `/clear`, then
  `/unit U0.1 docs/plans/mini-app-v3.md`.
- Gotchas:
  - **U0.3 stops and asks** before touching `migrations/versions/`. Take the
    CP0 snapshot first.
  - U0.4 and U0.8 are a pair — see Risks. Do not leave the repo between them
    for long.
  - `resolve_period` returns half-open `[start, end)` UTC-aware bounds because
    that is what `expense_repo.get_by_period` expects; `end_date` from the
    client is *inclusive*, so the conversion adds a day. Getting this backwards
    silently drops the last day of every custom range.
  - The bot must not need a single line changed for archived categories to
    disappear from its keyboards (D306). If a unit finds itself editing
    `bot/keyboards.py`, the default is wrong, not the keyboard.
