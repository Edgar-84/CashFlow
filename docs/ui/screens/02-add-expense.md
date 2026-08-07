# Screen: 02 — Add expense

## Purpose
Record an expense in under ten seconds on one surface — no wizard, no five-turn
conversation. Amount is focused on open so the numeric keypad is up immediately;
everything else is a tap.

This spec **extends** the shipped composer (`webapp/src/screens/add-expense.ts`)
rather than replacing it: the draft model, the double-submit guard and the
MainButton contract are unchanged. What is new is the account line, the category
grid, the date row and the tag affordance.

## Reference
- `../refs/02-add-expense/empty-keypad.jpg` — empty amount, keypad up, category
  grid with "More"
- `../refs/02-add-expense/filled.jpg` — amount entered, category selected, date
  shortcuts, tag chips, comment field
- Verbal brief from the user, 2026-08-04

## Delta from reference
- **Taking:** the vertical order (amount → account → categories → date → tags →
  comment); the large centred amount with the currency code beside it and a rule
  under it; the 4-column category grid of circles with names underneath; the
  trailing "More" circle in the grid; the selected category marked by a **rounded
  square** rather than a circle; the three date shortcut pills with a calendar
  button at the right end; the outlined tag chips wrapping over two rows; the
  bottom comment field.
- **Changing:**
  - Category circles are **plain colour, no glyph** (design-system Iconography).
  - The account line is **read-only text**, not a picker — one account per user.
  - Selecting the date opens our own month-grid picker (D303), not the OS one.
  - The tag row gets an explicit **"+ Add tag"** chip; the reference uses a
    magnifying glass that opens a search, which we do not have.
  - Submission is Telegram's **MainButton**, not the reference's floating yellow
    "Add" pill. The FAB's yellow is reserved to screen 01 alone
    (design-system `--accent`).
- **Explicitly not taking:** the green app bar and `EXPENSES / INCOME` tabs; the
  calculator button beside the currency; the Photo attachment row; the
  reference's brand green; per-category glyphs; the account switcher.

## Layout
Single scroll container, top to bottom. Nothing fixed — MainButton is native
chrome and sits outside the scroll area.

| # | Region | Geometry |
|---|---|---|
| 1 | **Amount** | centred; 34px/600 input, currency code 20px/500 in `--ink-secondary` to its right, 1px `--separator` rule under the input only. `28px` top padding |
| 2 | Account | label "Account" 12px `--ink-secondary`, value 15px `--ink` below it. Left-aligned, `20px` above |
| 3 | Categories | label "Categories"; 4-column grid, 64px circles, 12px column gap, 16px row gap, name 12px centred under each circle at max two lines |
| 4 | Date | horizontal row: three 88×44px pills + calendar button pushed to the right edge. `24px` above |
| 5 | Tags | label "Tags"; chips wrapping, 32px tall, 8px radius, 1px `--separator` border, 8px gaps. "+ Add tag" is the **last** chip |
| 6 | Comment | label "Comment"; single-line-growing field, `--separator` underline, no counter. `24px` above, `96px` below to clear MainButton |

### Amount
- Placeholder is empty, not `0` — a zero has to be deleted before typing.
- `inputmode="decimal"`, so the numeric keypad opens without a custom keypad
  (the reference draws its own; we do not).
- Parsing is unchanged: `lib/money.ts::parseAmount`, comma and dot, `1 234,56`,
  rejects `<= 0`.
- The currency code comes from `GET /users/me` (`accounts.currency`, D211). It
  is **text, not a control** — there is nothing to choose.

### Account
Read-only. Shows `accounts.name`. It exists because the reference has it and
because it answers "which account is this landing in?" before the user submits —
but this app has exactly one account per user, so it never becomes a picker.

**This is a contract delta** (verified 2026-08-04): `models/user.py::UserMeResponse`
extends `UserResponse` with `currency` and nothing else — the account's `name`
never reaches the client, even though `models/account.py::AccountResponse`
carries it. `UserMeResponse` gains `account_name: str`, read from the same
`accounts` join that already supplies `currency`, and `webapp/src/api/types.ts`
mirrors it in the same unit. Small, but it is a backend change, not a frontend
one.

### Categories
- Sorted `created_at ASC`, the same order everything else uses.
- Circle filled with the category's `color_slot` colour; **no glyph, no letter**.
- **Selected** state: the circle becomes a 12px-radius rounded square of the
  same colour and the name goes 600 weight `[ref]` — the reference marks
  selection by shape change, which is exactly the "never colour alone" rule
  satisfied for free.
- Single-select, required.
- The **last cell is always "More"** — a `--separator`-filled circle with a `+`
  in `--ink-secondary` and the label "More". Tapping it navigates to screen 06
  (Categories), where a category can be created and its colour chosen.
- Archived categories (`is_active = false`, D302) never appear here.

### Date
Three pills plus a calendar button. Each pill is two lines `[ref]`: the numeric
date above, the word below.

| Pill | Line 1 | Line 2 |
|---|---|---|
| 1 | `8/4` | "today" |
| 2 | `8/3` | "yesterday" |
| 3 | `8/2` | "two days ago" |

- Default selection is **today**, so a user who ignores the row gets today's
  date — the current behaviour, unchanged.
- Selected pill: `--ink` background, `--card` text `[ref]`. Unselected:
  transparent, `--ink` text.
- The calendar button opens a **single-date** month grid — the same component
  as the range picker in its single-date variant
  (`../components/date-range-picker.md`), not a second calendar.
- **Future dates are not selectable**, in the pills or the calendar. Same rule
  as screen 01's arrows.
- Once a calendar date outside the three shortcuts is chosen, a fourth pill
  appears showing it, selected, and the row scrolls horizontally if needed
  `[inferred]`.

### Tags
- Multi-select, optional. Selected chip: `--ink` background, `--card` text.
- Chips wrap; the row grows. No horizontal scroll — a hidden tag is an
  unfindable tag.
- **"+ Add tag"** is the last chip, always, and navigates to screen 07 (Tags)
  where a tag can be created. On returning, the tag list refetches and a
  just-created tag is **pre-selected** (2026-08-04) — it is the only reason to
  have gone there.
- Archived tags never appear.
- **No fold in v1** (2026-08-04). Every tag is visible and the row grows. If it
  becomes unusably tall in real use, that is a follow-up with a real number
  behind it rather than a threshold guessed now.

### Comment
Optional, `4096` max. **No character counter** (2026-08-04) — the reference
shows a permanent `0/4096`, which is noise on a field almost nobody fills and
nobody overflows. The cap is enforced silently by `maxlength`.

## Components used
- `../components/category-picker.md` — region 3. **Does not exist yet.**
- `../components/date-range-picker.md` — the calendar button's target, in its
  single-date variant. **Does not exist yet** (U1.5).
- Chip, field, card — existing in `app.css`.

## Telegram
- **Theme:** all colours from `tokens.css`. In dark, the selected category's
  rounded square and the selected date pill keep their fills; only the token
  values change. Category colours do **not** dim in dark mode.
- **MainButton:** **yes, this screen's primary action.** Unchanged from today —
  label restates the action (`Add 38.40 EUR to Groceries`), disabled with
  "Choose a category" until one is picked and "Enter an amount" until the amount
  parses. There is **no** yellow FAB on this screen; `--accent` belongs to
  screen 01.
- **BackButton:** shown; returns to screen 01. With a dirty draft it asks first,
  via Telegram's own popup — unchanged. A draft is dirty if amount, category,
  tags or comment differ from empty; **a changed date alone does not make it
  dirty** (2026-08-04) — someone who only tapped "yesterday" and then went back
  should not be interrogated about discarding a draft they never started.
- **Haptics:** `selection` on a category tap, a tag toggle and a date pill tap;
  `notificationOccurred('success')` after the POST resolves; `('error')` on a
  failure. Unchanged.
- **Viewport:** the keyboard is up on open and covers roughly the lower half.
  The comment field must scroll into view when focused — the field being typed
  into is never under the keyboard. `Telegram.WebApp.viewportStableHeight` is
  the height to lay out against, not `100vh`.
- **Closing confirmation:** `enableClosingConfirmation()` while the draft is
  dirty, disabled again after a successful submit `[inferred]`.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | first open | Skeletons in the final layout: amount rule, 8 circle skeletons in the grid, 6 chip skeletons. Amount field is **live and focused** immediately — typing never waits on a fetch. |
| Empty | account has no categories | The grid holds only the "More" cell, with "Create your first category to add an expense." MainButton disabled. |
| Error | categories/tags fetch fails, no cache | "Couldn't load categories." + "Try again". The amount field keeps whatever was typed. |
| 403 | `ForbiddenError` | "You have read-only access to this account." Form rendered but every control disabled; MainButton hidden. |
| Offline | fetch fails, cache exists | Cached categories and tags with a last-synced banner. Submitting while offline fails with the network error and **preserves the draft** — v1 has no write queue. |
| Ready | data loaded | The form. |
| Invalid amount | amount typed, doesn't parse | Inline message under the rule ("Enter an amount greater than 0."), never a popup. MainButton disabled. |
| Submitting | MainButton tapped | MainButton shows its progress; **all** controls disabled; exactly one POST regardless of taps (D118/D123 guard, unchanged). |
| Stale category | 404 on submit | "That category no longer exists." Category selection cleared, list refetched, draft otherwise intact. |
| Archived category | 409 on submit (D302) | "That category was archived. Choose another." Same recovery as 404. |

## Interactions

| Element | Action | Result |
|---|---|---|
| Amount | type | live parse; inline error on invalid; MainButton label updates |
| Category circle | tap | selection haptic; becomes the single selection; MainButton relabels |
| "More" | tap | navigates to screen 06 (Categories) |
| Date pill | tap | selection haptic; sets the expense date |
| Calendar button | tap | opens the single-date picker; BackButton then closes the **picker**, not the screen |
| Tag chip | tap | toggles; multi-select |
| "+ Add tag" | tap | navigates to screen 07 (Tags); a tag created there returns pre-selected |
| Comment | type | no validation beyond the length cap |
| MainButton | tap | POST; on success: success haptic → back to screen 01 with the donut redrawn |
| BackButton | tap | dirty → Telegram popup asking to discard; clean → screen 01 |

## Copy

| Key | String | Notes |
|---|---|---|
| `label.account` | "Account" | |
| `label.categories` | "Categories" | |
| `label.tags` | "Tags" | |
| `label.comment` | "Comment" | also the field's placeholder |
| `cat.more` | "More" | the trailing grid cell |
| `tag.add` | "+ Add tag" | the trailing chip |
| `date.today` | "today" | lowercase, as the reference |
| `date.yesterday` | "yesterday" | |
| `date.twoDaysAgo` | "two days ago" | |
| `mb.chooseCategory` | "Choose a category" | existing, unchanged |
| `mb.enterAmount` | "Enter an amount" | existing, unchanged |
| `mb.submit` | "Add {amount} {currency} to {category}" | existing, unchanged |
| `err.amount` | "Enter an amount greater than 0." | existing, unchanged |
| `err.categories` | "Couldn't load categories." | |
| `err.stale` | "That category no longer exists." | on 404 |
| `err.archived` | "That category was archived. Choose another." | on 409 (D302) |
| `empty.categories` | "Create your first category to add an expense." | |
| `readonly` | "You have read-only access to this account." | existing, unchanged |

## Data

| Call | Notes |
|---|---|
| `GET /users/me` | currency **and account name** |
| `GET /categories` | names + `color_slot`; archived excluded (`include_archived=false`, D306) |
| `GET /tags` | archived excluded |
| `POST /expenses` | `amount`, `category_id`, `tag_ids`, `comment`, **`spent_at`** |

### Backend deltas this screen needs

1. **`expenses.spent_at DATE NOT NULL DEFAULT current_date`** (D314, migration
   — root CLAUDE.md's stop-and-ask gate applies). Added to `ExpenseBase`, so it
   flows through `ExpenseCreate`, `ExpenseUpdate` and `ExpenseResponse`.
   Backfill `spent_at = (created_at AT TIME ZONE family_tz)::date` so no
   existing row moves. Every statistics query and `resolve_period` switches from
   `created_at` to `spent_at`; `created_at` stays as the audit trail.
   - The **bot** keeps working untouched: omitting `spent_at` defaults to
     today, which is exactly what it does now.
   - A `spent_at` in the future is **422**. Same rule as everywhere else.
2. **409 on writing into an archived category** (already in the V3 plan).
3. **`UserMeResponse.account_name`** — confirmed missing (see Account above).
   One field, same join, mirrored in `api/types.ts`.
4. **`UserMeResponse.today`** (U3.3) — confirmed missing. The date row's
   "today"/"yesterday"/"two days ago" pills and their `spent_at` must resolve
   in `family_tz`, never the device clock (D120's bug class) — nothing before
   this exposed the family's current date to the client. Computed
   server-side (`api/deps.py`) from `get_settings().family_tz`, mirrored in
   `api/types.ts`.

## Accessibility
- Every category swatch has its name directly under it; the swatch is never the
  only identifier. Selection is carried by **shape** (circle → rounded square)
  and weight, not colour.
- The category grid is a `radiogroup`; tags are checkboxes; the date row is a
  `radiogroup`. Arrow keys move within each.
- The amount input has a visible label for screen readers even though the visual
  design has none.
- Focus order: amount → account (skipped, not focusable) → categories → date →
  tags → comment. MainButton is native chrome and comes last.
- `prefers-reduced-motion`: no shape-morph animation on category selection; the
  square appears instantly.

## Edge cases
- **Long category name** — two lines under the circle, then ellipsis. The grid
  row's height is set by the tallest label so cells stay aligned.
- **One category** — the grid is that one cell plus "More".
- **Twenty categories** — the grid grows to five rows; the page scrolls. No fold.
- **No tags at all** — the Tags section shows only "+ Add tag".
- **Comment of 4096 characters** — the field scrolls internally, capped at ~5
  lines tall `[inferred]`; the page does not become unusable.
- **Date set to a day before the account existed** — allowed. Analytics simply
  show it there.
- **Submit while the keyboard is up** — MainButton is above the keyboard; no
  layout change needed.
- **Rapid double tap on MainButton** — exactly one POST (existing guard).
- **Returning from screen 06 with a new category** — the list refetches and the
  new category is present; the draft's amount, tags and comment survive.

## Acceptance criteria
- [ ] On open, the amount field has focus and the numeric keypad is up before
      any network call resolves.
- [ ] The currency code renders to the right of the amount, in
      `--ink-secondary`, and is not tappable.
- [ ] The account name renders under an "Account" label and is not tappable.
- [ ] The category grid is 4 columns of 64px filled circles, each with its name
      centred underneath, and contains no glyphs or letters inside the circles.
- [ ] Tapping a category turns its circle into a rounded square of the same
      colour and bolds its name; tapping another moves the selection.
- [ ] The last grid cell reads "More" and opens the Categories screen.
- [ ] The date row shows three pills reading "today", "yesterday" and "two days
      ago" with their dates above, plus a calendar button at the right end.
- [ ] "today" is selected on open, and the created expense's `spent_at` matches
      the selected pill.
- [ ] No date after today can be selected, in the pills or the calendar.
- [ ] The tag row's last chip reads "+ Add tag" and opens the Tags screen.
- [ ] Selecting two tags and submitting creates one expense carrying both.
- [ ] MainButton reads "Choose a category" and is disabled until a category is
      picked, then restates the amount, currency and category.
- [ ] There is no yellow button anywhere on this screen.
- [ ] BackButton with anything typed asks before discarding, via Telegram's
      popup and not a custom modal.
- [ ] Focusing the comment field scrolls it clear of the keyboard.
- [ ] Renders correctly in both light and dark from `tokens.css` only.

## Resolved
- `GET /users/me` does **not** expose `accounts.name` (verified 2026-08-04) — it
  is a contract delta; see Account and Data above.
- **No tag-row fold** in v1; **new tag pre-selected** on return from screen 07;
  **a date change alone does not make the draft dirty**; **no comment counter**
  (all 2026-08-04). Each is written into the sections above.
- The **calendar's single-date variant gets no quick chips** — the three date
  pills already cover today / yesterday / two days ago.

## Open questions
None blocking. Global `[?]`s (safe-area insets, focus states) live in
`../design-system.md`; the category-grid fold question lives in
`../components/category-picker.md`.
