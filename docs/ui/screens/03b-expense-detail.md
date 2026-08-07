# Screen: 03b — Expense detail

## Purpose
One expense, in full, with the two things you can do to it: edit it or delete
it. Reached by tapping a row on `03-expenses.md`.

**First spec for a shipped screen** (`webapp/src/screens/expense-detail.ts`,
built in V2). V4 keeps the screen and changes what its two actions do.

## Reference
- The shipped screen — values marked `[repo]` were read out of it.
- `docs/design/mini-app-ux.md` §5's `E --> D[Expense detail] --> ED[Edit]` flow.
- Verbal brief from the user, 2026-08-07: "When we click on a selected expense,
  we see our old expense information menu, and within it, if we click 'Edit', we
  see a new menu for editing… There's also a delete button, as before. Now, if
  we click it, we're asked, 'Are you sure you want to delete this expense?' If
  we click 'Yes', it's immediately deleted."

## Delta from reference
- **Taking:** the whole shipped read view — hero amount, category with its
  colour, author, date, comment, tags — and the two-action footer.
- **Changing (V4), three things:**
  1. **"Edit" navigates to `02b-edit-expense.md`** instead of entering this
     screen's own field-picker. The field picker and its per-field drafts and
     PATCHes are **deleted**, not hidden.
  2. **"Delete" asks via Telegram's popup and then deletes immediately.** The
     inline 5s undo banner is removed.
  3. The date line shows **`spent_at`**, the day the money was spent, not
     `created_at`.
- **Explicitly not taking:** an edit-in-place mode of any kind. There is exactly
  one editing surface in this app and it is the composer.

## Layout
One scroll container, top to bottom `[repo]`.

| # | Region | Geometry |
|---|---|---|
| 1 | Hero amount | 28px/700, tabular, centred, currency code beside it |
| 2 | Category | colour dot + name, one line |
| 3 | Date | the expense's `spent_at`, "Sun, Aug 3" format `[repo]` |
| 4 | Author | "Added by {name}", omitted when the API returns no `user_name` |
| 5 | Comment | full text, wraps, omitted when empty |
| 6 | Tags | the expense's tags as chips, omitted when there are none |
| 7 | **Actions** | "Edit" (`--ink`) and "Delete expense" (`--status-red` text action), full width, stacked |

Nothing here is a form. Every value is text.

## Components used
None. Local markup, as the shipped screen has it.

## Telegram
- **Theme:** all colour from `tokens.css`. The category dot is the only
  saturated colour; `--status-red` on the delete action is the one exception the
  design system already names for destructive text actions.
- **MainButton:** **not used.** The two actions are in-screen because there are
  two of them and one is destructive — MainButton can only be one action, and it
  must never be the destructive one. Screen 02b, one hop away, does use it.
- **BackButton:** shown; returns to `03-expenses.md` **with the filter it was
  opened from intact** `[repo]`.
- **Haptics:** `selection` on Edit; `notificationOccurred('success')` after a
  delete resolves, `('error')` on failure. No haptic on opening the confirm
  popup — Telegram's own popup is the feedback.
- **Viewport:** no keyboard on this screen.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | opened | Skeleton in the final layout `[repo]` |
| Empty | n/a | Unreachable — a detail view always has its one record |
| Error | the fetch rejects | "Couldn't load that expense." + "Try again" `[repo]` |
| 403 | `ForbiddenError` | The detail renders read-only if the read succeeded; **both actions are hidden**. `own_only` makes this reachable: a member may read a partner's expense and not change it |
| Offline | fetch fails, no cache | Error with retry. A single record has no useful cross-session cache, unlike a list — an accepted, deliberate gap `[repo]` |
| Not found | 404 | "That expense no longer exists." and a way back to the list |
| Ready | loaded | The detail with both actions |
| **Confirming (V4)** | "Delete expense" tapped | Telegram's own popup. The screen behind it is unchanged — no inline banner, no dimming of its own |
| **Deleting (V4)** | "Yes" in the popup | Both actions disabled; on success, straight back to `03-expenses.md`, which refetches |
| Delete failed | 403/404/network | Back to `ready` with a message under the actions; the expense was never removed |

## Interactions

| Element | Action | Result |
|---|---|---|
| "Edit" | tap | selection haptic; navigates to `02b-edit-expense.md`, handing over the loaded expense — no refetch |
| "Delete expense" | tap | opens Telegram's confirm popup |
| Popup "Yes" | tap | `DELETE /expenses/{id}`; success haptic; back to the list |
| Popup "Cancel" | tap | nothing happens; **no API call is made** |
| BackButton | tap | back to the filtered list |

### Why the undo banner goes (V4)
The shipped flow deletes optimistically and offers 5 seconds of "Undo" before
the API call. The user asked for a confirm-then-delete flow instead
(2026-08-07). The two are alternatives, not complements: asking first and then
offering to take it back is one interruption too many for deleting a single
row.

What is lost is the recovery path for a mis-tap; what replaces it is that a
mis-tap no longer deletes anything, because the destructive step is behind a
popup that names the action. That is the better trade for a destructive action
on a screen reached by two deliberate taps.

## Copy

| Key | String | Notes |
|---|---|---|
| `action.edit` | "Edit" | |
| `action.delete` | "Delete expense" | `--status-red` text action |
| `confirm.title` | "Delete expense" | Telegram popup title |
| `confirm.message` | "Are you sure you want to delete this expense?" | **(V4)** verbatim from the user, 2026-08-07 |
| `confirm.yes` | "Yes" | **(V4)** verbatim; the popup's destructive button |
| `confirm.cancel` | "Cancel" | |
| `author` | "Added by {name}" | existing `[repo]` |
| `err.load` | "Couldn't load that expense." | |
| `err.notFound` | "That expense no longer exists." | |
| `err.delete` | "Couldn't delete that expense." | on a failed DELETE |
| `err.forbidden` | "You don't have permission to do that." | existing `[repo]` |
| `error.retry` | "Try again" | existing |

## Data

| Call | Notes |
|---|---|
| `GET /expenses/{id}` | the record |
| `GET /categories` | the category's name and colour |
| `GET /users/me` | currency, `family_tz` for the date line |
| `DELETE /expenses/{id}` | after the popup is confirmed |

`PATCH /expenses/{id}` **leaves this screen** — it belongs to 02b now.

### Backend deltas this screen needs
**None.** The date-line fix is a client change: the screen renders
`expense.created_at` today and must render `expense.spent_at`, a field the API
has returned since V3.

## Accessibility
- The category dot is always paired with its name.
- "Delete expense" is a `button` whose accessible name includes the word
  "Delete"; red is never the only signal.
- Focus order: Edit → Delete. Returning from 02b restores focus to Edit
  `[inferred]`.
- The confirm popup is Telegram's own and inherits the client's accessibility —
  this is a reason to use it rather than a custom modal.
- `prefers-reduced-motion`: nothing on this screen animates.

## Edge cases
- **The expense was deleted in another session** — the DELETE returns 404;
  treated as success (it is gone either way) and the user returns to the list.
- **A viewer opens the screen** — both actions hidden, detail readable.
- **A member opens a partner's expense under `own_only`** — same as a viewer:
  readable, both actions hidden, because Edit would 403 at save time.
- **The expense's category was archived** — the name and colour still render;
  archiving never hides history.
- **Delete tapped twice before the popup opens** — one popup, one DELETE.
- **Very long comment** — wraps and scrolls with the page; no truncation on this
  screen, unlike the list row.

## Acceptance criteria
- [ ] The screen shows amount, category with its colour, date, author, comment
      and tags, with the empty ones omitted rather than shown blank.
- [ ] The date line shows the day the expense was **spent** — an expense
      backdated to 3 August and created on 7 August reads 3 August.
- [ ] Tapping "Edit" opens the pre-filled composer (02b), not a list of fields
      to choose from.
- [ ] No field on this screen can be edited in place.
- [ ] Tapping "Delete expense" opens Telegram's own popup reading "Are you sure
      you want to delete this expense?" with "Yes" and "Cancel".
- [ ] Tapping "Cancel" leaves the expense untouched and fires no request.
- [ ] Tapping "Yes" deletes it, returns to the expenses list, and the row is
      gone from the list without a manual refresh.
- [ ] No undo banner appears at any point.
- [ ] For a read-only viewer neither action is rendered.
- [ ] Renders correctly in light and dark from `tokens.css` only.

## Open questions
- ~~[?] **Delete's placement**~~ — **answered 2026-08-07 (HUMAN): "not inside
      the edit form, only in detail screen".** Delete is here and only here.
- [?] **Whether this screen survives at all long-term.** With editing moved to
      02b, its remaining job is "read one expense and choose one of two
      actions". Tapping a list row straight into 02b, with Delete inside it,
      would remove a screen. The brief explicitly keeps the read view
      ("we see our old expense information menu"), so it stays — but if it turns
      out to be a step nobody wants, this is where to revisit.
