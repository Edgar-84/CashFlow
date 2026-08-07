# Screen: 01 — Home

## Purpose
The root screen. Someone opens the app to see where the money went in a period
they choose, and to add an expense in one tap. The donut answers "where did it
go?" before a number is read; the ranked rows underneath name the categories so
identity is never carried by colour alone.

**This spec supersedes the three-chip period design** in `docs/design/mini-app-ux.md`
§4 screen 01 (`Today · Yesterday · This month`) and plan unit U1.3. The period
control is now Day/Week/Month/Year/Period with offset arrows — see D313 below.

**Revised 2026-08-07 (V4, HUMAN)**, six changes, each marked `(V4)` below.
The sixth arrived after the first five and is the largest: **the chart collapses
into a stacked bar and pins to the top of the viewport while the list scrolls**
— see "Collapsed chart header".
1. An empty period draws an **empty ring**, not a bare copy block.
2. The period selector gains a **jump-to-present** control.
3. **The donut is display-only** — tapping it navigates nowhere.
4. A **ranked category row filters by category *and* the period in force**,
   which is a backend delta (`GET /expenses` has no filters today).
5. The six-tile bottom row is replaced by a **☰ menu button** opening
   `../components/side-menu.md`.
6. Scrolling the ranked rows collapses the donut into a **pinned stacked bar**;
   scrolling back to the top restores the donut.

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
    with `›` disabled at offset 0, so the control's shape teaches the rule, plus
    a skip-to-present control that appears once you have navigated back **(V4)**.
  - Our six existing navigation tiles moved into a left-hand drawer **(V4)**;
    the reference has no equivalent of either arrangement.
  - The over-budget strip has no reference counterpart; it stays, month-scoped.
  - The reference's donut is a drill-down; ours is **display-only (V4)**.
- **Explicitly not taking:** the green app bar and its `EXPENSES / INCOME`
  tabs (this app has no income concept); the `Total ▾` account switcher (one
  account per user — there is nothing to switch); the receipt icon; the
  reference's brand green; the "All time" checkbox in the period dialog;
  per-category glyphs.

  The reference's **hamburger is now taken (V4)** — it was in this list until
  2026-08-07. What is still not taken is its position: the reference puts it in
  a top app bar, ours sits at the bottom-left of the chart card, on the Add
  button's axis (HUMAN).

## Layout
Top to bottom, one scroll container. **Nothing is fixed (V4)** — the side menu
and its scrim are overlays outside the scroll container, and the tile row that
used to be fixed is gone.

| # | Region | Fixed / scrolls | Geometry |
|---|---|---|---|
| 1 | Offline banner | scrolls | full width, only in `offline` |
| 2 | **Chart card** | scrolls | `--card`, radius 14px, padding `16px 12px 20px` |
| 2a | ↳ Period tabs | — | 44px tall, 5 items, evenly distributed |
| 2b | ↳ Period nav row | — | 44px tall, `[spacer]` · `‹` · label · `›` · `[jump]`, each cell 44×44 **(V4)** |
| 2c | ↳ Donut | — | 200px box, 30px stroke, total centred in the hole |
| 2d | ↳ **Add button** | absolute, **within the card** | 56px circle, `--accent`, bottom-right, inset 12px from the card's right and bottom padding edges |
| 2e | ↳ **☰ Menu button (V4)** | absolute, **within the card** | 44×44, transparent, `--ink` glyph, bottom-**left**, inset 12px from the card's left and bottom padding edges, **vertically centred on the Add button** |
| 3 | Over-budget strip | scrolls | full width card, `--status-red` text + warning icon |
| 4 | Ranked category rows | scrolls | one card each, 12px gap, `10px 13px` padding |
| ~~5~~ | ~~Bottom nav row~~ | — | **removed (V4)** — replaced by 2e + `../components/side-menu.md` |
| 6 | **Collapsed chart header (V4)** | **`position: fixed; top: 0`**, out of flow | 68px: a 44px row (☰ · label · total) over a 10px stacked bar, `8px 12px` padding, `--card` background, 1px `--separator` bottom rule. **Present only while region 2c has scrolled above the viewport** |

Gaps: `20px` between region 2 and 3, `12px` between cards inside region 4.
The page's bottom padding keeps its `96px` MainButton reserve plus
`env(safe-area-inset-bottom)`; what changes is that nothing is docked in it.

### Collapsed chart header (V4)
The brief (2026-08-07, HUMAN): "make the main ring with the diagram pinned and
the list of expenses below scroll… when you scroll down, the main diagram turns
into a wide horizontal line with a breakdown of expense categories by colour,
with the length depending on the amount of the category's expense, and when we
swipe the list to the very top, it turns back into a pie chart."

**Two states, one dataset.** The donut and the bar are the *same* segments in
the same order with the same colours and the same six-slice fold into "Other" —
only the geometry differs. If the two ever disagree, the bar is wrong.

| | Expanded | Collapsed |
|---|---|---|
| Trigger | region 2c is at least partly in the viewport | region 2c has scrolled fully above the viewport top |
| Chart | 200px donut, total in the hole | 10px full-width stacked bar |
| Period tabs | present | **absent** — scroll up to change unit |
| Period label | in the nav row, tappable | centred in the 44px row, tappable, same target |
| Total | in the donut's hole | right end of the 44px row, 15px/600, tabular |
| ☰ | bottom-left of the chart card | left end of the 44px row |
| Yellow Add button | bottom-right of the chart card | **not rendered** |

Mechanics, all `[inferred]`:

- The header is **`position: fixed`, not `sticky`** — out of flow, so appearing
  and disappearing never moves the content whose scroll position triggered it.
  A sticky element inside the flow reserves space and produces a feedback loop
  at the threshold; a fixed overlay cannot.
- The trigger is an **`IntersectionObserver` on a 1px sentinel** at the bottom
  edge of region 2c, not a scroll-position listener. Scroll handlers in a
  Telegram webview fire at the client's mercy; an observer does not.
- It overlays the top ~68px of the ranked rows while collapsed. Accepted, and
  the standard app-bar trade: the alternative reserves 68px permanently, which
  is what the tile row was removed for.
- Slide + fade over 160ms; instant under `prefers-reduced-motion`.

**Exactly one ☰ exists in the DOM at a time**, and exactly one chart. The
expanded card's ☰ and the collapsed header's are the same control in two
places, never two focusable controls with one name.

#### Why the yellow button disappears while collapsed
There is no room for a 56px circle in a 68px header without it dominating, and
the constraint that lets it coexist with MainButton is that it is **anchored to
the card and never `position: fixed`** (Telegram, below). Putting it in a fixed
header would break that constraint outright.

Nothing is lost: **MainButton is always present** and fires the same handler, so
"add an expense" is one tap away in both states. That is exactly the redundancy
the three-entrances arrangement was accepted for.

#### This is not the reference's chart-type switch
`docs/ui/refs/01-home/week-tab.jpg` degrades the donut to a bar **when the
period changes**, and this spec's Delta rejects that: two periods you cannot
compare at a glance. The V4 behaviour switches on **scroll position**, with the
period held constant — the same period, drawn small, because the user has asked
to look at the list instead. Comparing Week to Month still means comparing two
donuts.

### The menu button's placement
"On the same horizontal axis as the yellow add-expense plus button, but on the
left side of the screen" (2026-08-07, HUMAN). Concretely: the two share a
centre line, so 2e's centre sits at the same `y` as 2d's despite being 44px to
2d's 56px. It is **inside the chart card and scrolls with it**, exactly like the
Add button, and for the same reason — see Telegram below.

It is `--ink` on the card, not a filled circle: it is chrome, and `--accent`
belongs to exactly one element in the app (design-system).

Region 4 is a list of **categories, not individual expenses** — one row per
category, `swatch · name · share% · amount`, exactly as the reference shows
(`../refs/01-home/week-tab.jpg`: Дом 58% zł2,948) and as the app already does.
Individual expenses stay on screen 03, reachable by tapping a row.

It shows **all** categories with a non-zero total, ranked descending — the donut
folds at six slices, the rows do not fold at all. A category at 0 for the period
is omitted entirely.

### Navigation (V4 — replaces the bottom navigation row)
The six tiles (Add expense · Expenses · Budgets · Statistics · Categories ·
Tags) are **no longer on the screen**. They are rows in the side menu, together
with a seventh, Settings. Everything about the panel — width, row height,
order, focus behaviour, read-only rule — is specified in
`../components/side-menu.md`; this screen owns only the button that opens it and
the fact that it is the sole opener in the app.

What the V3 arrangement got wrong, and why it changed (2026-08-07, HUMAN): six
labels docked above the MainButton reserve ate roughly 100px of a phone
viewport permanently, to show six destinations that are visited a handful of
times a session. The donut is what the screen is for.

**Add expense keeps all three entrances** — the yellow Add button, MainButton,
and now the menu's first row. That was already the accepted arrangement; only
the third one's location changed.

## Components used
- `../components/period-selector.md` — regions 2a + 2b. Shipped; **V4 adds the
  jump-to-present control to it**, which is a change to that component, not to
  this screen.
- `../components/date-range-picker.md` — opened by the Period tab. Shipped.
- `../components/side-menu.md` — opened by region 2e. **Does not exist yet; it
  is a unit dependency for this screen (V4).**
- Donut, ranked row, card, chip — existing, in `screens/home.ts` and `app.css`.
  V4 adds the donut's **empty ring** variant; the populated donut is unchanged.

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
- **Menu button (☰): shown (V4)**, and it is chrome, not a primary action — it
  is `--ink` on the card with no fill, so it never competes with either the
  yellow button beside it or MainButton below. It is **hidden for nobody**: a
  read-only viewer navigates too (the menu disables only its Add expense row).
  Like the Add button it is anchored inside the chart card and **must never be
  `position: fixed`** — see Open questions for the cost of that.
- **BackButton:** hidden on the root screen, with **one exception (V4): while
  the side menu is open it is shown, and it closes the menu.** It never
  navigates away from Home. This is the only BackButton behaviour on screen 01.
- **Haptics:** `selection` on a period tab change, on an arrow tap, on the
  jump-to-present control **(V4)**, on a ranked-row tap and on a side-menu row
  tap. `impact('light')` on the menu button **(V4)**. `impact('medium')` on the
  yellow Add button — the heaviest action on the screen. No haptic on a
  *rejected* arrow tap (the disabled `›` at offset 0) — silence is the feedback
  — and **no haptic on a donut tap, which now does nothing at all (V4)**.
- **Viewport:** no keyboard on this screen. When the viewport collapses the
  whole page scrolls, including the Add and menu buttons, which travel with the
  chart card. The side menu, when open, is sized to the **viewport**, not the
  page, and honours `viewportStableHeight`.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | first open, or any period change | Period tabs and nav row render **live and interactive**; the donut area is a skeleton circle at its final 200px, the rows are three skeleton cards. No reflow when data lands. |
| **Empty (V4)** | period resolved, total is 0 | Chart card keeps the tabs and nav row and draws an **empty ring**: the same 200px box and 30px stroke as a populated donut, one unbroken arc in `--separator`, no segment gaps. The hole holds the **formatted zero total** for the account's currency (`0.00`), in `--ink-secondary` rather than `--ink`. The explanatory sentence sits under the ring, 12px below, 13.5px `--ink-secondary`, centred. No ranked rows, no over-budget strip. MainButton, the yellow Add button and the menu button all stay enabled. |
| Error | any of the calls rejects and there is no cache | "Couldn't load your expenses." + "Try again". Period control still usable — retrying with a different period is a legitimate recovery. Never a status code. |
| 403 | `ForbiddenError` from any call | Read-only surface: donut and rows render if the reads succeeded; MainButton **and** the yellow Add button are hidden. The **menu button stays visible** and its Add expense row is disabled, not hidden **(V4)**, with the read-only line above the chart card. |
| Offline | a call rejects and a cache snapshot exists | Last loaded data, banner with the last-synced time. The period control is **frozen at the cached period** — changing it would need a fetch. Tapping a tab shows "Offline — showing <period>". The menu still opens: navigating away from a stale screen must not require a network. |
| Populated | total > 0 | Donut, total in the hole, all non-zero categories ranked below. |
| **Collapsed (V4)** | the donut has scrolled above the viewport top | A fixed 68px header: ☰, the period label, the period's total, and the stacked bar. The donut, the tabs and the yellow button are all off-screen or unrendered; MainButton is unchanged. |
| **Loading, collapsed (V4)** | a period change while scrolled down | Cannot occur — a period change scrolls to the top first. Stated so the combination is not implemented "just in case". |
| Single category | exactly one non-zero category | Donut renders as one full ring; the ranked list still shows the one row (unlike V2, which suppressed the legend at ≤1 — the ranked rows are the data now, not a legend). |

## Interactions

| Element | Action | Result |
|---|---|---|
| Period tab (Day/Week/Month/Year) | tap | selection haptic; offset resets to **0**; refetch; label and chart update |
| Period tab (Period) | tap | opens the date-range picker; the previously active tab stays visually active until a range is applied |
| `‹` | tap | offset − 1; refetch; `›` and the jump control become enabled/visible |
| `›` | tap | offset + 1; refetch; disabled at offset 0 |
| **Jump to present (V4)** | tap | selection haptic; offset → **0** in one step, whatever it was; refetch; the control disappears. Absent at offset 0 and on the Period tab |
| Period label | tap | opens the date-range picker (same as the Period tab) — matches the reference's underlined, tappable label |
| **Donut (V4)** | tap | **nothing.** No haptic, no navigation, no selection state. The chart is display-only (2026-08-07, HUMAN), superseding the V3 drill-down |
| **Ranked row (V4)** | tap | selection haptic; navigates to the expenses list filtered by **that category *and* the period in force** (2026-08-07, HUMAN), superseding V3's category-only filter. Day at offset −1 + "Transport" → yesterday's transport expenses and nothing else |
| Yellow Add button | tap | medium impact haptic; navigates to screen 02 (Add expense), **carrying the selected date when the Day tab is active (V4)** — see below |
| MainButton | tap | navigates to screen 02 — the same handler, same date-carrying rule |
| **☰ Menu button (V4)** | tap | light impact haptic; opens the side menu. Same behaviour from the chart card and from the collapsed header |
| **Collapsed stacked bar (V4)** | tap | **nothing** — the same display-only rule the donut now follows |
| **Collapsed period label (V4)** | tap | opens the date-range picker, identical to the expanded label |

**Period never resets.** Switching to screen 02 and coming back, or a retry after
an error, restores the period that was in force. It resets only on a cold open,
to `month` / offset 0.

### The date Home hands to screen 02 (V4)
When the Day tab is active, "add expense" means "add an expense **to the day I
am looking at**" (2026-08-07, HUMAN). Both the yellow button and MainButton pass
the resolved date of the current `day`/`offset` to screen 02, which pre-selects
it (`../screens/02-add-expense.md`'s date row).

**Only the Day tab does this.** Week, Month, Year and Period pass nothing and
screen 02 defaults to today, exactly as it does now — a range names no single
day, and silently picking one out of it (its last day, say) would put an expense
on a date the user never chose.

The date travels as a `YYYY-MM-DD` string resolved from the same
`family_tz`-anchored value the period label renders, never from the device
clock.

## Copy

| Key | String | Notes |
|---|---|---|
| `tab.day` | "Day" | |
| `tab.week` | "Week" | |
| `tab.month` | "Month" | |
| `tab.year` | "Year" | |
| `tab.custom` | "Period" | not "Custom" — the reference's word, and the user's |
| `empty.day` | "There were no expenses on this day." | **(V4)** verbatim from the user, 2026-08-07 |
| `empty.week` | "There were no expenses in this week." | **(V4)** |
| `empty.month` | "There were no expenses in this month." | **(V4)** |
| `empty.year` | "There were no expenses in this year." | **(V4)** |
| `empty.custom` | "There were no expenses in this period." | **(V4)** |
| ~~`empty.day.0`~~ … | ~~"Nothing today" / "Nothing in August" / …~~ | **removed (V4)** — the eight period-named strings below are superseded by the five above |
| `error.load` | "Couldn't load your expenses." | |
| `error.retry` | "Try again" | existing string, unchanged |
| `readonly` | "You have read-only access to this account." | existing string, unchanged |
| `offline.banner` | "Offline — showing data from {time}" | existing string, unchanged |
| `offline.period` | "Offline — showing {period}" | on a period tap while offline |
| `overbudget` | "{Category} is over budget by {amount} {currency}" | existing, unchanged |
| `mb.add` | "Add expense" | MainButton label; existing string, unchanged |
| `add.aria` | "Add expense" | the yellow button's accessible name — the `+` glyph alone is not one |
| `menu.aria` | "Menu" | **(V4)** the ☰ button's accessible name; see `../components/side-menu.md` for the panel's own strings |

### Empty copy: deictic, not period-named (V4, changed)
V3's rule was that the empty state **names** the period ("Nothing in August").
V4 replaces it with one sentence per unit that says "this day/week/month/year/
period" instead (2026-08-07, HUMAN, `empty.day` verbatim).

That is not a loosening of the "never a generic no-data" rule — it is that rule
satisfied by position rather than repetition. The empty sentence sits directly
under a ring, which sits directly under a label reading "Yesterday, August 3".
Naming August 3 twice, 100px apart, is noise; what the copy has to do is be
unambiguous about *which* period is empty, and "this day" under that label is.

Still forbidden: one string for all five units, and the word "data".

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
4. **`GET /expenses` gains a category filter and the period family (V4).** A
   ranked-row tap now means "this category, this period", and the expenses list
   has no way to express either: the route takes `limit`/`offset` only, and
   `webapp/src/screens/expenses.ts` filters by category **client-side, inside
   one fetched page**. That is already wrong for a long list — a category with
   no expenses in the newest 50 rows renders as empty — and it cannot express a
   period at all. See `../screens/03-expenses.md`'s Data section for the
   contract; it is a backend unit this screen's row tap depends on.

The over-budget strip is **shown only on `month` at offset 0** and hidden for
`day`, `week`, `year` and custom periods (D310, extended; confirmed 2026-08-04,
HUMAN). Rationale under Resolved, below.

## Accessibility
- Every category swatch is paired with its name in the same row. The donut is
  `role="img"` with a label listing the top three categories and their shares.
  **(V4)** It is no longer interactive, so it is not focusable and carries no
  `button` semantics — its label is now its only job. The **empty ring**'s label
  is the empty sentence itself.
- The period tab row is a `tablist`; the active tab carries `aria-selected` and
  is marked by **weight and underline**, never colour alone.
- `›` at offset 0 is `disabled` with `aria-disabled`, not visually hidden — the
  control's shape must teach that the future is unreachable.
- Focus order **(V4)**: tabs → `‹` → label → `›` → jump → **menu button** →
  **Add button** → ranked rows. The two card-anchored buttons come after the
  chart they float over; the menu button precedes the Add button because it is
  to its left. MainButton is native chrome and sits outside this order. The
  donut is skipped entirely.
- Both card-anchored buttons carry a visible focus ring and an accessible name;
  their glyphs are decorative and `aria-hidden`.
- **Opening the menu moves focus into the panel and traps it there**; closing
  returns focus to the ☰ button (`../components/side-menu.md`) — whichever of
  the two positions it currently occupies.
- **(V4)** The collapsed header's bar is `role="img"` with the **same label the
  donut carries** (top three categories and their real percentages, not the
  clamped widths). It is not focusable and not a button.
- **(V4)** Only one ☰ is in the DOM at a time, so a screen reader never
  encounters two controls named "Menu". Focus order while collapsed: ☰ → period
  label → ranked rows.
- `prefers-reduced-motion`: disables the skeleton pulse, the period-change
  crossfade **and the menu's slide**; the chart and the panel swap instantly.

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
  navigates to a period they want to **backdate an expense into**. The empty
  ring renders; `‹` is never disabled at any depth. **(V4)** This is exactly the
  case the jump control exists for: eleven taps back, one tap home.
- **Period change while a fetch is in flight** — the stale response is
  discarded, not rendered. The last tap wins. **(V4)** The jump control is
  subject to the same guard: tapping it during an in-flight `‹` must render the
  present, not the period that was being loaded.
- **Cross-year week** (29 Dec – 4 Jan) — the label carries both years.
- **(V4) Jump tapped at offset 0** — unreachable: the control is not rendered
  there. If it is somehow tapped, `onOffsetChange(0)` is a no-op refetch, never
  a positive offset.
- **(V4) Menu opened, then the app is backgrounded and resumed** — the menu
  stays open; it is UI state, not a transient. Nothing refetches on resume.
- **(V4) Ranked-row tap on a period with data for that category but none in the
  newest page** — cannot happen once the filter is server-side; this is the
  concrete bug the backend delta closes.
- **(V4) Many categories with the menu open** — the page behind the scrim does
  not scroll; the panel itself scrolls only if seven 48px rows ever exceed the
  viewport, which they do not on any supported device.
- **(V4) Too few rows to scroll** — with three categories the page does not
  scroll at all and the collapsed header never appears. Correct: there is
  nothing to keep in view.
- **(V4) Collapsed, then the period changes via the label** — the picker opens
  over the collapsed state; applying a range refetches and the page **scrolls
  back to the top**, restoring the donut. A new period always starts expanded
  `[inferred]` — landing mid-list in data you have not seen is disorienting.
- **(V4) Collapsed while the menu opens** — the header stays put behind the
  scrim; it is page chrome, not a competing overlay. The panel's z-index is
  above it.
- **(V4) One category, collapsed** — the bar is a single full-width segment.
- **(V4) A category worth 0.2% of the period, collapsed** — its segment is
  clamped to a 3px minimum so it does not vanish. The bar is therefore
  **approximate by design**; the ranked rows carry the exact shares, and the
  bar's `role="img"` label names the top three with their real percentages.
- **(V4) Empty period, collapsed** — barely reachable (an empty period has no
  rows to scroll past), but specified: one unbroken `--separator` segment,
  mirroring the empty ring.
- **(V4) Rubber-band scroll past the top on iOS** — the sentinel sits at the
  *bottom* edge of the donut, well clear of the overscroll region, so the header
  does not flicker at the boundary.

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
      the ☰ button is still visible, and the menu's Add expense row is disabled
      and still visible.
- [ ] Category rows below the donut are sorted by amount descending, each with a
      filled colour circle, a name, a share percentage and an amount.
- [ ] **(V4)** Tapping the donut — segment, hole or gap — does nothing: no
      navigation, no haptic, no visual state change.
- [ ] **(V4)** With the Day tab at offset −1 and a single 5.00 Transport expense
      yesterday, tapping the Transport row opens an expenses list containing
      exactly that one expense, not every Transport expense ever recorded.
- [ ] **(V4)** With the Month tab on a month holding 6 Transport expenses,
      tapping the Transport row opens a list of exactly those 6.
- [ ] **(V4)** With zero expenses in the selected period the card shows a
      complete grey ring at the same 200px size and 30px stroke as a populated
      donut, `0.00` in its hole, and the sentence "There were no expenses on
      this day." (or its unit's equivalent) beneath it; MainButton, the yellow
      button and the ☰ button all stay enabled.
- [ ] **(V4)** Switching from a period with expenses to an empty one moves
      nothing above the ranked rows — the ring occupies the donut's slot exactly.
- [ ] **(V4)** No navigation tiles are rendered anywhere on the page.
- [ ] **(V4)** A 44px ☰ sits at the bottom-**left** inside the chart card, its
      centre on the same horizontal line as the yellow button's centre, and
      tapping it opens the side menu.
- [ ] **(V4)** With the Day tab showing 3 August and today being 7 August,
      tapping the yellow button opens screen 02 with the third date pill reading
      `8/3` and selected — not "today".
- [ ] **(V4)** With the Month tab active, tapping the yellow button opens screen
      02 with "today" selected.
- [ ] **(V4)** After tapping `‹` three times on any unit tab, a skip-to-present
      control is visible to the right of `›`; tapping it once returns the label
      to the current period.
- [ ] **(V4)** Scrolling down until the donut leaves the viewport pins a 68px
      header to the top holding ☰, the period label, the total and a horizontal
      stacked bar; scrolling back to the top removes it and the donut is intact.
- [ ] **(V4)** The bar's segments are the same categories, in the same order and
      colours, as the donut's, including the "Other" fold at six.
- [ ] **(V4)** Each segment's width is proportional to its amount — the largest
      category's segment is visibly the widest.
- [ ] **(V4)** The yellow Add button is not rendered while the header is
      pinned, and MainButton still reads "Add expense".
- [ ] **(V4)** Tapping ☰ in the pinned header opens the same menu as tapping it
      on the chart card, and only one ☰ is reachable at a time.
- [ ] **(V4)** Appearing and disappearing, the pinned header does not shift the
      ranked rows underneath it by a single pixel.
- [ ] **(V4)** With `prefers-reduced-motion: reduce` the header appears with no
      slide.
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
- ~~**Bottom nav is two rows of three**~~ (2026-08-04, HUMAN) — **superseded
  2026-08-07 (V4, HUMAN)**: the row is gone entirely, replaced by the ☰ button
  and `../components/side-menu.md`.
- **Over-budget strip is hidden on Year** (2026-08-04, HUMAN), completing the
  rule: shown **only** on Month at offset 0. Budgets are monthly, so that is the
  one tab whose period matches the budget's own. See below.
- ~~**Donut/row taps filter by category only**~~ (2026-08-04, HUMAN) —
  **superseded 2026-08-07 (V4, HUMAN)**, in both halves. The donut no longer
  navigates at all, and a ranked-row tap filters by category **and** period. The
  V3 rationale was explicitly that this "keeps `GET /expenses` out of the work";
  V4 accepts that cost, because the all-time list a user got after tapping a row
  on the Day tab answered a question they had not asked.
- **Empty periods draw a ring, not a gap** (2026-08-07, HUMAN). See States.
- **Only the Day tab hands a date to screen 02** (2026-08-07, HUMAN). See
  Interactions.

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
- ~~[?] **(V4) The menu button scrolls away with the chart card.**~~ —
      **answered by the collapsed header (2026-08-07, HUMAN)**. The ☰ moves into
      the pinned header the moment the chart card leaves the viewport, so
      navigation is reachable at every scroll position without the button ever
      being `position: fixed` on the card itself. The pinned-navigation problem
      and the pinned-chart request had the same answer.
- [?] **(V4) Does the collapsed header show the period tabs?** This spec says
      no — 68px stays a summary, and changing the *unit* is a deliberate act
      worth scrolling up for, while changing the *range* stays available via the
      tappable label. If switching Day↔Month mid-list turns out to be common,
      the tab row can be added at a cost of 44px of permanent height.
- [?] **(V4) The 3px minimum segment.** It keeps a tiny category visible and
      makes the bar slightly untrue at the small end. The alternative — dropping
      sub-1% categories into "Other" for the bar only — makes the bar disagree
      with the donut, which this spec forbids elsewhere. Judgeable on a real
      account with a long tail.
- Remaining `[?]`s that touch this screen live in `../design-system.md`
  (safe-area insets, focus states) and are global.
