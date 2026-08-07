# Component: Category picker

## Purpose
The grid of categories on `../screens/02-add-expense.md`. Single-select,
required. A category is a **filled circle in its own colour with its name
underneath** — the pair is the identity, and the two are never separated.

## Reference
- `../refs/02-add-expense/empty-keypad.jpg` — the grid with nothing selected
- `../refs/02-add-expense/filled.jpg` — "Транспорт" selected, shown as a rounded
  square
- Verbal brief from the user, 2026-08-04

## Delta from reference
- **Taking:** the 4-column grid; circle above centred name; the selected cell
  becoming a **rounded square** instead of a circle; the trailing "More" cell
  drawn as a grey circle with a `+`.
- **Changing:** the circles hold **no glyph** — the reference draws a white
  line-art icon in each (basket, bus, cigarette…). Ours are plain colour,
  because there is no icon set and no `categories.icon` column, and colour is
  user-chosen instead (design-system Iconography, resolved 2026-08-04).
- **Explicitly not taking:** the reference's icon vocabulary; its long-press
  reorder; its horizontal paging between category groups.

## Anatomy
1. **Section label** — "Categories", 12px `--ink-secondary`, `12px` above the
   grid.
2. **Grid** — 4 equal columns, 12px column gap, 16px row gap.
3. **Cell** — a button, full column width, contents centred:
   - **Swatch** — 64px, filled with `--category-slot-{n}` from the category's
     `color_slot`; falls back to position-in-list when the slot is `NULL`
     (D301/D206).
   - **Name** — 12px `--ink`, centred, max two lines then ellipsis, `8px` under
     the swatch.
4. **"More" cell** — always last. Swatch filled `--separator` with a 24px `+`
   in `--ink-secondary`; label "More".

## Variants

| Variant | When used | What differs |
|---|---|---|
| Default | screen 02 | As above |
| Read-only | 403 viewer | Cells rendered at 50% opacity, inert, "More" hidden |
| Archived-selected | screen 02b (U1.4), the expense's own category was archived after the fact | That one cell only: dimmed to 50% opacity and `disabled`, but still drawn **selected** (rounded square, 600 weight). Appended after every active cell, before "More". Independent of the grid's own `disabled` prop |

## States

| State | Trigger | What the user sees |
|---|---|---|
| Default | — | Circle, name in 400 weight |
| Selected | tapped | Swatch becomes a **12px-radius rounded square**, same colour and size; name goes 600 weight |
| Pressed | finger down | Swatch at 0.7 opacity |
| Disabled | read-only | 50% opacity, no press feedback |
| Loading | data not in yet | 8 swatch skeletons at 64px with 12px name bars, in the final grid positions |
| Error | fetch failed | The grid is replaced by the host's error block — the component renders nothing |

Selection is **shape + weight**, never colour alone. That is not a concession to
accessibility rules; it is the only thing that works here, because the colour is
already saying "which category" and cannot also say "chosen".

## Copy

| Key | String | Notes |
|---|---|---|
| `label` | "Categories" | section label |
| `more` | "More" | the trailing cell |
| `aria.more` | "Manage categories" | the glyph alone is not an accessible name |
| `empty` | "Create your first category to add an expense." | grid holds only "More" |

## Sizing and spacing
Swatch 64px (design-system Sizing). Cell hit target is the full column width ×
(64 + 8 + name height), comfortably over 44px. Grid gaps 12px / 16px. Selected
square radius 12px.

## Accessibility
- The grid is a `radiogroup`; each cell is a `radio` with `aria-checked`. "More"
  is **outside** the radiogroup — it is a navigation button, not an option.
- Each cell's accessible name is the category name alone; the swatch is
  `aria-hidden`.
- Arrow keys move within the grid, wrapping by row.
- Visible focus ring on the swatch, not the whole cell.
- `prefers-reduced-motion`: the circle→square change is instant, with no morph.

## Inputs
Pure render function. No fetching, no state.

```ts
interface CategoryPickerItem {
  id: Uuid;
  name: string;
  colorVar: string;          // "var(--category-slot-3)", resolved by the caller
  archived?: boolean;        // 02b's Archived-selected variant (U1.4) — dimmed, never tappable
}

interface CategoryPickerProps {
  items: CategoryPickerItem[];   // already sorted created_at ASC, archived excluded
  selectedId: Uuid | null;
  disabled?: boolean;
  onSelect(id: Uuid): void;
  onMore(): void;
}
```

The caller resolves `color_slot` → CSS variable (`lib/category-colors.ts`) and
does the sorting and the archived filter. This component only draws.

## Acceptance criteria
- [ ] Renders a 4-column grid of 64px filled circles, each with its category
      name centred underneath.
- [ ] No circle contains a glyph, letter, emoji or image.
- [ ] Each circle's fill is its category's slot colour, and two categories
      sharing a slot render the same colour without error.
- [ ] Tapping a cell turns its circle into a 12px-radius rounded square of the
      same size and colour, and bolds its name.
- [ ] Exactly one cell can be selected at a time.
- [ ] The last cell always reads "More" and calls `onMore`, never `onSelect`.
- [ ] With an empty `items` array only the "More" cell renders, above the empty
      copy.
- [ ] A category name of 30 characters wraps to two lines and then ellipses,
      without changing the swatch size or misaligning the row.
- [ ] With `disabled`, no tap fires a callback and "More" is not rendered.
- [ ] Renders correctly in both themes; category colours are identical in
      structure and differ only by token value.

## Resolved
- **Ordering stays `created_at ASC`** (2026-08-04), not recently-used. It is
  what keeps the `NULL`-slot colour fallback stable, and a grid that reorders
  itself between visits destroys the muscle memory that makes this screen fast.

## Open questions
- [?] With 20+ categories the grid pushes the date row well below the fold.
      Cap the grid at N rows with a "show all"? N undecided. Not blocking —
      the fold only bites at a category count no account has yet.
