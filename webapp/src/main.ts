import { ApiClient } from "./api/client";
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
  applyDetailChrome,
  loadDetail,
  mount as mountExpenseDetail,
  type DetailHandlers,
} from "./screens/expense-detail";
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
const statisticsCache = createStatisticsCache();

// Home's selected period. Module-level so it survives navigating to screen
// 02 and back, and a retry (both just call `showHome`/`refreshHome` again,
// same shape as `showStatistics`'s `monthsBack` closure argument) — it only
// resets to the cold-open default when the app itself reboots.
let homePeriod: PeriodValue = { unit: "month", offset: 0 };

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
      }
      // Categories/Tags land in a later milestone (M3) — tiles stay
      // reachable but are no-ops until then.
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
