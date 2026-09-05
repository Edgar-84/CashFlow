# Screen: 05 — Statistics

## Purpose
Home's donut plus ranked bars underneath, so switching screens never re-teaches
the picture — deeper because every period unit is available here (V7), not
just three fixed presets, and a second and third grouping ("by tag", "by
budget") sit beside the category view — the tag reader adds no new fetch, and
the budget reader piggybacks on the same parallel load whenever the active
period is a month (V8, D810). The ranked-bar list *is* this screen's legend;
there is no separate legend component.

## Reference
This screen shipped in V2 with no spec file at all — there is no screenshot
reference. Written from the live implementation, then the V7 delta applied:
- `webapp/src/screens/statistics.ts` — data + presentation, documented
  2026-08-25, before the V7 delta below is implemented
- `api/statistics.py`, `services/statistics_service.py` — the endpoints
- `webapp/src/styles/app.css`'s `.stats-*` / `.donut*` / `.chip*` rules
- `docs/design/mini-app-ux.md` §4 "05 — Statistics" — the why, and the source
  of the old chip table this spec supersedes (see Delta)

## Delta from reference
- **Taking:** the donut (category breakdown, always — tags have no fixed
  colour column to draw a donut from), the ranked-bar list below it as this
  screen's legend, the "By category"/"By tag" grouping toggle that re-renders
  without a second fetch, the offline/error/403/empty states, the bar tap
  drilling into Expenses filtered by category.
- **Changing (V7, D704):** the three `months_back` preset chips ("This
  month" / "Last month" / "Last 3 months") are replaced by
  `../components/period-selector.md` — the same five-tab, offset-arrow,
  jump-to-present control `01-home.md` uses. This screen becomes that
  component's **second consumer**; see the note in that file. Every
  statistics call moves from `{months_back}` to `{period, offset}` or
  `{period: "custom", start_date, end_date}`. A "Period" tab (or a label tap)
  opens `../components/date-range-picker.md` in `"range"` mode — a control
  this screen never had before. **This spec supersedes
  `docs/design/mini-app-ux.md` §4 screen 05's chip table** (Today / Yesterday
  / This month / Last month / Last 3 months / Select period…), the same way
  `01-home.md` superseded that section's three-chip design for screen 01 —
  the design doc itself is not edited (D700's ordering: M0 documents the
  delta, M2 implements it).
- **Explicitly not taking:** Home's collapsed pinned-header behaviour (no
  scroll-driven chart-to-bar transform on this screen — out of scope for the
  V7 brief); Home's `.chart-card` background/padding treatment for the period
  selector — this screen keeps the control **bare on the page background**,
  matching how the preset chips it replaces were laid out (see Layout,
  region 2, and the open question below); the "All time" option (the
  component the selector reuses has none); any change to the bar-tap's
  category-only filtering (Home's V4 ranked-row tap also carries the period;
  this screen's bar tap does not — a pre-existing divergence, not touched by
  this delta, see Interactions and Open questions).
- **Changing (V8):** the tag bar becomes tappable for real. `GET /expenses`
  gains a `tag_id` filter (D802 — server-side, not a client-side filter of one
  fetched page), so tapping a tag bar drills into Expenses filtered by that
  tag, firing the same `selection` haptic the category tap already fires. The
  tag tap carries **only the tag, not the period** (D801), exactly mirroring
  the category tap's existing period-dropping behaviour above — see
  Interactions.
- **Changing (V8, item 3):** a third grouping, "Budgets", sits beside "By
  category" and "By tag" (`GET /statistics/by-budget`, new). It shows each
  budget plan's current-month fill using `04-budgets.md`'s own row
  vocabulary — colour dot, name, `spent of limit`, fill bar with a threshold
  tick, never recoloured by status — rather than inventing a second one. Only
  the **Month** period unit makes sense against a single-limit read, so the
  other four period-selector tabs are dimmed and inert while this grouping is
  active (D807–D811); picking Budgets under any other unit **coerces** the
  period to the current month (D809) rather than disabling the chip. The
  historical read is against **today's limit**, not the limit that applied at
  the time (D807) — `budget_plans` keeps no history, so a raised or lowered
  limit is retroactive to every past month shown here.

## Layout
Top to bottom, one scroll container, `12px` gap between every top-level region
(`.statistics-ready`'s existing flex column) — unchanged by this delta.

| # | Region | Fixed / scrolls | Geometry |
|---|---|---|---|
| 1 | Offline banner | scrolls | full width, only in `offline` |
| 2 | **Period selector (V7)** | scrolls | bare on the page background — `#app`'s own `14px 12px` padding, **no `.card` wrapper** `[inferred, see Open questions]` |
| 2a | ↳ Tab row | — | 44px tall, 5 tabs, evenly distributed |
| 2b | ↳ Nav row | — | 44px tall, `[spacer]` · `‹` · label · `›` · `[jump]`, each cell 44×44 |
| 3 | Donut | scrolls | 200px viewBox, `r=76`/`stroke-width=26` `[ref: statistics.ts]` — see the stroke-width note below; total centred in the hole; `4px 0 2px` wrap padding; no card background |
| 4 | Grouping toggle | scrolls | chip row, "By category" / "By tag" / "Budgets" (V8), `8px` gaps, `9px 14px` chip padding, `999px` radius |
| 5 | Ranked bar list | scrolls | `.card`, 14px radius; one row per bar, `12px 13px` padding, 1px `--separator` row rule between rows, none after the last; **absent entirely at exactly one bar** (own rule, see States); a one-line note replaces it at zero bars; under Budgets grouping the row anatomy differs — see below (V8) |

### The donut's stroke width does not match `design-system.md`'s "Donut stroke" row
That row (`design-system.md` Sizing table) documents Home's V4 thickening —
`r=74`/`stroke-width=30` — and says so in its own source note ("thickened from
V2's 26px"). This screen's donut was never thickened: it still renders
`r=76`/`stroke-width=26`, V2's original pair. The two pairs happen to reach the
same outer edge (`76+13 = 89 = 74+15`), so the ring's outer footprint is
visually identical between the two screens even though the stroke itself is
4px narrower here. Documented as shipped, not corrected by this unit — flagged
below.

### Budget row (region 5, Budgets grouping, V8)
Reuses `04-budgets.md`'s row vocabulary rather than inventing a second one —
this screen defines no new tick or bar dimension of its own, `[ref:
04-budgets.md]`:
1. **Head** — a colour dot in the category's slot colour, the category name,
   and `budget.of` ("{spent} of {limit}") right-aligned; currency is appended
   the same way `04-budgets.md`'s head line does, not embedded in the string.
   A plan whose `category_id` isn't in this screen's `GET /categories` fetch
   (archived, D808) renders the dot in `OTHER_COLOR_VAR` and the name as
   `statistics.unknownCategory` ("Unknown category") — the same fallback
   `budgets.ts:133` already applies, not a new one.
2. **Bar** — a track with a fill in the category's own colour, width the
   API's `fillPct` clamped 0–100, plus a tick at `notifyThreshold` — identical
   anatomy to `04-budgets.md`'s bar, never recoloured by status. `fillPct:
   null` (a legacy `amount <= 0` plan, the same rare edge case `04-budgets.md`
   documents) renders an empty bar with no crash.
3. **Status** — no text for an un-flagged row `[inferred, see Open
   questions]`: this grouping ships only two new strings (`budget.of`,
   `budget.exceeded`), not `04-budgets.md`'s three-way status line. A trailing
   **Warning** glyph (design-system Iconography) marks the row instead:
   `currentColor`, icon only, when `isOverThreshold` — the same "one shape
   serves both states" reuse that icon's own table row already documents —
   and `--status-red` plus `budget.exceeded` ("Over by {amount}") when
   `isExceeded`, matching `webapp/CLAUDE.md`'s rule that status red is
   reserved for over-budget and always ships with an icon and a word.

## Components used
- `../components/period-selector.md` — regions 2a + 2b. **Second consumer
  (V7)** — that file's own "Used by" note and Resolved section are updated in
  this same change to name this screen. **V8:** also the restricted-units
  variant's only consumer (`allowedUnits`, `../components/period-selector.md`)
  while the Budgets grouping is active — see Delta and Interactions.
- `../components/date-range-picker.md` — opened by the "Period" tab or a
  label tap, `"range"` mode. Shipped, reused unchanged.
- Donut, ranked bar row, grouping toggle — existing, `screens/statistics.ts` +
  `app.css`. No shared component file; mirrors how `01-home.md` keeps its own
  donut and ranked rows inline rather than extracting them.

## Telegram
- **Theme:** every colour from `tokens.css`; both themes render identically in
  structure, colour only differs by token value.
- **MainButton:** hidden. This screen names no primary action —
  `applyStatisticsChrome` hides it unconditionally, same choice
  `expenses.ts::applyExpensesChrome` makes for its own screen.
- **BackButton:** shown; returns one step, to Home — the only screen that
  opens this one (`../navigation.md`). While the date-range picker is
  open it closes the picker instead, the same override
  `../components/date-range-picker.md` and `01-home.md` both specify.
- **Haptics:** `selection` on a period unit tab, an offset arrow, the
  jump-to-present control (all three per
  `../components/period-selector.md`'s own contract), the grouping toggle, and
  a bar tap in the category **or** tag grouping (V8 — the tag tap now fires it
  too, same as the category tap). No haptic on the disabled `›` at offset 0,
  nor on a budget bar tap (V8 — a deliberate no-op, D812) or a dimmed period
  tab under the Budgets grouping (V8, D811).
- **Viewport:** no keyboard reachable from this screen; nothing else to note.

## States
Five mandatory states plus this screen's own:

| State | Trigger | What the user sees |
|---|---|---|
| Loading | first open, or a unit/offset/custom-range change | period selector's slot renders a skeleton bar (`chips-skeleton`), a 196px donut skeleton circle, a second skeleton bar for the grouping toggle, and three `stats-bar-skeleton` rows — final layout, no reflow when data lands |
| Empty | period resolved, `periodTotal.total === 0` | period selector (live, interactive) + grouping toggle + "No expenses in this period." — no donut, no bars |
| Error | any statistics call for the active unit (three, plus `by-budget` under Month — V8) or `/users/me`, `/categories`, `/tags` rejects and there is no cache | period selector (live) + the thrown error's own message (an `ApiError` subclass from `api/client.ts` — never a raw status code) + "Try again" |
| 403 | `ForbiddenError` from any call | "You don't have permission to view statistics." — no period selector, no chart |
| Offline | a call rejects and a cache snapshot exists | last-loaded data + "Offline — showing data from {time}"; **the period control is not frozen** — see Edge cases, this is a pre-existing gap, not part of this delta |
| Ready | `periodTotal.total > 0` | donut (category breakdown, always) + the active grouping's ranked bars |
| **Custom period (V7)** | `unit: "custom"` after Apply | period selector's Custom variant — arrows and jump control hidden, label shows the range, "Period" tab active — everything else identical to Ready |
| Single bar | exactly one non-zero row in the active grouping | region 5 renders **nothing at all** — this screen's own rule, distinct from Home's V4 rule (which always shows the one row); the donut still renders |
| Zero bars, non-zero total | the active grouping has no rows this period (e.g. no tagged expenses while the categorised total is non-zero) | "No categorised expenses in this period." / "No tagged expenses in this period." replaces the bar list only; the donut is unaffected |
| **Budgets grouping, no plans (V8)** | `grouping === "budget"` and the account has zero budget plans | `bars.empty.budget` ("No budgets set.") replaces the bar list only — the grouping toggle, donut and other groupings' data are unaffected, same shape as the row above |
| **Budgets grouping, archived category (V8)** | a plan's `category_id` isn't in the `GET /categories` fetch | that row still renders (D808) — `statistics.unknownCategory` name, `OTHER_COLOR_VAR` dot, same fallback `budgets.ts:133` uses |

## Interactions

| Element | Action | Result |
|---|---|---|
| Period unit tab (Day/Week/Month/Year) | tap | selection haptic; offset resets to 0; refetch; donut and bars update |
| Period tab ("Period") | tap | opens the date-range picker; the previously active tab stays visually active until Apply |
| `‹` | tap | offset − 1; refetch |
| `›` | tap | offset + 1; refetch; disabled at offset 0 |
| Jump to present | tap | selection haptic; offset → 0 in one step; refetch |
| Period label | tap | opens the date-range picker, same as the "Period" tab |
| Date-range picker Apply | tap | sends `period=custom` + `start_date`/`end_date`; refetch; label shows the chosen range |
| Grouping toggle | tap | selection haptic; swaps `state.grouping` and re-renders **locally, with no refetch** — category and tag totals are always in memory from the one load regardless of unit (unchanged by this delta), and so is the Budgets arm's whenever the active unit is already Month (V8, D810). **Exception:** swapping to Budgets under a non-Month unit coerces the period to `{unit: "month", offset: 0}` and refetches (D809) — the one case where this toggle triggers a load |
| Donut | tap | nothing — display-only, matching Home's V4 rule |
| Ranked bar, category grouping | tap | selection haptic; navigates to Expenses filtered to **that category only**. **Unlike Home's V4 ranked-row tap, the period is not carried** — a pre-existing divergence this delta does not touch (see Open questions) |
| Ranked bar, tag grouping | tap | selection haptic; navigates to Expenses filtered to **that tag only**. Mirrors the category tap: the period is not carried (D801) |
| Ranked bar, budget grouping (V8) | tap | nothing — a budget bar is **not** a drill-down target in V8 (D812); the brief asks to see fill, not for a fourth navigation edge |
| Period unit tab (Day/Week/Year/Period), Budgets grouping active (V8) | tap | no-op: dimmed, `aria-disabled`, no haptic, no refetch (D811, `../components/period-selector.md`'s `allowedUnits`) |
| `‹` / `›`, Budgets grouping active (V8) | tap | offset −1 / +1 within Month only; refetches `by-budget` for that month — D807's current-limit caveat applies to whichever month is shown |
| Retry button (error state) | tap | re-runs the load at the current unit/offset (or custom range) |
| BackButton | — | one step back — Home, its only opener (`../navigation.md`); closes the date-range picker instead, if it is open |

## Copy
Period-selector strings (tab labels, `aria.prev`/`aria.next`/etc.) are
inherited entirely from `../components/period-selector.md`'s own Copy table
and are not restated here. Date-range-picker strings likewise come from
`../components/date-range-picker.md`. This screen's own strings:

| Key | String | Notes |
|---|---|---|
| `grouping.category` | "By category" | |
| `grouping.tag` | "By tag" | |
| `grouping.budget` | "Budgets" | **(V8)** literal catalogue key `statistics.byBudget` |
| `bars.empty.category` | "No categorised expenses in this period." | |
| `bars.empty.tag` | "No tagged expenses in this period." | |
| `bars.empty.budget` | "No budgets set." | **(V8)** literal catalogue key `statistics.bars.emptyBudget` |
| `budget.of` | "{spent} of {limit}" | **(V8)** the head line's amount; currency appended the same way `04-budgets.md` does, not embedded in the string |
| `budget.exceeded` | "Over by {amount}" | **(V8)** paired with the Warning glyph in `--status-red` |
| `empty.body` | "No expenses in this period." | one generic sentence, unlike Home's five period-named strings — see Open questions |
| `forbidden.body` | "You don't have permission to view statistics." | |
| `error.retry` | "Try again" | matches Home's `error.retry` |
| `offline.banner` | "Offline — showing data from {time}" | matches Home's `offline.banner` verbatim |

No "This month" / "Last month" / "Last 3 months" row remains anywhere in this
table (V7, D704).

## Data

| Call | Params | Notes |
|---|---|---|
| `GET /users/me` | — | currency |
| `GET /categories` | — | names + `color_slot`, for donut segments and category bar labels |
| `GET /tags` | — | names, for tag bar labels |
| `GET /statistics/by-period` | `period`+`offset`, or `period=custom`+`start_date`+`end_date` | the total in the donut's hole |
| `GET /statistics/by-category` | same | donut segments + category bars |
| `GET /statistics/by-tag` | same | tag bars |
| `GET /statistics/by-budget` (V8) | `period=month`+`offset` only | budget rows; **only fetched when the active unit is Month** |

All statistics calls for the active unit fire in parallel on every load —
three always, plus `GET /statistics/by-budget` whenever the unit is Month —
so the grouping toggle never triggers a second fetch on its own (D810; the
one exception is D809's coercion, see Interactions). Under any other unit
`by-budget` is not fetched at all; the only way to reach the Budgets grouping
from there goes through that same coercion, which is a refetch anyway.

**`GET /statistics/by-budget` 422s any unit other than `month`** — this screen
never sends one, since D810's condition is exactly the endpoint's own
constraint.

**Historical budget fill is scored against today's limit, not the limit that
applied at the time (D807).** `budget_plans` keeps no per-month history, so
arrowing `‹` into an earlier month re-scores that month's spend against the
plan's *current* amount — a user who raises a limit in October and looks back
at September sees September scored against the new limit. Stated here in
plain terms because it is the number in this grouping most likely to look
wrong to a user who recently changed one.

**The client never computes period bounds.** `period`/`offset`/`start_date`/
`end_date` pass straight through from the period selector and date-range
picker to the API, exactly as `../components/period-selector.md`'s Purpose
states; no bound is derived from `new Date()` anywhere in this screen.

**`months_back` is not sent by this screen after V7 (D704).** The parameter
is not removed from the API — `bot/keyboards.py` still sends it (D708) — this
screen simply stops being one of its callers.

## Accessibility
- Identity is never colour alone: every bar row pairs a colour dot with its
  name; the donut restates nothing the bars don't already say by name.
- The period selector's own accessibility contract (tablist semantics,
  `aria-selected`, 44×44 hit targets, focus order) is inherited from
  `../components/period-selector.md` and not restated here.
- Focus order: period selector → grouping toggle → ranked bars → retry
  button, when present.
- `prefers-reduced-motion`: no screen-specific animation exists beyond the
  design system's global skeleton pulse — no crossfade, no slide.
- **Known gap, not fixed by this unit:** the donut's `<svg>` carries
  `role="img"` but **no `aria-label`** — unlike Home's donut, which names the
  top three categories and their shares. See Open questions.
- **Budget row status glyph (V8):** the `isExceeded` case is announced
  because `budget.exceeded`'s text sits beside it; the `isOverThreshold`
  (approaching) case is icon-only with no accessible name today — a real gap
  this unit inherits from the "no fourth string" choice above, flagged in
  Open questions rather than silently shipped.

## Edge cases
- **Exactly one bar** in the active grouping — the entire bar-list region is
  omitted (shipped `renderBars` rule), not shown as a single row the way
  Home's V4 ranked list always does. The two screens' single-row rules are
  intentionally different and this delta does not reconcile them.
- **A grouping with a non-zero period total but zero rows** (e.g. no tagged
  expenses this period) — the empty note replaces the bar list only; the
  donut, which always reflects the category breakdown, is unaffected.
- **Offline** — the period control is **not** frozen or disabled, unlike
  Home's `disabled` prop on the same component. Tapping a unit or arrow while
  offline re-fetches, fails again, and falls back to the cached snapshot —
  which may then show data for a different period than the label states.
  Pre-existing, unchanged by this delta; see Open questions.
- **Long category or tag name in a bar row** — truncates with an ellipsis
  (`.stats-bar-head .nm`); the amount never shrinks or wraps.
- **Backward navigation is unbounded**, same as the period selector's own
  contract — arrowing into a period before the account existed is a
  legitimately empty state, not an error.
- **A category- or tag-bar tap (V8 for tag) on a period whose expenses aren't
  on `GET /expenses`'s newest page** — a real gap (the call carries no period
  filter from either bar type), the same limitation Home had before its own
  V4 fix. Out of scope for this unit; see Interactions and Open questions.
- **A deleted budget plan (V8)** — has no history at all; the Budgets
  grouping lists only plans that exist today (D808), following directly from
  D807 and needing no separate mechanism.
- **A budget bar tap doing nothing (V8)** is a deliberate scope boundary
  (D812), not a gap left for a later unit the way the tag bar's tap was before
  this plan fixed it.
- **Cross-year custom range** — the date-range picker's own summary/label
  formatting handles this; nothing here recomputes it.

## Acceptance criteria
- [ ] The file exists at `docs/ui/screens/05-statistics.md`.
- [ ] The Layout table names the period-selector component (regions 2a/2b)
      and the grouping toggle (region 4).
- [ ] The Copy table has no "This month" / "Last month" / "Last 3 months" row.
- [ ] The Data section states the client never computes period bounds —
      `period`/`offset`/custom dates pass straight to the API.
- [ ] Every sizing, colour and spacing value in this spec traces to a
      `design-system.md` token or table entry, or is explicitly marked as a
      shipped divergence from one (the donut stroke-width note).
- [ ] The bar tap's category-only filtering (no period carried) is stated
      explicitly as a divergence from Home's V4 rule.
- [ ] The single-bar suppression rule (region 5 renders nothing at exactly
      one bar) is stated as this screen's own rule, distinct from Home's.
- [ ] Neither this file nor `03-expenses.md` contains a sentence claiming a
      tag-bar tap does nothing.
- [ ] Tapping a tag bar fires the `selection` haptic and navigates to Expenses
      filtered to that tag, carrying no period — the same period-dropping
      rule the category tap already has (D801).
- [ ] A third chip, "Budgets", appears in region 4's grouping toggle beside
      "By category" and "By tag".
- [ ] The Data section states `GET /statistics/by-budget` is fetched in the
      same parallel load as the other three calls whenever the active unit is
      Month, so the grouping toggle still never refetches on its own (D810).
- [ ] Choosing the Budgets chip under a non-Month unit is documented as
      coercing the period to the current month rather than disabling the
      chip (D809).
- [ ] The four non-Month period-selector tabs are stated as dimmed and inert
      while the Budgets grouping is active (D811), reusing the existing
      50%-opacity disabled-row rule rather than a new one.
- [ ] The spec states, in the user's terms, that a budget's historical fill is
      scored against today's limit, not the limit that applied at the time
      (D807).
- [ ] A budget bar tap is documented as doing nothing (D812), and a plan whose
      category was archived is documented as falling back to "Unknown
      category" (D808).

## Open questions
- [?] **Bare layout vs. a `.chart-card` wrapper for region 2+3**, matching
      Home's region 2. This spec keeps the bare placement the preset chips
      already had — the minimal, wiring-only reading of D704. Flip this
      during M2 if the two screens should look visually identical.
- [?] **The donut's missing `aria-label`.** Shipped gap, not introduced or
      fixed by this delta.
- [?] **The donut's 26px stroke vs. `design-system.md`'s 30px row.** Worth
      aligning to Home's thickened value during M2, or worth giving the
      design-system table a screen-specific footnote instead of implying one
      shared value. Not decided here.
- [?] **No "on track" text for the Budgets grouping's un-flagged rows (V8)**,
      unlike `04-budgets.md`'s three-way status line. This spec ships only the
      two Contracts strings (`budget.of`, `budget.exceeded`) and lets a
      trailing Warning glyph (icon-only, `currentColor`) carry the
      "approaching" state, on the theory that a fourth new string repeating
      `04-budgets.md` is unwarranted for a read-only summary view. Flip to a
      full three-way status line (and give the glyph an accessible name, see
      Accessibility) if the icon-only treatment reads as too quiet.
- [?] **Should the bar tap start carrying the period, like Home's V4 ranked-
      row tap?** A real inconsistency between the two screens, not requested
      by the V7 brief and not decided here.
- [?] **Should `empty.body` become five period-named strings**, matching
      Home's `empty.day`/`empty.week`/etc.? Not requested by the V7 brief.
- [?] **Should the period control freeze while offline**, matching Home's
      `disabled` prop? Pre-existing gap, not part of this delta.
