# Plan: V8 — tag drill-down, one-step Back, and a Budgets view in Statistics

Ninth plan file, after `docs/plans/expense-tracker-mvp.md` (V1 MVP, D1–D45),
`docs/plans/family-features-v1_1.md` (D100–D124),
`docs/plans/bot-allowlist-db.md` (D300s), `docs/plans/mini-app-v2.md`
(D200–D211), `docs/plans/mini-app-v3.md` (D300–D3xx),
`docs/plans/mini-app-v4.md` (D400–D420), `docs/plans/mini-app-v5.md`
(D500–D512), `docs/plans/mini-app-v6.md` (D600–D609) and
`docs/plans/mini-app-v7.md` (language, admin panel, D700–D7xx) — all done.
Decision ids here start at **D800**.

**Scope is Mini App + backend.** Item 1 needs a new `GET /expenses` filter and
item 3 needs a new statistics endpoint, so `repositories/`, `services/` and
`api/` are all in play. Nothing here touches `bot/`, `models/` beyond two
additive aggregate schemas, or `migrations/` — **no migration is needed in
V8** (see D807: no budget-limit history table).

Workflow per unit: `/clear` → `/unit <id> docs/plans/mini-app-v8.md` →
Stop-gate (`bash scripts/verify.sh`) → [reviewer subagent for M2 units] →
human commits.

## Goal
Three items from the user's V8 brief (2026-09-04):

1. **A tag bar in Statistics drills into its expenses**, exactly the way a
   category bar already does. Today the tag bar is tappable and does nothing
   because `GET /expenses` has no tag filter (D801, D802).
2. **BackButton goes back one step, not to Home.** Sub-screens reached from a
   menu destination (Settings → Language is right today; Statistics →
   Expenses → Detail, Budgets → Budget form, Categories → Category form are
   inconsistent) must return to the screen that opened them (D804, D805).
3. **Statistics gets a third grouping, "Budgets"**, beside "By category" and
   "By tag", showing how each budget was filled in the chosen month and
   whether it was exceeded. Under that grouping only the **Month** period tab
   is enabled; Day/Week/Year/Period are disabled and dimmed (D807–D811).

## Review of the brief — what changed after reading the code
Written during planning so no unit re-derives it.

- **Item 1's backend half is small but real.** `GET /statistics/by-period`
  *already* accepts `tag_id` (`api/statistics.py`), but `GET /expenses`
  accepts only `category_id` (`api/expenses.py:24`,
  `services/expense_service.py:295`, `repositories/expense_repo.py:150`'s
  `list`). The tag filter must be **server-side**, not a client-side filter
  of one fetched page — the exact reasoning `docs/ui/screens/03-expenses.md`'s
  Data note §1 already gives for `category_id` ("server-side filtering is what
  makes pagination and the filter agree"). A `WHERE EXISTS (SELECT 1 FROM
  expense_tags …)` clause slots into the existing `conditions`/`params`
  builder in `expense_repo.list` without touching its `_SELECT_WITH_AUTHOR`.
- **Item 1's frontend half needs tag names on the Expenses screen.**
  `buildExpensesData` labels the filter banner from `categories`
  (`expenses.ts:154`); a tag-filtered list needs `GET /tags` too, plus
  `filter.tagOnly` / a tag arm of `filter.both`, plus `empty.*` copy — in all
  three catalogues (`webapp/src/lib/i18n.ts`, EN/RU/UK, `i18n.test.ts`
  enforces key parity).
- **`05-statistics.md` already documents the gap** it is about to close:
  "tag bars have no drill-down target yet — `GET /expenses` has no tag
  filter", "Ranked bar, tag grouping | tap | nothing", and "No haptic on a
  tag-bar tap (it does nothing)". Three spec lines invert in U0.1.
- **Item 2 is a router change, not a screen change.** `main.ts:168` says it
  outright: "Not a generic router; there is no navigation history here, only
  'what's on screen right now'." Every `showX` hard-codes
  `onBack: () => void showHome()` (`showExpenses`:548, `showBudgets`:624,
  `showStatistics`:1023, `showSettings`:1065, `showAdmin`:1137), while three
  places already hand-roll the correct behaviour with closures —
  `showExpenseDetail(id, onBack)`, `categoriesReturnTo`, `tagsReturnTo`, and
  `showLanguage`'s `onBack: () => void showSettings()`. So the codebase
  already has two mechanisms; V8 makes it one (D804).
- **`docs/ui/` has no navigation file at all** — only `design-system.md`,
  `screens/` and `components/`. Back behaviour is currently specified one row
  at a time ("**BackButton:** shown; returns to Home") in ten screen docs.
  Item 2 changes that behaviour, so per the root CLAUDE.md rule it needs a
  spec in the same change: a new `docs/ui/navigation.md` plus a correction to
  each screen doc's BackButton row (D806).
- **Item 3 has no historical budget data to read.** `budget_plans` holds one
  current row per (account, category) with no period column beyond
  `period = "monthly"` and no history; `BudgetService.get_progress` hardcodes
  `month_bounds(now)` (`services/budget_service.py:143`). "How budgets were
  filled in the past" can therefore only mean *this month's limit applied to
  that month's spend* (D807) — a real limitation that must be stated in the
  spec, not silently shipped.
- **The arithmetic already exists and is generic.** `calculate_progress` is a
  pure function taking `spent`/`limit`, and `expense_repo.sum_by_category_month`
  takes explicit `start`/`end`/`tz` despite its name — so a "by budget" reader
  for an arbitrary month needs one repo `list` call, one existing sum call and
  the existing pure calc. No new SQL beyond what `sum_by_category_month`
  already does.
- **The grouping toggle's "never refetches" invariant is load-bearing.**
  `05-statistics.md`: "swaps `state.grouping` and re-renders **locally, with
  no refetch** — both groupings' totals are already in memory from the one
  load". D810 keeps it true by fetching `by-budget` in the same parallel load
  whenever the active unit is `month`.
- **`period-selector.ts` has one all-or-nothing `disabled` prop** (offline).
  Item 3 needs per-tab disabling, which is a new component variant and
  therefore a `components/period-selector.md` change (U0.4), not an ad-hoc
  attribute set from the screen.

## Non-goals
- **No budget-limit history table.** A budget's limit is not snapshotted per
  month in V8; see D807 and the Risks section.
- **No drill-down from a budget bar** into that category's expenses (D812).
  The brief asks for the Budgets view, not a fourth navigation edge.
- **No period carried by a bar tap.** The category bar's long-standing
  "filters by category only, drops the period" behaviour
  (`05-statistics.md`, Interactions) is **not** fixed here; the new tag tap
  mirrors it exactly (D801). Changing both is its own unit in a later plan.
- **No bot changes.** `bot/keyboards.py` keeps `months_back` (D708) and gains
  no tag filter and no budgets view.
- **No browser-side history integration** (`history.pushState`, the hardware
  back button on Android). The stack is Telegram's `BackButton` only (D805).
- **No swipe-back gesture.**
- **No change to `GET /statistics/by-category` / `by-tag`.**

## Constraints
- Money stays `int` minor units end to end, including every intermediate in
  the budget-fill calc (root CLAUDE.md). `fill_pct` is the one float, and it
  is derived last, exactly as `calculate_progress` already does it.
- Every new visible string lands in **all three catalogues** (EN/RU/UK) in the
  same unit that introduces it — `webapp/tests/i18n.test.ts` fails on a key
  present in one catalogue and missing from another.
- Every new colour/size/spacing value comes from `docs/ui/design-system.md` or
  extends it first (root CLAUDE.md). The dimmed-tab treatment reuses the
  existing disabled-row rule (50% opacity) rather than inventing an opacity.
- Layering holds: route → service → repository. The new `EXISTS` clause lives
  in `expense_repo`, the new fill assembly in `statistics_service`.
- `scripts/verify.sh` green after every unit; the webapp suite (960 tests at
  the end of V7) never goes red between units.
- Specs before code: **M0 lands before M1–M3** (see Ordering).

## Ordering (a hard constraint, not a preference)
```
M0 (specs)  →  M1 (tag drill-down)  →  M2 (back stack)  →  M3 (budgets view)
                     │                                          │
                     └── U0.1 ──┐                    U0.3, U0.4 ─┘
                     U0.2 ──────┴── M2
```
- **M0 first, always.** Three of the three items change documented interaction
  behaviour, and two of them ("tap does nothing", "returns to Home") are
  written down as deliberate current behaviour. Code must not contradict a
  spec that still says the opposite.
- **U0.1 before U0.3** — both edit `docs/ui/screens/05-statistics.md`, in
  different sections. Doing them in this order keeps each unit's revert clean.
- **M1 before M2.** M1 adds one more `showExpenses` call site; doing it after
  the stack refactor would mean writing that call site twice.
- **M2 before M3.** M3 adds a third grouping and a period coercion to
  `showStatistics`; the stack refactor rewrites that same function's handler
  block. Merging in the other order is a guaranteed conflict.

## Contracts (U0 / U1.1 / U3.1)
Immutable for the units that consume them. A limitation found mid-unit →
stop, record it in the Decision log, then continue.

### Backend — expense tag filter (U1.1)
```python
# repositories/expense_repo.py
async def list(  # type: ignore[override]
    self,
    *,
    limit: int = 50,
    offset: int = 0,
    account_id: UUID,
    category_id: UUID | None = None,
    tag_id: UUID | None = None,          # NEW
    start: datetime | None = None,
    end: datetime | None = None,
    tz: str = "UTC",
) -> list[ExpenseResponse]: ...

# services/expense_service.py — ExpenseRepositoryProtocol.list gains the same
# keyword, and:
async def list(
    self,
    account_id: UUID,
    *,
    limit: int = 50,
    offset: int = 0,
    category_id: UUID | None = None,
    tag_id: UUID | None = None,          # NEW
    bounds: tuple[datetime, datetime] | None = None,
) -> list[ExpenseResponse]: ...
```
SQL shape (slots into the existing `conditions`/`params` builder, no change to
`_SELECT_WITH_AUTHOR`):
```sql
AND EXISTS (SELECT 1 FROM expense_tags
             WHERE expense_tags.expense_id = expenses.id
               AND expense_tags.tag_id = $n)
```
`GET /expenses` gains `tag_id: UUID | None = None`. `category_id` and `tag_id`
are **AND-combined and both permitted together** (D803). The `own_only`
post-filter in the route is unchanged and still runs after the DB page.

### Frontend — expenses filter (U1.2)
```ts
// webapp/src/screens/expenses.ts
export interface ExpensesFilter {
  categoryId?: Uuid;
  tagId?: Uuid;                 // NEW
  period?: PeriodValue;
}
// buildExpensesData input gains `tags: TagResponse[]` and `tagId?: Uuid`,
// and its output gains `tagLabel: string | null` beside `categoryLabel`.

// webapp/src/api/client.ts
listExpenses(opts: {
  limit?: number; offset?: number;
  categoryId?: Uuid; tagId?: Uuid;      // NEW
  period?: PeriodQuery;
} = {}): Promise<ExpenseResponse[]>
```
New catalogue keys (EN shown; RU + UK in the same unit):
`expenses.filter.tagOnly` = `"{tag}"`,
`expenses.filter.categoryAndPeriod` (existing `filter.both`, unchanged),
`expenses.filter.tagAndPeriod` = `"{tag} · {period}"`,
`expenses.empty.tag` = `"Nothing tagged {tag}."`,
`expenses.empty.tagPeriod` = `"Nothing in {period} tagged {tag}."`,
`expenses.unknownTag` = `"Unknown tag"`.

### Frontend — navigation stack (U2.1)
```ts
// webapp/src/lib/nav-stack.ts — pure, no DOM, no Telegram, no fetching.
export interface NavEntry {
  /** Which screen this entry re-mounts. Debug/testing identity only —
   *  never compared for equality by the stack itself. */
  screen: string;
  /** Re-mounts that screen exactly as it was entered. Called by `pop`'s
   *  caller, never by the stack. */
  restore: () => void;
}

export interface NavStack {
  /** Push a new entry on top. */
  push(entry: NavEntry): void;
  /** Replace the top entry (a same-screen re-render: a retry, a period
   *  change, a grouping toggle) — never grows the stack. */
  replace(entry: NavEntry): void;
  /** Drop the top entry and return the one beneath it, or `null` at the
   *  floor (Home). Does NOT call `restore`. */
  pop(): NavEntry | null;
  /** Empty the stack — Home is the floor and holds no entry. */
  reset(): void;
  /** For tests and for `main.ts`'s re-entrancy guard. */
  depth(): number;
  peek(): NavEntry | null;
}

export function createNavStack(): NavStack;
```
`main.ts` owns the single instance and one `goBack()` that pops and calls the
revealed entry's `restore`, or `showHome()` at depth 0.

### Backend — budget fill (U3.1)
```python
# models/statistics.py — additive aggregate, same precedent as CategoryTotal
class BudgetFill(BaseModel):
    budget_plan_id: UUID
    category_id: UUID
    amount: int          # the plan's CURRENT limit, minor units (D807)
    spent: int           # minor units, that month
    remaining: int       # amount - spent; negative once exceeded
    fill_pct: float | None
    notify_threshold: int
    is_over_threshold: bool
    is_exceeded: bool

# services/statistics_service.py
async def by_budget(
    self,
    account_id: UUID,
    *,
    period: PeriodUnit | None = None,
    offset: int = 0,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[BudgetFill]: ...
```
Route: `GET /statistics/by-budget`, same
`PermissionChecker(Resource.EXPENSES, Action.READ)` gate and the same
`validate_period_params` call as its three siblings. **It rejects any unit
other than `month`** with 422 (`period` absent → the current month, matching
the siblings' default). No `months_back` arm — that legacy parameter is not
extended to a new endpoint (D704's direction of travel).

`own_only` is **not** applied here (D813): a budget is an account-level limit,
not a per-user one, and a per-user slice of the spend against a whole-account
limit is a number that means nothing. The endpoint returns the account's
figures to any caller allowed to read expenses at all.

### Frontend — budgets grouping (U3.2 / U3.3)
```ts
// webapp/src/components/period-selector.ts
export interface PeriodSelectorProps {
  value: PeriodValue;
  now: Date;
  disabled?: boolean;                 // offline — unchanged, all tabs
  allowedUnits?: readonly PeriodUnit[];  // NEW; absent ⇒ all five
  onUnitChange(unit: PeriodUnit): void;
  onOffsetChange(offset: number): void;
  onOpenPicker(): void;
}

// webapp/src/screens/statistics.ts
export type Grouping = "category" | "tag" | "budget";   // widened
export interface StatisticsBudgetRow {
  planId: Uuid; categoryId: Uuid; label: string; colorVar: string;
  amountMinor: number; spentMinor: number; fillPct: number | null;
  notifyThreshold: number;   // NEW, D814 — percent 0-100, ticks the bar
  isOverThreshold: boolean; isExceeded: boolean;
}
// StatisticsData gains `budgetRows: StatisticsBudgetRow[]`.
```
New catalogue keys (EN; RU + UK same unit): `statistics.byBudget` = "Budgets",
`statistics.bars.emptyBudget` = "No budgets set.",
`statistics.budget.of` = "{spent} of {limit}",
`statistics.budget.exceeded` = "Over by {amount}",
`periodSelector.aria.unitUnavailable` = "{unit} — not available for budgets".

## Units

### M0 — Specs (`ui-spec` skill; nothing here writes code)
- [x] **U0.1** `docs/ui/screens/03-expenses.md` + `05-statistics.md` — the tag
      filter and the tag drill-down. In `03-expenses.md`: the filter banner and
      the empty state gain a tag half (three combinations become six), the Data
      section states `GET /expenses` now takes `tag_id` server-side for the same
      reason it takes `category_id`, and the screen's fetch list gains
      `GET /tags`. In `05-statistics.md`: the three lines that document the gap
      invert — Delta ("tag bars have no drill-down target yet"), Interactions
      ("Ranked bar, tag grouping | tap | nothing") and Telegram ("No haptic on a
      tag-bar tap"). State explicitly that the tag tap carries the tag only, not
      the period, mirroring the category tap (D801).
      **AC:** neither file contains a sentence claiming a tag bar tap does
      nothing; `03-expenses.md`'s Copy table lists every tag-filtered string
      the contract above names.
- [x] **U0.2** `docs/ui/navigation.md` — **new** — plus the BackButton row in
      every screen doc it contradicts. The new file owns: the stack model
      (Home is the floor, a menu row is a push onto Home, a sub-screen is a
      push onto its opener), what `replace` means (a retry/period/grouping
      re-render is not a new step), what happens at the floor (BackButton
      returns to Home, then Telegram's own close), and the one screen that
      already behaves this way (Language → Settings) named as the model.
      Then correct the "returns to Home" row in `03-expenses.md`,
      `03b-expense-detail.md`, `04-budgets.md`, `04b-budget-form.md`,
      `05-statistics.md`, `06-categories.md`, `06b-category-form.md`,
      `06c-category-delete.md`, `07-tags.md`, `07b-tag-form.md`,
      `08-settings.md`, `10-admin.md` — each to "returns one step, to the
      screen that opened it (`../navigation.md`)".
      **AC:** `grep -rl "returns to Home" docs/ui/screens/` returns nothing
      that is not explicitly justified as a floor case in the same line.
- [x] **U0.3** `docs/ui/screens/05-statistics.md` — the Budgets grouping.
      A third chip in region 4; a new bar anatomy for region 5 under that
      grouping (name, `spent of limit`, fill bar, over-budget treatment —
      reusing `04-budgets.md`'s existing budget-row vocabulary rather than
      inventing a second one); the Month-only period rule and the dimmed
      tabs; the coercion when Budgets is chosen under a non-month unit; the
      new States rows (no budgets set; a budget whose category was archived);
      the D807 limitation stated in the user's terms ("the limit shown is
      today's limit"); Data gains `GET /statistics/by-budget`; Copy gains four
      of the five keys above (`periodSelector.aria.unitUnavailable` is
      `period-selector.md`'s own key, U0.4's file to add). **Depends on U0.1
      (same file).**
      **AC:** the spec states, in the Data section, that `by-budget` is
      fetched in the same parallel load as the other three whenever the unit
      is month, so the grouping toggle still never refetches (D810).
- [x] **U0.4** `docs/ui/components/period-selector.md` — the restricted-units
      variant. A new row in Variants ("Restricted"), the `allowedUnits` prop in
      Inputs, the visual treatment (50% opacity, `disabled`, no haptic, no
      `onUnitChange`), the accessibility contract (`aria-disabled` and a
      label saying *why*, not just that), and a note that the offset arrows
      and the jump control stay live — only the unit tabs are restricted.
      **AC:** the file names `05-statistics.md`'s Budgets grouping as the
      variant's only consumer, the same way it names its two existing ones.

### M1 — Tag drill-down (item 1)
- [x] **U1.1** Backend: `GET /expenses?tag_id=`. `expense_repo.list` gains the
      `EXISTS` clause, `ExpenseRepositoryProtocol` and `ExpenseService.list`
      gain the keyword, the route gains the query param. Tests: the filter
      returns only tagged expenses, combines with `category_id` and with the
      period bounds, survives pagination (an expense on page 2 of the
      unfiltered list is on page 1 of the filtered one), and an unknown/foreign
      `tag_id` returns `[]` rather than 404.
      **AC:** `GET /expenses?tag_id=<id>&limit=1` returns the newest expense
      carrying that tag, and no untagged expense appears in any page of a
      tag-filtered list.
- [x] **U1.2** Expenses screen accepts a tag filter. `ExpensesFilter.tagId`,
      `ApiClient.listExpenses({ tagId })`, `loadExpenses` also fetching
      `GET /tags`, `buildExpensesData` labelling the banner and the empty
      state from it, and the six catalogue keys in EN/RU/UK.
      **AC:** with `{ tagId }` in force the banner reads the tag name, the
      empty state names the tag ("Nothing tagged Coffee."), and a tag deleted
      between the tap and the load renders "Unknown tag" rather than throwing.
- [x] **U1.3** Statistics' tag bar becomes tappable for real. `mount`'s bar
      handler stops branching on `grouping === "category"`, fires the
      `selection` haptic for both, and reports the tag id; `main.ts`'s
      `onBarTap` widens to `(id, grouping)` and routes to
      `showExpenses({ tagId })` for the tag arm.
      **AC:** tapping a tag bar lands on Expenses filtered to that tag with the
      banner naming it; tapping a category bar is byte-for-byte the behaviour
      it had before this unit.

### M2 — One-step Back (item 2)
- [ ] **U2.1** `webapp/src/lib/nav-stack.ts` + `webapp/tests/nav-stack.test.ts`
      — the pure module from Contracts, **not wired to anything**. Push/replace/
      pop/reset/depth/peek, `pop` at the floor returning `null`, `replace` on an
      empty stack behaving as `push`.
      **AC:** `verify.sh` green with the module exercised only by its own tests;
      `main.ts` is untouched by this unit and app behaviour is unchanged.
- [ ] **U2.2** Wire the stack into `main.ts` for the menu-reachable screens.
      A module-level `navStack`, a `navigate(screen, restore)` helper called at
      the top of each `showX`, a `goBack()` that pops and restores, `showHome`
      calling `reset()`, and every `onBack: () => void showHome()` in
      `showExpenses`/`showBudgets`/`showStatistics`/`showSettings`/`showAdmin`
      replaced by `goBack`. Retries and period/grouping re-renders use
      `replace`, not `push` (else "back" walks through every period the user
      tried). **Reviewer subagent before commit.**
      **AC:** Home → menu → Statistics → back lands on Home (unchanged), and
      Statistics → tag bar → Expenses → back lands on **Statistics with its
      period and grouping intact**, not Home. Also covers
      `admin.ts`'s `requestCloseCreate`, which today hardcodes Home as
      BackButton's target in **both** List and Create mode (comment: "the
      destination is Home in both modes") — per U0.2's corrected
      `10-admin.md`, Create mode's one step back is List mode, not Home, so
      `exitToHome` becomes mode-dependent here too, the same shape as every
      other `showX` in this unit.
- [ ] **U2.3** Retire the second mechanism. `showExpenseDetail`'s `onBack`
      parameter, `categoriesReturnTo`, `tagsReturnTo`, `showBudgetForm`'s
      return-to-Budgets closures and `showLanguage`'s `onBack: showSettings`
      all become stack pops; the module-level `let` closures are deleted. The
      Add-Expense-mid-draft returns (a category or tag created from the
      composer) keep working because a stack entry is a thunk and can carry
      the draft (D805). **Reviewer subagent before commit.**
      **AC:** creating a category from inside Add expense still returns to Add
      expense with the draft intact and the new category selected; no
      `*ReturnTo` module-level variable remains in `main.ts`.

### M3 — Budgets in Statistics (item 3)
- [ ] **U3.1** Backend: `models.statistics.BudgetFill`,
      `StatisticsService.by_budget`, `GET /statistics/by-budget`. Reuses
      `budget_plan_repo.list`, `expense_repo.sum_by_category_month` (generic
      bounds despite the name) and `budget_service.calculate_progress` — the
      pure calc is imported, not re-implemented. Non-month units → 422.
      **AC:** for an account with two plans, `GET /statistics/by-budget?period=
      month&offset=-1` returns both plans scored against **last** month's
      spend and this month's limits; `?period=day` returns 422; an account with
      no plans returns `[]`, not 404.
- [ ] **U3.2** `period-selector` gains `allowedUnits`. Disabled tabs render at
      50% opacity with `disabled` + `aria-disabled`, fire no haptic and call no
      handler; arrows and the jump control are unaffected. CSS in `app.css`
      reuses the existing disabled treatment. Tests cover a restricted render,
      a tap on a restricted tab being a no-op, and the default (prop absent)
      still enabling all five.
      **AC:** with `allowedUnits: ["month"]` the four other tabs are visibly
      dimmed and inert, and the component's existing tests pass untouched.
- [ ] **U3.3** Statistics renders the Budgets grouping. `Grouping` widens, the
      third chip appears, `loadStatistics` also calls `by-budget` when the unit
      is `month` (one `Promise.all`, D810), `buildStatisticsData` maps plans to
      `StatisticsBudgetRow` (category name + colour from the categories already
      loaded; an archived or missing category falls back the way
      `budgets.ts:133` already does), and the bar list renders the budget row
      shape from U0.3's spec. Five catalogue keys in EN/RU/UK.
      **AC:** under `{unit:"month"}` with two plans the Budgets chip shows two
      rows reading "spent of limit" with the over-budget one marked; with no
      plans it shows "No budgets set."; the category and tag groupings still
      swap with no network call.
- [ ] **U3.4** `main.ts` wires the restriction. `showStatistics` passes
      `allowedUnits: ["month"]` down when the grouping is `budget`, and
      coerces the period to `{ unit: "month", offset: 0 }` when the user picks
      the Budgets chip under any other unit (D809). Docs: `webapp/CLAUDE.md`
      and this plan's STATE.
      **AC:** picking Budgets while "Year" is active re-renders on the current
      month with the four other tabs dimmed; picking "By category" again
      re-enables all five and keeps the month in force.

## Risks
- **U2.2/U2.3 are the riskiest diffs in this plan.** `main.ts` is 1168 lines,
  every screen enters through it, and `webapp/tests/main.test.ts` asserts
  current back behaviour directly. Mitigations: the stack lands as a tested
  pure module first (U2.1), the wiring is split in two, and both wiring units
  get a reviewer pass. If U2.2's diff exceeds the 300-line budget, split it by
  screen rather than widening the unit.
- **Back-stack growth on retries.** A user retrying a failed load five times
  must not need five back taps. `replace` (not `push`) on same-screen
  re-renders is the whole defence — it is the first thing to check if "back
  feels stuck".
- **D807's honesty problem.** A user who raises a budget in October and then
  looks at September sees September scored against the *new* limit. This is
  the single most likely "that number is wrong" report from V8. It is stated
  in the spec; if the user rejects it, the fix is a `budget_plan_history`
  table and its own plan — not a patch inside these units.
- **A budget whose category was archived** still has a plan row and still
  accrues no new spend. The Budgets grouping shows it; `budgets.ts` already
  has the fallback label path to copy.
- **i18n key parity** breaks the build, not the runtime — but it breaks it in
  a unit that "only touched the frontend". Add all three languages in the same
  edit, every time.
- **`own_only` and the tag filter.** The route's post-fetch `own_only` filter
  still runs after the DB page, so a restricted caller can still get a short
  page (the pre-existing "Pagination vs own_only" risk from the MVP plan). The
  tag filter neither fixes nor worsens it; do not try to fix it here.

## Decision log
- 2026-09-04: **D800** — the three brief items ship as one plan file,
  `mini-app-v8.md`, ids from D800. Because they share one screen (Statistics
  is touched by items 1 and 3) and one router (`main.ts` by all three), so
  three separate plans would have to cross-reference each other's units to
  express the ordering constraint. Rejected: a plan per item.
- 2026-09-04: **D801** — the tag bar tap carries **the tag only, not the
  period**, exactly mirroring the category bar tap. Because the category tap's
  period-dropping behaviour is documented, shipped and out of this brief's
  scope; making the new tap smarter than the old one would create a second
  divergence to explain instead of removing one. Rejected: carrying the period
  on the new tap (asymmetric); fixing both taps here (unrequested scope, and
  it changes a shipped behaviour the user did not complain about).
- 2026-09-04: **D802** — the tag filter is **server-side** on `GET /expenses`,
  not a client-side filter of the fetched page. Because
  `docs/ui/screens/03-expenses.md`'s Data note already settled this argument
  for `category_id`: a client-side filter makes pagination lie. Rejected:
  filtering `buildExpensesData`'s input (the same bug the V4 unit removed).
- 2026-09-04: **D803** — `category_id` and `tag_id` are AND-combined and may
  both be sent. Because the route is a general list filter and orthogonal
  parameters are cheaper to keep orthogonal than to guard; no UI sends both
  today. Rejected: 422 on both-at-once.
- 2026-09-04: **D804** — back behaviour becomes a **navigation stack owned by
  `main.ts`**, replacing per-screen hard-coded `showHome()` targets. Because
  the file already carries two mechanisms (hard-coded Home targets *and*
  hand-rolled return closures) and the bug the user reported is exactly the
  seam between them. Rejected: adding an `onBack` argument to every `showX`
  (that *is* the closure mechanism, and it is what produced the
  inconsistency); rejected: `history.pushState` (the app runs in a Telegram
  webview whose own back gesture we do not own — out of scope, see Non-goals).
- 2026-09-04: **D805** — stack entries are **thunks** (`{screen, restore}`),
  not serialized state. Because a restore must re-run the screen's own loader
  to show fresh data, and because a thunk can close over a draft — which is
  what makes U2.3's deletion of `categoriesReturnTo`/`tagsReturnTo` a
  simplification rather than a feature loss. Rejected: storing screen args and
  a dispatch table (a second router to keep in sync).
- 2026-09-04: **D806** — back behaviour gets its own spec file,
  `docs/ui/navigation.md`, rather than twelve edited screen rows alone.
  Because it is one rule that twelve screens obey, and repeating it twelve
  times is how the current inconsistency became invisible. The screen rows are
  still corrected, but they point at the one file.
- 2026-09-04: **D807** — historical budget fill is computed against the plan's
  **current** limit. Because `budget_plans` stores no per-month limit history
  and adding one is a migration plus a write path plus a backfill — a feature,
  not an implementation detail of a Statistics tab. The limitation is stated
  in `05-statistics.md`. Rejected: a `budget_plan_history` table in V8;
  rejected: hiding months before the plan's `created_at` (the spend figure is
  still true and still useful).
- 2026-09-04: **D808** — a **deleted** budget plan has no history at all; the
  Budgets grouping lists only plans that exist today. Follows directly from
  D807 and needs no separate mechanism.
- 2026-09-04: **D809** — choosing Budgets under a non-month unit **coerces**
  the period to `{unit: "month", offset: 0}` rather than disabling the chip.
  Because the brief asks for the other tabs to be dimmed, which presumes the
  Budgets chip is always reachable; and because a chip that disables itself
  based on an unrelated control is the harder rule to explain. Rejected:
  remembering the pre-Budgets unit and restoring it on the way out (state the
  user cannot see).
- 2026-09-04: **D810** — `GET /statistics/by-budget` is fetched in the **same
  parallel load** as the other three whenever the active unit is `month`, so
  the grouping toggle keeps its no-refetch invariant
  (`05-statistics.md`). Under a non-month unit it is not fetched at all — the
  only way to reach the Budgets grouping from there goes through D809's
  coercion, which is a refetch anyway. Rejected: fetching on the chip tap (a
  spinner inside a toggle that has never had one).
- 2026-09-04: **D811** — the **Period (custom range)** tab is disabled under
  Budgets too. Because a custom range is not a month, and a fill percentage
  over 17 days against a monthly limit is a misleading number rather than a
  partial one.
- 2026-09-04: **D812** — a budget bar is **not** a drill-down target in V8.
  Because the brief asks to see how budgets were filled, not for a fourth
  navigation edge, and the obvious target (that category's expenses for that
  month) is already reachable via the category grouping.
- 2026-09-04: **D813** — `GET /statistics/by-budget` does **not** apply the
  `own_only` restriction its three siblings apply. Because a budget limit is an
  account-level number: scoring one caller's own spend against the whole
  account's limit produces a fill percentage that is wrong in a way no label
  can repair. A caller permitted to read expenses at all sees the account's
  real fill. Flag this one to the reviewer explicitly — it is a deliberate
  deviation from `_own_user_id`'s pattern, and it is the kind of line a
  reviewer should challenge.
- 2026-09-05: **D814** — `StatisticsBudgetRow` gains `notifyThreshold: number`
  (Contracts, Frontend — budgets grouping). Found mid-U0.3: the spec's row
  anatomy reuses `04-budgets.md`'s bar-plus-tick vocabulary, and the tick
  needs a threshold to sit at, but the original Contracts stub carried only
  `isOverThreshold`/`isExceeded` (booleans, useless for positioning a tick)
  even though the backend's `BudgetFill` already returns `notify_threshold`.
  Recorded per this plan's own rule ("a limitation found mid-unit → stop,
  record it in the Decision log, then continue") rather than dropping the
  tick from the spec — 04-budgets' tick is exactly the anatomy this grouping
  was asked to reuse, not reinvent a poorer version of.

## STATE (handoff)
- **Done:** Planning only, 2026-09-04. The three brief items were read against
  the code before decomposition; the "Review of the brief" section is the
  result and no unit needs to re-derive it. The findings that changed the
  shape of the plan: `GET /statistics/by-period` already takes `tag_id` but
  `GET /expenses` does not (item 1 is a real backend unit, not wiring);
  `main.ts:168` already documents its own lack of history and the file already
  carries two competing back mechanisms (item 2 is a router refactor, and the
  riskiest work here); `budget_plans` has no limit history and
  `BudgetService.get_progress` hardcodes the current month (item 3 needs D807's
  stated limitation, and a new endpoint rather than N+1 progress calls).
  Fourteen decisions taken, D800–D813 — the ones a later session is most
  likely to want to reopen are **D807** (fill against today's limit) and
  **D813** (no `own_only` on `by-budget`).
- **Done (U0.1, 2026-09-05):** `docs/ui/screens/03-expenses.md` and
  `05-statistics.md` updated. In `03-expenses.md`: a `Changing (V8)` delta
  bullet, `filter.tagOnly`/`filter.tagAndPeriod`/`empty.tag`/
  `empty.tagPeriod`/`unknownTag` in the Copy table, `GET /tags` and `tag_id`
  in the Data table plus a "Backend deltas (V8)" note, an edge case and three
  new acceptance criteria for the tag-deleted-mid-flight fallback and the two
  banner/empty combinations. In `05-statistics.md`: the three gap-documenting
  lines inverted (Delta's "Taking" bullet, the tag-grouping Interactions row,
  the Haptics line), a new `Changing (V8)` delta bullet stating the tag tap
  carries only the tag per D801, the category-bar Edge case widened to cover
  tag too, and two new acceptance criteria. No new decisions — this unit
  applies D801/D802/D803, it doesn't make new ones. No code was touched
  (M0 is spec-only); `scripts/verify.sh` was run as the Stop-gate and passed
  because nothing it checks changed.
- **Done (U0.2, 2026-09-05):** `docs/ui/navigation.md` created — the stack
  model (Home as floor, menu rows push onto Home, sub-screens push onto their
  opener), `push` vs `replace`, the floor behaviour, `09-language.md` named as
  the reference implementation, and a per-screen opener/target table. Then the
  BackButton row (Telegram section, Interactions table, and any affected
  Acceptance criteria) was corrected in all twelve screen docs the unit names:
  `03-expenses.md`, `03b-expense-detail.md`, `04-budgets.md`,
  `04b-budget-form.md`, `05-statistics.md`, `06-categories.md`,
  `06b-category-form.md`, `06c-category-delete.md`, `07-tags.md`,
  `07b-tag-form.md`, `08-settings.md`, `10-admin.md`. Two real (not just
  cosmetic) corrections came out of this: `03-expenses.md` and `05-statistics.md`
  already document a category-bar tap from Statistics into Expenses
  (pre-existing, not a V8 addition), and Expenses' BackButton was still
  hardcoded to Home for that path — now documented as returning to whichever
  of Home or Statistics opened it. `06-categories.md`/`07-tags.md` still said
  "always navigates to Home" even though `main.ts` already returns to the
  expense composer via `categoriesReturnTo`/`tagsReturnTo` when opened from
  there — the docs were stale relative to the code; now corrected to match.
  Also found and fixed a **self-inconsistency inside `10-admin.md`**
  (pre-existing, unrelated to any V8 item): its Telegram/Interactions
  sections said Create mode's BackButton returns straight to Home, while its
  own Create-mode "Cancel" row said Cancel — "identical to BackButton" —
  returns to List mode. Resolved in favour of List mode (Create is pushed
  onto List, not onto Home), consistent with the new stack model; no new
  decision id needed, this applies D804 rather than choosing among
  alternatives. No new decisions otherwise — this unit applies D804/D805/D806,
  it doesn't make new ones. No code was touched (M0 is spec-only);
  `scripts/verify.sh` was run as the Stop-gate and passed (960 webapp tests,
  unchanged) because nothing it checks changed.
  **Reviewer round 1** (APPROVE with one WARN, fixed before commit): the
  `10-admin.md` fix above now diverges from shipped `webapp/src/screens/admin.ts`
  (`requestCloseCreate` hardcodes Home as BackButton's target in both List and
  Create mode today), and no unit yet committed to closing that gap when M2
  lands — U2.2's own bullet above now names `admin.ts`'s `requestCloseCreate`
  explicitly so it isn't missed. Two NITs also addressed/noted: tightened
  `06-categories.md`'s AC wording to be self-contained; `docs/design/mini-app-ux.md`
  still says bare "BackButton → Home" for Expenses/Statistics — pre-existing,
  out of this unit's file list, left as a follow-up.
  **Reviewer round 2** (APPROVE with one WARN, three NITs, fixed before
  commit): `navigation.md`'s stack-model bullet and per-screen table didn't
  mention Admin's own List↔Create push (the same nuance `10-admin.md` already
  documents) — added a Create-mode row to the table and a clause to the
  stack-model bullet. Two phrasing NITs fixed: `06-categories.md`/`07-tags.md`'s
  "Home is the fix for..." lines reworded to "The Home-opened path is the fix
  for..." now that BackButton can also target the expense composer;
  `07-tags.md`'s AC wording ("opened that way") aligned with
  `06-categories.md`'s ("opened from that tile"). `scripts/verify.sh` re-run
  and green after each round.
- **Done (U0.3, 2026-09-05):** `docs/ui/screens/05-statistics.md` updated for
  the Budgets grouping. Purpose/Delta gain a third-grouping bullet stating the
  Month-only rule, the D809 coercion and the D807 current-limit limitation in
  the user's terms; Layout's region 4 gains the "Budgets" chip and region 5
  gains a new "Budget row" anatomy subsection reusing `04-budgets.md`'s dot +
  head + bar + tick vocabulary, with a trailing Warning glyph (icon-only for
  `isOverThreshold`, icon + `budget.exceeded` text for `isExceeded`) standing
  in for `04-budgets.md`'s three-way status line; States gains two rows (no
  budgets set; a plan whose category was archived, falling back to
  `statistics.unknownCategory` per `budgets.ts:133`); Interactions gains the
  budget bar's no-op tap (D812), the dimmed-tab no-op, the `‹`/`›` offset
  behaviour under Budgets, and a refetch exception on the grouping toggle for
  D809's coercion case; Copy gains four keys (`grouping.budget`,
  `bars.empty.budget`, `budget.of`, `budget.exceeded` — `periodSelector.aria.
  unitUnavailable` stays out of this file, it's U0.4's own key); Data gains
  `GET /statistics/by-budget` with the D810 parallel-load note and the D807
  limitation restated plainly. `design-system.md`'s Warning icon row extended
  to name this screen as a third consumer — no new token, value or icon
  invented. This unit applies D807–D812 and makes one new decision, **D814**:
  `StatisticsBudgetRow` (Contracts) gains `notifyThreshold: number` — the
  original stub had no field the tick could sit at even though the backend's
  `BudgetFill` already returns `notify_threshold`. One inferred choice flagged
  in Open questions for the human to confirm or overturn: no "on track" text
  for un-flagged budget rows (only the two Contracts strings ship), with a
  matching accessibility gap noted (the approaching-state glyph has no
  accessible name yet). No code was touched (M0 is spec-only);
  `scripts/verify.sh` was run as the Stop-gate and passed because nothing it
  checks changed.
  **Reviewer round 1** (REQUEST_CHANGES, all fixed before round 2): one
  BLOCKER — `StatisticsBudgetRow` had no field to position the anatomy's tick
  at, resolved as D814 above. Three WARNs, all fixed: a rule citation
  attributed to "root CLAUDE.md" that actually lives in `webapp/CLAUDE.md`
  (status red + icon + word on over-budget); the States table's Error row
  still said "three" statistics calls after the Data section's new text said
  a fourth (`by-budget`) can join under Month; the Grouping-toggle
  Interactions row phrased the no-refetch guarantee so it read as if
  category↔tag's pre-existing no-refetch behaviour were also Month-gated,
  when only the new Budgets arm is. One NIT, fixed: the unit's own plan
  bullet said "five keys" when this unit ships four
  (`periodSelector.aria.unitUnavailable` is `period-selector.md`'s/U0.4's).
  `scripts/verify.sh` re-run and green.
  **Reviewer round 2** (APPROVE, no fixes needed): confirmed all four round-1
  fixes landed correctly with no regressions; a fresh pass over Contracts/
  Decision-log alignment, `ui-spec` provenance markers and the Delta/
  Acceptance-criteria sections found nothing further. `scripts/verify.sh`
  unchanged and green.
- **Done (U0.4, 2026-09-05):** `docs/ui/components/period-selector.md` updated
  with the restricted-units variant. Variants gains a "Restricted (V8)" row;
  States gains a row distinguishing it from the existing whole-component
  Disabled state (per-tab 50% opacity vs. whole-component); Inputs gains
  `allowedUnits?: readonly PeriodUnit[]` (absent ⇒ all five enabled) with a
  note that it restricts the tab row only — the nav row (arrows, label, jump
  control) reads no restriction from it; Copy gains
  `aria.unitUnavailable` = "{unit} — not available for budgets", sourced from
  the tab's own `tab.*` label rather than the lowercase `unit.*` map
  `aria.prev`/`aria.next` use; Accessibility states a restricted tab's
  accessible name comes from that key, not the bare label. A new V8 paragraph
  in Purpose and the file's Acceptance criteria both name
  `05-statistics.md`'s Budgets grouping as the variant's sole consumer,
  matching the AC. No new decisions — this unit applies
  D807–D811 as already recorded, it doesn't make new ones. No code was
  touched (M0 is spec-only); `scripts/verify.sh` was run as the Stop-gate and
  passed (809 backend + 960 webapp tests, both unchanged) because nothing it
  checks changed.
  **Reviewer round 1** (APPROVE, one WARN and two NITs fixed before round 2):
  the WARN — `aria.unitUnavailable`'s `{unit}` source was ambiguous between
  the capitalized `tab.*` label and the lowercase `unit.*` map `aria.prev`/
  `aria.next` use — resolved by naming `tab.*` explicitly in the Copy table
  and this STATE entry. Two NITs fixed: the file didn't reconcile a
  `disabled` tab with the existing roving-tabindex "Arrow keys move between
  tabs" rule; and this STATE entry originally overstated an edit to the
  existing "Used by" sentence when the V8 text is a new appended paragraph.
  **Reviewer round 2** (APPROVE; one WARN, one NIT, both fixed): the
  round-1 arrow-key fix was itself unclear — it hedged ("may skip... the
  same way it already skips nothing today") without stating an actual
  behavior. Reworded to state plainly that a native `disabled` element
  cannot receive focus, so arrow-key traversal skips a restricted tab
  entirely. NIT: "replacing `aria-selected`'s usual label" mischaracterized
  a boolean ARIA state as a label source — reworded to "the tab's usual
  accessible name". `scripts/verify.sh` re-run and green after each round
  (809 backend + 960 webapp tests, unchanged throughout).
- **M0 complete.** U0.1, U0.2, U0.3 and U0.4 are all ticked — every spec line
  M1–M3 will implement against now exists and matches the target behaviour.
- **Done (U1.1, 2026-09-05):** `GET /expenses?tag_id=` implemented exactly per
  Contracts. `repositories/expense_repo.py`'s `list` gained `tag_id: UUID |
  None = None` and an `EXISTS (SELECT 1 FROM expense_tags …)` clause slotted
  into the existing `conditions`/`params` builder (no change to
  `_SELECT_WITH_AUTHOR`); `services/expense_service.py`'s
  `ExpenseRepositoryProtocol.list` and `ExpenseService.list` both gained the
  same keyword and thread it straight through; `api/expenses.py`'s
  `list_expenses` gained the `tag_id` query param. `category_id` and `tag_id`
  are AND-combined per D803 — no guard against sending both. Tests added at
  all three layers: `tests/test_expense_repo.py` (5 new integration tests —
  tag-only filter, tag+category AND-combine, tag+period combine, pagination
  survival mirroring `category_id`'s U0.3 precedent, unknown `tag_id` → `[]`),
  `tests/test_expense_service.py` (`FakeExpenseRepo.list` gained `tag_id`
  filtering and its call-log dict gained the key; the byte-for-byte
  no-params test asserts `tag_id=None` too; new
  `test_list_passes_tag_id_through_to_repo`), `tests/test_expenses_api.py`
  (new `test_list_expenses_tag_id_filters_across_pages` and
  `test_list_expenses_category_id_and_tag_id_and_combined`, and the
  byte-for-byte no-params test asserts `tag_id=None`). `tests/README.md`
  updated with all new test entries in the same commit (tests/CLAUDE.md
  rule). No new decisions — this unit applies D801–D803 as already recorded.
  `scripts/verify.sh` green (812 unit + 960 webapp tests); the 5 new
  integration tests additionally verified green via
  `bash scripts/integration_docker.sh -k test_expense_repo` (36 passed).
  **Reviewer round 1:** pending.
- **Done (U1.2, 2026-09-05):** Expenses screen's tag filter (frontend)
  implemented exactly per Contracts. `webapp/src/screens/expenses.ts`:
  `ExpensesFilter.tagId`, `ExpensesApi.listTags()` (new, mirrors
  `listCategories()`), `buildExpensesData` gained `tags: TagResponse[]` and
  `tagId?: Uuid` on input and `tagLabel: string | null` on output (unknown/
  deleted tag id falls back to `expenses.unknownTag`, same pattern as
  `categoryLabel`'s `unknownCategory` fallback); `createExpensesController`
  fetches `GET /tags` in the same `Promise.all` as `getMe`/`listCategories`
  on `load()`, and threads `tagId` through every `listExpenses` call
  (`fetchPage`), so it travels on `loadMore()` pages too. `filterBannerText`/
  `emptyMessage` gained a tag arm mirroring the category arm — since D803
  permits `category_id`+`tag_id` together but no screen sends both, the
  banner gives category precedence when (hypothetically) both are set,
  matching the existing precedent of not inventing a combined string the
  Copy table doesn't define. `webapp/src/api/client.ts`'s `listExpenses`
  gained `tagId` → `tag_id` query param, AND-combined with `category_id`
  exactly like the backend (D803). Five new catalogue keys in EN/RU/UK
  (`expenses.filter.tagOnly`, `expenses.filter.tagAndPeriod`,
  `expenses.empty.tag`, `expenses.empty.tagPeriod`, `expenses.unknownTag`) —
  the unit's own plan bullet says "six catalogue keys" but the Contracts list
  includes `expenses.filter.categoryAndPeriod` as "(existing `filter.both`,
  unchanged)", i.e. not a new key; same kind of off-by-one the U0.3 STATE
  entry already flagged for its own key count, applying existing decisions
  rather than making a new one. No `main.ts` changes — `showExpenses`
  already accepts `filter: ExpensesFilter` opaquely and forwards it
  unchanged, so `tagId` flows through with no wiring; the actual tag-bar tap
  is U1.3's job. Tests added: `webapp/tests/expenses.test.ts` (tag-label
  resolution and unknown-tag fallback in `buildExpensesData`, `listTags`
  fetched alongside categories and `tagId` sent on every page including
  `loadMore`, category+tag AND-combine pass-through, tag-only and
  tag+period empty/banner rendering, unknown-tag banner fallback) and
  `webapp/tests/client.test.ts` (`tagId` serializes as `tag_id` alongside
  `category_id`). No new decisions — this unit applies D801–D803 as already
  recorded. `scripts/verify.sh` green (812 backend + 971 webapp tests).
  **Reviewer round 1** (APPROVE, one NIT fixed before commit): the
  category-wins-over-tag banner/empty-state precedence (when both are
  somehow set) had no test pinning it down — only the API-call AND-combine
  was tested, not the render-layer precedence. Added one test exercising
  both `categoryId` and `tagId` together, asserting the banner and empty
  state both read "Transport" (the category) and never mention "Coffee"
  (the tag). `scripts/verify.sh` re-run and green (812 backend + 972 webapp
  tests).
- **Done (U1.3, 2026-09-05):** Statistics' tag bar is now a real drill-down,
  exactly per the M1 unit bullet. `webapp/src/screens/statistics.ts`:
  `StatisticsHandlers.onBarTap` widened to `(id: Uuid, grouping: Grouping) =>
  void`; `mount`'s bar-click wiring no longer branches on
  `current.grouping === "category"` — it attaches to every `[data-id]` bar row
  regardless of grouping, fires the same `selection` haptic for both, and
  passes `current.grouping` through to the handler. The stale header comment
  documenting the tag bar as "tappable-but-no-op" was corrected to describe
  the new dual-grouping drill-down. `webapp/src/main.ts`: `showStatistics`'s
  `onBarTap` handler widened to accept `(id, tapGrouping)` and routes to
  `showExpenses({ tagId: id })` when `tapGrouping === "tag"`, else
  `showExpenses({ categoryId: id })` — byte-for-byte the same category path as
  before. One stale doc comment above `showStatistics` corrected to mention
  both bar types. No new decisions — this unit applies D801 (no period
  carried) as already recorded, it doesn't make new ones. No test changes:
  `mount` for this screen has been an accepted "not meaningfully unit-testable
  under Node" gap since its original U2.5 implementation (no test ever covered
  `onBarTap` wiring, category or tag), and this unit's change is pure wiring
  inside that same untested function — `buildStatisticsData`/`renderStatistics`
  (the tested, pure layer) are untouched. `scripts/verify.sh` green (812
  backend + 972 webapp tests, both counts unchanged from U1.2).
  **Reviewer round 1:** pending.
- **Next:** `/clear`, then `/unit U2.1 docs/plans/mini-app-v8.md` — M1 (tag
  drill-down) is complete; M2 (one-step Back) starts with the pure
  `nav-stack.ts` module from Contracts, not wired to anything yet.
- **Gotchas:**
  - A stale, already-merged branch literally named `U0.2` was left over from
    the V7 plan (local + `origin`) when this unit started; it was not reused
    — this unit's work landed on `U0.2_navigation_stack_spec` instead. Worth
    deleting that stale branch (local + remote) next time it's convenient;
    it is not touched by this plan.
  - U0.1 and U0.3 both edit `docs/ui/screens/05-statistics.md`, in different
    sections, and must run in that order.
  - No migration in V8. If a unit reaches for Alembic, a decision was missed —
    stop and record it.
  - Every new string needs EN + RU + UK in the same edit
    (`webapp/tests/i18n.test.ts` enforces parity, and it fails the build, not
    a runtime path).
  - `expense_repo.sum_by_category_month` takes explicit bounds despite the
    "month" in its name — U3.1 reuses it as-is; do not add a second sum query.
  - `calculate_progress` in `services/budget_service.py` is already pure and
    already correct; U3.1 imports it. A second fill calculation in
    `statistics_service` would be the money-math duplication the root
    CLAUDE.md exists to prevent.
  - U2.2's `replace`-vs-`push` distinction is the whole reason retries don't
    pile up in the stack. It is the first thing to check if back behaviour
    feels wrong after M2.
