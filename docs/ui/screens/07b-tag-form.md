# Screen: 07b — Tag form (create / rename / delete-or-hide)

## Purpose
One form surface for both creating a new tag and renaming or removing an
existing one — reached from `07-tags.md`'s list: the "Add tag" row opens it
empty (create), an active or archived row opens it pre-filled (rename /
delete-or-hide). Plan unit U2.5, explicitly "U2.2 + U2.3 condensed for tags
(no colour, so one unit is enough)" — this file specs both halves together
rather than as two sibling files, since there is no colour-picker region to
warrant splitting them the way categories did.

## Reference
No screenshot — derived entirely from written intent and from the two sibling
specs this condenses:
- `docs/design/mini-app-ux.md` §4 "07 — Tags" — the D302 delete-or-hide rule
  ("identical rule to screen 06: a tag on at least one expense is hidden, one
  on none is deleted"), called out as mattering *more* here than for
  categories because `expense_tags` is `ON DELETE CASCADE` — no rule, one
  mis-tap silently strips a tag from every past expense with nothing to
  recover; "Renaming and deleting are the secondary action at the bottom".
- `docs/plans/mini-app-v3.md` U2.5 — the already-approved acceptance criteria
  this spec must satisfy.
- `06b-category-form.md` — the Name-field pattern, the dirty-only MainButton
  rule, and the overall form shape this file condenses, minus the colour
  picker (region 3 there; absent here — tags have no `color_slot`).
- `06c-category-delete.md` — the delete-or-hide trigger, the exact Telegram
  `showConfirm` pattern, and the optimistic-patch-then-revert-on-failure flow
  this file reuses against `07-tags.md`'s already-loaded list instead of
  `06-categories.md`'s.
- `07-tags.md` — the screen this form is navigated to/from; its already-loaded
  `TagsData` (name, `expenseCount`) is this form's only data source, same
  no-fetch-on-open contract 06b established.

## Delta from reference
- **Taking:** 06b's Name-field layout (label + underlined field, no counter,
  trimmed on save), its dirty-check/MainButton-enable rule, its inline
  empty-name error (never a popup) and its submitting/double-submit guard
  shape; 06c's delete-or-hide trigger placement (bottom of the form, edit mode
  only), its exact `showConfirm` message pattern, its **optimistic**
  patch-the-already-loaded-list-then-revert-on-failure flow, and its
  `medium`-haptic-on-confirm timing. The CSS classes `.cat-form`,
  `.cat-form-field`, `.cat-form-input`, `.cat-form-message*`,
  `.cat-form-section`, `.submit-error`, `.cat-delete-trigger` and
  `.cat-delete-failed` are reused **verbatim, not duplicated under a
  `.tag-*` name** — none of them reference colour or anything
  category-specific, the same reasoning `07-tags.md` used to reuse `.row`/
  `.nm` from `home.ts` rather than inventing parallel classes.
- **Changing:** no colour-picker region at all (tags carry no `color_slot`,
  `models/tag.py::TagCreate`/`TagUpdate` have only `name`); the delete/hide
  confirm copy and trigger labels are reworded for tags — "keep it tagged"
  rather than categories' "keep it for reports" (see Copy); the failure/retry
  banner and 403 handling are otherwise identical in shape.
- **Explicitly not taking:** 06b's 12-swatch grid, its `radiogroup` semantics,
  and its "In use" slot caption — none apply, there is no colour; 06c's
  last-remaining-category warning (`confirm.lastActive.suffix`) — that exists
  because `expenses.category_id` is `NOT NULL` (deleting the last category
  leaves new expenses nowhere to go), but tags are optional and multi-valued
  (`expense_tags` many-to-many) — deleting the last tag has no equivalent
  consequence, so this form has no "last tag" warning; the duplicate-name
  warning 06b shows (`categoryDuplicateWarning`) — categories' non-blocking
  warning exists alongside D19/D311 "duplicate warns but does not block";
  `services/tag_service.py` explicitly notes tags have **no** per-account name
  uniqueness at all (`docs/SCHEMA.sql` has none), and the plan's U2.5 AC does
  not ask for one, so this form skips the check entirely rather than warning
  about something the backend doesn't even track — `[inferred]`, flagged in
  Open questions since it is a real judgment call, not a spec-supported fact
  the way categories' warning was; the design doc's empty-state "three
  starters" suggestion chips (`mini-app-ux.md` §4, deferred by `07-tags.md`
  to "this unit") — **still not built here**, because the plan's approved
  U2.5 AC (the contract this file must satisfy) does not mention them; see
  Open questions — this is a scope note for the human to confirm, not a
  decision made unilaterally in this pass.

## Layout
Single scroll container, top to bottom — identical shape to 06b's, minus the
colour region. MainButton is native chrome, outside the scroll area.

| # | Region | Geometry |
|---|---|---|
| 1 | **Name** | label "Name" 12px `--ink-secondary`; single-line field, `--separator` underline, 15px `--ink` value, no counter (`.cat-form-field`/`.cat-form-input`, same as 06b region 1). `28px` top padding |
| 2 | Name error | one line, appears directly under the field, collapses to 0 height when not showing — same `.cat-form-message` shape as 06b region 2, but this form only ever shows the empty-name error here (no duplicate-name warning, see Delta) |
| 3 | Submit error banner | only after a failed Save; `.submit-error` line, `12px` above where MainButton sits (06b region 4's class, unchanged) |
| 4 | **Delete action** (edit mode only) | "Delete tag" / "Hide tag" text trigger, Row title role (13.5px/600), `--status-red`, `.cat-delete-trigger` (06c region 5's class, unchanged); opens the delete-or-hide flow |

`96px` bottom padding to clear MainButton, same as every scrollable screen
with one.

### Name field (region 1)
- Placeholder "Tag name" `[inferred]`, mirrors 06b's "Category name".
- Value is the tag's current name in edit mode, empty in create mode.
- Trimmed on save; leading/trailing whitespace alone never differentiates a
  "changed" name from the original (same dirty-check rule as 06b).

## Components used
None from `../components/`. Reuses 06b/06c's `.cat-form*`/`.cat-delete-*` CSS
verbatim (see Delta) rather than a component — those classes are already
colour-agnostic markup/typography, not a `../components/` entry either.

## Telegram
- **Theme:** every colour from `tokens.css`, both themes. The delete trigger's
  only colour is `--status-red` ("Over-budget, and destructive text actions",
  `design-system.md`), identical token 06c uses.
- **MainButton:** **"Save"**. Disabled until the form is dirty — trimmed name
  differs from the original (empty vs empty in create mode is not dirty).
  Disabled again immediately after a successful Save. An empty/whitespace-only
  name never enables Save; the inline error (region 2) covers that case
  instead of a disabled-but-silent button — identical rule to 06b.
- **BackButton:** always shown; navigates to `07-tags.md`. On a dirty draft,
  Telegram's own popup confirms before discarding, same
  `wireCategoryFormBackButton`-shaped guard 06b implements.
- **Haptics:** `success` after a successful Save; `medium` impact the instant
  the delete/hide popup is **confirmed** (not on the tap that opens it, not
  again on the network response — the optimistic change already happened by
  then, same timing 06c uses). No haptic on tapping into the field or on
  popup cancel.
- **Viewport:** the Name field is a single-line text input near the top of the
  screen — no special keyboard scroll handling needed, same as 06b.

## States
The five-state framework applies to the **Save action**, not to opening the
screen — same as 06b, this form's initial data comes from `07-tags.md`'s
already-loaded list (navigation state), not a fetch. Loading/Empty on open are
n/a.

| State | Trigger | What the user sees |
|---|---|---|
| Error (on Save) | `POST`/`PATCH /tags` rejects for a reason other than 403 | Submit error banner (region 3), `error.save`; draft preserved exactly as typed |
| 403 (on Save) | caller lacks create/update permission on `tags` | Same banner region, `error.readonly`; draft preserved |
| Offline (on Save) | request never reaches the network | Same banner region, treated as the generic Error case — this screen never had cached data to fall back to (it is a write) |
| Saving | MainButton tapped, request in flight | MainButton shows its built-in progress state; a double-tap must not issue a second request (D118/D123-shaped guard) |
| Success | Save resolves | `success` haptic; navigates back to `07-tags.md`, which re-fetches so the new/renamed tag is visible immediately |

Delete-or-hide has its own action-states table, evaluated on **07a**
(`07-tags.md`) because the flow is optimistic, identical shape to 06c's:

| State | Trigger | What the user sees |
|---|---|---|
| Idle | form open, edit mode | region 4 renders the trigger; hidden entirely in create mode |
| Confirming | trigger tapped | Telegram's native popup, message per Copy |
| Cancelled | popup dismissed without confirming | popup closes; form unchanged; no request sent |
| Optimistic success | popup confirmed | `medium` haptic fires immediately; navigates to `07-tags.md` **without calling `GET /tags` again** — the tag is already removed from the active list (rendered from the mutated in-memory `tagsCache`) and, if it had ≥1 expense, already present in the archived section; `DELETE /tags/{id}` fires in the background |
| Confirmed (background) | `DELETE` resolves `204` | nothing visibly changes — the optimistic state was already correct |
| Failed — retryable | `DELETE` rejects with a network/5xx error | back on `07-tags.md`, the row is **restored** to its exact prior position and status; a banner names the tag and which action failed, with a working "Try again" that re-issues the same `DELETE` |
| Failed — 403 | `DELETE` rejects `403` | same row-restore; banner reads `error.readonly` instead, no "Try again" |

## Interactions

| Element | Action | Result |
|---|---|---|
| `Name` field | type | updates the draft; clears the inline empty-name error the moment the trimmed value is non-empty again |
| MainButton ("Save") | tap, name blank/whitespace-only | **blocked**: inline error appears (region 2); tap is a no-op that surfaces the error rather than submitting |
| MainButton ("Save") | tap, valid | `POST /tags` (create mode, no `id` in the draft) or `PATCH /tags/{id}` (edit mode); see States |
| BackButton | tap, draft clean | navigates to `07-tags.md` immediately |
| BackButton | tap, draft dirty | Telegram confirm popup; confirming navigates and discards the draft, cancelling stays on this screen |
| "Delete tag" / "Hide tag" trigger (edit mode) | tap | opens Telegram's `showConfirm` with the message from Copy |
| Popup | cancel | closes; no state change |
| Popup | confirm | see States — Optimistic success |
| Delete-failed banner (07a) | tap "Try again" | re-issues the same `DELETE /tags/{id}`; success clears the banner |
| Delete-failed banner (07a) | (403 variant) | no action offered beyond the message itself |

## Copy

| Key | String | Notes |
|---|---|---|
| `name.label` | "Name" | field label |
| `name.placeholder` | "Tag name" | `[inferred]`, mirrors 06b |
| `name.error.empty` | "Give this tag a name." | inline, region 2; never a popup |
| `error.save` | "Couldn't save this tag." | generic Save failure |
| `error.readonly` | "You have read-only access to this account." | existing string, reused verbatim |
| `error.retry` | "Try again" | reused verbatim |
| `trigger.delete` | "Delete tag" | region 4's label when `expenseCount === 0` |
| `trigger.hide` | "Hide tag" | region 4's label when `expenseCount ≥ 1` |
| `confirm.delete` | "Delete {name}?" | popup message, zero-expense branch |
| `confirm.hide.one` | "Hide {name}? 1 expense keeps it tagged." | popup message, `expenseCount === 1` |
| `confirm.hide.many` | "Hide {name}? {n} expenses keep it tagged." | popup message, `expenseCount ≥ 2` |
| `delete.failed.delete` | "Couldn't delete {name}." | retryable-failure banner, zero-expense branch |
| `delete.failed.hide` | "Couldn't hide {name}." | retryable-failure banner, has-expenses branch |

## Data

| Call | Params | Notes |
|---|---|---|
| `POST /tags` | `{ name }` | create mode. `models/tag.py::TagCreate` already has just `name` — no widening needed (unlike 06b's `color_slot` 1–6→1–12 change, there is no equivalent field here). |
| `PATCH /tags/{id}` | `{ name? }` | edit mode. `TagUpdate.name` already optional. |
| `DELETE /tags/{id}` | — | already implemented end to end (`services/tag_service.py::delete`, U0.5): archives (`is_active = false`) if `count_expenses(tag_id) > 0`, hard-deletes otherwise (D302) — the exact rule this spec's popup/trigger copy previews. No backend change needed. |
| — | — | No `GET` on open: the draft's initial `{ name, id }`, and `expenseCount` for the delete-trigger label/popup branch, come from `07-tags.md`'s already-loaded `tagsCache` snapshot, passed through navigation state — same no-fetch-on-open contract as 06b. |

`webapp/src/api/client.ts` has only `listTags` today — adding `createTag`,
`updateTag` and `deleteTag` is in scope for this unit, mirroring
`createCategory`/`updateCategory`/`deleteCategory`'s shape exactly (`Promise
<TagResponse>` / `Promise<TagResponse>` / `Promise<void>`).
`webapp/src/api/types.ts` needs new `TagCreate { name: string }` and
`TagUpdate { name?: string }` interfaces, mirroring `CategoryCreate`/
`CategoryUpdate` minus `color_slot`; `TagResponse` already exists (U2.4).

## Accessibility
- The `Name` field has a real `<label for>`, not just placeholder text.
- The inline empty-name error is announced (`aria-live="polite"` on region 2,
  same as 06b region 2).
- The delete/hide trigger is a real `<button>`, reachable by Tab, activated by
  Enter/Space; its own text already states the consequence ("Delete
  tag"/"Hide tag"), so `--status-red` is reinforcement, not the only signal.
- The delete-failed banner is announced (`aria-live="polite"`, same pattern as
  06c) so a screen-reader user hears the restore-and-fail outcome.
- Focus order: BackButton (native, outside this order) → `Name` field → (edit
  mode only) delete trigger → MainButton (native, outside DOM focus order).
- `prefers-reduced-motion`: n/a — no transitions on this screen beyond what
  the shared `.cat-form-message`/banner classes already handle (instant
  show/hide either way, same as 06b/06c).

## Edge cases
- **Very long tag name** — the field is single-line; overflow scrolls
  horizontally within the input, never wraps or truncates while editing, same
  as 06b's Name field. (07a's own row rendering separately handles ellipsis
  for display — this form's input behaves like any native text field.)
- **Renaming to a name another tag already has** — allowed and saves
  successfully; no duplicate check exists for tags (see Delta/Open questions),
  unlike categories.
- **A stale cached `expenseCount` mispredicts the delete-vs-hide branch** —
  same accepted, not-fixed limitation 06c documents: the popup and the
  optimistic transition are computed from the count `07-tags.md` last loaded,
  not a fresh read; the server's branch (D302, based on the live count) always
  wins on a 204 either way, no data loss, narrow window at family scale.
- **Deleting while offline** — the optimistic navigation still happens (local
  state only); the background `DELETE` fails immediately as a network error,
  landing in "Failed — retryable" on the next tick, same as 06c.
- **Double-tapping Save while a request is in flight** — the controller's
  `submitting` guard (D118/D123 shape) blocks the second call; exactly one
  write reaches the API.
- **Tapping the delete trigger twice fast** — Telegram's native `showConfirm`
  is itself modal; a second call while one is open is a platform-level no-op.

## Acceptance criteria
- [ ] Opening from the "Add tag" row shows an empty `Name` field; opening from
      an existing row pre-fills the name.
- [ ] MainButton is disabled on open in both modes and becomes enabled the
      moment the name differs from the original (trimmed); it returns to
      disabled immediately after a successful Save.
- [ ] Submitting a blank or whitespace-only name shows the inline error
      (never a Telegram popup) and does not call the API.
- [ ] A successful create returns to `07-tags.md` with the new tag visible in
      the list; a successful rename updates that tag's row.
- [ ] In edit mode, the trigger reads "Delete tag" when the tag has zero
      expenses and "Hide tag" when it has one or more; it is absent entirely
      in create mode.
- [ ] Tapping the trigger opens Telegram's native confirmation popup (never a
      custom modal) with the message from the Copy table, matching the
      zero/one/many-expense branch.
- [ ] Cancelling the popup leaves the form and the tag exactly as they were,
      with no request sent.
- [ ] Confirming with zero expenses removes the tag from `07-tags.md`'s list
      and, on the next `GET /tags`, it is gone entirely (hard delete).
- [ ] Confirming with ≥1 expense moves the tag out of the active list into the
      archived section on `07-tags.md`, and it is still present with
      `include_archived=true` on the next `GET /tags`; the expenses that had
      this tag still show it when fetched via `GET /expenses` — the tag is
      **hidden, never stripped** from past expenses.
- [ ] Both transitions above happen without `07-tags.md` issuing a new
      `GET /tags` call — the list updates from the already-loaded cache,
      patched in place.
- [ ] A `DELETE` failure (network/5xx) restores the tag to its exact prior
      position and section on `07-tags.md`, with a banner naming the tag and
      which action failed, and a working "Try again".
- [ ] A `DELETE` failure with `403` restores the row the same way but shows
      the read-only message instead, with no "Try again" offered.
- [ ] A 403 or network failure on **Save** shows the corresponding message and
      leaves the typed name exactly as it was — nothing is cleared or reset.
- [ ] Double-tapping Save while a request is already in flight results in
      exactly one write.
- [ ] BackButton on a clean draft navigates to `07-tags.md` immediately; on a
      dirty draft it shows Telegram's confirm popup first.
- [ ] Rendering is correct in both light and dark, with every colour resolved
      from `tokens.css`.

## Open questions
- [?] **No duplicate-name warning for tags** (this session) — `[inferred]`
      decision: the backend tracks no uniqueness for `tags.name` (unlike
      categories) and the plan's U2.5 AC doesn't ask for one, so this spec
      omits 06b's non-blocking duplicate warning entirely. Confirm this is
      wanted, or ask for the same warning categories have (cosmetic only,
      since nothing would ever reject the save either way).
- [?] **"Three starters" empty-state suggestion chips** — `07-tags.md`
      deferred this design-doc item (§4: "no tags yet… explain, then offer
      three starters") to "this unit", but the plan's approved U2.5 AC does
      not mention it and this spec does not build it. Confirm whether it
      stays deferred to a later unit, or should be added to this spec's scope
      before implementation.
- [?] **Exact hide/delete confirm copy** (`confirm.hide.one`/`.many`) is
      `[inferred]` — "keep it tagged" is a new phrase, not lifted from the UX
      brief the way categories' "keep it for reports" was.
