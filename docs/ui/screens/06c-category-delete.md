# Screen: 06c — Delete or hide a category

## Purpose
Not a new screen surface — the D302 archive-or-delete rule made legible at the
one place a category can be removed: the bottom of `06b-category-form.md`'s
edit mode. Deciding whether a tap **deletes** or **hides** a category, telling
the user which before they commit, and reflecting the result back on
`06-categories.md`'s grid without a network round trip. Plan unit U2.3.

## Reference
No screenshot — this spec is derived entirely from written intent and from
this session's decisions (2026-08-06, HUMAN, in the `/unit U2.3` session):
- `docs/design/mini-app-ux.md` §4 "06 — Categories", "Delete (V3, D302)" —
  the exact confirmation copy pattern this spec implements verbatim: "Hide
  Groceries? 42 expenses keep it for reports" vs "Delete Groceries?", stated
  "before the tap, never as a 409 afterwards"; "confirmation is Telegram's own
  popup, never a custom modal".
- `docs/design/mini-app-ux.md` §4 "07 — Tags" — "Renaming and deleting are the
  secondary action at the bottom" — the placement this spec reuses for
  categories (07's own delete pass is U2.5, not this unit).
- `docs/plans/mini-app-v3.md` U2.3 — the already-approved acceptance criteria
  this spec must satisfy, notably: the archive/delete branch named correctly
  in the popup; the row moves/disappears **without a full reload**; a failure
  **restores the row** and says what failed; 403 shows the read-only message;
  the last remaining active category is deletable but warns that new expenses
  will have nowhere to go.
- `06-categories.md`'s Open Questions — this file is the "own layout pass"
  that entry named as not yet done; resolved by this spec (see that file's
  updated Open Questions).
- `06b-category-form.md` — the screen this action's trigger lives inside; its
  Layout, Telegram and States sections are extended by this spec (see
  Delta), not superseded.
- `webapp/src/screens/expense-detail.ts` — the only other delete flow in this
  app. **Explicitly not followed**: it uses an in-app "Undo" banner with no
  confirmation popup at all, because a single expense delete is cheap and
  reversible within 5 seconds. Categories/tags are different — `docs/design/
  mini-app-ux.md` is explicit that *this* delete confirms **before** the tap,
  via Telegram's native popup, not after. One piece of its CSS is still
  reused: `.detail-actions button.danger { color: var(--status-red) }` is the
  only existing precedent in this app for a destructive text action's colour,
  reused here for "Delete category" (see Open questions — this sits in
  tension with `design-system.md`'s "`--status-red` is reserved for
  over-budget" line, flagged there, not resolved here).

## Delta from reference
- **Taking:** the exact confirmation-copy pattern from `mini-app-ux.md`
  ("Hide {name}? {n} expenses keep it for reports." / "Delete {name}?");
  Telegram's native `showConfirm` (already wrapped once in `lib/telegram.ts`
  as `confirmDiscard`, reused here under a more general name — an
  implementation detail, not a spec concern); the bottom-of-form placement
  `mini-app-ux.md` names for tags, applied to categories; `--status-red` for
  the trigger's text colour, matching `expense-detail.ts`'s `.danger` button.
- **Changing:** `06b-category-form.md`'s own Save flow (2026-08-05) returns to
  `06-categories.md` by **re-fetching** ("navigates back … which re-fetches
  so the new/renamed/recoloured cell is visible immediately"). This unit's
  delete/hide flow deliberately does **not** re-fetch — it patches
  `06-categories.md`'s already-loaded list in place, because the plan's AC
  requires the row to move/disappear "without a full reload" and a failure to
  "restore" it, which only means something if the grid is never blown away
  and refetched in between. This is a **named divergence** between the two
  actions on the same form, not an inconsistency to fix later.
- **Explicitly not taking:** a custom modal of any kind (webapp/CLAUDE.md);
  `expense-detail.ts`'s Undo-banner-with-timer pattern (see Reference); a
  dedicated confirmation *screen* (D302's rule is delivered by a popup, not a
  navigation); any change to `06-categories.md`'s archived-row tap, which
  stays the stub it already is (un-archiving is out of scope, D312) — this
  unit only wires the **active**-cell path, via the edit form.

## Layout
No new screen layout. The one new element is a single region appended to
`06b-category-form.md`'s existing layout table, **edit mode only** (hidden
entirely in create mode — there is nothing to delete yet):

| # | Region | Geometry |
|---|---|---|
| 5 | **Delete action** | same `20px` flex-gap `06b-category-form.md`'s `.cat-form` already applies between every region — no extra margin added; centred, single line: "Delete category" / "Hide category" (see Copy — the label itself names the branch, using the same `expense_count` the popup message uses), design-system.md's **Row title** role (13.5px, 600, −0.01em — reused rather than inventing a new size), `--status-red`, no background, no border — a text action, not a filled button (distinct from `expense-detail.ts`'s pill-shaped `.danger` button; this form has no other pill actions to match, region 1's field and region 3's grid are the only other content) |

Sits below region 4 (submit error banner) when both are present — the submit
error is about a **failed Save**, unrelated to this action, and the two never
show for the same tap.

## Components used
None. Reuses `06-categories.md`'s already-rendered `CategoryRow` shape
(`expenseCount`) for the popup copy, and `06b-category-form.md`'s already-
loaded `activeSiblings` (its length, not its contents) for the
last-remaining-category check — no new data fetch.

## Telegram
- **Theme:** the trigger's only colour is `--status-red` (both themes,
  `tokens.css`). The confirmation itself is Telegram's native popup chrome —
  not themed by this app, same as every other `showConfirm` use.
- **MainButton:** unchanged from `06b-category-form.md` — still "Save",
  governed only by the name/colour draft. This action does not use
  MainButton; it is a plain in-page tap, deliberately not competing with Save
  for the one primary-action slot.
- **BackButton:** unchanged from `06b-category-form.md`. Tapping "Delete
  category" and then cancelling the popup does not itself count as making the
  draft dirty (it touches neither `name` nor `colorSlot`) — `BackButton`'s
  dirty-check is unaffected by this action either way.
- **Haptics:** `medium` impact the instant the popup is **confirmed** (not on
  the tap that opens the popup, and not again on the network response — the
  visible change already happened by the time any response arrives, since
  this flow is optimistic; see States). No haptic on cancel. `[inferred]` —
  matches this app's existing restraint (haptics mark a committed action, not
  every tap), and deliberately does not add a second `success` haptic on top
  of the one already fired at confirm-time.
- **Viewport:** n/a — no text entry, no keyboard interaction in this flow.

## States
The five-state framework doesn't map cleanly onto a one-shot action; this
table replaces it with the action's own states, evaluated on **06a**
(`06-categories.md`) except where noted, because the flow is optimistic —
06a is where the user is standing by the time any of these resolve.

| State | Trigger | What the user sees |
|---|---|---|
| Idle | form open, edit mode | region 5 renders the trigger; hidden entirely in create mode |
| Confirming | trigger tapped | Telegram's native popup, message per Copy; blocks nothing else on the form underneath |
| Cancelled | popup dismissed without confirming | popup closes; form is exactly as it was; no request sent |
| Optimistic success | popup confirmed | `medium` haptic fires immediately; the app navigates to `06-categories.md` **without calling `GET /categories` again** — the category is already removed from the active grid (rendered from the mutated in-memory list) and, if it had ≥1 expense, already present in the (now-expanded, or newly-shown-if-this-was-the-first-archived-item) archived section; `DELETE /categories/{id}` fires in the background |
| Confirmed (background) | `DELETE` resolves `204` | nothing visibly changes — the optimistic state was already correct |
| Failed — retryable | `DELETE` rejects with a network/5xx error | back on `06-categories.md`, the row is **restored** to its exact prior position (active grid, original index) and status; a banner above the grid (same slot as the offline banner, stacks above it if both apply) reads `delete.failed.hide` or `delete.failed.delete` (see Copy) naming the category, with a "Try again" action that re-issues the same `DELETE` without reopening the form |
| Failed — 403 | `DELETE` rejects `403` | same row-restore as above; the banner instead reads `error.readonly` (existing string, no "Try again" — matches `06-categories.md`'s and `06b-category-form.md`'s existing 403 convention of no retry on a permission failure) |

## Interactions

| Element | Action | Result |
|---|---|---|
| "Delete category" / "Hide category" trigger (06b, region 5) | tap | opens Telegram's `showConfirm` with the message from Copy |
| Popup | cancel | closes; no state change |
| Popup | confirm | see States — Optimistic success |
| Delete-failed banner (06a) | tap "Try again" | re-issues the same `DELETE /categories/{id}`; success clears the banner and the row stays in its (already-correct, previously-attempted) target state; another failure re-shows the banner |
| Delete-failed banner (06a) | (403 variant) | no action offered beyond the message itself |

## Copy

| Key | String | Notes |
|---|---|---|
| `trigger.delete` | "Delete category" | region 5's label when `expenseCount === 0` |
| `trigger.hide` | "Hide category" | region 5's label when `expenseCount ≥ 1` — the label itself previews the branch, before the user even taps |
| `confirm.delete` | "Delete {name}?" | popup message, zero-expense branch |
| `confirm.hide.one` | "Hide {name}? 1 expense keeps it for reports." | popup message, `expenseCount === 1` |
| `confirm.hide.many` | "Hide {name}? {n} expenses keep it for reports." | popup message, `expenseCount ≥ 2` |
| `confirm.lastActive.suffix` | " This is your only category — new expenses will have nowhere to go." | appended to whichever `confirm.*` message applies, only when `activeSiblings.length === 0` (this category is the last active one) |
| `delete.failed.delete` | "Couldn't delete {name}." | retryable-failure banner, zero-expense branch |
| `delete.failed.hide` | "Couldn't hide {name}." | retryable-failure banner, has-expenses branch |
| `error.retry` | "Try again" | reused verbatim; retries the same `DELETE` |
| `error.readonly` | "You have read-only access to this account." | reused verbatim (Home, 06a, 06b) |

## Data

| Call | Params | Notes |
|---|---|---|
| `DELETE /categories/{id}` | — | already specified in `docs/plans/mini-app-v3.md`'s Contracts (`204`, archives if `expense_count > 0`, hard-deletes otherwise, D302). `webapp/src/api/client.ts` has **no `deleteCategory` method yet** — adding it is in scope for this unit (mirrors `deleteExpense`'s/`deleteBudgetPlan`'s shape: `Promise<void>`, `204` handled generically by `ApiClient.request`). |
| — | — | No new `GET`. `expenseCount` and `activeSiblings.length` both come from data `06-categories.md`/`06b-category-form.md` already loaded; this flow must not issue a fresh `GET /categories` on success (see Delta) — only on a manual "Try again" does the **same** `DELETE` (not a `GET`) replay. |

## Accessibility
- The trigger is a real `<button>`, not a styled link — reachable by Tab,
  activated by Enter/Space, per the design system's global focus-state rule.
  Its accessible name is its visible label (`trigger.delete`/`trigger.hide`),
  which already states the consequence category.
- The delete-failed banner is announced (`aria-live="polite"`, same pattern
  `06b-category-form.md`'s region 2 already uses) so a screen-reader user
  hears the restore-and-fail outcome without needing to notice the grid
  changed twice.
- Focus order on `06b-category-form.md`: unchanged through region 4, then the
  new region 5's trigger, last before leaving the form (BackButton is native
  chrome, outside this order, as already documented there).
- Identity is not carried by `--status-red` alone: the trigger's own text
  ("Delete category"/"Hide category") already says which action it is, so
  colour is reinforcement, not the sole signal — consistent with this app's
  identity-never-by-colour-alone rule.

## Edge cases
- **A stale cached `expenseCount` mispredicts the branch** — the popup
  message and the optimistic active→archived/removed transition are both
  computed from the count 06a last loaded, not a fresh read. If another
  family member adds an expense to this category in the moment between that
  load and this delete, the client predicts "delete" (0 expenses) while the
  server actually archives it (per D302, `expense_count > 0`). The server's
  branch always wins — a 204 either way, no error — but the optimistic UI
  will have shown the wrong outcome (the row simply vanishes instead of
  landing in the archived section) until the next full `GET /categories`.
  Accepted, not fixed: closing this gap would need a fetch after every
  success, which is exactly the "full reload" this unit's AC requires
  avoiding. Narrow window, family-scale account, no data loss (D302's
  archive-not-delete guarantee is still enforced server-side regardless of
  what the client predicted).
- **Tapping the trigger twice fast** (double-tap before the popup renders) —
  Telegram's native `showConfirm` is itself modal; a second call while one is
  open is a platform-level no-op, not something this spec needs to guard
  against client-side (unlike Save's explicit double-submit guard, D118/D123,
  which exists because `fetch` has no such built-in protection).
- **Deleting while offline** — the optimistic navigation still happens (it is
  local state, not a network call), but the background `DELETE` fails
  immediately as a network error, landing in the "Failed — retryable" state
  on the very next tick; from the user's perspective, the row visibly snaps
  back almost immediately with the failure banner, rather than appearing to
  hang.
- **The archived section was collapsed when a hide-outcome lands** — the
  restored/moved row obeys whatever `archivedExpanded` already was; a hide
  does not force the section open (the user can see the count in the header
  change from `Archived (n)` to `Archived (n+1)` without it auto-expanding).
  `[inferred]` — not stated by the plan AC, chosen to avoid surprising a
  layout change the user didn't ask to see.
- **This category is both the last active one AND has expenses** — both
  conditions can be true together; `confirm.lastActive.suffix` appends to
  `confirm.hide.*`, not instead of it (see Copy).
- **A failed `DELETE` after the popup already fired the confirm haptic** — the
  haptic already happened (see Telegram/Haptics); a failure does not attempt
  a second, "undo" haptic. `[inferred]`.

## Acceptance criteria
- [ ] In edit mode, region 5 renders "Delete category" when the category has
      zero expenses and "Hide category" when it has one or more; it is absent
      entirely in create mode.
- [ ] Tapping the trigger opens Telegram's native confirmation popup (never a
      custom modal) with the message from the Copy table, matching the
      zero/one/many-expense branch and, when this is the account's only
      active category, the appended last-category warning.
- [ ] Cancelling the popup leaves the form and the category exactly as they
      were, with no request sent.
- [ ] Confirming with zero expenses removes the category from
      `06-categories.md`'s grid and, on the next `GET /categories`, it is
      gone entirely (hard delete).
- [ ] Confirming with ≥1 expense moves the category out of the active grid
      into the archived section on `06-categories.md`, and it is still
      present with `include_archived=true` on the next `GET /categories`.
- [ ] Both transitions above happen **without `06-categories.md` issuing a
      new `GET /categories` or `GET /statistics/by-category` call** — the
      grid updates from the already-loaded list, patched in place.
- [ ] A `DELETE` failure (network/5xx) restores the category to its exact
      prior position and section on `06-categories.md`, and shows a banner
      naming the category and which action failed, with a working "Try
      again" that re-issues the same request.
- [ ] A `DELETE` failure with `403` restores the row the same way but shows
      the read-only message instead, with no "Try again" offered.
- [ ] The trigger's text is `--status-red` in both light and dark themes,
      resolved from `tokens.css`.

## Resolved
- **Trigger lives at the bottom of the 06b edit form, not on the 06a grid
  directly** (2026-08-06, HUMAN, this session). Reuses `06b-category-form.md`'s
  already-loaded `expenseCount`/`activeSiblings` data and the
  `mini-app-ux.md` §4 "07 — Tags" placement convention, rather than adding a
  new per-cell interaction pattern (e.g. long-press or a kebab control) that
  nothing else in this app currently uses.
- **The row's move/disappearance on 06a is optimistic** (2026-08-06, HUMAN,
  this session), not "wait for the server, then patch" — chosen specifically
  because the plan's AC says a *failure* "restores the row", which only
  reads as a real behaviour (not figurative) if the row was already visibly
  moved by the time a failure can occur. This is a deliberate divergence from
  `06b-category-form.md`'s Save flow, which re-fetches on success (see
  Delta) — the two actions on the same form now behave differently on
  purpose.
- **Confirmation copy matches `mini-app-ux.md` verbatim** for the base
  delete/hide messages; the last-category warning and the two trigger labels
  are new strings this spec introduces, `[inferred]` and open to the user's
  edit (see Open questions).

## Open questions
- ~~[?] **`--status-red` for the trigger's text**~~ — **answered (U2.3
      implementation)**: `design-system.md`'s Colour table now reads
      "Over-budget, and destructive text actions" for this token.
- [?] **Exact last-category warning wording** (`confirm.lastActive.suffix`)
      is `[inferred]` — the plan only requires that it "warns that new
      expenses will have nowhere to go", not an exact string.
- [?] **`trigger.hide`/`trigger.delete` labels** are new strings, not named
      anywhere in the plan or the UX brief — confirm the wording or edit
      directly in this file.
- [?] **Archived-section auto-expand on a hide outcome** — see Edge cases;
      chosen not to auto-expand, `[inferred]`, easy to flip.
