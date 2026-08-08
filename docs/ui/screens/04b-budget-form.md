# Screen: 04b — Budget form (set / edit a budget)

## Purpose
One surface for setting a category's monthly limit and the percentage at which
it warns — reached from `04-budgets.md` by tapping a budgeted row (edit), an
unbudgeted category (create), or MainButton (create, next unbudgeted).

## Reference
No screenshot. Derived from:
- Verbal brief from the user, 2026-08-08: "open the budget setup in a separate
  new window/screen, similar to how we currently handle the Expenses menu. The
  budget setup menu itself should remain the same: amount selection;
  percentage selection; Save / Cancel buttons. Change the default percentage
  from 80% to 70%. Also, for some reason, saving the budget currently does not
  work."
- `webapp/src/screens/budgets.ts::renderBudgetForm` — the shipped inline form
  whose fields, validation and error copy this screen inherits `[ref: shipped
  code]`.
- `03b-expense-detail.md` — the "row on a list → its own screen with a
  BackButton" pattern the user pointed at.
- `02-add-expense.md` — the amount field and its currency suffix.

## Delta from reference
- **Taking:** the two fields and their exact validation and error strings; the
  Save / Cancel / Delete action row; the checked-server-side progress model
  (nothing about spend is computed here).
- **Changing:**
  - it is a **screen**, not a card at the bottom of the Budgets list (D506);
  - it gains a **header line naming the category**, in both modes — the old
    form only named it in create mode ("Set budget for Groceries" vs a bare
    "Edit budget");
  - the threshold default is **70**, not 80 (D507) — placeholder text included;
  - the Save button's enabled state **tracks what is typed** (D508). It does
    not today; see Data & the known defect below.
- **Explicitly not taking:** MainButton. The user asked for Save / Cancel
  buttons, so the bottom of this screen is in-screen buttons and MainButton is
  **hidden** — the one decision `ui-spec/references/telegram-miniapp.md`
  requires per screen, made explicitly here. This is the first screen in the
  app to answer it that way, and the reason is that Cancel has no native
  equivalent: pairing a native MainButton with an in-screen Cancel would put
  the two halves of one choice in two different places.

## Layout
Single scroll container. No `96px` MainButton reserve — MainButton is hidden —
but the action row still clears `env(safe-area-inset-bottom)`.

| # | Region | Geometry |
|---|---|---|
| 1 | **Header** | the category's colour dot + its name, 15px/600 `--ink`, `20px` top padding. The dot is the same identity pairing every other screen uses |
| 2 | **Spent-so-far line** (edit mode only) | 12.5px `--ink-secondary`, `4px` under the header: `Spent {spent} of {limit} {CUR} this month`. Straight from `GET /budgets/{id}/progress`, never recomputed |
| 3 | **Amount** | label "Monthly limit" 12px `--ink-secondary`; a `card field` holding the 34px/600 amount input with the currency code as a suffix — `02-add-expense.md`'s amount field exactly, same component treatment, `20px` above |
| 4 | Amount error | one line, `--status-red`, 12.5px; collapses to zero height when empty |
| 5 | **Threshold** | label "Warn me at" 12px `--ink-secondary`; a `card field` holding a numeric input with a `%` suffix, `20px` above. Default **70** |
| 6 | Threshold error | as region 4 |
| 7 | Submit error banner | only after a failed Save; existing `.submit-error` treatment |
| 8 | **Actions** | "Save" (primary) and "Cancel", 44px tall, `24px` above; in edit mode a "Delete budget" text trigger in `--status-red` sits `20px` below them, visually separated from the pair so it is never mistaken for a third equal option |

## Components used
None. Regions 3 and 5 reuse `app.css`'s existing `.card.field` +
`.amount-input` + `.currency-suffix` markup rather than introducing a
component; region 8 reuses `.detail-edit-actions`.

## Telegram
- **Theme:** every colour from `tokens.css`. The header dot is
  `--category-slot-{n}`; "Delete budget" is the one `--status-red` element and
  ships with a word, not just a colour.
- **MainButton:** **hidden** on this screen (see Delta). The screen's primary
  action is the in-screen "Save".
- **BackButton:** always shown; returns to `04-budgets.md`. On a dirty draft it
  confirms first with Telegram's own popup — the same `confirmDiscard` the Add
  expense and Category form screens already use. A clean draft returns
  immediately. Back is exactly equivalent to Cancel.
- **Haptics:** `success` after a successful save or delete; `impact` on
  confirming a delete; nothing while typing.
- **Viewport:** the amount input is focused on open in **create** mode only, so
  the keyboard opens over regions 5–8. Those regions must remain reachable by
  scrolling while the keyboard is up — this is why the actions are in the
  scroll container and not pinned. In **edit** mode nothing is focused on open,
  so the whole form is visible first.

## States
The five-state framework applies to the **Save action**, not to opening: in
create mode the form needs no fetch, and in edit mode it is opened with the
plan and progress `04-budgets.md` already loaded. Loading/Empty on open are
therefore **n/a**, same as `06b-category-form.md`.

| State | Trigger | What the user sees |
|---|---|---|
| Error (on Save) | `POST`/`PATCH /budgets` fails for a reason other than 403/404/409 | region 7 banner, plain language; **draft preserved**, both fields exactly as typed |
| 409 (on Save) | a plan already exists for this category and period | region 7 banner with `error.duplicate`; draft preserved |
| 404 (on Save) | the category was deleted underneath the form | region 7 banner with `error.gone`; draft preserved |
| 403 (on Save) | caller lacks create/update permission on budget plans | region 7 banner with `error.readonly`; draft preserved |
| Offline (on Save) | the request never reaches the network | treated as the generic Error case — this screen has no cached data to fall back to, it is a write |
| Saving | Save tapped, request in flight | Save disabled for the duration; a double-tap issues exactly one write |
| Success | Save resolves | `success` haptic; navigates back to `04-budgets.md`, which reloads |

## Interactions

| Element | Action | Result |
|---|---|---|
| Amount input | type | updates the draft; **re-evaluates Save's enabled state and region 4's error on every keystroke** (D508) |
| Threshold input | type | same, against region 6 |
| "Save", enabled | tap | `POST /budgets` (create) or `PATCH /budgets/{id}` (edit); see States |
| "Save", disabled | tap | nothing — it is a real `disabled` button, and the inline errors already say why |
| "Cancel" | tap | identical to BackButton: confirms if dirty, then returns to `04-budgets.md` with no write |
| "Delete budget" (edit only) | tap | Telegram confirm popup; on confirm `DELETE /budgets/{id}`, `impact` then `success` haptic, returns to `04-budgets.md` |

**Dirty** means: in create mode, either field differs from its initial value
(empty amount, threshold `70`); in edit mode, either differs from the plan's
stored values.

## Copy

| Key | String | Notes |
|---|---|---|
| `header.category` | "{category name}" | with the colour dot; both modes |
| `progress.line` | "Spent {spent} of {limit} {CUR} this month" | edit mode only, region 2 |
| `amount.label` | "Monthly limit" | `[inferred]` — the shipped inline form had no field label at all, only a placeholder |
| `amount.placeholder` | "0.00" | reused verbatim |
| `amount.error` | "Enter an amount greater than 0." | reused verbatim from `budgets.ts::amountFieldError` |
| `threshold.label` | "Warn me at" | `[inferred]`; reads as a sentence with the `%` suffix |
| `threshold.placeholder` | "70" | **was "80"** (D507) |
| `threshold.error` | "Enter a whole number 0-100." | reused verbatim; mirrors the bot's `_parse_notify_threshold` |
| `action.save` | "Save" | |
| `action.cancel` | "Cancel" | |
| `action.delete` | "Delete budget" | `--status-red` text trigger |
| `confirm.delete` | "Delete this budget plan?" | Telegram popup, reused verbatim |
| `confirm.discard` | existing discard-draft popup copy | reused from Add expense |
| `error.duplicate` | "A budget plan already exists for this category and period." | reused verbatim; mirrors the bot's 409 wording |
| `error.gone` | "That category no longer exists." | reused verbatim |
| `error.readonly` | "You don't have permission to do that." | reused verbatim |
| `error.generic` | "Something went wrong. Please try again." | reused verbatim |

## Data

| Call | Params | Notes |
|---|---|---|
| `POST /budgets` | `{ category_id, amount, notify_threshold }` | create mode. `amount` is minor units from `lib/money.ts::parseAmount` — never a float, never arithmetic in the browser |
| `PATCH /budgets/{id}` | `{ amount, notify_threshold }` | edit mode |
| `DELETE /budgets/{id}` | — | edit mode |

No new endpoint, no new field, no backend change **except** the default:
`models/budget_plan.py::BudgetPlanBase.notify_threshold` moves `80 → 70`, and
`bot/handlers/budgets.py::_DEFAULT_NOTIFY_THRESHOLD` with it, so a budget
created in the bot and one created here behave identically (D507). The Mini App
always sends the field explicitly, so the model default is not what this screen
reads — it is changed for consistency, not because this screen depends on it.
**No migration:** existing rows keep their stored threshold.

### The save defect this screen fixes
`budgets.ts::mount`'s `wire()` attaches `input` listeners that call
`setAmountDraft` / `setThresholdDraft` **without re-rendering**. The Save button
is rendered with `disabled` whenever `budgetFormValid(amountDraft,
thresholdDraft)` is false, and in **create** mode `amountDraft` starts empty —
so the button is rendered disabled and, because nothing re-renders as the user
types, it stays disabled forever. Creating a budget from the Mini App is
therefore impossible; editing one appears to work only because `startEdit`
pre-fills the amount, making the form valid at first render.

The same omission also freezes the inline field errors (regions 4 and 6) at
their initial values.

This is a real, reproducible defect, not a misconfiguration — and it is exactly
the class of bug that the Add expense screen avoids by updating validity on
every keystroke (`add-expense.ts::wireForm`, which patches the error element's
`textContent` and re-applies chrome rather than re-rendering the whole form and
losing input focus). This screen adopts that pattern: **update the error text
and the button's `disabled` property in place; never re-render the form while a
field has focus.**

## Accessibility
- Both inputs have a real `<label for>`, not placeholder-only labelling — the
  shipped inline form had neither.
- Inline errors are in an `aria-live="polite"` region so a rejection is
  announced without re-reading the field.
- The category in region 1 is carried by its **name**; the dot is decorative
  and `aria-hidden`.
- "Delete budget" is a button with a visible focus state, named in words, and
  its destructive meaning is not carried by `--status-red` alone.
- Focus order: BackButton (native) → amount → threshold → Save → Cancel →
  Delete.
- `prefers-reduced-motion`: nothing on this screen animates.

## Edge cases
- **Threshold `0`** — valid, and means "warn immediately". Accepted by both the
  API (`ge=0`) and this form; the tick renders at the far left of the bar.
- **Threshold `100`** — valid; the tick coincides with the end of the bar, so
  "approaching" and "exceeded" fire together. Not blocked.
- **Amount typed with a comma or a space** (`1 234,56`) — parsed by
  `lib/money.ts::parseAmount`, the same rules as Add expense.
- **Amount `0` or negative** — rejected inline; Save stays disabled. The API's
  `gt=0` is the second line of defence, not the first.
- **The plan is deleted from another device while this form is open** — the
  `PATCH` 404s and surfaces `error.gone`, draft preserved.
- **Category deleted underneath a create draft** — same 404 path. Not reachable
  for edit, since `ON DELETE RESTRICT` prevents deleting a category with a plan.
- **Navigating away mid-save** — the in-flight request completes; the screen
  guards against touching a DOM it no longer owns, the same `active` flag
  `expense-detail.ts` and the shipped `budgets.ts::mount` already use.

## Acceptance criteria
- [ ] Tapping a budgeted row or an unbudgeted category on `04-budgets.md`
      replaces the screen with this form; the Budgets lists are not visible.
- [ ] In create mode the threshold field shows **70** on open, and the
      placeholder reads "70".
- [ ] **Save is disabled on open in create mode and becomes enabled as soon as
      a valid amount is typed** — this is the regression test for the shipped
      defect; typing `12.50` must enable it without any other interaction.
- [ ] Tapping Save with a valid amount creates or updates the plan, fires a
      `success` haptic, returns to `04-budgets.md`, and that screen shows the
      new bar and status without a manual refresh.
- [ ] Typing an invalid amount shows the inline error under the field and never
      a Telegram popup; the error clears as soon as the value becomes valid.
- [ ] Cancel and BackButton behave identically: immediate return on a clean
      draft, Telegram confirm popup on a dirty one, and neither ever writes.
- [ ] MainButton is not visible anywhere on this screen.
- [ ] In edit mode the header names the category, region 2 states the spend
      this month, and "Delete budget" appears; in create mode neither region 2
      nor Delete is present.
- [ ] Double-tapping Save issues exactly one write.
- [ ] A 403, 404 or 409 on Save shows its specific message in region 7 and
      leaves both fields exactly as typed.
- [ ] Rendering is correct in both light and dark, every colour from
      `tokens.css`.

## Open questions
- [?] **Focus on open in create mode.** Specified as "focus the amount field",
      matching Add expense — but Add expense has no in-screen action row for
      the keyboard to cover. If the keyboard hiding the Save button reads badly
      on a real device, dropping autofocus is a one-line change.
- [?] **`amount.label` / `threshold.label` wording.** Both `[inferred]`; the
      shipped form had no labels, so there is nothing to inherit. "Warn me at"
      is chosen over "Notify threshold" to keep the app's plain-language rule,
      but it is the user's call.
