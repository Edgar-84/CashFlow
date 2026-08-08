# Screen: 04 — Budgets

## Purpose
Seeing, at a glance, how close each category is to its monthly limit — and
reaching the form that sets or changes one. Opened from the side menu's
"Budgets" row.

## Reference
No screenshot. Like `03-expenses.md`, this is the **first written spec for an
already-shipped screen**: the list half is transcribed from
`webapp/src/screens/budgets.ts` (U2.4) so the V5 change has something to be a
delta *from*. The list half is therefore `[ref: shipped code]`, not a proposal.
- `docs/design/mini-app-ux.md` §4 "04 — Budgets" — the intent behind the tick,
  the never-repainted bar, and the contextual MainButton.
- Verbal brief from the user, 2026-08-08 — the V5 change (see Delta).

## Delta from reference
- **Taking, unchanged:** everything about the two lists. Budgeted rows at the
  top with their fill bars and threshold ticks; unbudgeted categories below as
  invitations; the bar in the category's own colour, never repainted by status;
  status spelled out in words with an icon. The user's brief is explicit that
  this layout stays ("keep the current layout").
- **Changing:** **the form leaves this screen** (D506). Tapping a budgeted row
  or an unbudgeted category used to render an inline form card *below both
  lists*; it now navigates to `04b-budget-form.md`, a separate screen, the way
  tapping an expense row navigates to `03b-expense-detail.md`. Nothing else
  about this screen changes.
- **Explicitly not taking:** no change to the notification fan-out, the
  progress endpoint, the N-small-calls fetch shape, or the delete flow's
  Telegram confirm popup. V5 is a navigation change and a default, not a
  rewrite of budgets.

### Why the inline form had to go
Three concrete problems the user hit, all of them consequences of one form
living at the bottom of a scrolling list:

1. **It opened off-screen.** With more than a couple of categories, the form
   card renders below both lists — the tap appeared to do nothing until you
   scrolled.
2. **Nothing said which budget it was for in edit mode.** The create form is
   titled "Set budget for Groceries"; the edit form is titled "Edit budget",
   and the row it belongs to may be scrolled out of view.
3. **It fought MainButton.** MainButton keeps offering "Set budget for {next
   unbudgeted}" while the form for a *different* category is open, so the
   screen has two competing primary actions — precisely what
   `ui-spec/references/telegram-miniapp.md` says to decide per screen.

A separate screen answers all three at once and needs no new concepts: the
Expenses → Expense detail pattern already exists in this app.

## Layout
Single scroll container, top to bottom. `96px` bottom padding to clear
MainButton.

| # | Region | Geometry |
|---|---|---|
| 1 | Offline banner | only in the offline state; existing `.offline-banner` |
| 2 | **Budgeted list** | one `card`; one `.budget-row` per plan, in category creation order |
| 3 | **Unbudgeted list** | one `card`; one full-width `.budget-invite` button per category with no plan, in creation order. Omitted entirely when every category has a plan |
| ~~4~~ | ~~Inline form~~ | **removed in V5 (D506)** — see `04b-budget-form.md` |

### Budget row (region 2)
Three lines, `[ref: shipped code]`:
1. **Head** — a colour dot in the category's slot colour, the category name,
   and `spent / limit CUR` right-aligned.
2. **Bar** — a track with a fill in the category's own colour, width = the
   API's `fill_pct` clamped to 0–100, plus a **tick** at `notify_threshold`.
   The bar is never recoloured by status; that is the whole point of the tick.
3. **Status line** — words plus an icon, never colour alone.

### Invitation row (region 3)
A colour dot, the category name, and the trailing call to action.

## Components used
None from `../components/` — this screen's rows are its own markup. It shares
the dot + name identity pairing with every other screen.

## Telegram
- **Theme:** every colour from `tokens.css`. The bar fill and dot are
  `--category-slot-{n}`; the over-budget status line is `--status-red` and
  always carries the ⚠ glyph and a word.
- **MainButton:** contextual — "Set budget for {first unbudgeted category}",
  hidden once every category has a plan and in every non-ready state. In V5 it
  **navigates to `04b-budget-form.md` in create mode** instead of opening an
  inline form. It is re-applied after every mutation, because creating or
  deleting a plan changes what "next" means.
- **BackButton:** always shown; returns to `01-home.md`.
- **Haptics:** `selection` on tapping a row or an invitation.
- **Viewport:** no keyboard on this screen any more — the amount field moved to
  04b. This is a second, quieter benefit of the split: the list no longer has
  to survive the keyboard opening over it.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | on open, before the fetches resolve | two `.budget-row-skeleton` blocks in the final layout |
| Empty | the account has **no categories at all** | "Add a category first — every budget needs one." No lists, no MainButton |
| Error | any fetch fails and there is no cached snapshot | the failure in a sentence + "Try again" |
| 403 | the caller cannot read budget plans | "You don't have permission to view budgets." — read-only surface, no buttons |
| Offline | a fetch fails but a cached snapshot exists | last-loaded lists + the offline banner with the last-synced time |
| Populated, no budgets | categories exist, none has a plan | "No budgets yet — set one below." **above** the invitation list, which is the actual call to action |
| Populated | ≥1 plan | Both lists |

## Interactions

| Element | Action | Result |
|---|---|---|
| Budgeted row | tap | `selection` haptic; **navigates to `04b-budget-form.md` in edit mode** for that plan |
| Invitation row | tap | `selection` haptic; **navigates to `04b-budget-form.md` in create mode** for that category |
| MainButton | tap | navigates to `04b-budget-form.md` in create mode for the first unbudgeted category |
| BackButton | tap | returns to `01-home.md` |
| "Try again" | tap | re-runs the load |

Returning from 04b after a successful save or delete **re-runs the load** so
the bars and the two lists reflect the change. `[inferred]` — the same
re-fetch-on-return shape `06-categories.md` uses after 06b. This deliberately
gives up the shipped inline form's cleverness of patching one row in place from
the mutation's own response: that optimisation existed to avoid a full reload
while staying on the screen, and once the form is a separate screen the reload
is the simpler correct thing. It also retires `fetchProgress`'s
`spentKnown: false` fallback path, which existed only to describe a row patched
from a mutation whose progress read-back failed.

## Copy
Every string below is **already shipped** and reused verbatim; V5 introduces no
new copy on this screen.

| Key | String | Notes |
|---|---|---|
| `empty.noCategories` | "Add a category first — every budget needs one." | the Empty state |
| `empty.noBudgets` | "No budgets yet — set one below." | populated-but-unbudgeted |
| `invite.cta` | "Set a budget" | trailing text on an invitation row |
| `status.ok` | "On track" | |
| `status.warn` | "⚠ Approaching limit" | at or past `notify_threshold`, not yet exceeded |
| `status.over` | "⚠ Over by {amount} {CUR}" | `remaining` from the API, negated — never re-derived from spent/limit |
| `status.noLimit` | "No limit set" | `fill_pct` is `null` because the plan's amount is ≤ 0 |
| ~~`status.unknown`~~ | ~~"Spend unknown — reopen to refresh"~~ | **removed in V5** — unreachable once mutations reload rather than patch (see Interactions) |
| `mainButton` | "Set budget for {category}" | contextual label |
| `error.forbidden` | "You don't have permission to view budgets." | |
| `error.retry` | "Try again" | |
| `offline.banner` | "Offline — showing data from {timestamp}" | |

## Data

| Call | Params | Notes |
|---|---|---|
| `GET /me` | — | for `currency` |
| `GET /categories` | — | names, colour slots, creation order |
| `GET /budgets` | — | the plans |
| `GET /budgets/{id}/progress` | one per plan | spent, remaining, `fill_pct`, `is_over_threshold`, `is_exceeded` — **all computed server-side**; the client never derives a percentage |

No new endpoint and no new field. The writes (`POST`/`PATCH`/`DELETE /budgets`)
move to `04b-budget-form.md`.

## Accessibility
- Identity is the dot **plus** the category name, always.
- Status is words + a glyph; `--status-red` never carries the meaning alone.
- The bar's tick is a visual affordance only — the threshold is also stated in
  words on 04b, so it is never the sole carrier of the number.
- Rows are buttons with a visible focus state and a ≥44px hit height.
- `prefers-reduced-motion`: nothing on this screen animates.

## Edge cases
- **Every category budgeted** — region 3 and MainButton both disappear; the
  screen is region 2 alone.
- **A plan whose category is missing from the categories fetch** — rendered as
  "Unknown category" in `--ink-secondary`. Not reachable under the DB's
  `ON DELETE RESTRICT` on `budget_plans.category_id`; kept as a defensive
  fallback for a client-side fetch skew.
- **A plan with `amount <= 0`** — `fill_pct` is `null`; the row shows "No limit
  set" and an empty bar. Only reachable for rows written before the
  `CHECK (amount > 0)` migration.
- **Many categories** — both lists grow without limit; there is no pagination
  and no fold. `[ref: shipped code]`
- **A very long category name** — the head line's amount is right-aligned and
  the name takes the remaining width.

## Acceptance criteria
- [ ] Tapping a budgeted row opens a **separate screen** with a BackButton —
      the Budgets list is no longer visible behind or above it — and no form
      ever renders inside the Budgets list.
- [ ] Tapping an unbudgeted category does the same, in create mode.
- [ ] MainButton reads "Set budget for {first unbudgeted category}" and opens
      the same separate screen; it is hidden when every category has a plan.
- [ ] Returning from a successful save shows the new or changed bar and status
      immediately, with the category moved between the two lists if needed.
- [ ] Returning from a Cancel or BackButton leaves the lists exactly as they
      were, and issues no write.
- [ ] Each bar's fill is the API's `fill_pct` and each tick sits at the plan's
      `notify_threshold`; neither is computed in the browser.
- [ ] All five mandatory states render as in the States table.

## Open questions
- [?] **Reload vs patch on return** — this spec chooses a full reload (see
      Interactions), costing `1 + N` requests on every save. Cheap at family
      scale (a handful of categories) and much simpler; revisit only if the
      screen feels slow on a real connection.
