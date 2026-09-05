# Screen: 06b — Category form (create / rename / recolour)

## Purpose
One form surface for both creating a new category and editing an existing
one's name and colour — reached from `06-categories.md`'s grid: the "Add
category" cell opens it empty (create), an active or archived cell opens it
pre-filled (edit). Plan unit U2.2.

## Reference
No screenshot exists for this sub-screen (unlike 06a's grid, which had
`../refs/06-categories/add-category-grid.jpg`). This spec is derived entirely
from written intent:
- `docs/design/mini-app-ux.md` §4 "06 — Categories" — MainButton = Save
  enabled only when dirty; duplicate name warns, never blocks (D311/MVP D19);
  confirmations are Telegram's own popup. **Superseded in one place**: that
  section says "the picker is the six palette swatches… no seventh hue" —
  D317 (2026-08-04, HUMAN) supersedes this, growing the picker to **twelve**
  swatches with the user choosing the slot.
- `docs/plans/mini-app-v3.md` U2.2 unit description and STATE note — the
  already-approved acceptance criteria this spec must satisfy.
- `../components/color-picker.md` — **the colour picker, as of V5.** It owns
  region 3 entirely: the seven-circle quick row, the `+`, and the 72-slot
  sheet behind it. This file states where that component sits and what the
  form does with its output; it no longer describes swatches itself.
- `../components/category-picker.md` — the swatch/circle/name pattern the V3
  picker extended from 6 to 12 swatches. Historical: V5 replaced that grid
  (see Delta and the V5 addendum).
- `../screens/02-add-expense.md` — the section-label + underlined-field
  pattern (`Comment` field) this screen's `Name` field reuses.
- `../screens/06-categories.md` — the active/archived cell data (`name`,
  `color_slot`) this screen is navigated to with, already loaded there.

## Delta from reference
- **Taking:** `category-picker.md`'s 64px filled-circle swatch and 4-column
  grid geometry (12px column gap, 16px row gap); `02-add-expense.md`'s
  section-label-plus-underlined-field pattern for the `Name` field.
- **Changing:** ~~the picker grows from 6 swatches (one row) to **12** (three
  rows of 4, D317)~~ — **superseded in V5**: region 3 is now the quick
  row + sheet of `../components/color-picker.md` over a 72-slot palette, and
  the "In use" caption is gone (D502). Selection is still marked with a
  **checkmark badge** rather than `category-picker.md`'s shape-change (circle
  → rounded square) — that convention is for *choosing a category to file an
  expense under* (screen 02), this is for *choosing that category's own
  colour*, and the current slot must be "marked with a check, not by colour
  alone". An already-used slot is still never disabled (D317's "marks a slot
  as taken but does not forbid it" — V5 keeps the permission and drops the
  marking).
- **Explicitly not taking:** any in-page screen title — no screen in this app
  has one (`06-categories.md`'s own "no title bar" convention); this form
  relies on the `Name` field's empty vs pre-filled state to signal create vs
  edit (see Open questions — flagging this as worth confirming, it is the one
  real judgment call in this spec).

## Layout
Single scroll container, top to bottom. MainButton is native chrome, outside
the scroll area — matches `02-add-expense.md`'s pattern exactly.

| # | Region | Geometry |
|---|---|---|
| 1 | **Name** | label "Name" 12px `--ink-secondary`; single-line field, `--separator` underline, 15px `--ink` value, no counter (`02-add-expense.md`'s Comment-field pattern). `28px` top padding |
| 2 | Name error / duplicate warning | one line, appears directly under the field, `4px` above it collapses to 0 height when neither is showing (no layout jump when it appears — see Edge cases) |
| 3 | **Colour** | label "Colour" 12px `--ink-secondary`, `20px` above; then the quick row from `../components/color-picker.md` — one line of seven 32px circles plus a grey `+`, `12px` under the label. **One line tall, always** (V5, D505): the region no longer grows with the palette, which is what lets the palette reach 72 without pushing region 5 off the fold |
| 4 | Submit error banner | only after a failed Save; `.submit-error`-style line, `12px` above where MainButton sits |
| 5 | **Delete action** (edit mode only, U2.3) | "Delete category" / "Hide category" text trigger, Row title role (13.5px/600), `--status-red`, spaced by the same `20px` gap as every other region in this form; opens the delete-or-hide flow — see `06c-category-delete.md` |

`96px` bottom padding to clear MainButton (matches every scrollable screen
with a MainButton, e.g. `02-add-expense.md` region 6).

### Name field (region 1)
- Placeholder "Category name" `[inferred]`.
- Value is the category's current name in edit mode, empty in create mode.
- Trimmed on save; leading/trailing whitespace alone never differentiates a
  "changed" name from the original (see dirty-check in Telegram §MainButton).

### Colour picker (region 3)
**Specified in `../components/color-picker.md`** — anatomy, sizing, states,
accessible names and acceptance criteria all live there, so the two views of
one selection (row and sheet) cannot drift apart by being written down twice.

What this screen is responsible for:
- placing the quick row under the "Colour" label and passing it the draft's
  current `colorSlot` (`null` in an untouched create draft);
- treating `onSelect(slot)` as a draft change like any other — it makes the
  form dirty, it does **not** save;
- owning the sheet's open/closed flag, and closing it on select.

The 12-cell named grid (64px swatch + colour name + "In use" caption) that
U2.2 shipped is **removed**, not hidden. Its checkmark badge survives
unchanged as the component's Selected state — that is the one part of the old
picker the new one inherits verbatim.

## Components used
- `../components/color-picker.md` — region 3, entirely.
- `../components/category-picker.md` is **not** used here. Its selection model
  (ephemeral choice + shape change) differs from choosing a category's own
  permanent colour, and V5 removed even the geometric parallel the V3 picker
  had with it.

## Telegram
- **Theme:** every colour from `tokens.css`, both themes. The checkmark badge
  uses `--card`/`--ink` (adapts with theme), not a fixed white/black.
- **MainButton:** **"Save"**. Disabled until the form is dirty — the plan's
  explicit requirement (`mini-app-ux.md` §4, U2.2 AC) — dirty means: trimmed
  name differs from the original (empty string vs empty string in create mode
  is *not* dirty), or the selected slot differs from the original (`null` in
  create mode). Disabled again immediately after a successful Save (draft
  becomes the new "original"). An empty/whitespace-only name never enables
  Save even if the slot changed — the inline error (see Copy) covers that
  case instead of a disabled-but-silent button.
- **BackButton:** always shown; returns one step, to `06-categories.md` —
  its only opener (`../navigation.md`). On a dirty draft, Telegram's own
  popup confirms before discarding — the same pattern
  `add-expense.ts::wireBackButton` already implements for that screen's
  draft.
- **Haptics:** `success` after a successful Save; no haptic on tapping a
  swatch or typing (matches this app's existing restraint — `add-expense.ts`
  only haptics on submit and category-select, not every keystroke).
- **Viewport:** the `Name` field is a single-line text input; the keyboard
  opening does not need special scroll handling the way `02-add-expense.md`'s
  multi-line Comment field does (region 1 is near the top, never covered).

## States
The five-state framework (`webapp/CLAUDE.md`) applies to the **Save action**,
not to opening the screen — this form's initial data comes from the
navigation call (the category the user tapped on `06-categories.md`, already
loaded there), not a fetch, so **Loading/Empty on open are n/a**: the form is
interactive immediately, matching `02-add-expense.md`'s "Amount field is live
and focused immediately" precedent.

| State | Trigger | What the user sees |
|---|---|---|
| Error (on Save) | `POST`/`PATCH /categories` rejects for a reason other than 403 | Submit error banner (region 4) with a plain-language message; **the draft is preserved** — name and slot selection stay exactly as typed, MainButton stays enabled (still dirty) |
| 403 (on Save) | the caller lacks create/update permission on `categories` (member/viewer defaults are read-only, `api/CLAUDE.md`'s matrix) | Same banner region, `error.readonly` copy; draft preserved |
| Offline (on Save) | the request never reaches the network | Same banner region, treated as the generic Error case — this screen never had cached data to fall back to (it is a write, not a read) |
| Saving | MainButton tapped, request in flight | MainButton shows its built-in progress state (`WebApp.MainButton.showProgress()`); a double-tap while saving must not issue a second request (same guard shape as `add-expense.ts`'s submit guard, D118/D123) |
| Success | Save resolves | `success` haptic; navigates back to `06-categories.md`, which re-fetches so the new/renamed/recoloured cell is visible immediately |

## Interactions

| Element | Action | Result |
|---|---|---|
| `Name` field | type | updates the draft; clears the inline empty-name error the moment the trimmed value is non-empty again |
| `Name` field | blur, value matches another category's trimmed name (case-insensitive `[inferred]`) | shows the duplicate-name warning (region 2); **does not block** Save |
| Quick-row circle | tap | selects that slot in the draft (single-select, replacing any prior selection); moves the checkmark badge; no haptic |
| `+` | tap | opens the colour sheet; changes nothing in the draft |
| Sheet circle | tap | selects that slot **and** closes the sheet (D503); the quick row shows it selected, as an 8th circle when it is not one of slots 1–7 |
| Sheet scrim / BackButton while the sheet is open | tap | closes the sheet, selection unchanged. BackButton closes the sheet rather than leaving the screen — the sheet is the innermost dismissible thing |
| MainButton ("Save") | tap, name blank/whitespace-only | **blocked**: inline error appears (region 2), MainButton stays visually enabled but the tap is a no-op that surfaces the error rather than submitting — this is the "rejected inline, never as a popup" AC |
| MainButton ("Save") | tap, valid | `POST /categories` (create mode, no `id` in the draft) or `PATCH /categories/{id}` (edit mode); see States |
| BackButton | tap, draft clean | navigates to `06-categories.md` immediately |
| BackButton | tap, draft dirty | Telegram confirm popup; confirming navigates to `06-categories.md` and discards the draft, cancelling stays on this screen |

## Copy

| Key | String | Notes |
|---|---|---|
| `name.label` | "Name" | field label |
| `name.placeholder` | "Category name" | `[inferred]` |
| `name.error.empty` | "Give this category a name." | inline, region 2; never a popup |
| `name.warning.duplicate` | "Another category is already named \"{name}\"." | inline, region 2; non-blocking |
| `colour.label` | "Colour" | section label |
| ~~`swatch.inUse`~~ | ~~"In use"~~ | **removed in V5 (D502)** — the picker no longer distinguishes taken from free |
| `error.save` | "Couldn't save this category." | generic Save failure, mirrors `error.load`'s pattern elsewhere |
| `error.readonly` | "You have read-only access to this account." | existing string, reused verbatim (Home, 06a) |
| `error.retry` | "Try again" | reused verbatim; re-attempts the same Save |

## Data

| Call | Params | Notes |
|---|---|---|
| `POST /categories` | `{ name, color_slot }` | create mode. `models/category.py::CategoryCreate.color_slot` validates `1–12` today (widened from `1–6` in U2.2) — **must widen again to `1–72` for V5** (D500); otherwise picking any ramp slot 422s. |
| `PATCH /categories/{id}` | `{ name?, color_slot? }` | edit mode. `CategoryUpdate.color_slot` has the same bound needing the same widening. |
| — | — | No `GET` on open: the draft's initial `{ name, color_slot, id }` and the sibling names used for the duplicate check both come from `06-categories.md`'s already-loaded list, passed through navigation state. |

`webapp/src/api/client.ts` has no `createCategory`/`updateCategory` methods
yet (only `listCategories` exists) — adding both is in scope for this unit,
mirroring `listCategories`' shape. `webapp/src/api/types.ts` needs no new
type: `CategoryCreate`/`CategoryUpdate` mirrors are new, `CategoryResponse`
already exists.

## Accessibility
- The picker's ARIA (`radiogroup`, per-circle `radio` + `aria-checked`, and the
  slot-name accessible labels that are now the **only** text carrier) is
  specified in `../components/color-picker.md`, not repeated here.
- The `Name` field has a real `<label for>`, not just placeholder text —
  placeholder text alone is not an accessible label.
- Inline errors/warnings are announced (`aria-live="polite"` on region 2) so
  a screen-reader user hears the rejection without needing to re-read the
  field.
- Focus order: BackButton (native) → `Name` field → quick row (arrow keys move
  along it and wrap) → `+` → MainButton (native, outside DOM focus order —
  Telegram chrome). While the sheet is open, focus is trapped inside it and
  returns to the `+` on close.
- `prefers-reduced-motion`: n/a — this screen has no transitions beyond the
  checkmark badge appearing/disappearing, which is instant either way.

## Edge cases
- **Region 2 reserves no fixed height when nothing is showing** — unlike
  `06-categories.md`'s caption line (always present, reserves space to keep
  the grid aligned), this form has at most one of {error, warning} at a time
  and nothing below it to misalign, so the field may shift the swatch grid
  down by one line's height when a message appears. `[inferred]` — flagged in
  case a reserved-height approach is preferred for visual stability.
- **Both an empty name and a duplicate name** — the empty-name error takes
  priority (region 2 shows one message at a time); the duplicate check only
  runs once the trimmed name is non-empty.
- **Renaming to the exact name a *different* category already has, then back
  to the original** — the duplicate warning clears the moment the trimmed
  value no longer matches any sibling; it is re-evaluated on every blur, not
  computed once.
- **Very long name (matches `expenses.py`'s existing `name` column, no
  client-side max enforced beyond what the field naturally allows)** — the
  field is single-line; overflow scrolls horizontally within the input like
  any native text field, never wraps or truncates while editing.
- **Deselecting colour entirely is not offered** — there is no "no colour"
  swatch; `color_slot` stays `null` only if the user never taps a swatch in
  create mode (see Open questions on whether a swatch pick should be
  required).

## Acceptance criteria
- [ ] Opening from the "Add category" cell shows an empty `Name` field and no
      swatch pre-selected; opening from an existing cell pre-fills the name
      and marks that category's current slot with the checkmark badge.
- [ ] MainButton is disabled on open in both modes and becomes enabled the
      moment the name or the selected slot differs from the original; it
      returns to disabled immediately after a successful Save.
- [ ] Region 3 is one row tall: seven colour circles and a grey `+`, no names
      and no "In use" captions anywhere on the screen.
- [ ] Tapping any of the seven selects it and moves the checkmark, with no
      sheet and no request; tapping the `+` opens the 72-circle sheet, and
      tapping a circle there selects it and closes the sheet in one action.
- [ ] A category already using a given slot is offered exactly like any other
      — nothing is marked, disabled, or skipped.
- [ ] Submitting a blank or whitespace-only name shows the inline error
      (never a Telegram popup) and does not call the API.
- [ ] Entering a name matching an existing category shows the inline
      duplicate warning but Save still succeeds when tapped.
- [ ] A successful create returns to `06-categories.md` with the new category
      visible in the grid; a successful rename/recolour updates that
      category's cell, and — per U2.2's AC — every dot for that category on
      Home and Statistics reflects the new colour on next render.
- [ ] A 403 or network failure on Save shows the corresponding message and
      leaves the typed name and selected swatch exactly as they were —
      nothing is cleared or reset.
- [ ] Double-tapping Save while a request is already in flight results in
      exactly one write.
- [ ] BackButton on a clean draft navigates to `06-categories.md`
      immediately; on a dirty draft it shows Telegram's confirm popup first.
- [ ] Rendering is correct in both light and dark, with every colour
      (including the checkmark badge) resolved from `tokens.css`.

## Resolved
- **No in-page heading** (2026-08-05, HUMAN). Stays consistent with every
  other screen's no-title convention; the `Name` field's empty-vs-pre-filled
  state is the only signal for create vs edit.
- **Colour-family names confirmed** (2026-08-05, HUMAN): Blue, Orange, Aqua,
  Yellow, Pink, Green, Teal, Violet, Olive, Cyan, Moss, Magenta for slots
  1–12 — now also recorded in `design-system.md`'s Category palette table.
- **Colour pick is optional in create mode** (2026-08-05, HUMAN). Matches
  `CategoryCreate.color_slot` being nullable; a category can be saved with no
  swatch tapped and gets the existing position-fallback colour (D206/D301).
- **Duplicate-name check is active categories only** (2026-08-05, HUMAN).
  Archived categories are out of the user's forward-looking view and do not
  trigger the warning.

## Open questions
- [?] **Region 2's layout shift** when an error/warning appears — see Edge
      cases; reserved-height vs shift-on-appear is a real visual choice, not
      just an implementation detail. Not blocking — either is easy to change
      after seeing it on a real device.

## Addendum (V5, 2026-08-08)
Region 3 was rewritten. The 12-swatch named grid is replaced by
`../components/color-picker.md` (7-circle quick row + a `+` opening a 72-slot
sheet), the palette grows to 72 (`design-system.md`, D500/D501), and the "In
use" caption is removed (D502). Regions 1, 2, 4 and 5 are untouched, as are
the MainButton dirty rule, the Save flow, and every State in this file — the
draft simply carries a wider range of `colorSlot` values than before.

Two earlier "Resolved" entries below are narrowed rather than reversed:
- *"Colour-family names confirmed"* still holds for slots 1–12. Slots 13–72
  are named positionally (`Olive 3`) and those names now appear **only** as
  accessible names, never as visible text.
- *"Colour pick is optional in create mode"* is unchanged — `null` is still a
  valid `colorSlot`, and the quick row simply shows nothing selected.

## Addendum (U2.3, 2026-08-06)
Region 5 (Delete action) and its full behaviour — the confirmation popup, the
optimistic update on `06-categories.md`, and the failure/403 handling — are
specified in `06c-category-delete.md`, not repeated here. This file's Save
flow (regions 1–4, States, MainButton) is unchanged by that addition; the two
actions share the form but not a code path.
