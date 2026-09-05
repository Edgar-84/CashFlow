# Screen: 07 — Tags

## Purpose
Where the account's tags are listed, and where creating, renaming, hiding or
deleting one will be reached from. **This file currently specs the list only
(plan unit U2.4, "07a").** Create/rename and delete-or-hide ("07b", U2.5) are a
separate unit; this screen's row tap and its "Add tag" affordance are stubbed
(`// TODO`) until that unit ships, exactly the convention
`docs/ui/screens/06-categories.md` set for 06a/06b.

## Reference
- No screenshot for this screen. Built from:
  - `docs/design/mini-app-ux.md` §4 "07 — Tags" — the states list, the D302/D305
    delete and usage-count rules, and the "no tags yet" empty-state intent.
  - `docs/plans/mini-app-v3.md` U2.4 — the already-approved acceptance criteria
    this spec must satisfy ("mirror of U2.1 without colour").
  - `docs/ui/screens/06-categories.md` (06a) — the sibling spec this mirrors:
    same five states, same archived-section shape, same `include_usage=true`
    fetch (rendered nowhere, per D703, but still driving hide-vs-delete),
    same stub-tap convention for the not-yet-built destination screen.

## Delta from reference
There is no visual reference image to delta against; the delta here is against
**06a**, the screen this one parallels:
- **Taking:** the list shape as a whole — active items, a collapsible archived
  section with a plain-words explanation, the same five states, the same
  stub-tap convention for the not-yet-built create/edit destination. **No
  caption** — this file originally mirrored 06a's per-item `{count} ·
  {amount}` caption (sourced from `include_usage=true` plus a by-period
  totals call), but that was removed from both screens in the same revision
  that removed it from 06a, per D703 (2026-08-25, see Resolved).
- **Changing:** **rows, not a 4-column grid.** 06a's grid exists to hold a
  64px colour swatch — the one thing this screen doesn't have (tags carry no
  `color_slot`). A grid of blank cells has nothing to justify the fourth
  column, so this screen reuses Home's plain `.row`/`.nm` row shape instead
  (`app.css`'s existing `.row`, `home.ts::renderRankedRows`), with no `.val`
  and no `.swatch` at all — the first place in the app a row renders with
  **no** leading dot, so identity here is carried by name and position alone
  (there is nothing colour ever carried on this screen to begin with).
- **Explicitly not taking:** 06a's swatch, its 4-column keyboard navigation
  (`nextGridFocusIndex`/`GRID_COLUMNS`) — a single-column list needs only
  Up/Down, which is native `<div role="button">` tab order, nothing bespoke;
  the design doc's empty-state "three starters" (see Resolved) — not built in
  this unit.

## Layout
Top to bottom, one scroll container. Nothing on this screen is
`position: fixed` — no bottom nav here (matches every other non-Home screen),
and BackButton is native chrome.

| # | Region | Fixed / scrolls | Geometry |
|---|---|---|---|
| 1 | Offline banner | scrolls | full width, only in `offline` |
| 2 | Active tags list | scrolls | `.row` cards, 12px gap (matches `06-categories.md`'s grid gap and Home's `.ranked-rows`) |
| 3 | "Add tag" row | scrolls | same row shape; always the list's last active-section item |
| 4 | Archived section | scrolls | collapsed by default; header row + (expanded) explanation line + archived rows; **entire region absent when nothing is archived** |

### Active row anatomy (region 2)
A `.row` card (`app.css`'s existing class, `10px 13px` padding, matches
Home's ranked rows and 06a's archived rows):
1. **Name** — 13.5px 600 `--ink` (Row title role), left-aligned, ellipsis on
   overflow, single line (unlike 06a's swatch cells, a row has no reserved
   two-line height to protect — nothing beneath the name would misalign).

No second element. No caption (D703) — the row is the name alone.

### "Add tag" row (region 3)
Same `.row` shape as an active row: a 24px `+` (the project's one shared `+`
glyph, `design-system.md` Iconography) in `--ink-secondary` at the leading
position where a category row would have no swatch anyway, label "Add tag" in
the name position, **no caption**.

### Archived section (region 4)
Identical shape to 06a's: a tappable header row (section-eyebrow style,
"Archived (`{n}`)", 10px, 600, uppercase, `--ink-secondary`, chevron flips on
expand, pure client-side toggle, no fetch). Expanded, one explanation line
above the archived rows, which render at 60% opacity — same rationale as 06a
(historical, not disabled).

## Components used
None from `../components/` — this screen reuses `app.css`'s existing `.row`
class (already shared by Home's ranked rows and 06a's archived rows) rather
than a component from `../components/`, same non-component status 06a's own
grid has.

## Telegram
- **Theme:** every colour from `tokens.css`, both themes.
- **MainButton:** **hidden.** The "Add tag" affordance lives in the list itself
  (region 3), same reasoning as 06a — a MainButton would be a second, redundant
  entry point to a not-yet-built action.
- **BackButton:** shown; returns one step, to whichever screen opened this
  one — Home's side menu, or the expense composer (Add expense / Edit
  expense) when reached via its "+ Add tag" cell, which the return restores
  with the in-progress draft intact and the new tag pre-selected
  (`../navigation.md`, D805). The Home-opened path is what finally makes the
  Home "Tags" tile do something — `main.ts`'s `onTileTap` currently no-ops
  for `tags` (`"Tags lands in a later unit (U2.4)"`); this unit removes that
  no-op.
- **Haptics:** `selection` on the Home "Tags" tile tap (matches every other
  tile); `selection` on the archived-section expand/collapse toggle. No haptic
  on the row-tap/"Add tag" stubs — they do nothing yet, matching 06a's rule for
  its own stubs.
- **Viewport:** no text entry on this screen; n/a.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | first open | 6 skeleton rows at the real row height (`~40px [inferred]` — a swatch-less single-line `.row`'s actual rendered height: `10px 13px` padding plus one line of 13.5px text, unlike 06a's 56px which is sized around its 36px swatch), no reflow when data lands. |
| Empty | zero tags (active and archived) | `empty.explain` above the list, explaining what a tag is *for* — before the "Add tag" row, never after (plan U2.4 AC). The list holds **only** the "Add tag" row. |
| Error | the tags or statistics fetch rejects and there is no cache | `error.load` + `error.retry`. Never a raw status code. |
| 403 | `ForbiddenError` from the tags fetch | `readonly` copy in place of the list; "Add tag" row **hidden**, not disabled — same rule as 06a's "Add category" cell. |
| Offline | a fetch rejects and a cache snapshot exists | Last-loaded rows, `offline.banner` with the last-synced time. "Add tag" row still renders as a stub. |
| Populated | ≥1 active tag | Rows ordered `created_at ASC` (matches 06a's ordering, same `[inferred]` status — not stated by the user, confirm if recency/alphabetical is wanted instead). |

## Interactions

| Element | Action | Result |
|---|---|---|
| Home "Tags" tile | tap | selection haptic; navigates here |
| BackButton | tap | one step back — Home, or the expense composer with its draft intact, whichever opened this screen (`../navigation.md`) |
| Active tag row | tap | **Stub in this unit**: `// TODO` no-op, same convention as 06a's active-cell stub. U2.5 wires this to open the rename/delete-or-hide surface ("07b"). |
| Archived tag row | tap | same stub as above |
| "Add tag" row | tap | **Stub in this unit**: `// TODO` no-op. U2.5 wires this to open the create form. |
| Archived section header | tap | expands/collapses the archived rows and explanation line in place; no fetch |
| Retry (error state) | tap | re-fetch |

## Copy

| Key | String | Notes |
|---|---|---|
| `empty.explain` | "Tags cut across categories — add #vacation to a café, a flight and a hotel, and see it as one thing." | `[inferred]` — explains what a tag is *for*, per the plan AC; user should confirm or edit the exact wording |
| `error.load` | "Couldn't load your tags." | mirrors 06a's `error.load` pattern |
| `error.retry` | "Try again" | existing string, unchanged |
| `readonly` | "You have read-only access to this account." | existing string, reused verbatim |
| `offline.banner` | "Offline — showing data from {time}" | existing string, reused verbatim |
| `add.label` | "Add tag" | the row's label |
| `add.aria` | "Add tag" | accessible name; the `+` glyph alone is not one |
| `archived.header` | "Archived ({n})" | `n` = archived count, matches 06a |
| `archived.explain` | "Archived tags keep their history in reports, but you can't pick them for new expenses." | `[inferred]`, mirrors 06a's `archived.explain` with "tags" swapped for "categories" |

## Data

| Call | Params | Notes |
|---|---|---|
| `GET /tags` | `include_usage=true`, `include_archived=true` | names, `is_active`, `expense_count` (all-time count — `repositories/tag_repo.py::list_with_usage` mirrors the category one, no date filter on the join, D305). **Backend already returns both fields** (`models/tag.py::TagResponse`); `webapp/src/api/client.ts::listTags()` takes no options and `webapp/src/api/types.ts::TagResponse` does not yet expose `is_active`/`expense_count` — extending both to match `listCategories`'s existing `{ includeUsage, includeArchived }` shape is in scope for this unit, not a backend change. **`include_usage=true` stays on this call even though `expense_count` is never rendered here (D703)** — same reason as 06a: it drives the hide-vs-delete branch on the eventual edit/delete surface (07b, D305), unrelated to what renders. |
| `GET /statistics/by-tag` | `period=month`, `offset=0` | this-month total per tag (`TagTotal[]`). **No longer has a consumer on this screen (D703)** — same as 06a's `/statistics/by-category`, its only purpose was the removed caption's amount half. Whether the implementing unit keeps this call (unused) or drops it is an implementation choice, not decided here. |
| `GET /users/me` | — | `currency`, for `formatAmount` |

## Accessibility
- The list is a set of **navigation buttons**, not a `radiogroup` — a row tap
  navigates away rather than selecting in place, same as 06a's active cells.
- Each active row's accessible name is the tag name **alone** — e.g.
  "vacation" — matching what a sighted user sees; count and this-month total
  are not surfaced anywhere on this screen (D703), same as 06a.
- The "Add tag" row's accessible name is "Add tag"; its `+` is decorative and
  `aria-hidden`.
- The archived-section header is a real button with `aria-expanded`.
- Focus order: BackButton (native, outside this order) → active rows, top to
  bottom → "Add tag" row → archived-section header → archived rows (only when
  expanded). No custom Left/Right/Up/Down handling is needed — a single-column
  list's native tab order already matches this, unlike 06a's 4-column grid.
- `prefers-reduced-motion`: disables the archived-section expand/collapse
  transition (instant show/hide instead), matching 06a.

## Edge cases
- **Long tag name** — ellipses on its single line (matches Home's ranked-row
  `.nm` ellipsis rule). Unlike 06a's two-line reserved name area, a row has
  no sibling geometry below the name to protect, so a single-line ellipsis is
  enough.
- **Unused tag (0 expenses)** — renders identically to any other tag row
  (name only, D703); `expense_count = 0` is still fetched and, once 07b
  ships, drives that surface's delete-not-hide branch (D305) — it just has
  nothing to render here.
- **No archived tags** — the archived section (region 4) does not render at
  all, not even collapsed-and-empty.
- **All tags archived, none active** — the list shows `empty.explain` and the
  "Add tag" row; the archived section shows every tag.
- **20+ tags** — not blocking, same not-blocking status 06a's grid has for
  20+ categories.

## Acceptance criteria
- [ ] The Home "Tags" tile navigates to this screen; BackButton returns to
      Home when opened from that tile (the previously dead tile, closed), or
      to the expense composer with its draft intact when opened from its
      "+ Add tag" cell (`../navigation.md`).
- [ ] Active tags render as a list of rows, each showing its name only. No
      count or amount is shown anywhere on this screen (D703).
- [ ] `GET /tags` still sends `include_usage=true` even though `expense_count`
      is never rendered here — it drives the hide-vs-delete branch on the
      eventual edit/delete surface (D305), unchanged by D703.
- [ ] With zero tags, the list shows only the "Add tag" row, plus
      `empty.explain` above it, explaining what a tag is for **before** the
      row that offers to create one.
- [ ] On a fetch failure with no cache, the screen shows "Couldn't load your
      tags." with a working "Try again", never a status code.
- [ ] On a 403 from the tags fetch, the screen shows the read-only message in
      place of the list and the "Add tag" row is hidden — no broken/dead
      button is shown.
- [ ] Offline with a cache present shows the last-loaded rows and a banner
      naming the last-synced time.
- [ ] The archived section is entirely absent when no tag is archived, and
      shows a plain-words explanation plus the archived rows when expanded.
- [ ] Loading shows 6 skeleton rows at the real row height, with no reflow
      when data lands.
- [ ] A tag name of 30 characters ellipses on one line without misaligning
      the row.
- [ ] Each active row's accessible name is the tag name alone (D703).
- [ ] Rendering is correct in both light and dark, with every colour resolved
      from `tokens.css`.

## Resolved
- **The per-row caption is removed entirely — count included, not just the
  amount** (2026-08-25, HUMAN, D703). This file originally mirrored 06a's
  caption when first written; both screens drop it in the same revision. The
  row is the name alone. `include_usage=true` keeps being sent on `GET /tags`
  regardless — it drives hide-vs-delete (D305), a concern unrelated to what
  renders.
- **Rows, not a grid** (this session). 06a's 4-column grid exists to hold a
  colour swatch; tags have no `color_slot`, so a grid here would have an empty
  fourth column with nothing to justify it. Reuses Home's existing `.row`
  shape instead.
- **The design doc's "three starters" empty state is deferred to U2.5**
  (this session). `docs/design/mini-app-ux.md` §4 describes the empty state as
  explaining what a tag is for "then offer three starters" — named suggestion
  chips that presumably create a tag on tap. This unit (U2.4) is list-only,
  same scope boundary 06a drew for 06b's create form; a tappable suggestion
  that does not yet create anything would be a broken affordance, worse than
  no suggestion at all. This spec's empty state names what a tag is for and
  offers the generic "Add tag" row (itself a stub until U2.5); the three
  starter chips are U2.5's to design and build alongside the real
  `POST /tags` call.
- **No MainButton on this screen** (this session) — mirrors 06a exactly; the
  add affordance is in-list (region 3).

## Open questions
- [?] **Row order** — `created_at ASC` is `[inferred]` from 06a's precedent,
      not stated by the user. Confirm, or specify recency/alphabetical
      instead.
- [?] **Archived row opacity (60%)** is `[inferred]`, inherited from 06a.
      Sanity-check on a real device.
- [?] **`empty.explain` exact wording** — `[inferred]`, easy to change in the
      Copy table.
- ~~[?] **Zero-omission on `/statistics/by-tag`**~~ — **moot (2026-08-25,
      D703)**: the caption that consumed this data is removed; nothing on
      screen renders a monthly total for this to affect.
