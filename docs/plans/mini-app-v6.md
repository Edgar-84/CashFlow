# Plan: Mini App V6 — comment saves, category order, ring colour, budget alerts in-app

Seventh plan file, after `docs/plans/expense-tracker-mvp.md` (V1 MVP, D1–D45),
`docs/plans/family-features-v1_1.md` (V1.1, D100–D124),
`docs/plans/mini-app-v2.md` (Mini App v1, screens 01–05, D200–D211),
`docs/plans/mini-app-v3.md` (periods, categories & tags, D300–D3xx),
`docs/plans/mini-app-v4.md` (navigation, editing & settings, D400–D420) and
`docs/plans/mini-app-v5.md` (colour picker & the budget form, D500–D512) — all
done. Decision ids here start at **D600**.

Source of truth for appearance stays `docs/ui/`. Three of the four items change
visible behaviour that the shipped specs either didn't mention or had explicitly
decided the other way, so **M0 revises those specs first** and M1–M4 implement
them. The M0 specs were written by the `ui-spec` skill on **2026-08-11**, in the
session that produced this file:

| Spec | Status |
|---|---|
| `docs/ui/screens/01-home.md` | revised — region 3 is now the budget alert strip; the donut's slices follow the ranking (two V6 deltas, one file) |
| `docs/ui/components/category-picker.md` | revised — new "Ordering" section; the 2026-08-04 `created_at ASC` decision struck through with both its objections answered |
| `docs/ui/screens/02-add-expense.md` | revised — category region, Data row and ACs point at the picker's new ordering |
| `docs/ui/components/toast.md` | **new** — the in-app alert toast |
| `docs/ui/design-system.md` | extended — toast motion/dwell + sizing rows, the warning glyph's two colours, and the "no toast token, it is `--ink`/`--card` inverted" rule |

Workflow per unit: `/clear` → `/unit <id> docs/plans/mini-app-v6.md` →
Stop-gate (`verify.sh`) → [reviewer subagent for risky units] → human commits.

## Goal
Four fixes from the user's V6 brief (2026-08-11), all four in the Mini App:

1. **A comment-only edit can be saved at all.** It cannot today: `add-expense.ts::
   wireForm`'s comment listener calls `controller.setComment` and stops there,
   with no `applyChrome()` — so in edit mode MainButton is still rendered from
   the pre-typing draft and stays `disabled`, and "press Save" does nothing
   because there is nothing to press. Diagnosed, not guessed: `add-expense.ts:1025-1028`
   against the amount listener four lines above it (`:959-966`), which does call
   `applyChrome()`. See D600 — this is D508's defect class in a second place.
2. **The category grid is ordered by how often the family actually uses a
   category**, most-used first, all-time transaction count — Transport (100)
   before Groceries (50) before Housing (3). Supersedes
   `components/category-picker.md`'s "Ordering stays `created_at ASC`" (D604).
3. **The ring shows the colour of the category it names.** Today Home's donut
   takes its six slices from the categories sorted `created_at ASC`
   (`home.ts:150-182`, asserted by `home.test.ts`'s "builds segments in category
   creation order"), so on an account with more than six categories a recolour
   of anything outside the six *oldest* changes nothing on the ring — that
   category is inside the grey `Other` fold, whatever colour it now has, while
   the ranked row right below it shows the new colour correctly. The fix is that
   the ring's slices are the ranked rows (D605).
4. **A budget crossing its threshold is visible inside the app**, in two places:
   a dismissible in-app toast when the expense that crossed it was just saved
   (the bot's chat message is unchanged and stays), and Home's month strip
   gaining the **approaching-limit** line it omits today — `buildHomeData`
   filters `is_exceeded` only (`home.ts:227-235`), so the 70–99% band that
   Budgets reports as "⚠ Approaching limit" is silent on the main screen.

## Non-goals
- **No backend change of any kind.** All four items are frontend plus docs; this
  is the first plan since V2 with no `models/`, `services/`, `repositories/`,
  `api/` or `bot/` unit and no migration. Confirmed against the four items:
  usage counts already ship (`GET /categories?include_usage=true`,
  `CategoryResponse.expense_count`, U0.4 of V3), and every budget number the
  strip and the toast need is already on `BudgetProgress`
  (`fill_pct`, `is_over_threshold`, `is_exceeded`, `remaining`, `spent`,
  `amount`). If a unit finds itself editing Python, that is the signal to stop
  and record a decision.
- **Removing or changing the bot's budget notification.** `services/
  notification_service.py` and `expense_service._check_budget_and_notify` are
  untouched; the toast is *additive* (D608). The user's "not just in Telegram
  chat" is read as "also in the app", not "instead of chat".
- **Real-time / pushed notifications.** The toast fires on the return leg of an
  expense the *user in this app* just saved. A partner's expense crossing a
  threshold while you sit on Home does not toast — that needs a push channel
  this app deliberately does not have (`webapp/CLAUDE.md`: "Notifications stay
  bot-side. This app never sends a Telegram message").
- **Crossing-detection state.** No "already warned" bookkeeping, client or
  server: the toast fires whenever the just-saved category is at/over its
  threshold, which is exactly the rule the bot's message already follows
  (`expense_service.py:214`: `fill_pct < notify_threshold` → silence, otherwise
  send, every time). D609.
- **Changing what the ranked rows show, or the donut's six-slice fold.** Region 4
  still lists every non-zero category; the fold is still at six with a trailing
  `Other`. Only *which* six, and in what order, changes (D605).
- **Re-sorting Home's ranked rows, screen 03's list, screen 06's list or the
  colour-slot assignment.** `assignCategoryColors`'s `created_at ASC` sort and
  its `FALLBACK_MAX_SLOT = 6` are untouched — D604 changes display order only,
  and the two must not be confused (see Risks).
- **Screen 05 (Statistics).** Untouched for the fourth plan running, including
  its own donut (`statistics.ts:295`), which keeps whatever ordering it has.
- **The bot's category keyboards.** Frequency ordering is a Mini App change; the
  bot's `bot/handlers/expenses.py` category list is out of scope (D604).
- **A "recently used" ordering.** The brief says frequency, all-time count. No
  recency term, no decay, no per-user weighting.
- **Trimming the picker to N cells / a "show all"** — still the open question
  `category-picker.md` already carries. Frequency ordering makes the head of the
  grid useful without answering it.

## Constraints
- All root CLAUDE.md rules, plus `webapp/CLAUDE.md` under `webapp/`. The Mini
  App stays a pure HTTP client: **no percentage, no threshold comparison and no
  aggregation is computed in the browser**. The strip and the toast both read
  `is_over_threshold` / `is_exceeded` / `fill_pct` off `BudgetProgress`; the
  category order reads `expense_count` off `CategoryResponse`. Sorting and
  rounding a server-supplied number for display is presentation and stays
  allowed (Home already does both: `rows` sorts by amount, `sharePct` rounds).
- **Money stays integer minor units.** Every amount in the new strip lines and
  the toast is formatted once by `lib/money.ts::formatAmount` from a value the
  API sent. `remaining` is negated for the over-budget line, never re-derived
  from `spent - amount` (`04-budgets.md`'s Copy table already fixes this rule).
- **Every colour, size, radius and duration from `docs/ui/design-system.md`.**
  The toast is the first new surface since V5; if it needs an elevation or a
  duration that file does not have, that token is added to `design-system.md`
  **in U0.4**, before any CSS is written.
- **`--status-red` keeps its two permitted uses** (over-budget, destructive text
  actions). The approaching-limit line is **not** red — it is not the same state
  as over-budget, and Budgets already draws the two differently.
- Identity is never colour alone: every alert line names its category in text,
  and the toast carries a word, not just a tint.
- `verify.sh` green after every unit, including `pnpm typecheck && pnpm lint &&
  pnpm test`.

## Spec deltas (M0 — written 2026-08-11; awaiting the human's review)

Corrections the human makes in the spec files **win over this table and over
anything in the chat that produced them**. Each row's AC list lives in its spec,
not here; this table is the index M1–M4 read.

| Spec | Delta | Consumed by |
|---|---|---|
| `docs/ui/screens/01-home.md` | region 3 becomes the **budget alert strip**: two line kinds (over-budget, approaching), all rows rather than only the first, copy with percentage/spent/limit, its own States and AC rows | U4.1 |
| `docs/ui/screens/01-home.md` | the donut's six slices are the **six largest categories by spend in the period**, descending, slice *i* = ranked row *i*; the `Other` fold is the tail of that ranking | U3.1 |
| `docs/ui/components/category-picker.md` + `docs/ui/screens/02-add-expense.md` | ordering becomes **usage count descending**, `created_at ASC` as the tie-break; the 2026-08-04 "Resolved" entry is superseded, not deleted | U2.1 |
| `docs/ui/components/toast.md` (**new**) + `design-system.md` if a token is missing | the in-app alert toast: anatomy, placement, dismissal, timing, a11y, reduced-motion, and its one permitted trigger | U4.2, U4.3 |
| `docs/ui/screens/02b-edit-expense.md` | one AC row for the comment-only save (no visual change — the screen already specifies "MainButton enables once a field changes"; the AC makes the regression explicit) | U1.1 |

## Contracts (U0)

Frontend only. Nothing in `models/`, `api/`, `services/`, `repositories/`, `bot/`.

### `webapp/src/screens/add-expense.ts` — the input bindings table (D601)
```ts
/** One entry per free-text input in the form. Every entry's `onInput` both
 * mutates the draft and refreshes the chrome — the invariant the comment
 * field violated by hand-wiring (D600). */
export interface DraftInputBinding {
  testId: string;
  apply(value: string): void;
}
export function draftInputBindings(
  controller: AddExpenseController,
  refreshChrome: () => void,
  patchAmountError: (message: string) => void,
): DraftInputBinding[];
```
`wireForm` iterates this instead of hand-wiring `amount-input` and
`comment-input` separately. Exported so the regression has a Node-level test
(see G1 and D602) without a DOM: drive the `comment-input` binding with a spy
`refreshChrome` and assert it fired.

### `webapp/src/screens/add-expense.ts` — usage ordering (D604)
```ts
/** Usage count descending, `created_at ASC` within a tie (a stable order for
 * the long tail of never-used categories). `expense_count` absent/null counts
 * as 0 — `null` means "not requested", so a caller that forgets
 * `includeUsage` degrades to creation order rather than to a random one. */
export function sortCategoriesByUsage(categories: CategoryResponse[]): CategoryResponse[];

export interface AddExpenseApi {
  // was: listCategories(): Promise<CategoryResponse[]>
  listCategories(opts?: { includeUsage?: boolean }): Promise<CategoryResponse[]>;
  // …unchanged
}
```
`ApiClient.listCategories` already takes that options object
(`api/client.ts:237`) — this widens the screen's own narrow `Pick`, nothing
else. **Colour is unaffected:** `categoryPickerItems` resolves each colour
through `assignCategoryColors`, which sorts by `created_at` internally
(`lib/category-colors.ts:28`), so display order and slot assignment stay
independent.

### `webapp/src/screens/home.ts` — the alert strip (D606)
```ts
export type HomeBudgetAlertKind = "exceeded" | "approaching";

export interface HomeBudgetAlert {
  kind: HomeBudgetAlertKind;
  categoryId: Uuid;
  label: string;
  /** `BudgetProgress.fill_pct`, rounded at render only — never recomputed. */
  fillPct: number;
  spentMinor: number;
  limitMinor: number;
  /** `-remaining` from the API; only set on `kind: "exceeded"`. */
  overMinor: number | null;
}

export interface HomeData {
  // `overBudget: HomeOverBudgetRow[]` is REPLACED by:
  budgetAlerts: HomeBudgetAlert[];
  // …unchanged
}
```
`HomeOverBudgetRow` and `renderOverBudgetStrip`'s "first row only" behaviour are
deleted with it (see Risks). Ordering: every `exceeded` alert first, then every
`approaching` one, each group in the ranked-row order of its category. Still
gated to Month at offset 0 by the existing `isMonthToDate` (D310) — unchanged.

### `webapp/src/components/toast.ts` (new) — D607/D608
```ts
export interface ToastProps {
  /** Pre-composed line; the component never formats money or a percentage. */
  message: string;
  kind: "warning";
  /** ms before auto-dismiss; `null` never auto-dismisses. */
  autoDismissMs?: number | null;
}
export function renderToast(props: ToastProps): string;
/** Appends its own root to `host`, wires dismissal, and resolves when the
 * toast has left the DOM. Never touches BackButton or MainButton — a toast is
 * not a dismissible *screen* (D607). */
export function showToast(host: HTMLElement, props: ToastProps): () => void;
```
Pure render + thin DOM glue, the shape every component in
`webapp/src/components/` already has. The component owns neither the trigger
nor the copy.

### `webapp/src/main.ts` — the toast's one trigger (D609)
```ts
/** Set by screen 02/02b's `onSuccess` to the saved expense's category, read
 * once by the next `showHome()` and cleared. Pure so the routing decision has
 * Node-level coverage, same reasoning as `withCreatedTagPreselected`. */
export function budgetToastMessage(
  alerts: HomeBudgetAlert[], categoryId: Uuid | null, currency: Currency,
): string | null;
```

## Gates

- **G1 — a DOM test environment for `webapp`: ANSWERED YES** (human,
  2026-08-11). The defect in item 1 lives entirely in `mount`'s DOM wiring, and
  `webapp` had **no DOM test environment**: no `vitest.config.ts`, no
  `jsdom`/`happy-dom` in `package.json`, so vitest ran `environment: "node"` and
  every screen's `mount` was untested (V5's U3.1 note records this as an
  accepted gap). `jsdom` is now approved as a devDependency, scoped per-file, as
  **U0.5** — a prerequisite of M4, not the optional afterthought it was first
  drafted as, because `components/toast.ts` is a component whose entire
  behaviour is DOM glue (D603). This is the one sanctioned edit to
  `webapp/package.json` and `webapp/pnpm-lock.yaml` in this plan; no other
  dependency change is authorised by it.

## Units

### M0 — The specs and the test environment

- [x] **U0.1 `01-home.md`: region 3 becomes the budget alert strip** (D606) —
      rewrite region 3 in the Layout table, add the two copy keys, the states,
      the interactions (none — the strip is display-only, like the donut) and
      the AC rows. Keeps the D310 month-only gate and its rationale verbatim.
      AC: the Layout table's row 3 names both line kinds; the Copy table holds
      `alert.over` unchanged ("{Category} is over budget by {amount} {CUR}") and
      a new `alert.warn` carrying **percentage used, amount spent and the
      limit**; the spec states that **all** alerts render, exceeded first, one
      line each — replacing today's undocumented "first row only"; the
      approaching line is explicitly **not** `--status-red` and the spec says
      which token it is; States gains "approaching only" and "both kinds at
      once"; ACs cover Month-at-offset-0 only, and a 70–99% budget producing a
      visible line where today there is none.
      Files: `docs/ui/screens/01-home.md`.
      Model: opus (copy + a token decision), skill: `ui-spec`.

- [x] **U0.2 `01-home.md`: the donut's slices follow the ranking** (D605) — the
      ordering rule the spec never wrote down, plus the consequence for the
      collapsed bar and the `role="img"` label.
      AC: the spec states that the donut's slices are the period's categories
      **ranked by spend descending**, slice *i* being ranked row *i*, with the
      tail beyond six folded into `Other`; states that a category with **0 in
      the period never occupies a slice** (today's creation-order fold gives it
      an invisible one while a real spender is folded away); the "two states,
      one dataset" contract with the collapsed bar is restated as still true;
      the a11y label's "top three categories" is noted as now literally the
      first three slices; Edge cases' "More than six categories" row says which
      six.
      Files: `docs/ui/screens/01-home.md`.
      Model: sonnet, skill: `ui-spec`.

- [x] **U0.3 `category-picker.md` + `02-add-expense.md`: usage ordering** (D604)
      — supersede the 2026-08-04 "Resolved" entry rather than deleting it (the
      reason it was decided that way is the risk register for this change).
      AC: `CategoryPickerProps.items`' comment and the "the caller does the
      sorting" line both read usage-count-descending with `created_at ASC` as
      tie-break; the old Resolved entry is struck through with the date and the
      user's brief cited, and the two reasons it gave (colour-fallback
      stability, muscle memory) each get an answer — the first that slot
      assignment is computed from a `created_at`-sorted list independently of
      display order, the second accepted as a real cost with the head of the
      grid stabilising as usage accumulates; `02-add-expense.md`'s category
      region says the same thing and its AC list gains the 100/50/3 example
      from the brief; the archived-category rule, the `More` cell and the
      selection shape are all restated as unchanged.
      Files: `docs/ui/components/category-picker.md`,
      `docs/ui/screens/02-add-expense.md`.
      Model: opus (it overturns a recorded decision), skill: `ui-spec`.

- [x] **U0.4 `components/toast.md` (new)** (D607) — the first new component
      since V5's colour picker.
      AC: anatomy, placement (and what it must never cover — MainButton, the
      yellow Add button), width/padding/radius/type all from
      `design-system.md`; dismissal is specified three ways (tap the toast, tap
      its close affordance if it has one, auto-dismiss after a stated duration)
      and the duration is a design-system motion value or a new one added in
      this unit; the spec states the toast is **not** a dismissible screen —
      BackButton and MainButton are untouched while it shows; `prefers-reduced-
      motion` behaviour; a11y (`role="status"`, polite live region, never a
      focus trap, never colour alone); the "one trigger only" rule (an expense
      the user just saved) with the non-goals restated so a future session
      doesn't grow it into a generic notification centre; every token it uses
      exists in `design-system.md` after this unit.
      Files: `docs/ui/components/toast.md`(new),
      `docs/ui/design-system.md` (only if a token is genuinely missing).
      Model: opus, skill: `ui-spec`.

- [x] **U0.5 A DOM test environment, per-file opt-in** (D603, G1 answered yes) —
      `jsdom` as a devDependency plus a `vitest.config.ts`, so the `mount`
      wiring M1 fixes and the toast M4 adds can be tested at the level they
      actually live. **The only unit in this plan permitted to touch
      `webapp/package.json` and `webapp/pnpm-lock.yaml`.**
      AC: `pnpm test` runs all existing test files **unchanged and still under
      `environment: "node"`** — the config sets no global DOM default, and
      grepping the existing test files shows no edits; one new throwaway
      smoke test carrying `// @vitest-environment jsdom` can build a DOM,
      dispatch an `input` event and read `document`, proving the opt-in works
      before any real test depends on it (delete it in U1.1, which replaces it
      with the real regression); `pnpm typecheck` and `pnpm lint` stay green
      with the new config file in the project (it must be covered by, or
      deliberately excluded from, the existing tsconfig/eslint globs — a new
      root-level `.ts` file silently outside both is how this kind of file rots);
      `scripts/verify.sh` is **unchanged** and green, including its
      secret-grep of the build output; `pnpm install --frozen-lockfile`
      succeeds, i.e. the lockfile committed here matches `package.json`, so CI
      does not fail on a stale lock; `jsdom` lands in `devDependencies`, never
      `dependencies`, and does not appear in the Vite build output.
      Files: `webapp/package.json`, `webapp/pnpm-lock.yaml`,
      `webapp/vitest.config.ts`(new), one throwaway test file.
      Model: sonnet.

### M1 — The comment-only save (the user's item 1)

- [x] **U1.1 A comment-only edit enables Save and PATCHes the comment**
      (D600/D601/D602) — extract `draftInputBindings`, wire both text inputs
      through it, add the AC row to `02b-edit-expense.md`.
      AC: **the regression is asserted through the DOM** (U0.5's environment):
      mount the form in edit mode, dispatch exactly one `input` event on
      `[data-testid="comment-input"]`, and assert `mainButton.setEnabled(true)`
      and the "Save changes" label — this test must fail if U1.1's diff is
      reverted, which is the check that the fix is real rather than adjacent;
      `draftInputBindings` returns one entry per free-text input and
      **every** entry's `apply` calls `refreshChrome` — asserted with a spy,
      per binding, so a future third input cannot regress the same way (kept
      alongside the DOM test, not replaced by it: it is what makes the
      invariant readable, and it runs without a DOM); driving
      the `comment-input` binding on an edit draft flips
      `editButtonState(...).enabled` from `false` to `true` and its label to
      "Save changes"; `editChanges` for that draft carries `comment` and
      **nothing else** (no `amount`, no `spent_at`, no `tag_ids`); clearing an
      existing comment sends `comment: null`, not `""` (the screen doc's Edge
      case, now covered); the amount binding's inline-error patch behaves
      exactly as before, proven by its existing assertions staying green; create
      mode is unaffected — `submitButtonState` ignores the comment, so a
      comment typed with no category still reads "Choose a category" and stays
      disabled; **typing still never re-renders the form** (no `rerenderForm`
      call is added to either binding — that would destroy the caret, the D508
      trap); `02b-edit-expense.md` gains an AC row for the comment-only save.
      Files: `webapp/src/screens/add-expense.ts`,
      `webapp/tests/add-expense.test.ts`,
      `docs/ui/screens/02b-edit-expense.md`.
      RISKY (a write path, and the second instance of D508's defect class) →
      reviewer subagent.
      Model: sonnet.

### M2 — The category grid's order (the user's item 2)

- [ ] **U2.1 Add expense orders categories by usage** (D604) — implements
      U0.3's spec. `loadAddExpenseData` asks for usage counts and the grid
      renders `sortCategoriesByUsage`'s output.
      AC: with counts 100/50/3 for Transport/Groceries/Housing the grid renders
      exactly that order, whatever their creation dates; a category with
      `expense_count: 0` sorts after every used one and ties among the unused
      resolve by `created_at ASC`; `expense_count` `null`/absent is treated as
      0 rather than throwing or sorting randomly; **the stale-category recovery
      refetch also asks for usage** (`createController`'s
      `api.listCategories()` — otherwise the grid silently reverts to creation
      order mid-session), asserted; the same order appears in **edit** mode
      (screen 02b shares this loader) and the archived-current-category cell is
      still appended **last**, never sorted into the grid; **every category's
      colour is unchanged by the reorder** — asserted directly against a
      fixture where the most-used category is the newest, which is the case
      that would break if slot assignment ever read display order;
      `include_usage=true` is sent by exactly one call (no second
      `GET /categories`).
      Files: `webapp/src/screens/add-expense.ts`,
      `webapp/tests/add-expense.test.ts`.
      Model: sonnet.

### M3 — The ring's colour (the user's item 3)

- [ ] **U3.1 The donut's slices are the ranked rows** (D605) — implements
      U0.2's spec. `buildHomeData` builds one ranked list and feeds the donut,
      the collapsed bar and the rows from it.
      AC: with seven categories where the newest is the biggest spender, the
      donut's first slice is that category, in **its own colour**, and the
      `Other` slice holds the six-smallest tail — the exact case that fails
      today; slice *i*'s `categoryId` equals ranked row *i*'s for every *i*
      below the fold, asserted as a pair so the two can never disagree again;
      a category with 0 spend in the period gets **no slice**; recolouring a
      category changes that category's slice colour and no other slice's —
      asserted by rebuilding with one `color_slot` changed and diffing;
      `bars` still matches `segments` in count, order and colour (the existing
      "same order, count and colours" test stays green untouched); the
      `role="img"` label's top three still name the three biggest;
      `home.test.ts`'s "builds segments in category creation order" is
      **rewritten, not deleted** — same fixture, the new expectation — and the
      colour-stability test (appending a category must not recolour existing
      ones) stays green untouched.
      Files: `webapp/src/screens/home.ts`, `webapp/tests/home.test.ts`.
      Model: sonnet.

### M4 — Budget alerts inside the app (the user's item 4)

Ordered after M3 so the two milestones' `home.ts` edits never land in the same
session, and either can be reverted without the other.

- [ ] **U4.1 Home's strip shows approaching-limit too** (D606) — implements
      U0.1's spec. `overBudget` becomes `budgetAlerts`; `renderOverBudgetStrip`
      becomes a list.
      AC: a budget at 82% renders "approaching limit" with **82%, the amount
      spent and the limit**, all three formatted from API values (`fill_pct`,
      `spent`, `amount`) and none recomputed; a budget at 100%+ still renders
      today's "{Category} is over budget by {amount} {CUR}" **verbatim**, with
      `overMinor` taken from `-remaining`; with one of each, **both lines
      render**, exceeded first — the "first row only" behaviour is gone and
      grepping `screens/home.ts` for `overBudget` returns nothing; a budget
      below its threshold renders no line; the strip is still absent on Day,
      Week, Year and Period and on Month at a non-zero offset (the existing
      D310 test stays green, retargeted to `budgetAlerts`); `fill_pct: null`
      (a plan with `amount <= 0`) renders no approaching line rather than
      "null%"; the approaching line uses the token U0.1 names and **not**
      `--status-red`; both lines render in light and dark from `tokens.css`.
      Files: `webapp/src/screens/home.ts`, `webapp/tests/home.test.ts`,
      `webapp/src/styles/app.css`.
      Model: sonnet.

- [ ] **U4.2 `components/toast.ts`** (D607) — implements `components/toast.md`
      as a standalone component with its own tests. **Not yet triggered by
      anything** — U4.3 wires it.
      AC: `renderToast` output matches the spec's anatomy, carries
      `role="status"` and `aria-live="polite"`, and contains the message text
      escaped; the toast is **not** focusable and installs no BackButton or
      MainButton handler, asserted by the spy `lib/telegram` mock (this is the
      contract that keeps it from behaving like a screen); `showToast` returns a
      dismiss function that removes the root and is idempotent — calling it
      twice, or after auto-dismiss, is a no-op, not a throw; auto-dismiss fires
      at the spec's duration with fake timers, and `autoDismissMs: null` never
      dismisses; a tap dismisses immediately (the user's "can be dismissed
      immediately"); a second `showToast` while one is up replaces it rather
      than stacking; `prefers-reduced-motion` skips the entry animation; every
      colour, radius and duration resolves from `tokens.css`.
      Files: `webapp/src/components/toast.ts`(new),
      `webapp/src/styles/app.css`, `webapp/tests/toast.test.ts`(new).
      Model: sonnet.

- [ ] **U4.3 A saved expense that crosses a threshold toasts on Home**
      (D608/D609) — the trigger, and the only one.
      AC: `budgetToastMessage` returns the approaching or the exceeded line for
      the saved expense's category when that category has an alert, and `null`
      when it has none, when `categoryId` is `null`, or when the alert list is
      empty — covered directly under Node; saving an expense in a category at
      82% of its budget lands on Home **and** shows one toast whose text is the
      same sentence the strip shows for that category (one copy source, not
      two); saving in a category with no budget, or one below its threshold,
      shows no toast; the toast fires **once** — returning to Home again (menu,
      BackButton, a period change) does not re-show it, and the pending
      category id is cleared even when the reload fails; an edit that pushes a
      category over its threshold toasts the same way as a create; the toast
      never suppresses or delays Home's own render, and Home's strip still
      shows the same alert underneath it; a 403/offline Home renders its own
      state with no toast; the bot still sends its chat message (unchanged
      code path, restated as an AC so a reviewer checks it).
      Files: `webapp/src/main.ts`, `webapp/src/screens/home.ts`,
      `webapp/tests/main.test.ts`, `webapp/tests/home.test.ts`.
      RISKY (touches the notification story, which root CLAUDE.md makes
      best-effort and non-blocking) → reviewer subagent.
      Model: sonnet.

### M5 — none

V6 has no backend delta, so there is no e2e smoke unit (contrast V4's and V5's
U4.1, both of which existed to prove a new API contract through `initData`).
The equivalent gate here is CP1 + CP2, on a device. The DOM test environment
that was first drafted as an optional M5 unit is now **U0.5** (G1/D603).

## Live-test checkpoints
Not units — the human, on a real device, in a real Telegram client. They are
the actual acceptance gate for M2 and M4.

- **CP1 (after M2) — the reordered grid.** Does the head of the grid feel
  faster, or does the muscle memory loss the 2026-08-04 decision predicted
  actually bite? Specifically: does the *selected* category jumping position
  between two consecutive expenses feel wrong, and does the order visibly
  churn while counts are small (3 vs 4 uses)?
- **CP2 (after M4) — the toast.** Does it appear at all in the Telegram client
  (some clients overlay their own chrome at the top and the bottom)? Does it
  cover MainButton or the yellow Add button at any viewport height? Is the
  auto-dismiss duration long enough to read a two-number sentence and short
  enough not to sit in the way? And the honest one: getting both a chat
  message and a toast for the same expense — is that reassuring or annoying?
  If annoying, the fix is a *decision about the bot*, not about the toast.

## Risks
- **U4.1 deletes `HomeOverBudgetRow` and the strip's "first row only"
  behaviour, and must delete their tests with them.** A unit that leaves an
  orphaned test of a removed type fails `verify.sh`, which is the intended
  outcome — stated here so it is not a surprise mid-unit. The D310 month-gate
  test is *retargeted*, not removed: that behaviour survives.
- **U3.1 rewrites a passing test whose name asserts the old behaviour**
  ("builds segments in category creation order"). That is the point of the
  unit, but it means the diff must show the rewritten expectation, and the
  reviewer should confirm the *colour-stability* test next to it was left
  alone — those two look similar and mean opposite things.
- **Display order and colour assignment are two different sorts over the same
  list, and U2.1 changes only one of them.** `assignCategoryColors` sorts
  `created_at ASC` and must keep doing so: it is what makes a `null`-slot
  category's fallback colour survive a sibling's deletion (D301/D206), and
  wiring it to usage order would make a colour change every time someone spends
  money. U2.1's AC asserts this directly for that reason.
- **`expense_count` is all-time and account-wide**, including a partner's
  expenses and archived-category history. That is what the brief asked for
  ("100 all-time Transport expenses" for "this family account"), and it means a
  member with `own_only` expense reads still sees the family's frequency order.
  No new information is exposed — screen 06 already shows these counts — but it
  is a deliberate reading of the brief, not an accident.
- **The toast and the bot's message are two notifications for one event.** By
  design (D608); CP2 is where the human decides whether it stays that way. Do
  not "fix" it by muting the bot inside a webapp unit — that is a backend
  decision with its own plan.
- **No crossing-detection state means a repeated toast.** Every expense saved
  into an over-threshold category toasts, exactly as the bot messages every
  time (D609). If that proves noisy, the cheapest next step is a per-session
  "already toasted this category" set in `main.ts`, which is a decision, not a
  bug fix.
- **The comment fix is one line inside a seam this plan widens.** The
  temptation in U1.1 is to also "tidy" the four `rerenderForm` listeners into
  the same table. They are not the same shape (they re-render; the text inputs
  must not), and folding them in would reintroduce the caret-destroying bug
  D508 warned about. The bindings table is for text inputs only.
- **U0.5 is the plan's only dependency change, and it is a lockfile edit.** It
  must land as its own commit, with `pnpm install --frozen-lockfile` proven to
  succeed — a lockfile that disagrees with `package.json` fails CI on every
  later unit and looks like that unit's fault. It is also not a licence to add a
  second dependency: anything beyond `jsdom` needs its own ask (D603).
- **A DOM environment invites the wrong kind of test.** The reason ten `mount`s
  are untested here is that logic was pushed into pure functions instead
  (`buildHomeData`, `editChanges`, `budgetFormValid`, …). U1.1–U4.3 keep that
  order: pure helper first, DOM test only for the glue that has no pure form. A
  unit that grows a DOM test *instead of* a pure one has misread D603.
- **Region 3 grows.** Two alerts plus a long category name is two or three
  lines of text between the chart card and the first ranked row, on the screen
  whose whole job is the chart. U0.1 owns the answer (line clamp? cap the
  count?); if it defers it, that deferral is an Open question in the spec, not
  something U4.1 improvises.

## Decision log
- 2026-08-11: **D600 — the comment field's missing `applyChrome()` is the whole
  of item 1** — `add-expense.ts:1025-1028` mutates the draft and stops, so
  screen 02b's MainButton is never re-evaluated after a keystroke in the
  comment; in create mode this is invisible (`submitButtonState` ignores the
  comment), which is why it shipped. Same defect class as D508 (the budget
  form's Save button), second occurrence, which is why D601 makes it structural
  instead of fixing one line.
- 2026-08-11: **D601 — the fix is a bindings table, not a second hand-wired
  `applyChrome()` call** — two hand-wired text inputs is how the first one got
  forgotten; a list with one invariant ("every entry refreshes the chrome") is
  testable and makes the third input free. Rejected: adding the one call (cheap,
  but leaves the same trap for the next field) and re-rendering on input
  (destroys the caret — the explicit D508 trap).
- 2026-08-11: **D602 — the regression is tested at the bindings table, under
  Node** — the binding is the last pure layer above the missing call, so a spy
  on `refreshChrome` fails against the shipped code and passes after the fix,
  which is what a regression test has to do. Rejected: shipping with only the
  (already-passing) `editChanges` coverage, which would not have caught this bug
  and would not catch it again.
  **Amended the same day by D603:** this test stays, but it is no longer the
  *only* coverage — U0.5's DOM environment lets U1.1 also assert the event
  itself. The bindings test is kept for what it says (the invariant, readable,
  no DOM needed); the DOM test is kept for what it proves (that `wireForm`
  actually uses the table — the one line a pure test cannot reach, and exactly
  where this bug lived).
- 2026-08-11: **D603 — `webapp` gains a DOM test environment, `jsdom`,
  per-file opt-in** (human, 2026-08-11, answering G1) — because item 4 ships
  `components/toast.ts`, whose entire behaviour *is* DOM glue (append, tap to
  dismiss, auto-dismiss, replace rather than stack, remove), leaving nothing
  pure to test and no honest way to write U4.2's ACs without it. It also closes
  item 1's regression at the level it broke. Scoped two ways so the repo's
  pure-functions-plus-thin-glue discipline survives: the config sets **no global
  DOM default**, so all ten existing test files stay on `environment: "node"`
  and are not edited; and this is not a licence to move logic into the DOM —
  every new pure helper in M1–M4 is still tested as a pure function first.
  Rejected: no DOM environment at all (would have forced U4.2's ACs down to
  `renderToast`'s string output, shipping a new component whose behaviour only a
  device could verify) and `happy-dom` (lighter and faster, but `jsdom` is the
  more faithful default and this suite is small enough that install size is not
  the constraint).
- 2026-08-11: **D604 — the category grid orders by all-time usage count
  descending** (user, 2026-08-11), superseding `category-picker.md`'s
  2026-08-04 "Ordering stays `created_at ASC`, not recently-used". The old
  entry gave two reasons; both are answered rather than ignored: colour
  stability is unaffected because slot assignment reads a separately sorted
  list, and the muscle-memory cost is accepted because a family's frequency
  order stabilises quickly and the top-left cells become the common case. The
  sort is client-side over the server's own `expense_count`, with no backend
  change; rejected: a `sort=usage` query parameter (a new API contract, a new
  `ORDER BY`, and a second way to order the same list, for a sort the client
  already does for Home's rows), and recency or a decayed score (the brief says
  count).
- 2026-08-11: **D605 — Home's donut takes its slices from the ranked rows** —
  the ring today folds by `created_at`, so on an account with more than six
  categories a recolour of a newer one is invisible (it is inside the grey
  `Other`), and a big recent spender is folded away while a dormant old
  category holds an invisible zero-width slice. Ranking by spend is also what
  the spec's own a11y label ("top three categories") and the collapsed bar's
  "largest segment is visibly the widest" AC already assume. Rejected: keeping
  creation order and only fixing colour delivery (there is nothing wrong with
  the delivery — `stroke="var(--category-slot-n)"` resolves correctly, verified
  in a browser during planning, so the colour was never the mechanism), and
  raising the fold above six (design-system: "never generate a seventh hue").
- 2026-08-11: **D606 — Home's strip carries both alert kinds and every row**,
  replacing `overBudget`'s exceeded-only filter and its render-the-first-only
  behaviour — because Budgets already reports "⚠ Approaching limit" for the
  70–99% band and the main screen contradicting it is the user's complaint. The
  approaching line carries percentage, spent and limit (user, 2026-08-11); the
  over-budget line keeps its existing wording so Home and Budgets stay in sync.
  Not red: over-budget and approaching are different states and red is a
  two-use token.
- 2026-08-11: **D607 — the in-app alert is a toast, not Telegram's native
  popup** — `showPopup` is modal: it would block the screen the user has just
  navigated to and demand a tap for information they did not ask for, on every
  expense in an over-threshold category. A toast is dismissible immediately
  (the brief's words), auto-dismisses, and cannot be confused with the
  confirmation popups this app uses for destructive actions. Rejected:
  `showPopup`/`showAlert` (zero new UI to spec, but modal and reusing the
  confirmation idiom for a notification) and rendering the alert only in the
  strip (it is already there — the brief is that the crossing should announce
  itself).
- 2026-08-11: **D608 — the toast is additive; the bot's message stays** — a
  family member who is not in the app must still be told, and
  `notification_service` is the only surface that can tell them. "Not just in
  Telegram chat" is read as "also in the app". Revisit at CP2 if two
  notifications for one event proves annoying — and that revisit is a decision
  about the *bot*, in its own plan.
- 2026-08-11: **D609 — the toast's trigger is "the expense I just saved is in a
  category at or over its threshold"**, with no crossing-detection state — the
  same rule `expense_service._check_budget_and_notify` already applies to the
  chat message (it sends on every expense at/over the threshold, not only on
  the crossing), so the two surfaces cannot disagree, and no client-side
  "already warned" bookkeeping has to survive a reload. Home already fetches
  every plan's progress on that return leg, so the trigger costs **zero extra
  requests**. Rejected: a `crossed_threshold` flag on the expense response (a
  new field on a four-schema entity, and a backend change this plan otherwise
  does not need) and polling for a partner's crossings (no push channel
  exists — see Non-goals).
- 2026-08-11: **D610 — U1.1's DOM regression test lives in `add-expense.test.ts`
  itself, switching that whole file to `jsdom`** — U0.5's opt-in is per
  **file**, not per describe block (vitest's `@vitest-environment` docblock
  applies file-wide), and the plan's unit lists only `add-expense.test.ts` as a
  test file to touch, so a second file just for the DOM case would be an
  unlisted file for no benefit. Verified safe: none of the file's other ~110
  tests depend on `document`/`window` being absent, and the existing
  `installWebApp`/`afterEach` pattern (assign then `delete globalThis.window`)
  behaves the same under jsdom as it always did — `window` and `document` are
  two separate globals vitest's jsdom environment sets, so deleting one leaves
  the other alone — proven by all 113 tests in the file passing unchanged.
  Narrower than "nothing changes", though: jsdom also seeds other ambient
  globals (e.g. `window.innerHeight`) with real defaults instead of Node's
  `undefined`, which matters if a future test in this file ever exercises
  `lib/telegram.ts::getViewportStableHeight`'s fallback without
  `installWebApp` in place — worth a second look before adding a `focus`-event
  DOM test here (reviewer NIT, U1.1).

## STATE (handoff)
- **Done:** planning, plus **U0.1–U0.4** — the five spec files in the table at
  the top are written and are the source of truth for M1–M4. `verify.sh` green
  after them (docs only). **They have not been reviewed by the human yet**: any
  correction made directly in a spec file wins over this plan's summary of it,
  and over anything said in the session that wrote it. Plus **U0.5** — `jsdom`
  is a `devDependency`, `webapp/vitest.config.ts` is new (test config moved out
  of `vite.config.ts`, which now only holds `build.outDir`), the global
  environment stays `"node"` (all 22 pre-existing test files pass unchanged),
  and `tests/dom-env-smoke.test.ts` proves the per-file `// @vitest-environment
  jsdom` opt-in works — throwaway, deleted by U1.1. No other code unit is
  implemented. The four defects are diagnosed against real code, not inferred
  from the brief:
  - item 1 → `webapp/src/screens/add-expense.ts:1025-1028` (no `applyChrome()`),
    contrast `:959-966`;
  - item 2 → `components/category-picker.md`'s "Resolved" entry plus
    `add-expense.ts:571-607` (grid renders the fetch order, and the fetch does
    not ask for `include_usage`);
  - item 3 → `webapp/src/screens/home.ts:150-182` (`orderedCategories` sorted
    `created_at`, fed to `donutSegments`, folded at six), asserted by
    `webapp/tests/home.test.ts:82`;
  - item 4 → `webapp/src/screens/home.ts:227-235` (`is_exceeded` only) and
    `:665-673` (`overBudget[0]` only).
  Plus **U1.1** — `draftInputBindings` (D601) replaces the two hand-wired
  `amount-input`/`comment-input` listeners in `wireForm`; both bindings call
  `refreshChrome`, closing item 1. The regression is covered two ways (D602/
  D603): a pure spy-on-`refreshChrome` suite (`describe("draftInputBindings
  …")`) and a DOM test under `mount` that dispatches a real `input` event and
  asserts `MainButton.enable()`/"Save changes" — the latter required switching
  `add-expense.test.ts`'s own environment to `jsdom` (D610); `tests/dom-env-
  smoke.test.ts` is deleted, its job done. `docs/ui/screens/02b-edit-expense.md`
  gained the comment-only-save AC row.
- **Next:** **U2.1** (the category grid's usage order, implementing U0.3's
  spec). After that M3 → M4 in order; M4's three units are the only ones that
  must stay in sequence (U4.2 builds the component U4.3 triggers).
- **Spec-authoring notes worth keeping (U0.1–U0.4):**
  - The toast introduces **no new colour token**: it is `--ink` background with
    `--card` text, the existing pair used in reverse, which inverts per theme for
    free and separates the toast from what it floats over without breaking
    design-system's "no shadows" rule. `design-system.md` says so explicitly so a
    future session doesn't add `--toast-bg`.
  - Home's approaching line is **`--ink`**, matching screen 04's shipped
    `.budget-status--warn`. That was not a fresh choice — Budgets had already
    answered it, so the two screens now agree by construction.
  - The **warning glyph** gained a second colour rule (`--status-red` on an
    exceeded line, `currentColor` elsewhere) rather than a second icon. Screen 04
    writes a literal "⚠" character while screen 01 specifies the inline SVG —
    that inconsistency is now an explicit `[?]` in `01-home.md`, deliberately not
    fixed in V6.
  - `01-home.md` carries **two** V6 deltas in one file (the strip and the donut
    ordering) but they are separate units, U4.1 and U3.1. Read only the section
    your unit owns; the other one's presence in the same file is not licence to
    implement it early.
  - `category-picker.md`'s superseded ordering decision was **struck through, not
    deleted**, and each of its two objections carries its answer. If CP1 says
    revert, that entry is the record of why it was there.
- **Confirmed with the human (2026-08-11), closing the two assumptions the
  diagnoses rested on:**
  - The account has **more than six active categories** — so D605 is the cause of
    item 3, not merely a nearby improvement: the recoloured category was inside
    the grey `Other` fold. U3.1 needs no diagnostic step in front of it.
  - The failing edit changed **the comment and nothing else** — exactly D600's
    signature (with any other field changed, MainButton already enables and the
    comment rides along in the PATCH today). There is no second defect behind
    item 1, and U1.1's "comment-only" ACs are the real repro, not a proxy for it.
- **Verified during planning, so no unit needs to re-check it:**
  - `stroke="var(--category-slot-n)"` **does** resolve in a Chromium
    presentation attribute (tested live: computed `stroke` came back
    `rgb(42, 120, 214)` for both the attribute and the `style` form). The ring's
    colour delivery is not the bug — D605 is. Do not "fix" the donut by moving
    its stroke into a `style` attribute; it would be a no-op change.
  - `GET /categories?include_usage=true` already returns
    `expense_count` account-wide and all-time
    (`repositories/category_repo.py::list_with_usage`), and
    `ApiClient.listCategories` already forwards the flag
    (`webapp/src/api/client.ts:237`). Item 2 needs no backend and no client
    method change — only the screen's narrow `Pick` widened.
  - `BudgetProgress` already carries every number the strip and the toast need
    (`fill_pct`, `spent`, `amount`, `remaining`, `is_over_threshold`,
    `is_exceeded`), and `loadHome` already fetches it for every plan on every
    Home load. Item 4 needs no backend and no extra request.
  - `webapp` has **no** `vitest.config.ts` and no DOM environment as of this
    writing; every `mount` in the app is untested. **U0.5 changes that** (G1
    answered yes, D603) — until it lands, a test that needs `document` cannot
    run, and after it lands it needs the per-file
    `// @vitest-environment jsdom` docblock, because the config deliberately
    sets no global default.
- **Gotchas for the next session:**
  - **Do not touch `assignCategoryColors`** while implementing U2.1. Display
    order and slot assignment are deliberately two different sorts;
    `FALLBACK_MAX_SLOT = 6` also stays (V5's own gotcha, still true).
  - **Do not compute a percentage, a threshold comparison or a remaining
    amount in the browser** for U4.1/U4.3. Every one of them is a field on
    `BudgetProgress`. This is D120's lesson and `webapp/CLAUDE.md`'s hardest
    rule.
  - **Do not add `rerenderForm()` to a text input's listener** (U1.1) — it
    replaces `innerHTML` and destroys the caret mid-typing. Patch `textContent`
    and `disabled` in place; `applyChrome`/`patchAmountError` are exactly that.
  - The toast must never install a BackButton or MainButton handler (U4.2's
    AC). Screens own that chrome; a component that grabs it breaks whichever
    screen is under it.
  - `GET /budgets`'s progress is still one call per plan. Do not batch it
    "while you're in there" — a separate decision with its own endpoint change
    (V5's gotcha, still true).
