# Screen: 01 — Home

## Purpose
The root screen. Someone opens the app to see where the money went in a period
they choose, and to add an expense in one tap. The donut answers "where did it
go?" before a number is read; the ranked rows underneath name the categories so
identity is never carried by colour alone.

**This spec supersedes the three-chip period design** in `docs/design/mini-app-ux.md`
§4 screen 01 (`Today · Yesterday · This month`) and plan unit U1.3. The period
control is now Day/Week/Month/Year/Period with offset arrows — see D313 below.

## Reference
- `../refs/01-home/day-tab.jpg` — Day tab, one day's donut, ranked category rows,
  yellow FAB over the donut card
- `../refs/01-home/week-tab.jpg` — Week tab; note the reference collapses the
  donut to a horizontal stacked bar here (we do **not** — see Delta)
- `../refs/01-home/period-picker.jpg` — the Period tab's calendar dialog
- Verbal brief from the user, 2026-08-04

## Delta from reference
- **Taking:** the five-tab period row (Day/Week/Month/Year/Period) above the
  chart; the `‹ label ›` navigation row under the tabs with the label itself
  tappable; the donut with the total in the hole; ranked category rows below as
  separate cards, each `swatch · name · share% · amount`, sorted descending; the
  yellow circular `+` floating over the chart card's bottom-right; the overall
  looser spacing rhythm (`20–28px` between sections).
- **Changing:**
  - The donut **stays a donut on every tab.** The reference degrades to a
    stacked bar for Week/Month/Year; switching chart type when the period
    changes makes two periods incomparable at a glance, which is the whole job
    of this screen.
  - Category identity is a **plain colour circle**, not a glyph
    (design-system Iconography).
  - The reference's `‹` is always visible and `›` is absent; ours renders both,
    with `›` disabled at offset 0, so the control's shape teaches the rule.
  - Our six existing navigation tiles survive as a **small text-only bottom
    row**, which the reference has no equivalent of.
  - The over-budget strip has no reference counterpart; it stays, month-scoped.
- **Explicitly not taking:** the green app bar and its `EXPENSES / INCOME`
  tabs (this app has no income concept); the `Total ▾` account switcher (one
  account per user — there is nothing to switch); the hamburger and receipt
  icons; the reference's brand green; the "All time" checkbox in the period
  dialog; per-category glyphs.

## Layout
Top to bottom, one scroll container. The bottom nav row is the only fixed
element.

| # | Region | Fixed / scrolls | Geometry |
|---|---|---|---|
| 1 | Offline banner | scrolls | full width, only in `offline` |
| 2 | **Chart card** | scrolls | `--card`, radius 14px, padding `16px 12px 20px` |
| 2a | ↳ Period tabs | — | 44px tall, 5 items, evenly distributed |
| 2b | ↳ Period nav row | — | 44px tall, `‹` 44×44 · label centred · `›` 44×44 |
| 2c | ↳ Donut | — | 200px box, 30px stroke, total centred in the hole |
| 2d | ↳ **Add button** | absolute, **within the card** | 56px circle, `--accent`, bottom-right, inset 12px from the card's right and bottom padding edges |
| 3 | Over-budget strip | scrolls | full width card, `--status-red` text + warning icon |
| 4 | Ranked category rows | scrolls | one card each, 12px gap, `10px 13px` padding |
| 5 | Bottom nav row | fixed | 6 text tiles in **two rows of three**, 32px tall, above `env(safe-area-inset-bottom)` |

Gaps: `20px` between region 2 and 3, `12px` between cards inside region 4,
`24px` above region 5.

Region 4 is a list of **categories, not individual expenses** — one row per
category, `swatch · name · share% · amount`, exactly as the reference shows
(`../refs/01-home/week-tab.jpg`: Дом 58% zł2,948) and as the app already does.
Individual expenses stay on screen 03, reachable by tapping a row.

It shows **all** categories with a non-zero total, ranked descending — the donut
folds at six slices, the rows do not fold at all. A category at 0 for the period
is omitted entirely.

### Bottom navigation row
The six existing tiles (Add expense · Expenses · Budgets · Statistics ·
Categories · Tags), moved from mid-screen to the bottom and shrunk to a text-only
strip. `[ref]` for the intent ("keep them, but move them to the very bottom and
make them smaller"), `[inferred]` for every value:

- **Two rows of three** (2026-08-04, HUMAN). Not a horizontally scrolling row:
  six 12px labels do not fit one 32px row on a narrow phone, and a scrolling
  row hides tiles behind a gesture nobody knows is there.
- 12px label, `--ink-secondary`, `--card` background, 8px radius, 8px gap.
- **Add expense stays here** as a third route to screen 02, alongside the yellow
  Add button and MainButton. All three fire the same handler. The brief asked
  for every tile to stay reachable; this is the cost of that, accepted.
- Disabled (not hidden) for a read-only viewer, same as today.

## Components used
- `../components/period-selector.md` — regions 2a + 2b. **Does not exist yet;
  it is a unit dependency for this screen.**
- `../components/date-range-picker.md` — opened by the Period tab. **Does not
  exist yet** (plan unit U1.5 — its spec is now written).
- Donut, ranked row, card, chip — existing, in `screens/home.ts` and `app.css`.
  The donut needs its stroke widened to 30px and gains no other change.

## Telegram
- **Theme:** every colour from `tokens.css`. Dark differs only in the token
  values; no layout or opacity changes.
- **MainButton:** **shown and unchanged** — "Add expense", exactly today's
  `applyHomeChrome` behaviour. It renders in Telegram's own button colour (blue
  on the default themes), which is why it is not in the token table: it is
  native chrome the client draws, not something this app styles.
- **Add button (yellow circle): also shown** (2026-08-04, HUMAN). Both routes to
  screen 02 exist on this screen, deliberately.

  `references/telegram-miniapp.md` warns against a custom primary button
  competing with MainButton. That concern was raised and answered: **build
  both.** What makes it work here is *where* the yellow button sits — inside the
  chart card at its bottom-right (`../refs/01-home/day-tab.jpg`), **not** pinned
  to the viewport. Therefore:
  - It is **anchored to the card and scrolls with it.** It never overlaps
    MainButton and is never the thing covering MainButton, which is the concrete
    failure the guidance exists to prevent.
  - It must **never** be given `position: fixed`. That one change is what would
    turn an accepted redundancy into the collision.
  - Both it and MainButton fire the same handler. This is one action with two
    entrances, not two competing actions.
  - It is **hidden**, not disabled, for a read-only viewer — matching
    MainButton, so a viewer sees one consistent story instead of a dead yellow
    button.
- The design system's `--accent` / `--accent-ink` are **in use by this element
  and no other**. A second use is a review failure.
- **BackButton:** hidden. This is the root screen; there is nowhere to go back
  to. Unchanged.
- **Haptics:** `selection` on a period tab change, on an arrow tap, on a donut
  segment tap and on a bottom-nav tile tap. `impact('medium')` on the yellow Add
  button — the heaviest action on the screen. No haptic on a *rejected* arrow
  tap (the disabled `›` at offset 0) — silence is the feedback.
- **Viewport:** no keyboard on this screen. When the viewport collapses, the
  bottom nav row stays pinned and the chart card scrolls under it; the Add
  button travels with the card.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | first open, or any period change | Period tabs and nav row render **live and interactive**; the donut area is a skeleton circle at its final 200px, the rows are three skeleton cards. No reflow when data lands. |
| Empty | period resolved, total is 0 | Chart card keeps the tabs and nav row; in place of the donut, the empty copy **naming the period in force** ("Nothing today", "Nothing in August"). MainButton and the yellow Add button stay enabled. Bottom nav stays reachable. |
| Error | any of the calls rejects and there is no cache | "Couldn't load your expenses." + "Try again". Period control still usable — retrying with a different period is a legitimate recovery. Never a status code. |
| 403 | `ForbiddenError` from any call | Read-only surface: donut and rows render if the reads succeeded; MainButton **and** the yellow Add button are hidden, and the Add-expense tile is **disabled, not hidden**, with the read-only line above them. |
| Offline | a call rejects and a cache snapshot exists | Last loaded data, banner with the last-synced time. The period control is **frozen at the cached period** — changing it would need a fetch. Tapping a tab shows "Offline — showing <period>". |
| Populated | total > 0 | Donut, total in the hole, all non-zero categories ranked below. |
| Single category | exactly one non-zero category | Donut renders as one full ring; the ranked list still shows the one row (unlike V2, which suppressed the legend at ≤1 — the ranked rows are the data now, not a legend). |

## Interactions

| Element | Action | Result |
|---|---|---|
| Period tab (Day/Week/Month/Year) | tap | selection haptic; offset resets to **0**; refetch; label and chart update |
| Period tab (Period) | tap | opens the date-range picker; the previously active tab stays visually active until a range is applied |
| `‹` | tap | offset − 1; refetch; `›` becomes enabled |
| `›` | tap | offset + 1; refetch; disabled at offset 0 |
| Period label | tap | opens the date-range picker (same as the Period tab) — matches the reference's underlined, tappable label |
| Donut segment | tap | selection haptic; navigates to the expenses list filtered by **that category only** — not by the period in force (2026-08-04, HUMAN). The folded "Other" slice navigates to the unfiltered list. |
| Ranked row | tap | same target as its donut segment |
| Yellow Add button | tap | medium impact haptic; navigates to screen 02 (Add expense) |
| MainButton | tap | navigates to screen 02 — the same handler |
| Bottom nav tile | tap | selection haptic; navigates to that screen |

**Period never resets.** Switching to screen 02 and coming back, or a retry after
an error, restores the period that was in force. It resets only on a cold open,
to `month` / offset 0.

## Copy

| Key | String | Notes |
|---|---|---|
| `tab.day` | "Day" | |
| `tab.week` | "Week" | |
| `tab.month` | "Month" | |
| `tab.year` | "Year" | |
| `tab.custom` | "Period" | not "Custom" — the reference's word, and the user's |
| `empty.day.0` | "Nothing today" | |
| `empty.day.-1` | "Nothing yesterday" | |
| `empty.day.other` | "Nothing on 2 August" | the resolved date |
| `empty.week` | "Nothing that week" | |
| `empty.week.0` | "Nothing this week" | |
| `empty.month` | "Nothing in August" | month name, and the year if not this one |
| `empty.year` | "Nothing in 2026" | |
| `empty.custom` | "Nothing from 9 to 17 Jul" | matches the label format |
| `error.load` | "Couldn't load your expenses." | |
| `error.retry` | "Try again" | existing string, unchanged |
| `readonly` | "You have read-only access to this account." | existing string, unchanged |
| `offline.banner` | "Offline — showing data from {time}" | existing string, unchanged |
| `offline.period` | "Offline — showing {period}" | on a period tap while offline |
| `overbudget` | "{Category} is over budget by {amount} {currency}" | existing, unchanged |
| `mb.add` | "Add expense" | MainButton label; existing string, unchanged |
| `add.aria` | "Add expense" | the yellow button's accessible name — the `+` glyph alone is not one |

Empty-state copy is a **function of the period in force**, never a generic "no
data" — the same rule the three-chip design had, extended to four units.

## Data

| Call | Params | Notes |
|---|---|---|
| `GET /users/me` | — | currency; account name (screen 02 needs it too) |
| `GET /categories` | — | names + `color_slot` |
| `GET /statistics/by-category` | `period`, `offset` \| `period=custom` + `start_date`/`end_date` | |
| `GET /statistics/by-period` | same | the total in the hole |
| `GET /budgets` + `/budgets/{id}/progress` | — | over-budget strip; **month-scoped only** |

### Backend deltas this screen needs

1. **`period` + `offset` replaces the `PeriodPreset` enum (D313).** `period` is
   `day|week|month|year|custom`; `offset` is an int `≤ 0` (`0` = current,
   `−1` = previous). A positive `offset` is **422**, which is what makes the
   future unreachable server-side rather than only in the UI. `custom` keeps
   `start_date`/`end_date` and rejects `offset`. This supersedes D300 and
   reworks U0.1's `PeriodPreset` / `resolve_period`, already merged on this
   branch. The deprecated `months_back` alias **stays**: screen 05 and the bot
   are still its callers, and Statistics is out of scope for this work. So the
   statistics endpoints accept four mutually exclusive selector families —
   `{period, offset}` · `{period=custom, start_date, end_date}` ·
   `{months_back}` · `{start, end}` — and any mix is 422 naming the conflict.
2. **`expenses.spent_at`** (D314, migration) — statistics and `resolve_period`
   group by the date the money was spent, not the row's `created_at`. Screen 02
   is what writes it, but Home is what makes it visible: a backdated expense
   must land in the day the user chose.
3. **Week boundaries** must be resolved in `family_tz` like every other bound.
   Week start day is `[?]` — see Open questions.

The over-budget strip is **shown only on `month` at offset 0** and hidden for
`day`, `week`, `year` and custom periods (D310, extended; confirmed 2026-08-04,
HUMAN). Rationale under Resolved, below.

## Accessibility
- Every category swatch is paired with its name in the same row. The donut is
  `role="img"` with a label listing the top three categories and their shares.
- The period tab row is a `tablist`; the active tab carries `aria-selected` and
  is marked by **weight and underline**, never colour alone.
- `›` at offset 0 is `disabled` with `aria-disabled`, not visually hidden — the
  control's shape must teach that the future is unreachable.
- Focus order: tabs → `‹` → label → `›` → donut → **Add button** → rows →
  bottom nav. The Add button comes after the donut it floats over, not before
  it. MainButton is native chrome and sits outside this order.
- The Add button carries a visible focus ring and an accessible name; its `+`
  is decorative and `aria-hidden`.
- `prefers-reduced-motion`: disables the skeleton pulse and the period-change
  crossfade; the chart swaps instantly.

## Edge cases
- **More than six categories** — donut folds the tail into "Other"; the ranked
  rows list every one of them.
- **Exactly one category** — donut is a full ring, one row below.
- **Long category name** — ranked row truncates with an ellipsis at one line;
  the amount and share never shrink or wrap.
- **Year period with a big total** — the donut centre amount shrinks to 28px
  when the formatted string exceeds 11 characters `[inferred]`.
- **Offset far back** (e.g. `year`, offset −5, before the account existed) —
  a legitimately empty period, not an error, and **not something to prevent**
  (2026-08-04, HUMAN): arrowing back into an empty month is how a user
  navigates to a period they want to **backdate an expense into**. Empty copy
  names the period; `‹` is never disabled at any depth.
- **Period change while a fetch is in flight** — the stale response is
  discarded, not rendered. The last tap wins.
- **Cross-year week** (29 Dec – 4 Jan) — the label carries both years.

## Acceptance criteria
- [ ] The chart card's top row has exactly five tabs reading "Day", "Week",
      "Month", "Year", "Period", 44px tall, evenly distributed.
- [ ] The active tab is 600 weight with a 2px `--ink` underline; inactive tabs
      are 400 weight in `--ink-secondary`. No tab uses `--accent` or a category
      colour.
- [ ] On a cold open the active tab is "Month" and the label reads the current
      month name.
- [ ] The `›` arrow is disabled and visibly dimmed at offset 0, and becomes
      enabled after one tap of `‹`.
- [ ] No sequence of taps produces a label naming a date after today.
- [ ] Tapping "Day" then `‹` shows the label "Yesterday, August 3"; tapping `›`
      returns to "Today, August 4".
- [ ] The donut is a donut on all four unit tabs — the chart type never changes
      with the period.
- [ ] Telegram's MainButton reads "Add expense" and opens screen 02.
- [ ] A 56px yellow circle with a `+` sits at the bottom-right **inside the
      chart card**, and tapping it opens screen 02.
- [ ] Scrolling the page moves the yellow button with the chart card — it does
      not stay pinned to the viewport, and it never overlaps MainButton.
- [ ] For a read-only viewer both MainButton and the yellow button are hidden,
      and the Add-expense tile is disabled and still visible.
- [ ] Category rows below the donut are sorted by amount descending, each with a
      filled colour circle, a name, a share percentage and an amount.
- [ ] Tapping a category row or donut segment opens the expenses list filtered
      by that category, with no period filter applied.
- [ ] With zero expenses in the selected period the card shows copy naming that
      period ("Nothing today", not "No data"), and both Add affordances stay
      enabled.
- [ ] The six navigation tiles are at the very bottom of the page, text-only,
      32px tall, laid out as **two rows of three**, above
      `env(safe-area-inset-bottom)`.
- [ ] Changing the period keeps the donut's 200px slot occupied by a skeleton —
      nothing below it moves.
- [ ] The over-budget strip is absent on the Day, Week, Year and Period tabs,
      and present on Month at offset 0 when a budget is exceeded.
- [ ] Rendering is correct in both light and dark, with every colour resolved
      from `tokens.css`.

## Resolved
- **Backward navigation is unbounded** (2026-08-04, HUMAN) — see Edge cases.
- **Screen 05 (Statistics) is not part of this work** (2026-08-04, HUMAN). It
  keeps its existing `months_back` filters and its five preset chips; the
  period selector ships on Home only. Consequence for the backend: the
  `months_back` deprecation alias (D300) is **not** removable yet, because
  Statistics is still its caller.
- **Both MainButton and the yellow Add button ship** (2026-08-04, HUMAN). The
  guidance against a custom button competing with MainButton was raised and
  answered; the constraint that keeps it safe — the yellow button is anchored
  inside the chart card and never `position: fixed` — is in Telegram above and
  is an acceptance criterion.
- **Week starts Monday** (2026-08-04, HUMAN). Applies to `resolve_period`'s
  `period=week` bounds **and** the calendar grid's weekday header, which must
  agree — a picker whose weeks start on a different day than the Week tab is a
  bug users will find in a week.
- **Bottom nav is two rows of three** (2026-08-04, HUMAN).
- **Over-budget strip is hidden on Year** (2026-08-04, HUMAN), completing the
  rule: shown **only** on Month at offset 0. Budgets are monthly, so that is the
  one tab whose period matches the budget's own. See below.
- **Donut/row taps filter by category only** (2026-08-04, HUMAN), not by the
  period in force. This keeps `GET /expenses` out of the work — it has no
  period filter and does not need one.

### Why the over-budget strip is month-only
The strip states a **monthly** fact ("Groceries is over budget by 12.40"). On
the Day tab the donut states a **one-day** fact. Stacked together, the two
numbers appear to be about the same thing and are not — the strip's figure has
no relationship to the total in the donut's hole. The same mismatch applies to
Week, Year and any custom range. Month at offset 0 is the only tab where the
screen's period and the budget's period are the same span, so it is the only tab
where the strip is shown. Previous months are excluded too: a budget you already
blew through is history, not a warning.

## Open questions
None blocking. Remaining `[?]`s that touch this screen live in
`../design-system.md` (safe-area insets, focus states) and are global.
