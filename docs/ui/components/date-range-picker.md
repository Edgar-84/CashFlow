# Component: Date range picker

## Purpose
Picks an arbitrary date range for the "Period" tab
(`../components/period-selector.md`), and — in its single-date variant — the
date of an expense on `../screens/02-add-expense.md`. Hand-rolled month grid, not
a native `<input type="date">` and not a dependency (D303).

## Reference
- `../refs/01-home/period-picker.jpg` — "Select Period", the from–to summary,
  a continuously scrolling month grid, the selected span highlighted, CANCEL/OK
- Verbal brief from the user, 2026-08-04

## Delta from reference
- **Taking:** the title + human range summary at the top; the fixed weekday
  header row; the continuous vertical scroll through months with each month
  named above its grid; the selected span drawn as a **connected pill** with
  rounded caps at the two ends; the two text buttons at the bottom right.
- **Changing:**
  - Selection colour is `--ink`, not the reference's green — chrome is ink. The
    span between the ends is `--ink` at 12% opacity `[inferred]`.
  - "OK" becomes **"Apply"**, disabled until both ends are chosen; the reference
    leaves it always enabled.
  - Future dates are rendered **disabled**, not selectable. The reference allows
    them (its grid shows September 2026 as tappable).
  - Quick-range chips (Last 7 days · Last 30 days · This month) at the top,
    from plan unit U1.5 — the reference has none, and they cover most of what
    people actually want from a custom range.
- **Explicitly not taking:** the "All time" checkbox; the reference's green;
  the dialog's drop shadow (the design system has no shadows — the picker is
  separated by a scrim, not elevation).

## Anatomy
Rendered as a full-width **bottom sheet** over a scrim (2026-08-04, HUMAN) — the
reference uses a centred dialog, but a sheet survives a shrinking Telegram
viewport better.

1. **Scrim** — `--ink` at 40% opacity, covers the screen, tap dismisses.
2. **Sheet** — `--card`, 14px radius on the top corners only, max height 85% of
   `viewportStableHeight`, its body scrolling.
3. **Title** — "Select period" 17px/600 `--ink`.
4. **Summary** — "from 9 Jul to 17 Jul 2026" 14px `--ink-secondary`. Reads
   "Choose a start date" before the first tap `[inferred]`.
5. **Quick chips** — "Last 7 days", "Last 30 days", "This month". 32px, 8px
   radius, `--separator` border. Tapping one fills both ends immediately.
6. **Weekday header** — 7 columns, 11px `--ink-secondary`, **sticky** below the
   summary while the grid scrolls. **Weeks start Monday** (2026-08-04, HUMAN):
   `Mon Tue Wed Thu Fri Sat Sun`. This must match `resolve_period`'s
   `period=week` bounds exactly — a picker whose weeks start on a different day
   than the Week tab is a bug users will find quickly. The reference starts on
   Sunday; we do not.
7. **Month sections** — each is a name ("August 2026", 15px/600, centred) above
   a 7-column grid. Cells are 40px tall; the grid is 6 rows so every month
   occupies the same height and scrolling does not jump.
   - The **month name is tappable** and opens a year list, so a user backdating
     an expense into 2024 does not scroll through 20 months (2026-08-04,
     HUMAN). This is what makes the picker's reach match the period selector's
     uncapped offset without needing virtualisation.
8. **Footer** — "Cancel" and "Apply", right-aligned, 15px/600, 44px tall.

### Cell states

| Cell | Appearance |
|---|---|
| Selectable | `--ink` text, transparent |
| Today | `--ink` text with a 1px `--ink` ring |
| Future | `--ink-secondary` at 40%, not tappable |
| Leading/trailing (other month) | not rendered — the cell is blank |
| Range start | `--ink` fill, `--card` text, left cap rounded |
| Range end | `--ink` fill, `--card` text, right cap rounded |
| In range | `--ink` at 12%, `--ink` text, square |
| Single (start = end) | `--ink` fill, fully round |

## Variants

| Variant | When used | What differs |
|---|---|---|
| Range | screen 01/05 "Period" tab | Two taps, span highlight, Apply needs both ends |
| Single date | screen 02's calendar button | One tap applies immediately and closes; no summary, no quick chips, no footer |

The single-date variant is the **same module** with a `mode` input, not a second
calendar. Two calendars in one app diverge.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Default | opened | Scrolled to the current month, nothing selected, Apply disabled |
| Start chosen | first tap | That cell filled; summary names it; Apply still disabled |
| Range chosen | second tap after the start | Span highlighted; summary shows both; Apply enabled |
| Re-anchoring | second tap **before** the start | Treated as a new start, previous end cleared — never a reversed range |
| Too long | span > `MAX_RANGE_DAYS` (366) | Span drawn, reason shown ("Choose a range of up to 366 days"), Apply stays disabled |
| Reopened | opened with a range already applied | That range selected and scrolled into view |

## Copy

| Key | String | Notes |
|---|---|---|
| `title` | "Select period" | sentence case, unlike the reference |
| `title.single` | "Select date" | `single` mode's sheet title (screen 02's calendar button) |
| `summary.none` | "Choose a start date" | |
| `summary.start` | "from {date}" | `{date}` includes the year (e.g. "from 9 Jul 2026") — no other context on screen names it yet |
| `summary.both` | "from {start} to {end}" | e.g. "from 9 Jul to 17 Jul 2026" |
| `quick.7` | "Last 7 days" | |
| `quick.30` | "Last 30 days" | |
| `quick.month` | "This month" | |
| `err.tooLong` | "Choose a range of up to 366 days." | names the number |
| `cancel` | "Cancel" | |
| `apply` | "Apply" | |

## Sizing and spacing
Cell 40×40px, grid gap 0 (the span must be continuous), month name `16px` above
its grid and `24px` below the previous one. Sheet padding `16px`. Footer buttons
44px tall.

## Accessibility
- The grid is a `grid` with `gridcell`s; each cell's accessible name is its full
  date ("4 August 2026"), never the bare number.
- Selection is carried by **fill and shape**, not hue — a greyscale reader still
  sees the span.
- Future cells are `aria-disabled`, present but not focusable.
- Arrow keys move by day, PageUp/PageDown by month; Escape cancels.
- Focus is trapped in the sheet while it is open and returns to whatever opened
  it on close.
- `prefers-reduced-motion`: the sheet appears without the slide-up.

## Inputs
Pure render, no fetching, no state.

```ts
interface DateRangePickerProps {
  mode: "range" | "single";
  value: { start?: string; end?: string };   // YYYY-MM-DD
  maxDate: string;                           // today, in family_tz — passed in,
                                             // never computed here
  maxRangeDays: number;                      // 366
  onChange(next: { start?: string; end?: string }): void;
  onApply(range: { start: string; end: string }): void;
  onCancel(): void;
}
```

`maxDate` is **passed in**, not derived from `new Date()` — the device clock is
not `family_tz`, and this component computes no boundaries. `monthGrid` lives in
`lib/period.ts` (U1.1) and returns 6×7 cells with leading/trailing days flagged.

## Acceptance criteria
- [ ] Opens scrolled to the current month with today ringed.
- [ ] The first tap sets the start and clears any previous end.
- [ ] A second tap **before** the start re-anchors the start instead of
      producing a reversed range.
- [ ] The highlighted span includes both chosen ends.
- [ ] Scrolling to another month preserves the selection.
- [ ] A span over 366 days shows the reason and leaves Apply disabled.
- [ ] Dates after `maxDate` are dimmed and do not respond to a tap.
- [ ] "Apply" is disabled until both ends are chosen.
- [ ] Apply fires exactly one callback with two `YYYY-MM-DD` strings.
- [ ] Cancel, the scrim and BackButton all close the picker and change nothing.
- [ ] In `single` mode, one tap applies and closes, and there is no footer.
- [ ] Every month section is the same height, so scrolling never jumps.
- [ ] Renders correctly in both themes from `tokens.css` only.

## Resolved
- **Bottom sheet**, not a centred dialog (2026-08-04, HUMAN).
- **Weeks start Monday** (2026-08-04, HUMAN), matching `resolve_period`.
- **Scroll extent**: the grid scrolls month by month and the **month heading
  opens a year list** for long jumps (2026-08-04, HUMAN). No virtualisation, no
  fixed window — which matters, because the period selector's offset is
  uncapped so that old expenses can be backdated, and a picker that stopped at
  24 months would be the tighter of the two controls.
- **No quick chips in the single-date variant** on screen 02 — its three date
  pills already cover today / yesterday / two days ago.

## Open questions
None. Global `[?]`s (safe-area insets, focus states) live in
`../design-system.md`.
