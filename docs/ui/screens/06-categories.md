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
  intent (D301/D302/D311). Its "each row doubles as a mini-report" framing
  drove an earlier pass of this file (a third caption line, once
  reinterpreted as "each **cell** doubles as a mini-report" for the grid
  shape); that framing no longer applies to this screen — see Delta, D703.
- `docs/plans/mini-app-v3.md` U2.1/U2.2/U2.3 — the already-approved unit
  acceptance criteria this spec must satisfy.
- `../components/category-picker.md` — the 4-column grid, circle-above-name
  cell, and grey "More"-cell pattern this screen reuses (see Delta).

## Delta from reference
- **Taking:** the reference's 4-column grid; circle above centred name; the
  trailing cell as a grey circle with a `+`, last in the grid.
- **Changing:**
  - The reference's circles hold a white line-art icon (basket, wallet,
    gift…); ours hold **no glyph** — plain colour only, per
    `design-system.md`'s Iconography (no icon set project-wide, resolved
    2026-08-04). This matches `category-picker.md`'s existing delta from the
    same style of reference.
  - **No third caption line.** An earlier pass of this spec (2026-08-05)
    added one showing the category's expense count and this-month total
    (`{count} · {amount}`), required by the then-approved U2.1 acceptance
    criteria ("each row doubles as a mini-report"). The human later decided
    that information is unnecessary on this screen and it was removed in
    full — count included, not just the amount — per D703 (2026-08-25, see
    Resolved). The cell is swatch + name only, same two-part shape the
    reference itself uses.
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
   regardless of actual length (so cells in the same row stay the same
   height even when neighbouring names wrap differently), then ellipsis.
   `8px` under the swatch.

No third line (D703 — see Delta and Resolved). The cell is exactly these
two parts.

### "Add category" cell (region 3)
Same column width as an active cell: swatch filled `--separator` with a
24px `+` in `--ink-secondary` (matches `category-picker.md`'s "More" cell
exactly); label "Add category" in the name position; **no caption line**.

### Archived section (region 4)
A tappable header row (section-eyebrow style, "Archived (`{n}`)", 10px,
600, uppercase, `--ink-secondary`, with a chevron that flips on expand — pure
client-side toggle, no fetch). Expanded, it shows one explanation line
(`archived.explain`) above the archived items, rendered as a **row list**
(colour dot · name, no caption — D703), not the grid — archived
items are secondary/rare and read like an appendix, not active choices
(decided 2026-08-05, see Resolved). Archived rows render at 60% opacity
`[inferred]`, chosen to read as "historical" rather than
`category-picker.md`'s "disabled" (also 50%, but for a different, inert
meaning).

## Components used
None from `../components/` directly — this screen's grid parallels
`category-picker.md`'s shape and reuses its swatch/cell/"More"-cell values,
but is its own render function (it navigates on tap rather than
single-selecting, so it is not `radiogroup` — see Accessibility).

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
| Loading | first open | 8 skeleton cells at 64px with 12px name bars, in the final grid positions (matches `category-picker.md`'s Loading state). No reflow when data lands. |
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

## Data

| Call | Params | Notes |
|---|---|---|
| `GET /categories` | `include_usage=true`, `include_archived=true` | names, `color_slot`, `is_active`, `expense_count` (all-time count — `repositories/category_repo.py::list_with_usage` has no date filter on the join). **Backend already returns all four fields** (`models/category.py::CategoryResponse`); `webapp/src/api/client.ts::listCategories()` and `webapp/src/api/types.ts::CategoryResponse` do not yet expose them — extending both is in scope for this unit, not a backend change. **`include_usage=true` stays on this call even though `expense_count` is never rendered here (D703)** — it is what lets the eventual edit/delete surface (06b/06c) choose the hide-vs-delete branch without a second fetch (D305); dropping the flag would silently break that, not just the caption. |
| `GET /statistics/by-category` | `period=month`, `offset=0` | this-month total per category (`CategoryTotal[]`). **No longer has a consumer on this screen (D703)** — its only purpose was the removed caption's amount half. Whether the implementing unit keeps the call (unused) or drops it along with `monthTotalMinor` is an implementation choice for U1.1, not decided here; either way there is nothing left on screen for a zero-omission bug to affect. |
| `GET /users/me` | — | `currency`, for `formatAmount` |

## Accessibility
- The grid is a list of **navigation buttons**, not a `radiogroup` — unlike
  `category-picker.md`, tapping a cell here navigates away rather than
  selecting in place, so no `aria-checked`/`radio` semantics apply.
- Each active cell's accessible name is the category name **alone** — e.g.
  "Groceries" — matching what a sighted user sees; count and this-month
  total are not surfaced anywhere on this screen (D703). The swatch is
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
  ellipsis; the swatch never moves or resizes (matches `category-picker.md`'s
  wrap rule).
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
      circles, each with its name centred underneath. No count or amount is
      shown anywhere on this screen (D703).
- [ ] No circle contains a glyph, letter, emoji or image — colour only.
- [ ] `GET /categories` still sends `include_usage=true` even though
      `expense_count` is never rendered here — it drives the hide-vs-delete
      branch on the edit/delete surface (D305), unchanged by D703.
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
- [ ] Loading shows 8 skeleton cells at 64px with name bars, in the final
      grid positions, with no reflow when data lands.
- [ ] A category name of 30 characters wraps to two lines and ellipses
      without misaligning the row.
- [ ] Each active cell's accessible name is the category name alone (D703).
- [ ] Rendering is correct in both light and dark, with every colour
      resolved from `tokens.css`.

## Resolved
- **The per-cell caption is removed entirely — count included, not just the
  amount** (2026-08-25, HUMAN, D703). Superseding the 2026-08-05 decision
  below to add it: the human confirmed "removing the entire {quantity} ·
  {amount} heading […] it is unnecessary information in those places." The
  cell reverts to swatch + name only. `include_usage=true` keeps being sent
  on `GET /categories` regardless — it drives hide-vs-delete (D305), a
  concern unrelated to what renders.
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
- ~~[?] **U2.3's delete-or-hide confirmation is unspecified beyond "stub".**~~
      — **answered (2026-08-06, U2.3 prep)**: see `06c-category-delete.md`.
      The trigger lives at the bottom of `06b-category-form.md`'s edit mode,
      not as a new affordance on this screen's grid; this screen's active-cell
      tap stays wired to opening 06b (unchanged), and the archived-row tap
      stays a stub (un-archiving is out of scope, D312).
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
- ~~[?] **Zero-omission on `/statistics/by-category`**~~ — **moot (2026-08-25,
      D703)**: the caption that consumed this data is removed; nothing on
      screen renders a monthly total for this to affect.
