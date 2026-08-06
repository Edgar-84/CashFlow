import { ApiClient, ForbiddenError } from "./api/client";
import { applyTheme, getInitData } from "./lib/telegram";
import {
  createMemoryCache as createAddExpenseCache,
  loadAddExpenseData,
  mount as mountAddExpense,
  type AddExpenseHandlers,
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
import type { Uuid } from "./api/types";

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

function getRoot(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.getElementById("app");
}

/** Mounts Home. Its MainButton and its "Add expense" tile both route to
 * `showAddExpense` (docs/design/mini-app-ux.md §5's `H -->|MainButton| A`
 * flow) — the tile stays the fallback path once the other tiles' screens
 * exist and use the same dispatch pattern. */
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
    onTileTap: (tile) => {
      if (tile === "add-expense") {
        void showAddExpense();
      } else if (tile === "expenses") {
        void showExpenses();
      } else if (tile === "budgets") {
        void showBudgets();
      } else if (tile === "statistics") {
        void showStatistics();
      } else if (tile === "categories") {
        void showCategories();
      } else if (tile === "tags") {
        void showTags();
      }
    },
    onSegmentTap: (target) => {
      void showExpenses(target.categoryId ? { categoryId: target.categoryId } : {});
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
    onAddExpense: () => {
      void showAddExpense();
    },
  };

  await refreshHome(root, handlers);
}

/** Fetches and (re)renders Home for `homePeriod`, reused by the cold open,
 * every period-control tap, and retry — the one place `homeController`'s
 * stale-response guard is honoured, so a fast double-tap never lets an
 * earlier period's response overwrite a later one. */
async function refreshHome(root: HTMLElement, handlers: HomeHandlers): Promise<void> {
  applyHomeChrome({ status: "loading", period: homePeriod }, () => void showAddExpense());
  mountHome(root, { status: "loading", period: homePeriod }, handlers, new Date());

  const state = await homeController.load(homePeriod);
  if (!state) {
    return;
  }
  applyHomeChrome(state, () => void showAddExpense());
  mountHome(root, state, handlers, new Date());
}

async function showAddExpense(): Promise<void> {
  const root = getRoot();
  if (!root) {
    return;
  }
  activeScreen = "add-expense";

  const handlers: AddExpenseHandlers = {
    onRetry: () => {
      void showAddExpense();
    },
    onClose: () => {
      void showHome();
    },
    onSuccess: () => {
      void showHome();
    },
  };

  mountAddExpense(root, { status: "loading" }, client, handlers);
  const state = await loadAddExpenseData(client, addExpenseCache);
  mountAddExpense(root, state, client, handlers);
}

/** Mounts Expenses (U2.3, screen 03a). BackButton always returns to Home;
 * `filter` (an optional category) comes from Home's "Expenses" tile (none) or
 * a donut-segment tap (that category) — the folded "Other" slot's `null`
 * categoryId falls back to the unfiltered list, same as the tile. */
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
    mountExpenses(root, state, handlers);
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
  };

  applyDetailChrome(onBack);
  mountExpenseDetail(root, { status: "loading" }, client, handlers);
  const state = await loadDetail(client, id);
  applyDetailChrome(onBack);
  mountExpenseDetail(root, state, client, handlers);
}

/** Mounts Budgets (U2.4, screen 04), reached from Home's "Budgets" tile.
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

/** Mounts Categories (U2.1, screen 06). BackButton always returns to Home,
 * same shape as Budgets/Expenses — this is the fix for the previously
 * dead "Categories" tile. */
function buildCategoriesHandlers(): CategoriesHandlers {
  return {
    onRetry: () => {
      void showCategories();
    },
    onBack: () => {
      void showHome();
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

/** Mounts Tags (U2.4, screen 07a). BackButton always returns to Home, same
 * shape as Categories — this is the fix for the previously dead "Tags" tile.
 * Row and "Add tag" taps navigate to 07b (U2.5). */
function buildTagsHandlers(): TagsHandlers {
  return {
    onRetry: () => {
      void showTags();
    },
    onBack: () => {
      void showHome();
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
    onSaved: () => {
      void showTags();
    },
    onDelete: (id) => {
      void deleteTagAndUpdateCache(id);
    },
  };

  mountTagForm(root, client, draft, handlers, expenseCount);
}

/** Mounts Statistics (U2.5, screen 05), reached from Home's "Statistics"
 * tile. `monthsBack`/`grouping` are carried in the closure across preset
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
