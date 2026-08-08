# Plan: Mini App V5 — colour picker & the budget form

Sixth plan file, after `docs/plans/expense-tracker-mvp.md` (V1 MVP, D1–D45),
`docs/plans/family-features-v1_1.md` (V1.1, D100–D124),
`docs/plans/mini-app-v2.md` (Mini App v1, screens 01–05, D200–D211),
`docs/plans/mini-app-v3.md` (periods, categories & tags, D300–D3xx) and
`docs/plans/mini-app-v4.md` (navigation, editing & settings, D400–D420) — all
done. Decision ids here start at **D500**.

Source of truth for appearance stays `docs/ui/`. The specs this plan
decomposes were written or revised on **2026-08-08**, in the session that
produced this file:

| Spec | Status |
|---|---|
| `docs/ui/design-system.md` | revised — palette 12 → 72 (the ramp), picker sizing, sheet motion |
| `docs/ui/components/color-picker.md` | **new** — specified from `refs/color-picker/` |
| `docs/ui/screens/06b-category-form.md` | revised — region 3 rewritten, V5 addendum |
| `docs/ui/screens/04-budgets.md` | **new** (first spec for a shipped screen) |
| `docs/ui/screens/04b-budget-form.md` | **new** |

Workflow per unit: `/clear` → `/unit <id> docs/plans/mini-app-v5.md` →
Stop-gate (`verify.sh`) → [reviewer subagent for risky units] → human commits.

## Goal
Two changes from the user's V5 brief (2026-08-08), plus the bug that brief
uncovered:

1. **Choosing a category's colour stops being a menu of twelve.** The form
   shows seven circles and a grey `+`; the `+` opens a vertically scrolling
   sheet of all 72. The palette grows from 12 to 72 by a generated ramp, and
   the "In use" caption goes away — the picker shows colours, not an inventory.
2. **Setting a budget gets its own screen.** Tapping a budget or a category on
   Budgets navigates to a real screen instead of rendering a form card below
   two lists, where it was routinely off-screen and competed with MainButton
   for the primary action. The list half of Budgets is untouched.
3. **Creating a budget from the Mini App starts working at all.** It cannot
   today: `budgets.ts::mount` updates the draft on `input` but never
   re-renders, so the Save button — rendered `disabled` while the amount is
   empty, which is exactly how a create form opens — stays disabled forever.
   Edit only appears to work because `startEdit` pre-fills the amount. See
   D508 and `04b-budget-form.md`'s "The save defect this screen fixes".

Plus one number: the notify-threshold default moves 80 → 70, in the Mini App,
the API model and the bot alike.

## Non-goals
- **Any DB migration.** `categories.color_slot` is a `SMALLINT` with no `CHECK`
  (`docs/SCHEMA.sql`) — 72 already fits, and the range is enforced by Pydantic
  (D509). The threshold default changes for *new* rows only; existing
  `budget_plans` keep whatever they stored.
- **Rewriting existing categories' colours.** Slots 1–12 keep their exact hexes
  in both themes. Nothing a user already chose moves.
- **Per-theme hexes for the ramp.** Slots 13–72 are one hex each (D501).
- **Auto-assigning past slot 6.** `services/category_service.py::_next_free_color_slot`
  and the client's `null`-slot position fallback are both untouched. The 60 new
  slots are reachable only by an explicit human pick.
- **Runtime colour generation.** `scripts/gen_palette.py` is an authoring tool
  whose output is checked in; the app never computes a hue.
- **Touching the Budgets list's rows, bars, ticks or status copy.** The user's
  brief is explicit that layout stays. Only the *navigation out of it* changes.
- **A new endpoint or a new field.** V5 is entirely client-side plus two
  Pydantic bound/default changes.
- **Screen 05 (Statistics)** — untouched for the third plan running.
- **The bot's budget UI.** `bot/handlers/budgets.py` changes exactly one
  constant (the 80 → 70 default) and nothing else — no keyboard, no copy, no
  flow.
- **Virtualising the 72-circle grid.** 72 nodes is not a list that needs it.
- **An `icons.ts` module.** V4 left the icon list at exactly eight and said the
  next icon triggers that review; V5 adds none — the `+` already exists.

## Constraints
- All root CLAUDE.md rules, plus `webapp/CLAUDE.md` under `webapp/` and
  `tests/CLAUDE.md` for tests. Layering unchanged: routes → services →
  repositories; the Mini App stays a pure HTTP client with zero business logic.
- **Money stays integer minor units.** The budget form parses once via
  `lib/money.ts::parseAmount` and formats once at render — the same pair Add
  expense uses. No arithmetic on a displayed amount, no float, ever.
- **No percentage is computed in the browser.** `fill_pct`,
  `is_over_threshold`, `is_exceeded` and `remaining` all come from
  `GET /budgets/{id}/progress`. The form writes `notify_threshold`; it never
  derives one.
- **Every colour comes from `design-system.md`.** All 60 new hexes are in that
  file before any CSS is written (they are already there — see U1.1's AC, which
  is that the generator reproduces them, not that it invents them).
- **`--status-red` is never a category slot.** `Red 2` `#b04945` is the nearest
  ramp colour to `#e34948` and is visibly darker.
- Identity is never colour alone. Removing the picker's visible names makes the
  per-circle `aria-label` the sole text carrier — mandatory, not decorative.

## Contracts (U0)

### Backend — `models/category.py` (D500)
```python
class CategoryCreate(CategoryBase):
    color_slot: int | None = Field(default=None, ge=1, le=72)  # was le=12

class CategoryUpdate(BaseModel):
    color_slot: int | None = Field(default=None, ge=1, le=72)  # was le=12
```
`CategoryResponse.color_slot` stays lenient (the four-schema rule: a Response
never rejects a row the DB already holds). `docs/SCHEMA.sql`'s comment on the
column changes `1..12` → `1..72`.

### Backend — `models/budget_plan.py` and the bot (D507)
```python
class BudgetPlanBase(BaseModel):
    notify_threshold: int = Field(default=70, ge=0, le=100)  # was 80
```
```python
# bot/handlers/budgets.py
_DEFAULT_NOTIFY_THRESHOLD = 70  # was 80
```
Bounds unchanged. No migration; no existing row is rewritten.

### Frontend — `webapp/src/lib/category-colors.ts`
```ts
export const PALETTE_SLOT_COUNT = 72;
/** The picker's quick row (D504) — design-system.md's named slots 1-7. */
export const QUICK_SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;
/** 1-12 are the named set ("Blue"); 13-72 are the ramp ("Olive 3"). */
export function categorySlotName(slot: number): string;
```
`assignCategoryColors`'s `FALLBACK_MAX_SLOT = 6` is **unchanged** — the
position fallback must not reach the new slots.

### Frontend — `webapp/src/components/color-picker.ts` (new)
```ts
export interface ColorPickerProps {
  selectedSlot: number | null;
  quickSlots?: readonly number[];   // default QUICK_SLOTS
  disabled?: boolean;
  onSelect: (slot: number) => void;
  onMore: () => void;
}
export function renderColorQuickRow(props: ColorPickerProps): string;
export function renderColorSheet(selectedSlot: number | null): string;
export function mountColorPicker(host: HTMLElement, props: ColorPickerProps): void;
```
Pure render + thin DOM glue, the shape every other component in
`webapp/src/components/` already has. The component owns neither the sheet's
open/closed flag nor the draft — both belong to the host screen.

### Frontend — `webapp/src/screens/budget-form.ts` (new)
```ts
export type BudgetFormMode =
  | { kind: "create"; categoryId: Uuid; categoryLabel: string; colorVar: string }
  | { kind: "edit"; planId: Uuid; categoryId: Uuid; categoryLabel: string;
      colorVar: string; amountMinor: number; spentMinor: number; notifyThreshold: number };

export interface BudgetFormApi {
  createBudgetPlan(d: { category_id: Uuid; amount: number; notify_threshold: number }): Promise<BudgetPlanResponse>;
  updateBudgetPlan(id: Uuid, d: { amount: number; notify_threshold: number }): Promise<BudgetPlanResponse>;
  deleteBudgetPlan(id: Uuid): Promise<void>;
}

export const DEFAULT_NOTIFY_THRESHOLD = 70;   // moves here from budgets.ts
export function budgetFormValid(amount: string, threshold: string): boolean;
export function amountFieldError(amount: string): string | null;
export function thresholdFieldError(threshold: string): string | null;
export function createBudgetFormController(api: BudgetFormApi, mode: BudgetFormMode): BudgetFormController;
export function renderBudgetForm(state: BudgetFormViewState): string;
export function mount(root: HTMLElement, mode: BudgetFormMode, api: BudgetFormApi, handlers: BudgetFormHandlers): void;
```
`amountFieldError`, `thresholdFieldError` and `budgetFormValid` **move**
unchanged from `budgets.ts` — same functions, same strings, same rules. Their
existing tests move with them.

`BudgetFormMode` carries the label, colour and current values because
`04-budgets.md` already loaded them; this screen fetches nothing on open.

### Frontend — `nextGridFocusIndex` gains a column count
```ts
export function nextGridFocusIndex(
  cellCount: number, from: number, key: string, columns = GRID_COLUMNS,
): number;
```
Default preserves today's behaviour exactly (4 columns). The colour sheet
passes `6`, the quick row passes its own length. Folded into U2.1 as a
behaviour-preserving change rather than given its own unit — it is ten lines
and has no observable effect on its own.

## Units

### M0 — Backend (no migration, no stop-and-ask gate)

- [x] **U0.1 Widen `color_slot` to 1–72** (D500) — Pydantic bounds and the
      schema comment. No service change, no repository change, no migration.
      AC: `POST /categories` with `color_slot: 72` is 201 and reads back 72;
      `73` and `0` are each 422; `null` is still accepted and still leaves the
      server's auto-assignment to pick from 1–6, proven by an account with no
      categories getting slot 1; `PATCH /categories/{id}` with `color_slot: 40`
      succeeds; every existing categories test passes untouched;
      `docs/SCHEMA.sql`'s column comment reads `1..72`.
      Files: `models/category.py`, `docs/SCHEMA.sql`,
      `tests/test_models.py`, `tests/test_categories_api.py`.
      Model: sonnet.

- [x] **U0.2 Notify-threshold default 80 → 70** (D507) — one constant in the
      model, one in the bot.
      AC: `POST /budgets` with no `notify_threshold` stores **70** and the
      response says 70; a budget created through the bot's flow without an
      explicit threshold is 70; explicit `0` and `100` are both still accepted
      and `101` is still 422; **no existing row changes** — a plan seeded at 80
      still reads 80 after the change, asserted directly; the bot's threshold
      prompt copy is unchanged apart from the number it defaults to.
      Files: `models/budget_plan.py`, `bot/handlers/budgets.py`,
      `tests/test_budgets_api.py`, `tests/test_bot_handlers_budgets.py`,
      `tests/test_models.py`.
      Model: sonnet.

### M1 — The palette

- [x] **U1.1 Generate the ramp and check it in** (D500/D501) — add
      `scripts/gen_palette.py` and the 60 new custom properties.
      AC: `python3 scripts/gen_palette.py` prints a `tokens.css` block and a
      markdown table; running it produces **byte-identical** output to what is
      checked into `webapp/src/styles/tokens.css` and to
      `design-system.md`'s ramp table, including the contrast columns — the
      script reproduces the spec, it does not redefine it; `:root` gains
      `--category-slot-13` … `--category-slot-72`; the
      `:root[data-theme="dark"]` block gains **nothing** (D501); slots 1–12 are
      byte-identical to before in both blocks; no generated hex clips the sRGB
      gamut, asserted by the script's own check; `Red 2` `#b04945` is not
      `--status-red`.
      Files: `scripts/gen_palette.py`(new), `webapp/src/styles/tokens.css`.
      Model: sonnet.

- [x] **U1.2 `category-colors.ts` knows all 72** — names, count, quick set.
      AC: `categorySlotName(1) === "Blue"` and `(12) === "Magenta"` (the named
      set, unchanged); `(13) === "Olive 1"`, `(18) === "Olive 6"`,
      `(72) === "Slate 6"`; `(73)` falls back to `"Slot 73"` rather than
      throwing; `categorySlotCssVar(72) === "var(--category-slot-72)"`;
      `QUICK_SLOTS` is `[1..7]`; **`assignCategoryColors`'s fallback is still
      capped at 6** — a 40-category account with all-`null` slots gives
      category 7 onward `null`, not slot 7, proven by the existing test staying
      green untouched.
      Files: `webapp/src/lib/category-colors.ts`,
      `webapp/tests/category-colors.test.ts`.
      Model: sonnet.

### M2 — The colour picker

- [x] **U2.1 `components/color-picker.ts`** — implements
      `docs/ui/components/color-picker.md` as a standalone component with its
      own tests. Not yet wired into any screen. Includes the
      `nextGridFocusIndex(…, columns)` parameter (see Contracts).
      AC: the quick row renders exactly 8 controls — 7 circles in slot order
      1–7 then the `+` — and renders a 9th circle **before** the `+` when
      `selectedSlot` is 8–72, showing that slot's colour and marked selected;
      no circle renders a visible name or an "In use" caption anywhere; the
      sheet renders 72 circles in a 6-column grid inside a scrolling body, with
      the date-range picker's scrim and sheet shell reused (no second
      `slide-up` keyframe added to `app.css`); every circle carries
      `role="radio"`, an `aria-label` equal to its slot name, and
      `aria-checked` true on exactly one; `disabled: true` renders the row at
      50% opacity and **omits** the `+` entirely; arrow keys wrap by 6 in the
      sheet and by the row length in the quick row, with
      `nextGridFocusIndex`'s existing 4-column callers unchanged (their tests
      stay green untouched); circles are 32px with a 1px `--separator` ring and
      44px hit targets; every colour resolves from `tokens.css`.
      Files: `webapp/src/components/color-picker.ts`(new),
      `webapp/src/styles/app.css`, `webapp/src/screens/categories.ts`
      (the `columns` param only), `webapp/tests/color-picker.test.ts`(new).
      Model: sonnet.

- [x] **U2.2 Category form uses it; the 12-swatch grid is deleted** —
      implements `06b-category-form.md`'s revised region 3 (D502/D503/D505).
      **Deletes code and its tests together** (see Risks).
      AC: the form's Colour region is one row tall in both create and edit
      mode; `renderSwatchCell`, the `usedSlots` set and every "In use" string
      are gone from `screens/categories.ts` and from its tests — grepping the
      repo for `"In use"` and `usedSlots` returns nothing outside
      `docs/ui/`; tapping a quick-row circle marks it selected and makes the
      draft dirty without opening the sheet or issuing a request; tapping the
      `+` opens the sheet and tapping a circle there selects it **and closes
      the sheet** in one action; BackButton with the sheet open closes the
      sheet instead of leaving the screen; opening the form for a category
      whose slot is 8–72 shows that colour already selected in the quick row;
      saving writes the chosen slot and a category created with slot 55 shows
      that colour on Home's ranked rows and dots; the dirty rule, Save flow,
      duplicate-name warning and delete trigger are all unchanged, proven by
      their existing tests staying green.
      Files: `webapp/src/screens/categories.ts`,
      `webapp/tests/categories.test.ts`, `webapp/src/styles/app.css`.
      Model: sonnet.

### M3 — The budget form as a screen

Ordered after M2 so the two milestones never touch the same file in the same
session, and either can be reverted without the other.

- [x] **U3.1 `screens/budget-form.ts`** — implements
      `docs/ui/screens/04b-budget-form.md` as a standalone screen module with
      its own tests. **Not yet reachable from anywhere** — U3.2 wires it.
      `amountFieldError`, `thresholdFieldError` and `budgetFormValid` move here
      from `budgets.ts` unchanged, with their tests.
      AC: create mode renders the category's dot and name, an empty amount
      field, a threshold field showing **70** with placeholder "70", and a
      Save / Cancel pair — and **no** region-2 progress line and **no** Delete
      trigger; edit mode renders all of those plus "Spent {spent} of {limit}
      {CUR} this month" taken verbatim from the passed mode (never recomputed)
      and a "Delete budget" trigger in `--status-red` with a word beside the
      colour; **Save is `disabled` on open in create mode and becomes enabled
      the moment a valid amount is typed** (D508 — the regression test for the
      shipped defect: assert the button's `disabled` property after dispatching
      one `input` event, and assert the inline error text updates on the same
      event); Save is enabled on open in edit mode and goes disabled if the
      amount is cleared; typing never re-renders the form (input focus and
      caret survive a keystroke); a valid create issues exactly one `POST` even
      when Save is double-tapped, and a valid edit exactly one `PATCH`; 403,
      404 and 409 each surface their own verbatim message from the Copy table
      with both fields preserved exactly as typed; Delete shows Telegram's
      confirm popup and only writes on confirm; MainButton is hidden for the
      whole lifetime of the screen; every colour resolves from `tokens.css` in
      both themes.
      Files: `webapp/src/screens/budget-form.ts`(new),
      `webapp/src/styles/app.css`, `webapp/tests/budget-form.test.ts`(new).
      RISKY (money input + the write path this plan exists to fix) →
      reviewer subagent.
      Model: sonnet.

- [x] **U3.2 Budgets navigates to it; the inline form is deleted** —
      implements `docs/ui/screens/04-budgets.md`'s Delta and Interactions
      (D506/D511). Deletes `BudgetEditMode`, the controller's form state,
      `renderBudgetForm`, `fetchProgress`'s `spentKnown: false` fallback and
      the "Spend unknown — reopen to refresh" string, together with their
      tests.
      AC: tapping a budgeted row, tapping an unbudgeted category, and tapping
      MainButton each navigate to `budget-form.ts` (edit, create, create) and
      the Budgets lists are no longer in the DOM; **no form renders inside the
      Budgets screen in any state** — grepping `screens/budgets.ts` for
      `budget-form`/`amountDraft`/`spentKnown` returns nothing; returning after
      a successful save or delete re-runs `loadBudgets` and the changed row's
      bar, status and list membership are correct without a manual refresh;
      returning via Cancel or BackButton issues no write and leaves the lists
      byte-identical; MainButton's contextual label still names the first
      unbudgeted category and is still hidden once every category has a plan;
      all five mandatory states still render as in `04-budgets.md`'s States
      table; `budgets.test.ts` keeps its coverage of `buildBudgetsData`,
      `nextUnbudgeted` and `applyBudgetsChrome` unchanged.
      Files: `webapp/src/screens/budgets.ts`, `webapp/src/main.ts`,
      `webapp/tests/budgets.test.ts`, `webapp/tests/main.test.ts`.
      Model: sonnet.

### M4 — Smoke

- [ ] **U4.1 e2e smoke: a ramp slot and a defaulted threshold, through
      `initData`** — one test through the real stack, the same shape as V4's
      U4.1.
      AC: a category created through `initData` auth with `color_slot: 72`
      reads back 72 from `GET /categories`; a budget created through
      `initData` with no `notify_threshold` reads back **70**; a budget created
      with an explicit `85` reads back 85; a category created with
      `color_slot: 73` is 422 and nothing is written.
      Files: `tests/test_e2e_smoke.py`.
      Model: sonnet.

## Live-test checkpoints
Neither of these is a unit; both are the human, on a real device, in a real
Telegram client. They are the actual acceptance gate for M2 and M3.

- **CP1 (after M2) — the picker.** Does the quick row fit without wrapping on
  the narrowest phone in use, including the 9-item overflow case (the one
  `[inferred]` geometry in the component spec)? Is a 32px circle a big enough
  target in practice? Does the sheet's scroll fight the Telegram client's own
  swipe-to-close? Are the pale slots (steps 5–6) actually distinguishable from
  the white card with only the hairline ring, and the dark slots (steps 1–2)
  from the dark card?
- **CP2 (after M3) — the budget form.** Does the keyboard cover the Save
  button in create mode (the open question in `04b-budget-form.md`)? Does
  hiding MainButton on one screen and showing it on the next flicker on
  navigation? Is "Warn me at … %" the right wording?

## Risks
- **U2.2 and U3.2 both delete code and must delete its tests with it.** A unit
  that leaves an orphaned test of a removed function fails `verify.sh`, which
  is the intended outcome — but the plan says it here so it is not a surprise
  mid-unit. Concretely: U2.2 removes `renderSwatchCell`/`usedSlots` and their
  assertions; U3.2 removes the inline-form controller, `renderBudgetForm`,
  `spentKnown` and theirs.
- **The generated palette must match the spec, not the other way round.** The
  60 hexes and their contrast figures are already in `design-system.md`. If
  U1.1's script output differs by even one digit, the bug is in the script's
  parameters (they are all listed in that file), not a licence to edit the
  table. Same for the 7 in-gamut chroma multipliers.
- **Low contrast at the ends of the ramp is real, accepted and mitigated in
  exactly three ways** (`design-system.md`, "Known and accepted"). All three
  are load-bearing; dropping the hairline ring as a cosmetic simplification
  would silently break the pale end. The ring is in U2.1's AC for that reason.
- **`nextGridFocusIndex` has three existing callers** (06a's grid, the V3
  swatch grid, `category-picker.ts`'s own copy). U2.1's `columns` parameter
  must default such that all three are untouched; the V3 swatch-grid caller
  then disappears in U2.2.
- **The threshold default lives in three places** and U0.2 changes two of them;
  the third (`webapp`'s `DEFAULT_NOTIFY_THRESHOLD`) moves to
  `budget-form.ts` in U3.1. Between U0.2 and U3.1 the Mini App still sends 80
  explicitly — harmless, since it always sends the field, but it means the
  "70 everywhere" AC is only true after M3, not after M0.
- **Deleting the patch-in-place mutation path (D511) costs `1 + N` requests on
  every return from the form.** Correct and much simpler at family scale;
  flagged so a future session recognises it as a deliberate trade, not an
  oversight.
- **No migration is a decision, not an omission** (D509). If a future change
  ever wants a DB-level `CHECK` on `color_slot`, that is a new migration and a
  new decision — the current column deliberately has none.

## Decision log
- 2026-08-08: **D500 — the category palette grows 12 → 72**, as slots, keeping
  `categories.color_slot` as the storage — because the reference sheets the
  user supplied are ~192 colours and the shipped 12 cannot express them, while
  the slot indirection is what makes a colour survive a theme switch and makes
  "two categories share a colour" a coherent concept. Rejected: storing a hex
  per category (a migration, a backfill, every consumer touched, and
  design-system.md's closed-set rule broken outright); the full ~192 (an
  unreviewable table for colours that differ by one step); staying at 12 (the
  `+` would reveal five more colours, which is not what the brief shows).
- 2026-08-08: **D501 — ramp slots 13–72 have one hex, not a light/dark pair** —
  because the ramp already spans the lightness range end to end, so a per-theme
  variant restates the step number, and 60 hand-tuned pairs is 60 chances to
  drift. Slots 1–12 keep their pairs. Mitigated by the mandatory hairline ring.
- 2026-08-08: **D502 — the picker no longer marks a slot as "In use"** (user,
  2026-08-08: "we do not need to display a list of occupied and available
  colors") — because at 72 slots the caption costs a line of text under every
  circle to narrate something the user did not ask about. Sharing a slot was
  always permitted (D317); V5 keeps the permission and drops the narration.
- 2026-08-08: **D503 — tapping a colour in the sheet selects it and closes**,
  dropping the reference's "Select" button and its page dots — because this app
  picks-and-closes everywhere else (currency rows on 08, quick chips on the
  date-range picker) and the confirm step costs a tap on every use. Rejected:
  tap-to-mark + MainButton "Select" (safer against mis-taps on a dense grid;
  revisit at CP1 if mis-taps prove common).
- 2026-08-08: **D504 — the quick row is slots 1–7, fixed** — because they are
  the colourblind-validated named set the server already auto-assigns from, and
  a fixed row becomes muscle memory. Rejected: seven *unused* slots (shifts as
  categories are added, and re-introduces exactly the occupied/available
  distinction D502 removes); seven spread across the ramp (prettier preview,
  but the row would stop matching the colours the server assigns by default).
- 2026-08-08: **D505 — region 3 of the category form is one row tall,
  permanently** — because that is what lets the palette reach 72 without
  pushing the delete trigger off the fold, and what makes a future palette
  growth cost nothing in layout.
- 2026-08-08: **D506 — the budget form becomes its own screen** (user,
  2026-08-08) — because the inline card rendered *below both lists* (routinely
  off-screen), did not name the category in edit mode, and left MainButton
  offering a different category while it was open: two primary actions on one
  screen. Reuses the existing Expenses → Expense detail navigation pattern; no
  new concept.
- 2026-08-08: **D507 — `notify_threshold` defaults to 70 in the Mini App, the
  API model and the bot** (user, 2026-08-08) — because a budget created in the
  bot and one created in the app must behave identically. No migration:
  existing plans keep their stored value.
- 2026-08-08: **D508 — the budget form's Save button tracks what is typed** —
  because it does not today, and that is the whole reason "saving the budget
  currently does not work": `budgets.ts::mount` wires `input` to
  `setAmountDraft` with no re-render, so a create form's Save is rendered
  `disabled` and never re-evaluated. Fixed by Add expense's pattern — patch the
  error text and the button's `disabled` property in place, never re-render a
  form that has focus in it.
- 2026-08-08: **D509 — no migration in this plan** — `categories.color_slot` is
  a `SMALLINT` with no `CHECK` by design (`docs/SCHEMA.sql`), so 72 fits and
  Pydantic remains the only validator; the threshold change affects defaults
  for new rows only.
- 2026-08-08: **D510 — screen 04b hides MainButton and uses in-screen Save /
  Cancel buttons** (user asked for both buttons) — the first screen in the app
  to answer `telegram-miniapp.md`'s MainButton-or-custom question that way,
  because Cancel has no native equivalent and splitting one choice across
  native chrome and the page is worse than putting both in the page.
- 2026-08-08: **D511 — returning from 04b reloads Budgets rather than patching
  one row** — because the patch-in-place path existed only to avoid a reload
  while staying on the same screen, and it is what forced `fetchProgress`'s
  `spentKnown: false` fallback and its "Spend unknown" copy. Costs `1 + N`
  requests per save; cheap at family scale.
- 2026-08-08: **D512 — `BudgetFormMode` gains a `currency` field**, on both the
  `create` and `edit` variants — the plan's own contract snippet omitted it,
  but region 3's amount-field suffix and region 2's spend line both need a
  currency code and the screen is specified to fetch nothing on open, so there
  is nowhere else for it to come from. Purely additive (no existing field
  changed); U3.2 passes it from `04-budgets.md`'s already-loaded
  `BudgetsData.currency`, the same "already loaded, don't refetch" rationale
  the rest of the type follows.

## STATE (handoff)
- **Done:** planning, plus **U0.1** (widen `color_slot` to 1–72), **U0.2**
  (notify-threshold default 80 → 70), **U1.1** (generate the ramp), **U1.2**
  (`category-colors.ts` knows all 72), **U2.1** (`components/color-picker.ts`),
  **U2.2** (the category form wires it in, the 12-swatch grid is gone),
  **U3.1** (`screens/budget-form.ts` as a standalone screen) and **U3.2**
  (`screens/budgets.ts` navigates to it, the inline form is deleted). M0, M1,
  M2 and M3 are complete. The five spec files in the table at the top are
  written and are the source of truth; the 60 ramp hexes and their contrast
  figures are already in `design-system.md`, so U1.1 reproduces them rather
  than inventing them.
- **Next:** U4.1 — the e2e smoke test through `initData` (a ramp slot, a
  defaulted threshold).
- **U3.2 note:** deleting the inline form's mutation path left two fields
  dead and they were removed with it, beyond what the AC named directly:
  `BudgetRow.spentKnown` (only existed to flag `fetchProgress`'s failure
  fallback, which no longer exists) and `BudgetsData.categoryOrder` (only
  existed for the controller's create/delete re-sort, and a full reload
  already restores creation order via `buildBudgetsData`). `mount()` also
  dropped its now-unused `api` parameter — the screen performs no writes of
  its own any more, only navigation. `applyBudgetsChrome`'s
  `onMainButtonTap` callback now receives the full `UnbudgetedRow` plus
  `currency` instead of a bare category id, so `main.ts` can build the
  destination screen's mode without a second lookup. Two pure helpers,
  `budgetFormModeFromRow`/`budgetFormModeFromUnbudgeted` in `main.ts`, carry
  the row→mode mapping so this routing decision has direct test coverage
  under Node — same reasoning as `withCreatedTagPreselected`.
- **U3.1 note:** `amountFieldError`/`thresholdFieldError`/`budgetFormValid`/
  `DEFAULT_NOTIFY_THRESHOLD` were added as **new copies** in `budget-form.ts`
  by U3.1 — that unit's own Files list didn't touch `budgets.ts`/
  `budgets.test.ts`, so the inline form they validate stayed live until U3.2
  deleted it (done, see the U3.2 note above). The "move" the contract
  describes completed across both units: U3.1 added the destination, U3.2
  removed the source. See **D512** for the one contract gap found (`currency`
  missing from
  `BudgetFormMode`). `mount()` is untested under Node like every other
  screen's mount (`webapp/vitest.config.ts` runs `environment: "node"`, no
  `document`) — the D508 regression (AC: "assert the button's `disabled`
  property after dispatching one `input` event") is covered at the level
  `mount`'s own input listener delegates to: `controller.setAmountDraft` +
  `budgetFormValid`, which is exactly what determines the button's
  `disabled` property; `renderBudgetForm` is also tested directly at both
  draft states for the same regression.
- **U2.2 note:** the sheet is mount-only, never part of `renderCategoryForm`'s
  pure output — same shape as `screens/home.ts::openPicker`'s date-range-picker
  sheet: `mountCategoryForm` appends a sibling root for it on `+`/`onMore`,
  overrides BackButton to close it (component doc: "the sheet is the innermost
  dismissible thing"), and restores the form's own dirty-check BackButton
  handler on close — never a saved-and-restored *previous* handler, since the
  form's handler is a pure function of `controller.getDraft`/`original` and is
  cheap to just re-apply. `usedSlots` is gone end to end: `mountCategoryForm`
  dropped the parameter and `main.ts::showCategoryForm` no longer computes it
  (D502 already permitted sharing a slot; U2.2 just stopped tracking who has
  which). The quick row itself is mounted via `mountColorPicker` against a
  `[data-testid="cat-color-picker-slot"]` placeholder the pure render emits
  with no-op callbacks — the exact `renderCategoryPicker`/`.category-picker-slot`
  split `add-expense.ts` already uses for `category-picker.ts`. Confirmed the
  U2.1→U2.2 circular import (`color-picker.ts` imports `nextGridFocusIndex`
  from `screens/categories`; `categories.ts` now imports render/mount helpers
  back from `color-picker.ts`) resolves fine under Vite/vitest — both sides
  only touch the cross-module bindings inside function bodies, never at
  top-level module-eval time.
- **U2.1 note:** `renderColorSheet` takes no `onSelect`/`onMore` — it is a
  pure render function only. `mountColorPicker` wires the quick row alone
  ("Not yet wired into any screen" is this unit's own scope); the sheet's
  open/closed flag and its circles' click/keyboard wiring are U2.2's job, the
  same way `screens/categories.ts` already wires its own `cat-swatch` grid
  manually today — the component owns neither (component doc's Inputs table).
  U2.2 should wire the sheet's arrow keys with
  `nextGridFocusIndex(cellCount, from, key, 6)` — `color-picker.ts` re-exports
  `SHEET_COLUMNS` (`= 6`) for that call so the column count isn't a second
  magic number. The sheet markup literally reuses `class="drp-root"` /
  `"drp-scrim"` / `"drp-sheet"` / `"drp-title"` from `date-range-picker.ts`'s
  CSS — no new keyframe, no new scrim rule; a future host only needs its own
  `data-testid` to query the sheet root it renders.
  `nextGridFocusIndex` (`screens/categories.ts`) gained a `columns = GRID_COLUMNS`
  parameter; its four pre-existing calls (06a's grid, the V3 swatch grid ×2
  call sites, `category-picker.ts`'s own separate local copy — untouched)
  keep the default and stay green.
- **U1.2 note:** `categorySlotName`'s ramp half is computed positionally
  (family list + `Math.floor`/`%` against `RAMP_FIRST_SLOT`/`RAMP_STEP_COUNT`),
  not a 60-entry lookup table — the family order
  (`Olive, Green, Teal, Blue, Violet, Magenta, Red, Orange, Brown, Slate`)
  matches `scripts/gen_palette.py::FAMILIES` exactly. `FALLBACK_MAX_SLOT`
  (`assignCategoryColors`) was left untouched, per the contract; the AC's
  40-category regression test asserts categories past index 6 stay `null`.
- **U0.2 note:** no migration, no existing row rewritten — `BudgetPlanResponse`
  built with an explicit `notify_threshold=80` still reads 80
  (`test_budget_plan_models`, `test_get_budget_plan_as_viewer`), proving the
  field default only fills in absent values.
- **U1.1 note:** the OKLCH→sRGB conversion is Björn Ottosson's standard
  matrix (the one used by `color.js`/`culori`) plus the standard WCAG relative-
  luminance formula for the contrast columns — both reproduce every one of the
  60 checked-in hexes and contrast figures exactly, verified byte-for-byte in
  `tests/test_gen_palette.py`. One boundary case: Olive step 1 at the doc's
  3-decimal chroma multiplier (`0.842`) sits ~5e-4 past zero in the linear blue
  channel — the true zero-clip boundary is nearer `0.8353`. `_channel_to_byte`
  clamps either way to the same `#565600`, so the visible colour is unaffected;
  `GAMUT_TOLERANCE = 1e-3` in `scripts/gen_palette.py` absorbs this without
  hiding a real clip (a multiplier anywhere near 1.0 still raises `ValueError`).
  `scripts/gen_palette.py` needed `scripts/__init__.py` added (new file, not in
  the unit's original file list) so mypy doesn't see the module under two
  names (`gen_palette` vs `scripts.gen_palette`) once tests import it.
- **U0.1 note:** `CategoryResponse.color_slot` was found still carrying the
  old `ge=1, le=12` bound — the plan's Contracts section assumed it was
  already lenient, but it wasn't. Fixed to fully unbounded (`int | None =
  None`, no `Field` constraint at all) as part of this unit, matching
  `BudgetPlanResponse.amount`'s D112 pattern. `tests/test_category_service.py`
  also had its own `[0, 13, -1]` out-of-range parametrize, not listed in
  U0.1's file list — updated to `[0, 73, -1]` since it directly asserts the
  old bound.
- **Gotchas for the next session:**
  - The **save defect is diagnosed, not guessed** — `budgets.ts::mount`'s
    `input` listeners call `setAmountDraft`/`setThresholdDraft` and stop there.
    Do not "fix" it by calling `rerender()` from the input handler: that
    replaces `root.innerHTML` and destroys the focused input mid-typing. Add
    expense's `wireForm` shows the right shape (patch `textContent` and
    `disabled` in place).
  - **`GET /budgets`'s progress is one call per plan**, unchanged. Do not batch
    it "while you're in there" — that is a separate decision with its own
    endpoint change.
  - `assignCategoryColors`'s `FALLBACK_MAX_SLOT = 6` must **not** grow with the
    palette. Auto-assignment staying inside 1–6 is what keeps a user who never
    opens the `+` away from the low-contrast ends of the ramp.
  - The ramp's step 5–6 colours are under 2:1 against the white card and step
    1–2 under 3.5:1 against the dark card. This is stated and accepted in
    `design-system.md`; the hairline `--separator` ring on every swatch and dot
    is the mitigation and is not optional.
  - `models/category.py`'s `CategoryResponse.color_slot` stays **unbounded** —
    the four-schema rule (a Response that validates rejects rows the DB already
    holds; the D112 lesson from `BudgetPlanCreate.amount`).
  - There is **no migration** in this plan and no stop-and-ask gate.
  - Slots 1–12 must come out of U1.1 byte-identical. A diff there means the
    generator was pointed at the wrong range.
