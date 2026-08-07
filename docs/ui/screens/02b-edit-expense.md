# Screen: 02b — Edit expense

## Purpose
Change something about an expense that already exists, on **the same surface it
was created on**, with every field already filled in. Reached from screen 03b's
"Edit" action.

It replaces the field-picker flow shipped in V2 (`webapp/src/screens/
expense-detail.ts`: tap Edit → choose *which* field → change it → PATCH,
repeat), which the user judged confusing (2026-08-07, HUMAN: "The current edit
flow… is confusing. Replace it with the same UI used for creating an expense —
pre-filled with the existing values"). It also closes the gap that flow had:
**the date could not be edited at all**, even though `spent_at` has been
writable since V3.

## Reference
- `../screens/02-add-expense.md` — this screen **is** that layout. Every
  geometry, token and component reference there applies here verbatim and is
  not restated below.
- `../refs/02-add-expense/filled.jpg` — the same reference image; the filled
  state is what this screen always opens in.
- Verbal brief from the user, 2026-08-07.

## Delta from reference
- **Taking:** all of screen 02 — amount, account line, category grid, date row,
  tag chips, comment field, in that order and at those sizes.
- **Changing:** every control opens **pre-filled from the expense**; MainButton
  saves instead of creating and is disabled until something actually changes;
  the "More" and "+ Add tag" cells navigate but return here, not to the
  composer; BackButton returns to screen 03b, not to Home.
- **Explicitly not taking:** the field-picker UI it replaces — no "which field
  would you like to change?" step survives. And **no Delete on this screen** —
  deleting stays on 03b (see Open questions).

## Layout
Identical to `02-add-expense.md`'s six regions. No region is added, removed,
resized or reordered. If the two ever diverge visually, that is a bug in this
screen — the point of the change is that creating and editing look the same.

Pre-fill, region by region:

| # | Region | Pre-filled from |
|---|---|---|
| 1 | Amount | `expense.amount`, formatted by `lib/money.ts` into the field |
| 2 | Account | `GET /users/me` — unchanged, still read-only |
| 3 | Categories | `expense.category_id` selected (rounded square, 600 name) |
| 4 | Date | `expense.spent_at`, resolved into the three-pill slot rule |
| 5 | Tags | every tag in `expense.tags` selected |
| 6 | Comment | `expense.comment` |

The date row follows screen 02's pill-3-is-a-slot rule exactly: an expense spent
today/yesterday/two days ago selects pill 1/2/3 unchanged; any older date takes
over pill 3 with its weekday as the second line.

## Components used
- `../components/category-picker.md` — unchanged.
- `../components/date-range-picker.md`, single-date variant — unchanged.
- Chip, field, card — existing.

Every one is the shipped component. This screen introduces no new component.

## Telegram
- **Theme:** identical to screen 02. Nothing here has its own colour.
- **MainButton:** this screen's primary action.
  - Label: `Save changes`.
  - **Disabled while the draft equals the stored expense** — the comparison is
    over all five editable fields (amount, category, date, tags, comment), tags
    compared as a set, not a sequence. Re-selecting the tag that was already
    selected leaves the button disabled.
  - Disabled with `Enter an amount` if the amount is cleared or unparseable,
    and with `Choose a category` if the category is somehow cleared — the same
    two guards screen 02 has, same strings.
  - On tap: `PATCH /expenses/{id}` with **only the changed fields**, success
    haptic, back to screen 03b showing the updated expense.
- **BackButton:** shown; returns to screen 03b. **With unsaved changes it asks
  first**, via Telegram's own popup, using the same discard flow screen 02 uses
  for a dirty draft. The dirty test is the same comparison MainButton uses, so
  the two can never disagree.
- **Haptics:** identical to screen 02 — `selection` on a category tap, tag
  toggle or date pill; `notificationOccurred('success')` after the PATCH
  resolves, `('error')` on failure.
- **Viewport:** identical to screen 02. The amount field is **not** auto-focused
  here `[inferred]` — the keypad opening over a form the user came to read, and
  perhaps to change only a tag, is unhelpful; on screen 02 the whole point was
  that typing starts immediately.
- **Closing confirmation:** `enableClosingConfirmation()` while dirty, disabled
  after a successful save.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | opened before categories/tags resolve | The form skeleton from screen 02, but **the amount, date and comment already filled** — the expense itself came from 03b, which already has it; only the category grid and tag chips skeletonise |
| Empty | n/a | Unreachable: an expense that exists has a category, so the grid is never empty. Stated so the omission is deliberate |
| Error | categories/tags fetch fails, no cache | "Couldn't load categories." + "Try again". Whatever the user has already changed survives the retry |
| 403 | `ForbiddenError` on load or save | "You don't have permission to edit this expense." Every control disabled, MainButton hidden. Reachable via `own_only` — a member may edit their own expense and not a partner's |
| Offline | fetch fails, cache exists | Cached categories and tags, last-synced banner. Saving fails with the network error and **keeps the edits on screen** — no write queue (webapp/CLAUDE.md) |
| Ready | data loaded | The pre-filled form, MainButton disabled until something changes |
| Saving | MainButton tapped | MainButton progress; all controls disabled; exactly one PATCH regardless of taps, the same double-submit guard screen 02 uses |
| Stale expense | 404 on save | "That expense no longer exists." and back to screen 03a — there is nothing to return to on 03b |
| Stale category | 404 on save | "That category no longer exists." Selection cleared, list refetched, the rest of the draft intact |
| Archived category | 409 on save (D302) | "That category was archived. Choose another." Same recovery |
| Future date | 422 on save | Unreachable from the UI (the calendar and pills forbid it) but handled: "Pick a date that isn't in the future." |

## Interactions

| Element | Action | Result |
|---|---|---|
| Amount | type | live parse; inline error; MainButton enables once the value differs and parses |
| Category circle | tap | selection haptic; moves the selection; MainButton enables |
| "More" | tap | navigates to screen 06; returning comes **back here** with the in-progress edits |
| Date pill / calendar | tap | selection haptic; sets the date; MainButton enables |
| Tag chip | tap | toggles; MainButton enables only if the resulting set differs |
| "+ Add tag" | tap | navigates to screen 07; a tag created there returns **pre-selected**, same as screen 02 |
| Comment | type | no validation beyond the 4096 cap |
| MainButton | tap | PATCH → success haptic → screen 03b |
| BackButton | tap | dirty → discard popup; clean → screen 03b |

## Copy

| Key | String | Notes |
|---|---|---|
| `mb.save` | "Save changes" | the only new MainButton string |
| `mb.enterAmount` | "Enter an amount" | existing, unchanged |
| `mb.chooseCategory` | "Choose a category" | existing, unchanged |
| `err.amount` | "Enter an amount greater than 0." | existing |
| `err.categories` | "Couldn't load categories." | existing |
| `err.staleExpense` | "That expense no longer exists." | on 404 for the expense |
| `err.stale` | "That category no longer exists." | existing |
| `err.archived` | "That category was archived. Choose another." | existing |
| `err.futureDate` | "Pick a date that isn't in the future." | defensive; unreachable from the UI |
| `err.forbidden` | "You don't have permission to edit this expense." | 403 |
| `discard.title` | "Discard changes?" | Telegram popup title |
| `discard.confirm` | "Discard" | destructive button |
| `discard.cancel` | "Keep editing" | |

Every string except the six new ones is reused verbatim from screen 02, so the
two screens never drift apart in wording.

## Data

| Call | Notes |
|---|---|
| `GET /users/me` | currency and account name — cached, same as screen 02 |
| `GET /categories` | archived excluded, so an archived category is not offerable |
| `GET /tags` | archived excluded |
| `PATCH /expenses/{id}` | `amount`, `category_id`, `tag_ids`, `comment`, `spent_at` — **only the fields that changed** |

The expense itself is **not fetched here**. It is handed over by screen 03b,
which has just loaded it. Refetching would show a spinner over data the user is
already looking at.

### Backend deltas this screen needs
**None.** `ExpenseUpdate` already carries all five fields including `spent_at`
(V3 U0.2b), `PATCH /expenses/{id}` already enforces ownership and the archived-
category 409, and a future `spent_at` is already 422. This screen is entirely a
frontend change — which is the reason it is cheap enough to be worth doing
properly.

One consequence worth stating: an expense edited here can **move between
periods**. Editing `spent_at` from 3 August to 2 July changes July's and
August's statistics and both months' budget progress (D314). That is intended
and already implemented server-side.

## Accessibility
- Everything screen 02 specifies applies unchanged: the category grid is a
  `radiogroup`, tags are checkboxes, the date row is a `radiogroup`, selection
  is carried by shape and weight rather than colour.
- Focus order: amount → categories → date → tags → comment. **Focus is not
  moved on open** (unlike screen 02, which focuses the amount) — see Viewport.
- The screen's accessible name is "Edit expense", so a screen reader user is
  never told they are creating one.
- `prefers-reduced-motion`: no shape-morph on category selection, same as
  screen 02.

## Edge cases
- **Nothing changed, MainButton tapped** — impossible; the button is disabled.
  No empty PATCH is ever sent.
- **Only whitespace added to the comment** — counts as a change; the API stores
  it. Not worth a trimming rule that then disagrees with screen 02.
- **Comment cleared entirely** — sends `comment: null`, not `""`.
- **All tags removed** — sends `tag_ids: []`, which the API distinguishes from
  "not sent" (`None`); the expense ends with no tags.
- **The expense's current category has since been archived** — it is **not** in
  the grid (archived categories are excluded), so the screen would open with no
  selection. Instead the archived category is rendered in the grid as a
  selected, dimmed cell that cannot be re-selected once the user moves off it
  `[inferred]` — editing the comment of an old expense must not silently
  re-file it.
- **Someone else edits the same expense concurrently** — last write wins, per
  field. No optimistic-concurrency token exists and none is added.
- **Very long comment** — the field scrolls internally, capped at ~5 lines, same
  as screen 02.

## Acceptance criteria
- [ ] The screen renders the same six regions in the same order as screen 02,
      at the same sizes.
- [ ] Opening it on an expense of 38.40 in Groceries with two tags and a comment
      shows all four already filled in, with the Groceries circle drawn as a
      rounded square.
- [ ] The date row opens with the expense's `spent_at` selected — including for
      an expense from three weeks ago, which takes over the third pill.
- [ ] MainButton reads "Save changes" and is **disabled** until a field changes.
- [ ] Toggling a tag off and back on returns MainButton to disabled.
- [ ] Changing only the date and saving updates the expense's day on screen 03a
      without changing its amount.
- [ ] Saving sends exactly one PATCH no matter how fast MainButton is tapped
      twice.
- [ ] BackButton with an unsaved change opens Telegram's discard popup; with no
      change it returns to 03b immediately.
- [ ] There is no yellow button and no delete action anywhere on this screen.
- [ ] After a successful save the app is on screen 03b showing the new values,
      not on Home.
- [ ] Renders correctly in light and dark from `tokens.css` only.

## Open questions
- ~~[?] **Where Delete lives.**~~ — **answered 2026-08-07 (HUMAN): "not inside
      the edit form, only in detail screen".** Delete lives on 03b and nowhere
      else. This screen has no destructive action, which is also why it can use
      MainButton without ambiguity.
- [?] **Auto-focus.** `[inferred]` that the amount field should *not* steal
      focus on open. If editing the amount is the overwhelmingly common reason
      to open this screen, focusing it (and selecting its contents) would be
      better.
