# Component: Colour picker

## Purpose
Choosing a category's own colour on `../screens/06b-category-form.md`. Two
parts that are one control: a **quick row** of seven circles plus a `+`, always
visible in the form, and a **full sheet** of all 72 slots behind that `+`.

It replaces the twelve-swatch named grid U2.2 shipped. The reason is scale: at
72 slots the old cell (64px circle + name + "In use" caption) is roughly nine
screens of scrolling, and the name under each circle stops being information
once the names are `Olive 3` rather than `Olive`. The circle is the label.

Not to be confused with `category-picker.md`, which picks *which category an
expense belongs to*. This picks *what colour a category is*. Different
selection model, different geometry, no shared code.

## Reference
- `../refs/color-picker/page-1.jpg` — greens and yellow-greens, 6 × 9 grid
- `../refs/color-picker/page-2.jpg` — teals through violets
- `../refs/color-picker/page-3.jpg` — violets through oranges
- `../refs/color-picker/page-4.jpg` — oranges, browns, greys; a short last page
- Verbal brief from the user, 2026-08-08: "initially show a small selection of
  7 small colored circles… with a gray `+` button next to them. When the user
  clicks the `+`, display a list of all available colors as small circles…
  scrollable/swipeable vertically."

## Delta from reference
- **Taking:** the dense grid of plain filled circles with no labels; 6 columns;
  the circle size relative to the viewport (`~34px` at a `~390px` width); the
  organisation by hue family down the page with lightness running left to right.
- **Changing:**
  - **Vertical scrolling, not horizontal paging** (user, 2026-08-08). The
    reference's four pages and their page-dot indicator are gone; all 72 slots
    are one scrolling grid. A paged control also has no answer for "which page
    is my current colour on", which a scroll position does.
  - **No "Select" button.** Tapping a circle selects it and closes the sheet
    (D503). The reference's tap-then-confirm costs a second tap on every use;
    this app already picks-and-closes everywhere else (currency rows on 08,
    quick chips on the date-range picker).
  - **A quick row in front of it.** The reference goes straight to the full
    grid; here the seven most-used colours are one tap away and the full grid
    is opt-in. Nothing in the reference corresponds to this.
  - **Every circle carries a 1px `--separator` ring.** The reference's ground
    is a warm off-white that its palette never approaches; ours is `--card`
    (`#FFFFFF` / `#1C2123`) and the ramp reaches both ends of the lightness
    scale, so `Slate 6` on white and `Olive 1` on the dark card would otherwise
    have no visible edge.
- **Explicitly not taking:** the reference's green title bar and its
  `Select Color` header (no screen in this app has a title bar); the page-dot
  indicator; its `Select` footer button; its back chevron (Telegram's
  BackButton is the only back affordance).

## Anatomy

### Part 1 — quick row (always visible in the form)
1. **Section label** — "Colour", 12px `--ink-secondary`, `12px` above the row.
2. **Row** — a single line, `space-between`, min 8px gap, never wraps and never
   scrolls. Eight items:
   - **Seven colour circles** — slots **1–7** (Blue, Orange, Aqua, Yellow, Pink,
     Green, Teal), fixed and in that order (D504). The same seven every time, so
     the row is muscle memory; they are also the only slots the server ever
     auto-assigns from, plus one.
   - **The `+` button** — last, always. 32px circle filled `--separator` with a
     16px `+` glyph in `--ink-secondary`. Opens the sheet.
3. **Overflow circle** — an 8th colour circle appears *before* the `+` when the
   currently-selected slot is not one of 1–7 (i.e. the user picked from the
   sheet, or is editing a category whose slot is 8–72). It shows the selected
   colour, selected. The row then holds 9 items. Without it, opening the form
   for a `Violet 3` category would show seven circles and no indication of the
   category's actual colour.

### Part 2 — full sheet (behind the `+`)
Reuses the date-range picker's sheet shell exactly (`date-range-picker.md`
anatomy 1–2): scrim `--ink` at 40%, `--card` sheet, 14px radius on the top
corners only, max height 85% of `viewportStableHeight`, 16px padding, body
scrolls. The slide-up is `drp-slide-up`, 200ms `ease-out`.

1. **Scrim** — tap dismisses without changing the selection.
2. **Title** — "Colour" 17px/600 `--ink`. `[inferred]` — the reference says
   "Select Color"; this matches the form's own section label instead, so the
   sheet reads as an expansion of that row rather than a new concept.
3. **Grid** — 6 columns, 16px column gap, 16px row gap, 32px circles. All 72
   slots in slot order: the named twelve first, then the ramp family by family.
   12 rows total. Scrolls vertically inside the sheet body.
4. **Selected marker** — the current slot's circle carries the checkmark badge
   (see States). Exactly one circle in the grid ever has it.
5. **No footer.** Nothing to confirm.

The grid is **not** virtualised — 72 absolutely-positioned-free circles is a
trivial DOM, and virtualising it would be the only virtualised list in the app.

## Variants

| Variant | When used | What differs |
|---|---|---|
| Default | 06b, create and edit | As above |
| Overflow | selected slot is 8–72 | Quick row gains the 8th circle (Anatomy, part 1.3) |
| Read-only | 403 viewer reaching the form | Row rendered at 50% opacity, inert; the `+` is hidden, not disabled — an affordance that opens nothing is worse than no affordance |

There is **no** "in use" variant. V5 removes the taken/available distinction
outright (D502, user 2026-08-08: "we do not need to display a list of occupied
and available colors"). Sharing a slot was always permitted; the caption only
narrated it, and at 72 slots the narration costs a row of text under every
circle to say something the user did not ask.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Default | — | Filled circle, 1px `--separator` ring, no badge |
| Selected | it is the draft's current slot | Checkmark badge: an 18px `--card` circle at the bottom-right corner with a 2px `--card` ring and a 10px check glyph in `--ink` — the exact badge `06b-category-form.md` already specifies, unchanged, so the two picker generations mark selection identically |
| Pressed | finger down | Circle at 0.7 opacity, same as `category-picker.md`'s swatch |
| Disabled | read-only variant | 50% opacity, no press feedback |
| Loading | — | n/a. The palette is static, compiled into the CSS; there is nothing to fetch and therefore no skeleton |
| Error | — | n/a. Selecting a colour issues no request; failures belong to the form's Save (`06b-category-form.md` States) |

## Copy

| Key | String | Notes |
|---|---|---|
| `colour.label` | "Colour" | section label above the quick row; existing string, reused verbatim |
| `colour.more.aria` | "More colours" | accessible name of the `+`; the button shows a glyph, never this text |
| `sheet.title` | "Colour" | sheet title `[inferred]` |
| `swatch.aria` | "{name}" | e.g. "Blue", "Olive 3" — the slot's Name from `design-system.md`, the only place those names surface now that no visible caption carries them |
| `swatch.aria.selected` | "{name}, selected" | appended for the current slot; also carried by `aria-checked`, deliberately doubled for clients that announce one but not the other |

## Sizing and spacing
Every value from `design-system.md`'s Sizing table and the closed spacing set:

| Element | Value |
|---|---|
| Circle | 32px diameter, 1px `--separator` ring, 50% radius |
| Hit target | 44 × 44px around every circle, including the `+` — the circle is 32px, the tappable button is not |
| Quick row | one line, `space-between`, min 8px gap, `12px` under the section label |
| `+` glyph | 16px box, 2px strokes, `--ink-secondary` |
| Sheet grid | 6 columns, 16px column gap, 16px row gap |
| Sheet | 16px padding, 14px top-corner radius, max 85% `viewportStableHeight` |
| Checkmark badge | 18px badge, 2px ring, 10px glyph |

At a 320px-wide card the quick row is 8 × 32px = 256px of circles and 7 gaps of
9px — above the 8px floor, so the row fits the narrowest realistic viewport
without wrapping. In the overflow variant (9 items) it is 288px of circles and
8 gaps of 4px, which is **under** the floor: at that width the row scrolls
horizontally rather than wrapping or shrinking the circles. `[inferred]` — the
one geometry here that a real device should confirm.

## Accessibility
- The quick row and the sheet grid are each a `radiogroup`; every circle is a
  `radio` with `aria-checked`. They are two views of one value — opening the
  sheet does not create a second selection.
- **Every circle's accessible name is its slot Name.** This is the whole
  accessibility budget of this component: removing the visible caption removes
  the only sighted text, so the `aria-label` is no longer a duplicate of
  something on screen — it is the sole carrier. A circle rendered without one
  is a defect, not a nicety.
- Colour is never identity on its own anywhere the choice *lands* — the
  category's dot always ships with its name on Home, Expenses, Budgets and
  Statistics. Inside this component the colour genuinely is the content, which
  is why the accessible name above is mandatory.
- Hit targets are 44 × 44px even though the circles are 32px.
- Visible focus ring on every circle and on the `+`.
- Arrow keys move within each grid and wrap by row, reusing
  `categories.ts::nextGridFocusIndex` — 6 columns in the sheet, one row in the
  quick row.
- Focus is trapped in the sheet while it is open and returns to the `+` when it
  closes, matching the date-range picker.
- `prefers-reduced-motion`: the sheet appears without the slide-up.

## Inputs
Pure render functions in `webapp/src/components/`; no fetching, no state.

| Input | Type | Effect |
|---|---|---|
| `selectedSlot` | `number \| null` | Which circle carries the badge; `null` (create mode, untouched) means none. Drives the overflow circle |
| `quickSlots` | `number[]` | The seven; a parameter rather than a constant so the sheet and the row share one render path and tests can assert the default is `[1..7]` |
| `disabled` | `boolean` | Read-only variant |
| `onSelect` | `(slot: number) => void` | Fired by any circle in either view. The host closes the sheet; the component does not own the sheet's open/closed flag |
| `onMore` | `() => void` | Fired by the `+`. Same shape as `category-picker.md`'s `onMore` |

## Acceptance criteria
- [ ] The form shows exactly one row of eight controls: seven colour circles in
      slot order 1–7, then a grey `+`. No names, no captions, no "In use".
- [ ] Tapping any of the seven selects it immediately — checkmark badge moves,
      no sheet opens, no request is made.
- [ ] Tapping the `+` opens a bottom sheet over a scrim containing 72 circles in
      6 columns, and the sheet's body scrolls vertically to reach the last row.
- [ ] Tapping a circle in the sheet selects it **and** closes the sheet in one
      action; the quick row then shows that colour selected, as an 8th circle
      before the `+` when it is not one of slots 1–7.
- [ ] Opening the form for a category whose slot is 8–72 shows that colour
      already present and selected in the quick row, without opening the sheet.
- [ ] Tapping the scrim closes the sheet and leaves the selection exactly as it
      was before the sheet opened.
- [ ] Every circle has an accessible name equal to its slot's Name from
      `design-system.md` ("Blue", "Olive 3"), and the selected one is
      additionally announced as selected.
- [ ] Every circle is visible against the card in both light and dark — the pale
      end against `#FFFFFF` and the dark end against `#1C2123` — because each
      carries the 1px `--separator` ring.
- [ ] Under `prefers-reduced-motion: reduce` the sheet appears with no slide.

## Open questions
- [?] **Quick-row overflow at 320px** — nine items put the gap under the 8px
      floor and the row scrolls horizontally. Only judgeable on a real narrow
      device; the alternative (wrap to a second line) is a one-line CSS change
      if scrolling reads badly.
- [?] **Sheet ordering.** The grid runs in slot order, so the named twelve sit
      in a block of two rows whose hues jump (Blue, Orange, Aqua, Yellow…)
      before the ramp's orderly families begin. Faithful to the slot numbering
      and stable forever, but the first two rows look unsorted next to the
      other ten. The alternative — interleaving the named twelve into their hue
      families — makes the grid prettier and the slot order unreadable.
      Deliberately chosen the stable one; flagged because it is the first thing
      a designer will notice.
