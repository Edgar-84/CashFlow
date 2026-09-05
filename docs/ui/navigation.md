# Navigation

## Purpose
The single source of truth for what Telegram's `BackButton` does, app-wide.
Until V8 this was specified one screen at a time — "BackButton: shown;
returns to Home" repeated with minor variations across ten files — and the
repetition is what let it drift out of sync with the code: `06-categories.md`
and `07-tags.md` still said "always navigates to Home" after `main.ts`
already grew a second, closure-based return path back to the expense
composer, and no screen doc noticed that `05-statistics.md`'s own category-bar
tap into Expenses left Expenses' BackButton pointing at Home instead of back
at Statistics. V8's item 2 (`docs/plans/mini-app-v8.md`, D804) replaces both
the hardcoded-Home targets and the ad hoc closures with one rule, described
here once, and every screen doc's BackButton row now points at this file
instead of restating it.

## The stack model
- **Home** (`screens/01-home.md`) is the floor. It holds no entry of its own
  and is never pushed.
- **Opening a screen from the side menu** — Add expense, Expenses, Budgets,
  Statistics, Categories, Tags, Settings, Admin (`components/side-menu.md`)
  — pushes one entry onto Home.
- **Opening a sub-screen from within an already-pushed screen** — Expense
  detail from Expenses, a Budget form from Budgets, a Category form from
  Categories, a Tag form from Tags, Language from Settings, a bar tap from
  Statistics into Expenses, or Admin's own Create mode from its List mode —
  pushes an entry onto whatever is already on top, never onto Home directly.
- **BackButton pops exactly one entry** and restores whatever is now on top —
  the screen, with the state it had (period, filter, grouping, in-progress
  draft), that opened the entry just left. At the floor (nothing pushed)
  BackButton returns to Home; tapping it again at Home hands off to
  Telegram's own close gesture — Home's own BackButton behaviour
  (`screens/01-home.md`) is unrelated to this stack (it toggles the side
  menu instead) and is not changed by this file.

## `push` vs `replace`
Not every re-render is a new step back. Retrying a failed load, changing the
active period, or toggling the statistics grouping re-renders the **same**
screen and **replaces** the top entry instead of growing the stack. Pushing
on every re-render would mean a user who retries a failed load five times
needs five Back taps to leave the screen — `replace` is the whole defence
against that (see the plan's Risks section, `docs/plans/mini-app-v8.md`).
Only a genuine move to a different screen pushes.

## The reference implementation
`screens/09-language.md`'s BackButton — "shown; always returns to Settings
(08)" — is the one screen already built to this rule: Language is reached
only by pushing onto Settings, and its BackButton pops exactly that entry.
Every screen doc corrected by this unit now describes the same shape: its
own opener, never a hardcoded Home, with this file named as the model
instead of the behaviour being re-derived per screen.

## What "the screen that opened it" means, per screen
For most screens there is exactly one opener. A few have more than one,
depending on which tap led there — the target is still always "one step
back," it is just not always the same screen.

| Screen | Opened from | BackButton target |
|---|---|---|
| Expenses (`03-expenses.md`) | Home's own category-bar tap, **or** Statistics' category- or tag-bar tap (D801) | Whichever of Home or Statistics opened it, with that screen's period/grouping intact |
| Expense detail (`03b-expense-detail.md`) | Expenses (a row tap) | Expenses, with the filter it was opened from intact |
| Budgets (`04-budgets.md`) | Home's side menu only | Home |
| Budget form (`04b-budget-form.md`) | Budgets (a row, or the create action) | Budgets |
| Statistics (`05-statistics.md`) | Home's side menu only | Home |
| Categories (`06-categories.md`) | Home's side menu, **or** the expense composer's "More" cell (Add expense / Edit expense) | Home, or the composer with its draft intact and the category cleared (D805) |
| Category form (`06b-category-form.md`) | Categories (a cell, or "Add category") | Categories |
| Category delete (`06c-category-delete.md`) | A popup inside `06b-category-form.md`, not a separate stack entry | Unchanged from `06b-category-form.md` |
| Tags (`07-tags.md`) | Home's side menu, **or** the expense composer's "+ Add tag" cell | Home, or the composer with its draft intact and the new tag pre-selected (D805) |
| Tag form (`07b-tag-form.md`) | Tags (a row, or "Add tag") | Tags |
| Settings (`08-settings.md`) | Home's side menu only | Home |
| Language (`09-language.md`) | Settings (its "Language" row) | Settings — the model this file generalises from |
| Admin, List mode (`10-admin.md`) | Home's side menu only (system admin) | Home |
| Admin, Create mode (`10-admin.md`) | Admin's own List mode (its "Create account" action) | List mode — Create is pushed onto List, not onto Home |

The single-opener rows ("Home's side menu only") are not a special case of
the rule — they are the rule applied to a stack of depth 1. Their BackButton
pointing at Home is correct precisely because Home is the only thing ever
pushed under them, not because they are hardcoded to it. Admin's List/Create
split is the same rule at depth 2: List is pushed onto Home, Create is pushed
onto List, and each pops exactly one level.

## Non-goals
- No browser `history.pushState` integration and no hardware back button —
  the stack lives entirely in `main.ts`'s in-memory model and drives
  Telegram's one `BackButton` (plan Non-goals, D804/D805).
- No swipe-back gesture.
- This file describes **behaviour**, not the TypeScript shape. The
  `NavStack`/`NavEntry` contract (push/replace/pop/reset/depth/peek, entries
  as thunks rather than serialized state) is specified in
  `docs/plans/mini-app-v8.md`'s Contracts section (U2.1) and implemented in
  M2 (U2.1–U2.3); nothing here is code yet.
