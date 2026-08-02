import { ApiClient } from "./api/client";
import { applyTheme, getInitData } from "./lib/telegram";
import {
  createMemoryCache as createAddExpenseCache,
  loadAddExpenseData,
  mount as mountAddExpense,
  type AddExpenseHandlers,
} from "./screens/add-expense";
import {
  applyHomeChrome,
  createMemoryCache as createHomeCache,
  loadHome,
  mount as mountHome,
  type HomeHandlers,
} from "./screens/home";

const homeCache = createHomeCache();
const addExpenseCache = createAddExpenseCache();
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
      }
      // Expenses/Budgets/Statistics/Categories/Tags land in later units
      // (U2.3-U2.5, M3) — tiles stay reachable but are no-ops until then.
    },
    onSegmentTap: () => {
      // Filtered expense list lands with U2.3.
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
