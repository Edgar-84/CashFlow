# Screen: 03 — Expenses

## Purpose
What actually happened, day by day, in whatever slice the user arrived with.
Grouped by day with a per-day subtotal, because a flat list of 38 rows answers
nothing and the same list grouped answers "was Saturday expensive?" with no
interaction.

**First spec for a shipped screen.** `webapp/src/screens/expenses.ts` was built
in V2 from `docs/design/mini-app-ux.md` §4, before `docs/ui/` existed. This file
documents what is there and specifies the three V4 changes, so the next change
has something to read.

## Reference
- The shipped screen (`webapp/src/screens/expenses.ts`, `app.css`'s `.exp-*`
  rules) — every value marked `[repo]` below was read out of it, not measured
  off an image.
- `docs/design/mini-app-ux.md` §4 screen 03 — the original intent.
- Verbal brief from the user, 2026-08-07, for the V4 changes.

## Delta from reference
- **Taking:** the shipped layout in full — day cards, per-day subtotal, one row
  per expense with a colour dot, comment, tags, author initial and amount.
- **Changing (V4), three things:**
  1. The screen is reachable **with a period as well as a category**, and both
     are applied by the API rather than by filtering one fetched page.
  2. Day grouping keys off **`spent_at`**, not `created_at`.
  3. The row's colour dot is specified rather than incidental: it is present
     whenever the category has a colour, and never taller than the row's title.
- **Changing (V8):** the screen is also reachable **with a tag as well as a
  category**, applied by the API the same way `category_id` already is (D802)
  — never a client-side filter of one fetched page. `category_id` and
  `tag_id` are AND-combined when both are present (D803), though no UI sends
  both today, so this spec defines copy only for tag-alone and
  tag-plus-period; the filter banner and empty state below gain that tag half
  beside the existing category half.
- **Explicitly not taking:** swipe-to-delete and the 5s undo toast named in the
  UX brief. Neither was built, and V4 moves deletion to a confirm popup on 03b
  (`03b-expense-detail.md`); a swipe gesture inside a Telegram webview competes
  with the client's own horizontal swipes.

## Layout
One scroll container, top to bottom. Nothing fixed.

| # | Region | Geometry |
|---|---|---|
| 1 | Offline banner | full width, only in `offline` `[repo]` |
| 2 | **Filter banner** | one line, 12px `--ink-secondary`, only when a filter is in force |
| 3 | Day cards | one `--card` per day, 14px radius, 12px gap `[repo]` |
| 3a | ↳ Day header | day label left, subtotal + currency right, 1px `--separator` under it `[repo]` |
| 3b | ↳ Expense rows | `10px 13px` padding, one 1px `--separator` between rows `[repo]` |
| 4 | "Load more" | full-width button, only when more pages exist `[repo]` |

### Expense row
Left to right: **dot · main column · author initial · amount**.

- **Dot** — 9px circle in the category's slot colour `[repo]`, vertically
  centred against the row's first line. 9px sits under the 13.5px title's line
  box, satisfying the brief's "no wider than the height of the category name"
  (2026-08-07, HUMAN). It is drawn **only when the category resolves to a
  colour**; an unknown or deleted category falls back to the "Other" grey the
  donut uses, never to no dot — a missing dot would misalign the column.
- **Main column** — title (the category name, 13.5px/600), then the comment if
  any (12px `--ink-secondary`), then the tags as one comma-joined line (12px
  `--ink-secondary`) `[repo]`.
- **Author initial** — one uppercase letter, 10.5px/700, only when the API
  returned `user_name` `[repo]`.
- **Amount** — tabular numerals, right-aligned, never wraps `[repo]`.

The row is the same in every filter mode. When the list is filtered **to one
category** the title repeats that category on every row, which is redundant but
kept: identity is never carried by colour alone (design-system), and the dot
without its name would be exactly that.

## Components used
None. Every element is local to this screen — the dot, day card and rows are
`app.css` classes, not shared components.

## Telegram
- **Theme:** all colour from `tokens.css`; category dots keep their slot colour
  in both themes, all other colour is ink.
- **MainButton:** **not used.** This screen has no primary action — it is a list
  to read and tap into. Nothing occupies the bottom of the screen; the page's
  96px reserve stays empty so MainButton is not competed with on the screen the
  user lands on after tapping into it (02b uses it).
- **BackButton:** shown; returns one step, to whichever screen opened this
  one — **screen 01** for a Home-initiated filter, or **screen 05** for a
  category- or tag-bar tap from Statistics — with that screen's own state
  (period, grouping) intact (`../navigation.md`).
- **Haptics:** `selection` on a row tap. None on "Load more" — it is a
  continuation, not a choice.
- **Viewport:** no keyboard on this screen. Long lists scroll normally.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | first open, or a new filter | Two skeleton day cards at the real row height, no reflow when data lands `[repo]` |
| Empty | the filter resolves to zero expenses | One line naming **both halves of the filter in force** — "Nothing in August for Transport." — never a generic "no expenses". BackButton is the way out |
| Error | the call rejects and there is no cache | "Couldn't load expenses." + "Try again" `[repo]` |
| 403 | `ForbiddenError` | "You don't have permission to view expenses." No rows `[repo]` |
| Offline | the call rejects and a snapshot exists | Last loaded page with the last-synced banner; "Load more" is disabled — a further page needs the network `[repo]` |
| Populated | rows exist | Day cards, newest day first |
| Partial (`own_only`) | an override row restricts the caller | Only their own expenses, **silently** — no error, no explanation. The API already filters; this screen shows what it gets |
| End of list | the last page came back short | The "Load more" button is absent, not disabled |

## Interactions

| Element | Action | Result |
|---|---|---|
| Expense row | tap | selection haptic; navigates to `03b-expense-detail.md` for that expense |
| "Load more" | tap | fetches the next page **with the same filter**, appends, keeps scroll position |
| BackButton | tap | one step back — screen 01 or screen 05, whichever opened this list (`../navigation.md`) |

There is no swipe gesture on this screen, and no long-press.

## Copy

| Key | String | Notes |
|---|---|---|
| `filter.both` | "Transport · August" | **(V4)** category name, `·`, the period label from `lib/period.ts::describe` |
| `filter.categoryOnly` | "Transport" | when no period is in force |
| `filter.periodOnly` | "August" | when only a period is in force |
| `filter.tagOnly` | "Coffee" | **(V8)** tag name alone; mirrors `filter.categoryOnly` |
| `filter.tagAndPeriod` | "Coffee · August" | **(V8)** tag name, `·`, the period label; mirrors `filter.both` |
| `empty.both` | "Nothing in August for Transport." | **(V4)** names both halves |
| `empty.categoryOnly` | "Nothing here yet for Transport." | existing string `[repo]` |
| `empty.periodOnly` | "Nothing in August." | **(V4)** |
| `empty.tag` | "Nothing tagged Coffee." | **(V8)** |
| `empty.tagPeriod` | "Nothing in August tagged Coffee." | **(V8)** |
| `empty.unfiltered` | "No expenses yet." | existing `[repo]` |
| `unknownTag` | "Unknown tag" | **(V8)** a tag deleted between the tap that filtered to it and this screen's load; mirrors the archived-category fallback (Edge cases) but as a name, not a dot colour |
| `error.load` | "Couldn't load expenses." | |
| `error.retry` | "Try again" | existing |
| `forbidden` | "You don't have permission to view expenses." | existing `[repo]` |
| `offline.banner` | "Offline — showing data from {time}" | existing |
| `loadMore` | "Load more" | existing |
| `day.subtotal` | "{amount} {currency}" | existing |

The period half of every filter and empty string is rendered by the **same**
`describe()` the period selector uses, so the list and the screen that opened it
never name the same period two different ways.

## Data

| Call | Params | Notes |
|---|---|---|
| `GET /expenses` | `limit`, `offset`, **`category_id`**, `tag_id` **(V8)**, **`period` + `offset_periods`** \| **`start_date`/`end_date`** | the bold groups are V4; `tag_id` is V8 |
| `GET /categories` | — | names + colours for the dots |
| `GET /tags` | — | names, for the tag half of the filter banner and empty state **(V8)** |
| `GET /users/me` | — | currency, `family_tz` day grouping |

### Backend deltas this screen needs (V8)
1. **`GET /expenses` gains a `tag_id` filter**, server-side, for the identical
   reason `category_id` is server-side (see the V4 note below): a client-side
   filter of one fetched page makes pagination and the filter disagree.
   `tag_id` AND-combines with `category_id` when both are present (D803),
   though no screen sends both today.

### Backend deltas this screen needs (V4)

1. **`GET /expenses` gains a `category_id` filter.** Today the route takes
   `limit`/`offset` only and `buildExpensesData` filters the fetched page in the
   browser. That is wrong at the boundary: a category with no expenses among
   the newest 50 rows renders as "nothing here yet" while its expenses exist on
   page 2. Server-side filtering is what makes pagination and the filter agree.
2. **`GET /expenses` gains the period selector family**, resolved by the same
   `services/period.py::resolve_period` the statistics routes use — never
   re-implemented. The same mutual-exclusivity rule applies, and the same 422s.
   **Naming caution:** the route already has an `offset` (pagination). The
   period's offset therefore cannot be called `offset` here; it needs a distinct
   name, and both this screen and `api/expenses.py` must use the same one. The
   plan file owns that choice.
3. **Filtering must key off `spent_at`**, like every other period filter since
   D314 — including the `AT TIME ZONE` conversion `expense_repo.get_by_period`
   already does, not a naive comparison.
4. **Day grouping moves to `spent_at`** on the client. `groupByDay` currently
   keys off `created_at` (`webapp/src/screens/expenses.ts`), so an expense
   backdated to 3 August appears under 7 August, the day it was typed — a
   defect against D314 that shipped with V3 and is visible on this screen and
   nowhere else. The subtotals move with it.

## Accessibility
- Every dot is paired with the category name in the same row; colour is never
  the only identifier.
- The author initial is decorative (`aria-hidden`); the full name is not
  rendered, so the row's accessible name is "{category}, {amount}" plus the
  comment when present.
- Rows are `button`s with the full row as the hit target, at least 44px tall.
- The filter banner is a live region so a screen reader announces what the list
  narrowed to when arriving from Home.
- `prefers-reduced-motion`: disables the skeleton pulse; there is no other
  motion here.

## Edge cases
- **A day with 40 expenses** — one card, scrolls with the page, subtotal at the
  top stays with the card.
- **An expense with no comment and no tags** — the main column is one line; row
  height shrinks accordingly.
- **A category deleted after the expense was written** — the archived category
  still names the row (archived rows are readable, D302/D306); a genuinely
  missing one falls back to "Unknown" with the grey dot `[repo]`.
- **Filter resolves to a period before the account existed** — the empty state,
  not an error, same rule as Home.
- **`own_only` shortens a page** — the page may render fewer than `limit` rows
  and still have more; "Load more" is driven by what the API returned, not by
  the count after filtering.
- **A period filter plus "Load more"** — every page carries the same period; a
  later page must not silently drop it.
- **A tag deleted between the tap that filtered to it and this screen's load
  (V8)** — the banner and empty state fall back to `unknownTag` ("Unknown
  tag") rather than throwing, mirroring the archived-category fallback above.

## Acceptance criteria
- [ ] Arriving from Home's Day tab on yesterday with one 5.00 Transport expense
      shows exactly one row, under one day card.
- [ ] Arriving from Home's Month tab on a month with 6 Transport expenses shows
      exactly those 6, across however many day cards they fall on.
- [ ] The filter banner names both halves — "Transport · August" — and the
      period half reads identically to Home's period label.
- [ ] Every row carries a filled circle no larger than 9px in its category's
      colour, to the left of the category name.
- [ ] An expense whose `spent_at` is 3 August and whose `created_at` is 7 August
      appears under 3 August, and that day's subtotal includes it.
- [ ] The empty state names the category **and** the period.
- [ ] "Load more" fetches the next page with the same category and period, and
      never returns rows outside the filter.
- [ ] Tapping a row opens screen 03b for that expense.
- [ ] BackButton returns one step, to whichever screen opened this list —
      when that is Home's own bar tap, BackButton returns to Home with
      Home's period unchanged (`../navigation.md`).
- [ ] Renders correctly in light and dark from `tokens.css` only.
- [ ] Arriving filtered to a tag with a period also in force shows the banner
      "{tag} · {period}" (`filter.tagAndPeriod`), and at zero rows the empty
      string names both halves ("Nothing in {period} tagged {tag}.").
- [ ] Arriving filtered to a tag with no period shows the banner as just the
      tag name (`filter.tagOnly`), and at zero rows "Nothing tagged {tag}."
- [ ] A tag deleted between the tap and this screen's load renders "Unknown
      tag" in the banner and empty state rather than throwing.

## Open questions
- [?] **Does the "Expenses" side-menu row carry a period?** It opens this screen
      unfiltered (all-time, newest first), which is the shipped behaviour and is
      left alone. If it should instead inherit Home's period, that is a one-line
      change to the menu's handler and a different empty string.
- [?] **`limit` on a filtered list.** Page size stays 50 `[repo]`. A day-scoped
      filter almost never fills one page, so pagination is invisible there; no
      reason to tune it before that is a real complaint.
