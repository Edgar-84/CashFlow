# Component: Period selector

## Purpose
Names the period a screen is showing, and moves it. Two stacked rows: five tabs
choosing the **unit**, and a `‹ label ›` row moving the **offset** within that
unit.

**Used by `../screens/01-home.md` and `../screens/05-statistics.md` (V7,
D704).** Screen 05 kept its own `months_back` presets through V6 (2026-08-04,
HUMAN); V7's brief asked for the shared selector there too, and screen 05's
spec documents the delta. Nothing in this file is Home-specific — Statistics
is a plain second consumer, unchanged.

It is the only place in the app that expresses "which period", and it never
computes one — it emits `{unit, offset}` or `{unit: "custom", start, end}` and
the backend resolves it in `family_tz` (webapp/CLAUDE.md's zero-business-logic
rule; D120's bug is the reason).

## Reference
- `../refs/01-home/day-tab.jpg` — Day active, `‹ Today, August 4`
- `../refs/01-home/week-tab.jpg` — Week active, `‹ Aug 2 – Aug 8`
- Verbal brief from the user, 2026-08-04

## Delta from reference
- **Taking:** the five tabs in this order and wording; the underline marking the
  active tab; the centred label between arrows; the label being tappable and
  underlined to advertise it.
- **Changing:** the reference's active tab is **green** — ours is `--ink` with a
  600 weight and a 2px underline, because chrome is ink and the active state
  must survive greyscale. The reference shows only a `‹`; ours renders `›` too,
  disabled at offset 0, so the control's shape teaches that the future is
  unreachable.
- **Explicitly not taking:** the brand green; the "All time" option; the
  reference's dotted label underline (a solid 1px `--separator` reads better at
  our type size, `[inferred]`).

## Anatomy
In render order:

1. **Tab row** — `role="tablist"`, 44px tall, 5 tabs evenly distributed across
   the full card width, 14px labels.
   - Active: `--ink`, weight 600, 2px `--ink` underline spanning the label's
     width, sitting on the row's bottom edge.
   - Inactive: `--ink-secondary`, weight 400, no underline.
2. **Nav row** — 44px tall, **five cells** (2026-08-07: was three).
   - **Left spacer** — 44×44, empty, never interactive. Exists only so the
     label stays optically centred in the row once the jump control occupies
     the right end `[inferred]`.
   - `‹` — 44×44 hit target, 20px chevron, 2px stroke, `--ink`.
   - **Label** — centred, 15px/500 `--ink`, 1px `--separator` underline,
     tappable.
   - `›` — mirror of `‹`. Disabled at offset 0: `--ink-secondary` at 40%
     opacity, `aria-disabled`, no haptic on tap.
   - **Jump to present** — 44×44 hit target, the skip-to-present glyph
     (design-system Iconography: two chevrons plus a terminal bar), 2px stroke,
     `--ink`. **Present only when `offset < 0`**; at offset 0 the cell is still
     rendered but empty, so the row's geometry never changes.

Both rows sit inside the host card's padding; the component draws no background
and no border of its own.

### Why the jump control has a reserved, always-present cell
The straightforward implementation appends the button when the user arrows
back and removes it at offset 0. That moves `›` and the label sideways on the
tap that returns to the present — the control shifts under the finger that just
used it. The cell is therefore always in the layout and only its contents
appear and disappear `[inferred]`. The left spacer exists for the same reason
one row up: without it the label is centred between `‹` and the right edge on
one tab and somewhere else on another.

## Variants

| Variant | When used | What differs |
|---|---|---|
| Full | screen 01 | Both rows, all five tabs |
| Custom active | after a range is applied | Tab row unchanged with "Period" active; the nav row's arrows **and the jump control** are all hidden (an arbitrary range has no next, previous, or present) and the label shows the range |

## States

| State | Trigger | What the user sees |
|---|---|---|
| Default | offset < 0 | Both arrows enabled; the jump control is **visible** at the right end |
| At present | offset = 0 | `›` disabled and dimmed; `‹` enabled; the jump cell is empty but still occupies its 44px |
| Custom | unit = custom | Arrows and jump control hidden; label shows the range; "Period" tab active |
| Pressed | tap on tab or arrow | 0.6 opacity for the press duration |
| Disabled | host is offline | Whole component 50% opacity, tabs inert; tapping shows the host's offline message |
| Loading | a fetch is in flight | **No change** — the control stays live and interactive. Only the host's chart skeletonises. |

The component is never itself in a loading state. Freezing the control someone
just tapped is what makes a period switch feel slow.

## Copy

| Key | String | Notes |
|---|---|---|
| `tab.day` | "Day" | |
| `tab.week` | "Week" | |
| `tab.month` | "Month" | |
| `tab.year` | "Year" | |
| `tab.custom` | "Period" | |
| `aria.prev` | "Previous {unit}" | e.g. "Previous week" |
| `aria.next` | "Next {unit}" | |
| `aria.label` | "Change period" | on the tappable label |
| `aria.jump.day` | "Back to today" | the jump control, on the Day tab |
| `aria.jump.week` | "Back to this week" | |
| `aria.jump.month` | "Back to this month" | |
| `aria.jump.year` | "Back to this year" | |

The jump control's accessible name is **per unit**, not a generic "Back to the
present" — a screen reader user arrowing through months should hear the thing
they are returning to `[inferred]`.

### Label formats

Rendered by `lib/period.ts::describe`, pure and unit-tested. The year appears
only when it is not the current year.

| Unit | Offset | Label |
|---|---|---|
| day | 0 | "Today, August 4" |
| day | −1 | "Yesterday, August 3" |
| day | ≤ −2 | "August 2" — month and day only, **no weekday** |
| day | any, other year | "August 4, 2025" |
| week | 0 | "This week" — weeks start **Monday** (2026-08-04, HUMAN) |
| week | ≤ −1, same month | "2 – 8 Aug" |
| week | ≤ −1, spanning months | "28 Jul – 3 Aug" |
| week | spanning years | "29 Dec 2025 – 4 Jan 2026" |
| month | 0 | "August" |
| month | ≤ −1, this year | "July" |
| month | other year | "August 2025" |
| year | 0 | "2026" |
| year | ≤ −1 | "2025" |
| custom | — | "9 – 17 Jul" |

**Day forms confirmed 2026-08-04 (HUMAN):** "Today" and "Yesterday" are named
because those two are what people actually reach for; every other day is bare
`Month day` with **no weekday prefix**. The remaining forms are `[inferred]`,
with "This week" following the same convenience rule one unit up.

The custom format follows plan unit U1.1's already-specified `"9 – 17 Jul"`
rather than the reference's `"Aug 2 – Aug 8"`, so one format serves both.

## Sizing and spacing
From the design system's Sizing table. Tab row 44px, nav row 44px, arrow hit
targets 44×44, tab label 14px, period label 15px. `12px` between the nav row and
whatever the host renders below it.

## Accessibility
- Tab row is a `tablist` of `tab`s with `aria-selected`; the panel below is the
  host's chart.
- The active tab is distinguished by **weight and underline**, never colour
  alone — the component uses no colour other than `--ink` / `--ink-secondary`.
- `›` at offset 0 is `disabled` + `aria-disabled="true"` and stays **visible**.
  Hiding it would make the control's shape change under the user's finger.
- Arrow keys move between tabs; Enter/Space activates. Left/Right on the nav row
  steps the offset.
- Hit targets are 44×44 minimum everywhere, including the label.
- `prefers-reduced-motion`: the underline does not slide between tabs, it
  redraws.

## Inputs
Pure render function, no fetching and no state — `webapp/src/components/` rule.

```ts
type PeriodUnit = "day" | "week" | "month" | "year" | "custom";

interface PeriodValue {
  unit: PeriodUnit;
  offset: number;            // <= 0 always; ignored when unit === "custom"
  start?: string;            // YYYY-MM-DD, custom only
  end?: string;              // YYYY-MM-DD, inclusive, custom only
}

interface PeriodSelectorProps {
  value: PeriodValue;
  now: Date;                 // anchors `describe`'s label — injected so the
                              // component never reads the clock itself (D327)
  disabled?: boolean;        // offline
  onUnitChange(unit: PeriodUnit): void;   // host resets offset to 0
  onOffsetChange(offset: number): void;   // host clamps at 0
  onOpenPicker(): void;                   // "Period" tab, or a label tap
}
```

The jump control needs **no callback of its own**: it calls
`onOffsetChange(0)`. "Jump to the present" and "arrow forward to the present"
are the same state transition, so giving them separate handlers would let the
two paths drift. The host cannot tell them apart, and does not need to.

The component **clamps nothing and validates nothing** — it renders `›` disabled
when `value.offset === 0` and calls back. The clamp lives in the host so there
is one place to reason about it, and the backend 422s a positive offset
regardless.

`lib/period.ts` (U1.1) owns `describe`, `toQuery` and `monthGrid`. **No function
in that module converts a date to a UTC instant** — that constraint is asserted
by the absence of any such export.

## Acceptance criteria
- [ ] Renders exactly five tabs reading "Day", "Week", "Month", "Year",
      "Period", in that order.
- [ ] The active tab is 600 weight with a 2px `--ink` underline; the others are
      400 weight in `--ink-secondary`.
- [ ] No part of the component renders a category colour or `--accent`.
- [ ] With `offset: 0` the `›` arrow is present, visibly dimmed, and does not
      fire `onOffsetChange` when tapped.
- [ ] With `offset: -1` both arrows are enabled.
- [ ] With `offset: 0` no jump control is visible; with `offset: -1` a
      skip-to-present glyph appears immediately to the right of `›`.
- [ ] The `‹`, the label and the `›` sit at the same horizontal positions at
      `offset: 0` and at `offset: -1` — appearing and disappearing, the jump
      control moves nothing.
- [ ] Tapping the jump control at `offset: -7` calls `onOffsetChange(0)`
      exactly once, and the control then disappears.
- [ ] The jump control's accessible name names the unit ("Back to this month"),
      and it renders in `--ink`, never `--accent`.
- [ ] Changing the unit calls `onUnitChange` and never `onOffsetChange`.
- [ ] With `unit: "custom"` both arrows are absent and the label shows the range.
- [ ] Tapping the label calls `onOpenPicker`, as does tapping the "Period" tab.
- [ ] `describe` renders every row of the label-format table above.
- [ ] Every hit target measures at least 44×44px.
- [ ] Renders identically in structure in light and dark, with all colour from
      `tokens.css`.

## Resolved

- **Offset is uncapped** (2026-08-04, HUMAN). A user may arrow back into periods
  that are guaranteed empty — that is a feature, not a dead end: it is how
  someone navigates to an old month in order to **backdate an expense into it**
  (screen 02 writes `spent_at`). No "you have no data before X" wall, no
  disabled `‹` at any depth. The only clamp in the app is at the **present**
  end: `offset > 0` is unreachable in the UI and 422 at the API.
- ~~**Statistics (screen 05) is out of scope**~~ (2026-08-04, HUMAN) —
  **superseded 2026-08-25 (V7, D704)**: screen 05 adopts this component
  too, see `../screens/05-statistics.md`. The "All time" option the reference
  has was never adopted by either screen, and this component still has five
  tabs, not six.

## Open questions
None. The label formats above are the contract; `describe` is unit-tested
against every row of that table (plan unit U1.1).
