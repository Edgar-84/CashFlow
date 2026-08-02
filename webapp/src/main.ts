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
  createMemoryCache as createHomeCache,
  loadHome,
  mount as mountHome,
  type HomeHandlers,
} from "./screens/home";
import type { Uuid } from "./api/types";

const homeCache = createHomeCache();
const addExpenseCache = createAddExpenseCache();
const expensesCache = createExpensesCache();
const budgetsCache = createBudgetsCache();
const client = new ApiClient({ getInitData });

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
      void showHome();
    },
    onTileTap: (tile) => {
      if (tile === "add-expense") {
        void showAddExpense();
      } else if (tile === "expenses") {
        void showExpenses();
      } else if (tile === "budgets") {
        void showBudgets();
      }
      // Statistics/Categories/Tags land in later units (U2.5, M3) — tiles
      // stay reachable but are no-ops until then.
    },
    onSegmentTap: (target) => {
      void showExpenses(target.categoryId ? { categoryId: target.categoryId } : {});
    },
  };

  applyHomeChrome({ status: "loading" }, () => void showAddExpense());
  mountHome(root, { status: "loading" }, handlers);

  const state = await loadHome(client, homeCache);
  applyHomeChrome(state, () => void showAddExpense());
  mountHome(root, state, handlers);
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
