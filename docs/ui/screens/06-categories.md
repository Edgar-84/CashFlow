# Screen: 06 — Categories

## Purpose
Where a category's colour is chosen and where the account's categories are
listed, created, renamed, recoloured, archived or deleted. **This file
currently specs the list only (plan unit U2.1, "06a").** Create/rename/
recolour (U2.2, "06b") and delete-or-hide (U2.3, "06c") are separate units;
this screen's cell tap is stubbed (`// TODO`) until those units ship, and
their own layout/interaction detail belongs in a later pass of this file (or
a new `06b`/`06c` section), not invented here.

## Reference
- `../refs/06-categories/add-category-grid.jpg` — reference app's "Add
  Category" grid: 4 columns, circle-above-name, coloured icon fills, a grey
  "Create" cell trailing the grid. Supplied 2026-08-05.
- Verbal description from the user, 2026-08-05: a list of existing
  categories, colour + name; an affordance to create a new category;
  tapping an existing category opens a menu to change or delete it — the
  **grid shape** (not the row-list this brief originally implied) was
  confirmed against the reference image in the same session.
- `docs/design/mini-app-ux.md` §4 "06 — Categories" — the colour/delete
  intent (D301/D302/D311) and "each row doubles as a mini-report" framing —
  reinterpreted below as "each **cell** doubles as a mini-report" now that
  the shape is a grid, not rows.
- `docs/plans/mini-app-v3.md` U2.1/U2.2/U2.3 — the already-approved unit
  acceptance criteria this spec must satisfy.
- `../components/category-picker.md` — the 4-column grid, circle-above-name
  cell, and grey "More"-cell pattern this screen reuses and extends with a
  third caption line (see Delta).

## Delta from reference
- **Taking:** the reference's 4-column grid; circle above centred name; the
  trailing cell as a grey circle with a `+`, last in the grid.
- **Changing:**
  - The reference's circles hold a white line-art icon (basket, wallet,
    gift…); ours hold **no glyph** — plain colour only, per
    `design-system.md`'s Iconography (no icon set project-wide, resolved
    2026-08-04). This matches `category-picker.md`'s existing delta from the
    same style of reference.
  - Each cell gains a **third line** the reference does not have: a small
    caption showing the category's expense count and this-month total
    (`{count} · {amount}`) — required by the already-approved U2.1
    acceptance criteria ("each row doubles as a mini-report"), which a
    plain icon grid has no room for on its own. Resolved 2026-08-05 (see
    Resolved).
  - The reference's trailing cell reads "Create"; this app's copy table
    uses "Add category" instead, matching this project's fuller-word style
    elsewhere (e.g. "Add expense", not "Add"). `[inferred]` — cosmetic,
    easy to change.
- **Explicitly not taking:** the reference's app-bar title/back-arrow/search
  icon chrome (this app's screen has no in-page title bar, consistent with
  every other screen — BackButton and content only); `--accent` yellow for
  the add cell — `--accent` is reserved for exactly one element in the app
  (Home's floating Add-expense button, `design-system.md` line 39–41,
  human-confirmed 2026-08-04); the grey "More"/"Create" cell fill
  (`--separator`) is used instead, matching `category-picker.md`'s existing
  cell of the same kind — decided earlier in this same session, before the
  screenshot arrived, and unchanged by it.

## Layout
Top to bottom, one scroll container. Nothing on this screen is
`position: fixed` — no bottom nav here (unlike Home; matches every other
non-Home screen), and BackButton is native chrome.

| # | Region | Fixed / scrolls | Geometry |
|---|---|---|---|
| 1 | Offline banner | scrolls | full width, only in `offline` |
| 2 | Active categories grid | scrolls | 4 equal columns, 12px column gap, 16px row gap (`category-picker.md` values) |
| 3 | "Add category" cell | scrolls | same cell shape; always the grid's last cell |
| 4 | Archived section | scrolls | collapsed by default; header row + (expanded) explanation line + archived **rows** (list, not grid — see Resolved); **entire region absent when nothing is archived** |

### Active cell anatomy (region 2)
1. **Swatch** — 64px, filled `--category-slot-{n}` from `color_slot`,
   position fallback for `null` (`category-picker.md`'s existing rule,
   reused verbatim).
2. **Name** — 12px `--ink`, centred, reserves a fixed **two-line** height
   regardless of actual length (so captions in the same row stay aligned
   even when neighbouring names wrap differently), then ellipsis. `8px`
   under the swatch.
3. **Caption** (new, not in `category-picker.md`) — 11px `--ink-secondary`
   ("Caption" role, `design-system.md` Typography), centred, `4px` under
   the name's reserved area: `"{count} · {amount}"`, e.g. `"12 · $340"`.

### "Add category" cell (region 3)
Same column width as an active cell: swatch filled `--separator` with a
24px `+` in `--ink-secondary` (matches `category-picker.md`'s "More" cell
exactly); label "Add category" in the name position; **no caption line**.

### Archived section (region 4)
A tappable header row (section-eyebrow style, "Archived (`{n}`)", 10px,
600, uppercase, `--ink-secondary`, with a chevron that flips on expand — pure
client-side toggle, no fetch). Expanded, it shows one explanation line
(`archived.explain`) above the archived items, rendered as a **row list**
(colour dot · name · same count/total caption), not the grid — archived
items are secondary/rare and read like an appendix, not active choices
(decided 2026-08-05, see Resolved). Archived rows render at 60% opacity
`[inferred]`, chosen to read as "historical" rather than
`category-picker.md`'s "disabled" (also 50%, but for a different, inert
meaning).

## Components used
None from `../components/` directly — this screen's grid parallels
`category-picker.md`'s shape and reuses its swatch/cell/"More"-cell values,
but is its own render function (adds the caption line `category-picker.md`
does not have, and is not single-select/`radiogroup` — see Accessibility).

## Telegram
- **Theme:** every colour from `tokens.css`, both themes.
- **MainButton:** **hidden.** The "Add category" affordance lives in the
  grid itself (region 3); a MainButton would be a second, redundant entry
  point to the same not-yet-built action.
- **BackButton:** shown; always navigates to Home. This is the fix for the
  reported dead-tile bug — the Home "Categories" tile currently no-ops
  (`webapp/src/main.ts`'s `onTileTap`, "Categories/Tags land in a later
  milestone" comment); this unit removes that no-op for `categories` only.
- **Haptics:** `selection` on the Home "Categories" tile tap (matches every
  other tile, `home.ts`); `selection` on the archived-section expand/collapse
  toggle. No haptic on the cell-tap stubs — they do nothing yet.
- **Viewport:** no text entry on this screen; n/a.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | first open | 8 skeleton cells at 64px with 12px name bars and a small caption bar, in the final grid positions (matches `category-picker.md`'s Loading state, extended with the caption bar). No reflow when data lands. |
| Empty | zero categories | Grid holds **only** the "Add category" cell (matches `category-picker.md`'s "empty `items` array" rule), plus `empty` copy above the grid. |
| Error | the categories or statistics fetch rejects and there is no cache | `error.load` + `error.retry`. Never a raw status code. |
| 403 | `ForbiddenError` from the categories fetch | `readonly` copy in place of the grid; "Add category" cell **hidden**, not disabled (there is nothing to add to if the read itself is forbidden). |
| Offline | a fetch rejects and a cache snapshot exists | Last-loaded cells, `offline.banner` with the last-synced time. "Add category" cell still renders as a stub (it does not perform a write in this unit). |
| Populated | ≥1 active category | Cells ordered `created_at ASC` (`category-picker.md`'s ordering rule) `[inferred]` — no explicit order was stated; confirm if recency/alphabetical is wanted instead. |

## Interactions

| Element | Action | Result |
|---|---|---|
| Home "Categories" tile | tap | selection haptic; navigates here |
| BackButton | tap | navigates to Home |
| Active category cell | tap | **Stub in this unit**: `// TODO` no-op, same convention as `main.ts`'s current Categories/Tags tile handling. U2.2 wires this to open the edit/recolour/delete-menu screen (06b). |
| Archived category row | tap | same stub as above |
| "Add category" cell | tap | **Stub in this unit**: `// TODO` no-op. U2.2 wires this to open the create form (06b). |
| Archived section header | tap | expands/collapses the archived rows and explanation line in place; no fetch |
| Retry (error state) | tap | re-fetch |

## Copy

| Key | String | Notes |
|---|---|---|
| `empty` | "No categories yet" | verbatim, plan U2.1 AC |
| `error.load` | "Couldn't load your categories." | mirrors Home's `error.load` pattern |
| `error.retry` | "Try again" | existing string, unchanged |
| `readonly` | "You have read-only access to this account." | existing string, reused verbatim (Home) |
| `offline.banner` | "Offline — showing data from {time}" | existing string, reused verbatim |
| `add.label` | "Add category" | the grey cell's label |
| `add.aria` | "Add category" | accessible name; the `+` glyph alone is not one |
| `archived.header` | "Archived ({n})" | `n` = archived count |
| `archived.explain` | "Archived categories keep their history in reports, but you can't pick them for new expenses." | `[inferred]` — this is the plan's "plain-words explanation"; user should confirm or edit the exact wording |
| `cell.caption.one` | "1 · {amount}" | singular count |
| `cell.caption.many` | "{count} · {amount}" | plural count |

## Data

| Call | Params | Notes |
|---|---|---|
| `GET /categories` | `include_usage=true`, `include_archived=true` | names, `color_slot`, `is_active`, `expense_count` (all-time count — `repositories/category_repo.py::list_with_usage` has no date filter on the join). **Backend already returns all four fields** (`models/category.py::CategoryResponse`); `webapp/src/api/client.ts::listCategories()` and `webapp/src/api/types.ts::CategoryResponse` do not yet expose them — extending both is in scope for this unit, not a backend change. |
| `GET /statistics/by-category` | `period=month`, `offset=0` | this-month total per category (`CategoryTotal[]`). **Check before assuming zero-omission is safe**: Home's existing usage of this endpoint only ever renders categories present in the response; a category with a zero total this month may simply be absent from the array rather than returned with `total: 0`. This screen must treat "category id not present in the response" as `0`, not as an error or a missing cell. |
| `GET /users/me` | — | `currency`, for `formatAmount` |

## Accessibility
- The grid is a list of **navigation buttons**, not a `radiogroup` — unlike
  `category-picker.md`, tapping a cell here navigates away rather than
  selecting in place, so no `aria-checked`/`radio` semantics apply.
- Each active cell's accessible name includes the category name **and**
  its caption (count + this-month total) — e.g. "Groceries, 12 expenses,
  $340 this month" — so screen-reader users get the full mini-report even
  though sighted users see it as a compact caption line. The swatch is
  `aria-hidden`.
- The "Add category" cell's accessible name is "Add category"; its `+` is
  decorative and `aria-hidden`.
- The archived-section header is a real button with `aria-expanded`.
- Focus order: BackButton (native, outside this order) → grid cells,
  reading order (row by row) → "Add category" cell → archived-section
  header → archived rows (only when expanded).
- Arrow keys move within the grid, wrapping by row (matches
  `category-picker.md`).
- `prefers-reduced-motion`: disables the archived-section expand/collapse
  transition (instant show/hide instead).

## Edge cases
- **Long category name** — wraps to the reserved two-line name area, then
  ellipsis; the caption line and swatch never move or resize (matches
  `category-picker.md`'s wrap rule, extended to keep the caption aligned).
- **Category active with 0 expenses this month, but has history** — caption
  reads "0 · $0.00" for the month portion only if the month total is 0;
  the count portion still reflects the non-zero all-time `expense_count`.
  These are two independent numbers and must not be conflated (e.g. a
  category with 5 all-time expenses and none this month reads "5 · $0.00",
  never "0 · $0.00").
- **No archived categories** — the archived section (region 4) does not
  render at all, not even collapsed-and-empty.
- **All categories archived, none active** — the grid shows `empty` copy
  and the "Add category" cell; the archived section shows every category.
- **20+ categories** — already a flagged open question on
  `category-picker.md` (grid pushes content below the fold); same
  not-blocking status here.

## Acceptance criteria
- [ ] The Home "Categories" tile navigates to this screen; BackButton
      returns to Home (closes the reported dead-tile bug).
- [ ] Active categories render as a 4-column grid of 64px filled colour
      circles, each with its name centred underneath and a caption line
      below the name reading its all-time expense count and this-month
      total, sourced from `include_usage=true` and
      `GET /statistics/by-category`.
- [ ] No circle contains a glyph, letter, emoji or image — colour only.
- [ ] A category absent from the by-category response renders a `$0.00`
      caption, not an error and not a missing cell.
- [ ] With zero categories, the grid shows only the "Add category" cell,
      plus "No categories yet" above it.
- [ ] On a fetch failure with no cache, the screen shows "Couldn't load your
      categories." with a working "Try again", never a status code.
- [ ] On a 403 from the categories fetch, the screen shows the read-only
      message in place of the grid and the "Add category" cell is hidden —
      no broken/dead button is shown.
- [ ] Offline with a cache present shows the last-loaded grid and a banner
      naming the last-synced time.
- [ ] The archived section is entirely absent when no category is archived,
      and shows a plain-words explanation plus the archived rows (a list,
      not a grid) when expanded.
- [ ] An archived category is never offered anywhere a category is *chosen*
      — already satisfied today by `category-picker.md`'s `items` contract
      (archived excluded) and `include_archived` defaulting to `false`
      everywhere except this screen's own listing call; this criterion is a
      regression check, not new work.
- [ ] No element on this screen uses `--accent` (yellow) — the "Add
      category" cell is the grey `--separator` circle described above.
- [ ] Loading shows 8 skeleton cells at 64px with name and caption bars, in
      the final grid positions, with no reflow when data lands.
- [ ] A category name of 30 characters wraps to two lines and ellipses
      without moving the caption line or misaligning the row.
- [ ] Rendering is correct in both light and dark, with every colour
      resolved from `tokens.css`.

## Resolved
- **Grid, not a row list** (2026-08-05, HUMAN). The original verbal brief
  described rows; a reference screenshot of another app's "Add Category"
  grid was supplied in the same session, and the user chose to switch this
  screen to that 4-column grid shape, reusing `category-picker.md`'s
  existing cell pattern rather than inventing a new one.
- **Per-category stats survive as a small caption inside the cell**
  (2026-08-05, HUMAN). The grid shape has no natural row for a count/total
  the way a list would; the user chose to keep the mini-report requirement
  (already in the approved U2.1 acceptance criteria) as a third caption
  line rather than dropping it from this unit's scope.
- **The add affordance is grey, not yellow** (2026-08-05, HUMAN). `--accent`
  stays Home's Add-expense button only, unchanged by the later screenshot.
- **Archived categories stay a row list, not a second grid** (2026-08-05,
  HUMAN). They are secondary/rare and read as an appendix under a collapsed
  header, not a set of equally-weighted active choices.
- **No MainButton on this screen** (this session) — the add affordance is
  in-grid (region 3); a MainButton would be a second, redundant entry point
  to the same not-yet-built action.

## Open questions
- [?] **U2.3's delete-or-hide confirmation is unspecified beyond "stub".**
      Needs its own layout pass (a new `06c` file) once that unit is taken
      up — not blocking for U2.1 or U2.2.
      ~~Cell/row destinations are unspecified beyond "stub"~~ — **U2.2's
      create/rename/recolour form is now specced**: see
      `06b-category-form.md`.
- [?] **Grid order** — `created_at ASC` is `[inferred]` from
      `category-picker.md`'s precedent, not stated by the user. Confirm, or
      specify recency/alphabetical instead.
- [?] **Archived row opacity (60%)** is `[inferred]`. Sanity-check on a real
      device.
- [?] **"Add category" vs the reference's "Create"** — cosmetic copy choice,
      `[inferred]`, easy to change in the Copy table.
- [?] **Zero-omission on `/statistics/by-category`** — needs a quick check
      against the actual endpoint/service before implementation, not just
      an assumption from Home's usage pattern.
