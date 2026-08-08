import { ApiClient, ForbiddenError } from "./api/client";
import { applyTheme, getInitData } from "./lib/telegram";
import {
  createMemoryCache as createAddExpenseCache,
  draftFromExpense,
  emptyDraft,
  loadAddExpenseData,
  mount as mountAddExpense,
  type AddExpenseHandlers,
  type AddExpenseLoadState,
  type Draft as AddExpenseDraft,
} from "./screens/add-expense";
import {
  applyBudgetsChrome,
  createMemoryCache as createBudgetsCache,
  loadBudgets,
  mount as mountBudgets,
  type BudgetsHandlers,
} from "./screens/budgets";
import {
  applyCategoriesChrome,
  applyCategoryDeleteOutcome,
  categoryDeleteFailureMessage,
  categoryDeleteOutcomeKind,
  categoryFormDraftFromRow,
  createMemoryCache as createCategoriesCache,
  emptyCategoryFormDraft,
  loadCategories,
  mount as mountCategories,
  mountCategoryForm,
  revertCategoryDeleteOutcome,
  type CategoriesHandlers,
  type CategoryDeleteFailure,
  type CategoryFormHandlers,
} from "./screens/categories";
import {
  applyDetailChrome,
  loadDetail,
  mount as mountExpenseDetail,
  type DetailHandlers,
} from "./screens/expense-detail";
import {
  applyTagDeleteOutcome,
  applyTagsChrome,
  createMemoryCache as createTagsCache,
  emptyTagFormDraft,
  loadTags,
  mount as mountTags,
  mountTagForm,
  revertTagDeleteOutcome,
  tagDeleteFailureMessage,
  tagDeleteOutcomeKind,
  tagFormDraftFromRow,
  type TagDeleteFailure,
  type TagFormHandlers,
  type TagsHandlers,
} from "./screens/tags";
import {
  applyExpensesChrome,
  createExpensesController,
  createMemoryCache as createExpensesCache,
  mount as mountExpenses,
  type ExpensesFilter,
  type ExpensesHandlers,
  type ExpensesState,
} from "./screens/expenses";
import {
  applyHomeChrome,
  createHomeController,
  createMemoryCache as createHomeCache,
  mount as mountHome,
  type HomeHandlers,
} from "./screens/home";
import { clampOffset, type PeriodValue } from "./lib/period";
import {
  applyStatisticsChrome,
  createMemoryCache as createStatisticsCache,
  loadStatistics,
  mount as mountStatistics,
  type Grouping,
  type StatisticsHandlers,
} from "./screens/statistics";
import type { CategoryResponse, ExpenseResponse, Uuid } from "./api/types";

const client = new ApiClient({ getInitData });
const homeCache = createHomeCache();
const homeController = createHomeController(client, homeCache);
const addExpenseCache = createAddExpenseCache();
const expensesCache = createExpensesCache();
const budgetsCache = createBudgetsCache();
const categoriesCache = createCategoriesCache();
const tagsCache = createTagsCache();
const statisticsCache = createStatisticsCache();

// Home's selected period. Module-level so it survives navigating to screen
// 02 and back, and a retry (both just call `showHome`/`refreshHome` again,
// same shape as `showStatistics`'s `monthsBack` closure argument) — it only
// resets to the cold-open default when the app itself reboots.
let homePeriod: PeriodValue = { unit: "month", offset: 0 };

/** Which screen's `showX` most recently ran. Set at the top of every `showX`
 * function below. Its one consumer today is `deleteCategoryAndUpdateCache`
 * (U2.3): a delete/hide's `DELETE` request runs in the background after an
 * optimistic navigation back to Categories, and by the time it settles the
 * user may have moved on to a different screen — this guards a failed
 * request from yanking them back to Categories mid-draft elsewhere. Not a
 * generic router; there is no navigation history here, only "what's on
 * screen right now". */
type ActiveScreen =
  | "home"
  | "add-expense"
  | "expenses"
  | "expense-detail"
  | "budgets"
  | "categories"
  | "category-form"
  | "tags"
  | "tag-form"
  | "statistics";
let activeScreen: ActiveScreen | null = null;

/** Where Categories' BackButton goes (U3.2). Defaults to Home; Add Expense's
 * "More" cell (`showAddExpense`'s `onMore` handler, below) points it back to
 * itself instead, with the draft it was carrying, so a category created
 * mid-composer returns the user to their in-progress expense rather than
 * bouncing them to Home. Reset to Home at every *other* entry into
 * Categories (the side menu's row tap) so a stale "return to Add Expense" target
 * never leaks into an unrelated visit. */
let categoriesReturnTo: () => void = () => void showHome();

/** Where Tags' BackButton goes (U3.4) — same shape as `categoriesReturnTo`.
 * Add Expense's "+ Add tag" chip (`showAddExpense`'s `onAddTag` handler,
 * below) points it back to itself with the draft it was carrying; every
 * other entry into Tags (the side menu's row tap) resets it to Home so a stale
 * "return to Add Expense" target never leaks into an unrelated visit. */
let tagsReturnTo: () => void = () => void showHome();

/** The most recently *created* (not renamed) tag's id, read by
 * `tagsReturnTo`'s Add-Expense closure to pre-select it on return (screen
 * doc: "a tag created there returns pre-selected"). Set in `showTagForm`'s
 * `onSaved` only when that form was opened in create mode. Reset at *every*
 * entry into Tags — the side menu's row tap, and `onAddTag` itself — not just the
 * non-Add-Expense one: without also resetting on the Add-Expense leg, a tag
 * created on some earlier, unrelated Tags visit (reached via the side menu,
 * whose own BackButton runs the default `tagsReturnTo` and so never
 * consumes this var) would still be sitting here and would wrongly attach
 * itself to a *later*, unconnected draft. Only one id is ever held — if a
 * single Tags visit creates two tags, only the second is pre-selected, which
 * matches the AC's singular "a tag created there". */
let lastCreatedTagId: Uuid | null = null;

/** Pure merge step of `tagsReturnTo`'s Add-Expense closure — appends
 * `createdId` if it's set and not already present, otherwise returns
 * `tagIds` unchanged. Pulled out and exported so this unit's routing
 * decision has direct test coverage under Node, unlike the DOM-bound `showX`
 * functions around it (D343's deferred NIT: "worth a test once this pattern
 * is touched again" — U3.4 is that "again"). */
export function withCreatedTagPreselected(tagIds: Uuid[], createdId: Uuid | null): Uuid[] {
  if (createdId && !tagIds.includes(createdId)) {
    return [...tagIds, createdId];
  }
  return tagIds;
}

function getRoot(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.getElementById("app");
}

/** Wired to both Home's yellow Add button and its MainButton (same target,
 * D318) — `date` is the Day tab's resolved date (`home.ts::dayDateForHandoff`,
 * D406 half two) or `undefined` from every other tab, unchanged. A date seeds
 * `Draft.spentAt` without touching any other field, so it never makes the
 * draft dirty (`isDirty` excludes `spentAt`). */
function addExpenseFromHome(date?: string): void {
  void showAddExpense(date ? { ...emptyDraft(), spentAt: date } : undefined);
}

/** Mounts Home. Its MainButton and the side menu's "Add expense" row both
 * route to `showAddExpense` (docs/design/mini-app-ux.md §5's
 * `H -->|MainButton| A` flow, D409's drawer replacing the old tile row). */
async function showHome(): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "home";

  const handlers: HomeHandlers = {
    onRetry: () => {
      void refreshHome(root, handlers);
    },
    onMenuSelect: (item) => {
      if (item === "add-expense") {
        void showAddExpense();
      } else if (item === "expenses") {
        void showExpenses();
      } else if (item === "budgets") {
        void showBudgets();
      } else if (item === "statistics") {
        void showStatistics();
      } else if (item === "categories") {
        categoriesReturnTo = () => void showHome();
        void showCategories();
      } else if (item === "tags") {
        tagsReturnTo = () => void showHome();
        lastCreatedTagId = null;
        void showTags();
      } else if (item === "settings") {
        // TODO(U3.3): screens/settings.ts does not exist yet.
      }
    },
    onRowTap: (target) => {
      void showExpenses({ categoryId: target.categoryId, period: homePeriod });
    },
    onUnitChange: (unit) => {
      homePeriod = { unit, offset: 0 };
      void refreshHome(root, handlers);
    },
    onOffsetChange: (offset) => {
      homePeriod = { ...homePeriod, offset: clampOffset(offset) };
      void refreshHome(root, handlers);
    },
    onApplyCustomRange: (range) => {
      homePeriod = { unit: "custom", offset: 0, start: range.start, end: range.end };
      void refreshHome(root, handlers);
    },
    onAddExpense: addExpenseFromHome,
  };

  await refreshHome(root, handlers);
}

/** Fetches and (re)renders Home for `homePeriod`, reused by the cold open,
 * every period-control tap, and retry — the one place `homeController`'s
 * stale-response guard is honoured, so a fast double-tap never lets an
 * earlier period's response overwrite a later one. */
async function refreshHome(root: HTMLElement, handlers: HomeHandlers): Promise<void> {
  applyHomeChrome({ status: "loading", period: homePeriod }, addExpenseFromHome);
  mountHome(root, { status: "loading", period: homePeriod }, handlers, new Date());

  const state = await homeController.load(homePeriod);
  if (!state) {
    return;
  }
  applyHomeChrome(state, addExpenseFromHome);
  mountHome(root, state, handlers, new Date());
}

/** Mounts Add Expense (U2.2, screen 02; grid/account redesign U3.2, date row
 * U3.3, tags/comment U3.4). `initialDraft` is set on the return leg of a
 * "More" trip to Categories (see `onMore` below and `categoriesReturnTo`) or
 * a "+ Add tag" trip to Tags (see `onAddTag` below and `tagsReturnTo`) —
 * undefined on every other entry, which `mountAddExpense` treats as an empty
 * draft. */
async function showAddExpense(initialDraft?: AddExpenseDraft): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "add-expense";

  const handlers: AddExpenseHandlers = {
    onRetry: () => {
      void showAddExpense(initialDraft);
    },
    onClose: () => {
      void showHome();
    },
    onSuccess: () => {
      void showHome();
    },
    onMore: (draft) => {
      // `categoryId` is deliberately dropped — "More" exists to create a new
      // category, so the whole point of returning is to pick one, not to
      // silently keep whatever was selected before (component doc's AC).
      categoriesReturnTo = () => void showAddExpense({ ...draft, categoryId: null });
      void showCategories();
    },
    onAddTag: (draft) => {
      // Unlike `onMore` above, `tagIds` is *not* dropped — the AC is that a
      // tag created on screen 07 comes back pre-selected, appended to
      // whatever was already picked. Reset here, not just at the side menu's
      // entry: without this, a tag created on some earlier, unrelated Tags
      // visit (reached via the side menu, then never consumed because that
      // visit's own BackButton ran the default `tagsReturnTo` rather than
      // this closure) would still be sitting in `lastCreatedTagId` and would
      // wrongly attach itself to *this* draft even though nothing was
      // created on this trip. `tagsReturnTo`'s own closure reads
      // `lastCreatedTagId` at call time (not closure-creation time), so it
      // still sees whatever *this* Tags visit creates after this reset.
      lastCreatedTagId = null;
      tagsReturnTo = () => {
        const tagIds = withCreatedTagPreselected(draft.tagIds, lastCreatedTagId);
        lastCreatedTagId = null;
        void showAddExpense({ ...draft, tagIds });
      };
      void showTags();
    },
  };

  mountAddExpense(root, { status: "loading" }, client, handlers, initialDraft);
  const state = await loadAddExpenseData(client, addExpenseCache);
  mountAddExpense(root, state, client, handlers, initialDraft);
}

/** Screen 02b's archived-current-category edge case (U1.4, docs/ui/screens/
 * 02b-edit-expense.md's Edge cases): `loadAddExpenseData`'s plain
 * `GET /categories` excludes archived rows, so an expense whose category has
 * since been archived would open the composer with no selection at all. This
 * fetches that *one* category by id — never a bulk `include_archived` list,
 * which would also risk shifting an active category's own position-based
 * fallback colour (see `add-expense.ts::categoryGridItems`'s own comment) —
 * and splices it into the loaded state so that function can render it as the
 * dimmed, unselectable cell the spec calls for. A no-op when the category is
 * already in the list (the common case) or the state has nothing to splice
 * into (loading/error/forbidden/empty). Never throws: a category that's
 * gone entirely (not just archived) leaves the grid with no selection, the
 * same fallback the screen already had before this unit.
 *
 * `getCategory` is threaded in explicitly (rather than closing over the
 * module-level `client`) so this stays directly testable without a DOM —
 * same reasoning as `withCreatedTagPreselected`'s own pure shape above. */
export async function withArchivedCategory(
  state: AddExpenseLoadState,
  expense: ExpenseResponse,
  getCategory: (id: Uuid) => Promise<CategoryResponse>,
): Promise<AddExpenseLoadState> {
  if (state.status !== "ready" && state.status !== "offline") {
    return state;
  }
  if (state.categories.some((c) => c.id === expense.category_id)) {
    return state;
  }
  try {
    const archived = await getCategory(expense.category_id);
    return { ...state, categories: [...state.categories, archived] };
  } catch {
    return state;
  }
}

/** Mounts Screen 02b (Edit expense, U1.4) — the composer opened in `"edit"`
 * mode, pre-filled from `expense`, straight off the record screen 03b
 * already loaded (docs/ui/screens/02b-edit-expense.md's Data section: "the
 * expense itself is not fetched here"). `onBack` returns to 03b, never Home
 * — both a clean BackButton and a successful save land back on the record
 * being edited, unlike `showAddExpense`'s Home destination.
 *
 * Wired from screen 03b's "Edit" action (`showExpenseDetail`'s
 * `DetailHandlers.onEdit`, U1.5) — that unit also deleted the old
 * field-picker this route replaced. */
export async function showEditExpense(
  expense: ExpenseResponse,
  onBack: () => void,
  initialDraft?: AddExpenseDraft,
): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "add-expense";

  const handlers: AddExpenseHandlers = {
    onRetry: () => {
      void showEditExpense(expense, onBack, initialDraft);
    },
    onClose: onBack,
    onSuccess: onBack,
    onMore: (draft) => {
      categoriesReturnTo = () => void showEditExpense(expense, onBack, { ...draft, categoryId: null });
      void showCategories();
    },
    onAddTag: (draft) => {
      lastCreatedTagId = null;
      tagsReturnTo = () => {
        const tagIds = withCreatedTagPreselected(draft.tagIds, lastCreatedTagId);
        lastCreatedTagId = null;
        void showEditExpense(expense, onBack, { ...draft, tagIds });
      };
      void showTags();
    },
  };

  const seedDraft = initialDraft ?? draftFromExpense(expense);
  mountAddExpense(root, { status: "loading" }, client, handlers, seedDraft, "edit", expense);
  const state = await withArchivedCategory(await loadAddExpenseData(client, addExpenseCache), expense, (id) =>
    client.getCategory(id),
  );
  mountAddExpense(root, state, client, handlers, seedDraft, "edit", expense);
}

/** Mounts Expenses (U2.3, screen 03a). BackButton always returns to Home;
 * `filter` comes from the side menu's "Expenses" row (none), a ranked-row tap (that
 * category *and* the period in force — D404, the donut itself is
 * display-only and never reaches here), or Statistics' bar tap (that
 * category, no period). */
async function showExpenses(filter: ExpensesFilter = {}): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "expenses";

  const controller = createExpensesController(client, expensesCache, filter);

  const handlers: ExpensesHandlers = {
    onRetry: () => {
      void controller.load().then(render);
    },
    onLoadMore: () => {
      void controller.loadMore().then(render);
    },
    onRowTap: (id) => {
      void showExpenseDetail(id, () => void showExpenses(filter));
    },
  };

  function render(state: ExpensesState): void {
    if (!root) {
      return;
    }
    applyExpensesChrome(() => void showHome());
    mountExpenses(root, state, handlers, new Date());
  }

  render({ status: "loading" });
  const state = await controller.load();
  render(state);
}

/** Mounts Expense detail (U2.3b, screen 03b), reached by tapping a row on
 * Expenses. `onBack` returns to the Expenses list this row was tapped from,
 * preserving whatever filter was in force — captured by `showExpenses`'s
 * `onRowTap` closure above, same shape as `showAddExpense`'s `onClose`. */
async function showExpenseDetail(id: Uuid, onBack: () => void): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "expense-detail";

  const handlers: DetailHandlers = {
    onRetry: () => {
      void showExpenseDetail(id, onBack);
    },
    onBack,
    onDeleted: onBack,
    onEdit: (expense) => {
      void showEditExpense(expense, () => void showExpenseDetail(id, onBack));
    },
  };

  applyDetailChrome(onBack);
  mountExpenseDetail(root, { status: "loading" }, client, handlers);
  const state = await loadDetail(client, id);
  applyDetailChrome(onBack);
  mountExpenseDetail(root, state, client, handlers);
}

/** Mounts Budgets (U2.4, screen 04), reached from the side menu's "Budgets" row.
 * BackButton always returns to Home, same shape as Expenses/Detail. */
async function showBudgets(): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "budgets";

  const handlers: BudgetsHandlers = {
    onRetry: () => {
      void showBudgets();
    },
    onBack: () => {
      void showHome();
    },
  };

  applyBudgetsChrome({ status: "loading" }, handlers.onBack);
  mountBudgets(root, { status: "loading" }, client, handlers);
  const state = await loadBudgets(client, budgetsCache);
  applyBudgetsChrome(state, handlers.onBack);
  mountBudgets(root, state, client, handlers);
}

/** Mounts Categories (U2.1, screen 06). BackButton returns to `categoriesReturnTo`
 * — Home by default (same shape as Budgets/Expenses, the original fix for the
 * previously dead "Categories" row), or back to Add Expense with its draft
 * when reached via that screen's "More" cell (U3.2). */
function buildCategoriesHandlers(): CategoriesHandlers {
  return {
    onRetry: () => {
      void showCategories();
    },
    onBack: () => {
      categoriesReturnTo();
    },
    onSelectCategory: (id) => {
      void showCategoryForm(id);
    },
    onAddCategory: () => {
      void showCategoryForm(null);
    },
    onRetryDelete: (categoryId) => {
      void deleteCategoryAndUpdateCache(categoryId);
    },
  };
}

async function showCategories(deleteFailure: CategoryDeleteFailure | null = null): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "categories";

  const handlers = buildCategoriesHandlers();
  applyCategoriesChrome(handlers.onBack);
  mountCategories(root, { status: "loading" }, handlers);
  const state = await loadCategories(client, categoriesCache);
  applyCategoriesChrome(handlers.onBack);
  mountCategories(root, state, handlers, deleteFailure);
}

/** Re-renders 06a straight from `categoriesCache` — no `GET /categories`
 * replay. The optimistic-update/restore path for a delete-or-hide outcome
 * (docs/ui/screens/06c-category-delete.md); `showCategories()`'s own re-fetch
 * is deliberately not reused here (see that spec's Delta from
 * `06b-category-form.md`'s Save flow). Falls back to a real load if the
 * cache is somehow empty — shouldn't happen, since the only caller of
 * `deleteCategoryAndUpdateCache` is reached from a form that itself requires
 * the cache to already be populated. */
function renderCategoriesFromCache(deleteFailure: CategoryDeleteFailure | null = null): void {
  const root = getRoot();
  if (!root) {
    return;
  }
  const cached = categoriesCache.get();
  if (!cached) {
    void showCategories(deleteFailure);
    return;
  }
  activeScreen = "categories";
  const handlers = buildCategoriesHandlers();
  applyCategoriesChrome(handlers.onBack);
  mountCategories(root, { status: "ready", ...cached.data }, handlers, deleteFailure);
}

/** Confirmed delete/hide (06c): optimistically patches `categoriesCache` and
 * re-renders 06a immediately, then fires the `DELETE` in the background. A
 * failure reverts *just that row* (`revertCategoryDeleteOutcome`, applied to
 * whatever the cache currently holds — not a snapshot captured before the
 * call) so an unrelated delete/hide that completed on a different category in
 * the meantime is never clobbered. The revert always updates the cache, but
 * only re-renders if the user is still on Categories when the request
 * settles (`activeScreen` — otherwise a late failure would yank them off
 * whatever screen they've since moved to, e.g. mid-draft on Add Expense).
 * Success needs no further action: the optimistic state was already
 * correct. */
async function deleteCategoryAndUpdateCache(categoryId: Uuid): Promise<void> {
  const cached = categoriesCache.get();
  if (!cached) {
    void showCategories();
    return;
  }
  const row = [...cached.data.active, ...cached.data.archived].find((r) => r.id === categoryId);
  if (!row) {
    void showCategories();
    return;
  }

  const outcome = categoryDeleteOutcomeKind(row.expenseCount);
  categoriesCache.set({ data: applyCategoryDeleteOutcome(cached.data, categoryId, outcome), syncedAt: cached.syncedAt });
  renderCategoriesFromCache();

  try {
    await client.deleteCategory(categoryId);
  } catch (err) {
    const latest = categoriesCache.get();
    if (latest) {
      categoriesCache.set({ data: revertCategoryDeleteOutcome(latest.data, row, outcome), syncedAt: latest.syncedAt });
    }
    if (activeScreen !== "categories") {
      // The user has moved on — the cache is already corrected above, so the
      // next time they open Categories (a fresh `showCategories()`, which
      // re-fetches) it reflects the real state. Don't force-navigate them.
      return;
    }
    const failure: CategoryDeleteFailure =
      err instanceof ForbiddenError
        ? { categoryId, message: "You have read-only access to this account.", retryable: false }
        : { categoryId, message: categoryDeleteFailureMessage(row.name, row.expenseCount), retryable: true };
    renderCategoriesFromCache(failure);
  }
}

/** Mounts the 06b create/rename/recolour form (U2.2), reached from 06a's
 * "Add category" cell (`categoryId` `null`) or an active cell (`categoryId`
 * set). Per its spec, this screen never fetches on open — the draft and the
 * duplicate-name/taken-slot context both come from 06a's already-loaded
 * `categoriesCache` snapshot, not a new request. If that cache is somehow
 * empty (the form was reached without 06a ever loading), falls back to
 * `showCategories()` so the data exists before the form needs it. */
async function showCategoryForm(categoryId: Uuid | null): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "category-form";

  const cached = categoriesCache.get();
  if (!cached) {
    void showCategories();
    return;
  }

  const allRows = [...cached.data.active, ...cached.data.archived];
  let draft = emptyCategoryFormDraft();
  let expenseCount = 0;
  if (categoryId) {
    const row = allRows.find((r) => r.id === categoryId);
    if (!row) {
      // The category disappeared from the cache since 06a last rendered
      // (e.g. deleted in another tab) — safest fallback is back to the list.
      void showCategories();
      return;
    }
    draft = categoryFormDraftFromRow(row);
    expenseCount = row.expenseCount;
  }

  const activeSiblings = cached.data.active
    .filter((r) => r.id !== categoryId)
    .map((r) => ({ id: r.id, name: r.name }));
  const usedSlots = new Set(
    allRows.filter((r) => r.id !== categoryId && r.colorSlot !== null).map((r) => r.colorSlot as number),
  );

  const handlers: CategoryFormHandlers = {
    onClose: () => {
      void showCategories();
    },
    onSaved: () => {
      void showCategories();
    },
    onDelete: (id) => {
      void deleteCategoryAndUpdateCache(id);
    },
  };

  mountCategoryForm(root, client, draft, activeSiblings, usedSlots, handlers, expenseCount);
}

/** Mounts Tags (U2.4, screen 07a) — Home by default (the original fix for
 * the previously dead "Tags" row), or back to Add Expense with its draft
 * when reached via that screen's "+ Add tag" chip (U3.4), same
 * `tagsReturnTo` shape as Categories' `categoriesReturnTo`. Row and "Add
 * tag" taps navigate to 07b (U2.5). */
function buildTagsHandlers(): TagsHandlers {
  return {
    onRetry: () => {
      void showTags();
    },
    onBack: () => {
      tagsReturnTo();
    },
    onSelectTag: (id) => {
      void showTagForm(id);
    },
    onAddTag: () => {
      void showTagForm(null);
    },
    onRetryDelete: (tagId) => {
      void deleteTagAndUpdateCache(tagId);
    },
  };
}

async function showTags(deleteFailure: TagDeleteFailure | null = null): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "tags";

  const handlers = buildTagsHandlers();
  applyTagsChrome(handlers.onBack);
  mountTags(root, { status: "loading" }, handlers);
  const state = await loadTags(client, tagsCache);
  applyTagsChrome(handlers.onBack);
  mountTags(root, state, handlers, deleteFailure);
}

/** Re-renders 07a straight from `tagsCache` — no `GET /tags` replay. The
 * optimistic-update/restore path for a delete-or-hide outcome
 * (docs/ui/screens/07b-tag-form.md); `showTags()`'s own re-fetch is
 * deliberately not reused here, same divergence `categories.ts`'s Save vs.
 * delete/hide flows document. Falls back to a real load if the cache is
 * somehow empty. */
function renderTagsFromCache(deleteFailure: TagDeleteFailure | null = null): void {
  const root = getRoot();
  if (!root) {
    return;
  }
  const cached = tagsCache.get();
  if (!cached) {
    void showTags(deleteFailure);
    return;
  }
  activeScreen = "tags";
  const handlers = buildTagsHandlers();
  applyTagsChrome(handlers.onBack);
  mountTags(root, { status: "ready", ...cached.data }, handlers, deleteFailure);
}

/** Confirmed delete/hide (07b): optimistically patches `tagsCache` and
 * re-renders 07a immediately, then fires the `DELETE` in the background. A
 * failure reverts *just that row*, applied to whatever the cache currently
 * holds — not a snapshot captured before the call — so an unrelated
 * delete/hide that completed on a different tag in the meantime is never
 * clobbered. The revert always updates the cache, but only re-renders if the
 * user is still on Tags when the request settles (`activeScreen`), same guard
 * `deleteCategoryAndUpdateCache` uses. */
async function deleteTagAndUpdateCache(tagId: Uuid): Promise<void> {
  const cached = tagsCache.get();
  if (!cached) {
    void showTags();
    return;
  }
  const row = [...cached.data.active, ...cached.data.archived].find((r) => r.id === tagId);
  if (!row) {
    void showTags();
    return;
  }

  const outcome = tagDeleteOutcomeKind(row.expenseCount);
  tagsCache.set({ data: applyTagDeleteOutcome(cached.data, tagId, outcome), syncedAt: cached.syncedAt });
  renderTagsFromCache();

  try {
    await client.deleteTag(tagId);
  } catch (err) {
    const latest = tagsCache.get();
    if (latest) {
      tagsCache.set({ data: revertTagDeleteOutcome(latest.data, row, outcome), syncedAt: latest.syncedAt });
    }
    if (activeScreen !== "tags") {
      // The user has moved on — the cache is already corrected above, so the
      // next time they open Tags (a fresh `showTags()`, which re-fetches) it
      // reflects the real state. Don't force-navigate them.
      return;
    }
    const failure: TagDeleteFailure =
      err instanceof ForbiddenError
        ? { tagId, message: "You have read-only access to this account.", retryable: false }
        : { tagId, message: tagDeleteFailureMessage(row.name, row.expenseCount), retryable: true };
    renderTagsFromCache(failure);
  }
}

/** Mounts the 07b create/rename/delete-or-hide form (U2.5), reached from
 * 07a's "Add tag" row (`tagId` `null`) or an active row (`tagId` set). Per
 * its spec, this screen never fetches on open — the draft and `expenseCount`
 * both come from 07a's already-loaded `tagsCache` snapshot, not a new
 * request. If that cache is somehow empty, falls back to `showTags()` so the
 * data exists before the form needs it. */
async function showTagForm(tagId: Uuid | null): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "tag-form";

  const cached = tagsCache.get();
  if (!cached) {
    void showTags();
    return;
  }

  const allRows = [...cached.data.active, ...cached.data.archived];
  let draft = emptyTagFormDraft();
  let expenseCount = 0;
  if (tagId) {
    const row = allRows.find((r) => r.id === tagId);
    if (!row) {
      // The tag disappeared from the cache since 07a last rendered (e.g.
      // deleted in another tab) — safest fallback is back to the list.
      void showTags();
      return;
    }
    draft = tagFormDraftFromRow(row);
    expenseCount = row.expenseCount;
  }

  const handlers: TagFormHandlers = {
    onClose: () => {
      void showTags();
    },
    onSaved: (tag) => {
      // Only a *create* (`tagId === null` on entry) counts as "just
      // created" for `tagsReturnTo`'s pre-selection — a rename leaves
      // `lastCreatedTagId` alone.
      if (tagId === null) {
        lastCreatedTagId = tag.id;
      }
      void showTags();
    },
    onDelete: (id) => {
      void deleteTagAndUpdateCache(id);
    },
  };

  mountTagForm(root, client, draft, handlers, expenseCount);
}

/** Mounts Statistics (U2.5, screen 05), reached from the side menu's
 * "Statistics" row. `monthsBack`/`grouping` are carried in the closure across preset
 * taps and retries, same shape as `showExpenses`'s `filter` closure — a
 * preset tap re-fetches (`loadStatistics`), a grouping toggle does not (that
 * re-render happens entirely inside `screens/statistics.ts::mount`). A
 * category-bar tap drills into Expenses filtered to that category (design
 * doc §5's `S -->|bar tap| EF`), reusing the same `showExpenses` Home's
 * donut-segment tap already routes through. */
async function showStatistics(monthsBack = 0, grouping: Grouping = "category"): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "statistics";

  const handlers: StatisticsHandlers = {
    onRetry: () => {
      void showStatistics(monthsBack, grouping);
    },
    onBack: () => {
      void showHome();
    },
    onPresetChange: (nextMonthsBack) => {
      void showStatistics(nextMonthsBack, grouping);
    },
    onBarTap: (categoryId) => {
      void showExpenses({ categoryId });
    },
  };

  applyStatisticsChrome(handlers.onBack);
  mountStatistics(root, { status: "loading", monthsBack, grouping }, handlers);
  const state = await loadStatistics(client, statisticsCache, monthsBack, grouping);
  applyStatisticsChrome(handlers.onBack);
  mountStatistics(root, state, handlers);
}

/** Boots the app onto `#app`. Guarded the same way every DOM-touching export
 * in this codebase is (main.ts's own original placeholder, lib/telegram.ts's
 * applyTheme) so importing this module under the vitest `node` environment
 * never throws. */
export async function boot(): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }
  applyTheme();
  await showHome();
}

if (typeof document !== "undefined") {
  void boot();
}
