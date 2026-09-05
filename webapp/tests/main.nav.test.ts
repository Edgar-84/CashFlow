// @vitest-environment jsdom
//
// Whole-file opt-in, same shape as main.boot.test.ts: these tests drive
// `main.ts`'s real, unexported `showX`/`goBack` wiring through the DOM
// (`boot()`, real `mount`/`applyXChrome` functions, a fake Telegram WebApp
// whose captured BackButton handler stands in for a real device back-tap),
// mocking only each screen's data layer so nothing touches real `fetch`.
//
// Covers U2.2's own two named acceptance-criterion scenarios
// (docs/plans/mini-app-v8.md): Home -> Statistics -> Back -> Home, and
// Statistics (grouped by tag) -> tag-bar tap -> Expenses -> Back ->
// Statistics, still grouped by tag with its period intact. The second one is
// exactly the scenario a reviewer pass caught regressing (grouping toggles
// locally inside statistics.ts's own `mount`, which this unit's first cut
// never told `main.ts` about) — this file exists so that regression can't
// come back silently.
//
// Also covers U2.3's own named AC: a category or tag created mid-draft from
// Add Expense returns to the composer with the draft intact (the
// `categoriesReturnTo`/`tagsReturnTo` mechanism this unit retired in favour
// of stack pops), plus the two other retired `onBack` shapes —
// `showExpenseDetail`/`showEditExpense`'s parameter (Expenses -> Detail ->
// Edit -> Back -> Detail, not Home) and `showLanguage`'s hardcoded
// `showSettings()` call (Settings -> Language -> Back -> Settings).
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import type { TelegramWebApp } from "../src/lib/telegram";

vi.mock("../src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/i18n")>();
  return { ...actual, setLanguage: vi.fn() };
});

const { homeLoadMock } = vi.hoisted(() => ({ homeLoadMock: vi.fn() }));
vi.mock("../src/screens/home", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/home")>();
  return { ...actual, createHomeController: () => ({ load: homeLoadMock }) };
});

const { loadStatisticsMock } = vi.hoisted(() => ({ loadStatisticsMock: vi.fn() }));
vi.mock("../src/screens/statistics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/statistics")>();
  return { ...actual, loadStatistics: loadStatisticsMock };
});

const { expensesLoadMock } = vi.hoisted(() => ({ expensesLoadMock: vi.fn() }));
vi.mock("../src/screens/expenses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/expenses")>();
  return {
    ...actual,
    createExpensesController: () => ({ load: expensesLoadMock, loadMore: vi.fn() }),
  };
});

const { loadAddExpenseDataMock } = vi.hoisted(() => ({ loadAddExpenseDataMock: vi.fn() }));
vi.mock("../src/screens/add-expense", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/add-expense")>();
  return { ...actual, loadAddExpenseData: loadAddExpenseDataMock };
});

const { loadCategoriesMock } = vi.hoisted(() => ({ loadCategoriesMock: vi.fn() }));
vi.mock("../src/screens/categories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/categories")>();
  return { ...actual, loadCategories: loadCategoriesMock };
});

const { loadTagsMock } = vi.hoisted(() => ({ loadTagsMock: vi.fn() }));
vi.mock("../src/screens/tags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/tags")>();
  return { ...actual, loadTags: loadTagsMock };
});

const { loadDetailMock } = vi.hoisted(() => ({ loadDetailMock: vi.fn() }));
vi.mock("../src/screens/expense-detail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/expense-detail")>();
  return { ...actual, loadDetail: loadDetailMock };
});

const { loadSettingsMock } = vi.hoisted(() => ({ loadSettingsMock: vi.fn() }));
vi.mock("../src/screens/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/settings")>();
  return { ...actual, loadSettings: loadSettingsMock };
});

const { loadLanguageMock } = vi.hoisted(() => ({ loadLanguageMock: vi.fn() }));
vi.mock("../src/screens/language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/language")>();
  return { ...actual, loadLanguage: loadLanguageMock };
});

const { loadBudgetsMock } = vi.hoisted(() => ({ loadBudgetsMock: vi.fn() }));
vi.mock("../src/screens/budgets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/budgets")>();
  return { ...actual, loadBudgets: loadBudgetsMock };
});

import { boot } from "../src/main";

function fakeWebApp(): TelegramWebApp {
  return {
    initData: "user=fake&hash=abc",
    colorScheme: "light",
    expand: vi.fn(),
    MainButton: {
      setText: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
    HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn(), selectionChanged: vi.fn() },
    showConfirm: vi.fn(),
  };
}

// The most recently registered BackButton handler — every wired screen's
// `applyXChrome` calls `setBackButtonHandler`, which always calls
// `onClick` again (`lib/telegram.ts`'s unwire-then-rewire contract), so the
// last call's argument is always the one a real device back-tap would fire.
function currentBackHandler(webApp: TelegramWebApp): () => void {
  const calls = (webApp.BackButton.onClick as ReturnType<typeof vi.fn>).mock.calls;
  const handler = calls.at(-1)?.[0] as (() => void) | undefined;
  if (!handler) {
    throw new Error("BackButton.onClick was never registered");
  }
  return handler;
}

// Same reasoning as `currentBackHandler` — `lib/telegram.ts::mainButton.onClick`
// unwires-then-rewires on every call, so the last registered handler is the
// one a real tap would fire.
function currentMainButtonHandler(webApp: TelegramWebApp): () => void {
  const calls = (webApp.MainButton.onClick as ReturnType<typeof vi.fn>).mock.calls;
  const handler = calls.at(-1)?.[0] as (() => void) | undefined;
  if (!handler) {
    throw new Error("MainButton.onClick was never registered");
  }
  return handler;
}

const HOME_READY = {
  status: "ready" as const,
  totalMinor: 5000,
  currency: "EUR" as const,
  segments: [],
  bars: [],
  rows: [],
  budgetAlerts: [],
  period: { unit: "month" as const, offset: 0 },
  today: "2026-09-05",
  accountName: "Test Family",
};

function statisticsReady(
  grouping: "category" | "tag" | "budget",
  period: { unit: "day" | "week" | "month" | "year" | "custom"; offset: number } = { unit: "month", offset: 0 },
) {
  return {
    status: "ready" as const,
    totalMinor: 5000,
    currency: "EUR" as const,
    period,
    grouping,
    segments: [],
    categoryBars: [
      { id: "cat-1", label: "Groceries", colorVar: "var(--category-slot-1)", minor: 3000, widthPct: 100 },
      { id: "cat-2", label: "Transport", colorVar: "var(--category-slot-2)", minor: 2000, widthPct: 67 },
    ],
    tagBars: [
      { id: "tag-1", label: "Coffee", colorVar: null, minor: 3000, widthPct: 100 },
      { id: "tag-2", label: "Vacation", colorVar: null, minor: 2000, widthPct: 67 },
    ],
    budgetRows: [],
  };
}

function expensesReady() {
  return {
    status: "ready" as const,
    currency: "EUR" as const,
    categoryLabel: null,
    tagLabel: "Coffee",
    period: undefined,
    days: [],
    hasMore: false,
  };
}

function expensesReadyWithCategoryRow() {
  return {
    status: "ready" as const,
    currency: "EUR" as const,
    categoryLabel: "Groceries",
    tagLabel: null,
    period: undefined,
    days: [
      {
        dayKey: "2026-09-05",
        label: "Today",
        subtotalMinor: 500,
        rows: [
          {
            id: "exp-1",
            spentAt: "2026-09-05",
            categoryId: "cat-1",
            categoryLabel: "Groceries",
            colorVar: "var(--category-slot-1)",
            minor: 500,
            comment: null,
            authorInitial: "A",
            tags: [],
          },
        ],
      },
    ],
    hasMore: false,
  };
}

function addExpenseReady() {
  return {
    status: "ready" as const,
    categories: [{ id: "cat-1", name: "Groceries", account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" }],
    tags: [{ id: "tag-new", name: "Vacation", account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" }],
    currency: "EUR" as const,
    accountName: "Test Family",
    today: "2026-09-05",
  };
}

const EMPTY_CATEGORIES_DATA = { currency: "EUR" as const, active: [], archived: [] };
const EMPTY_TAGS_DATA = { currency: "EUR" as const, active: [], archived: [] };

function detailReady(expense: {
  id: string;
  amount: number;
  category_id: string;
  comment: string | null;
  spent_at: string;
  user_id: string;
  user_name: string | null;
  tags: unknown[];
}) {
  return {
    status: "ready" as const,
    expense,
    id: expense.id,
    amountMinor: expense.amount,
    currency: "EUR" as const,
    categoryId: expense.category_id,
    categoryLabel: "Groceries",
    colorVar: "var(--category-slot-1)",
    authorName: expense.user_name,
    comment: expense.comment,
    dayLabel: "Fri, Sep 5",
    tags: expense.tags,
    canWrite: true,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function openHome(webApp: TelegramWebApp): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  homeLoadMock.mockResolvedValue(HOME_READY);
  window.Telegram = { WebApp: webApp };
  await boot();
  await flush();
}

function tapMenuItem(item: string): void {
  document.querySelector<HTMLElement>('[data-testid="menu-button"]')?.click();
  document.querySelector<HTMLElement>(`[data-testid="side-menu-row-${item}"]`)?.click();
}

afterEach(() => {
  // `restoreAllMocks` (not `clearAllMocks`) so the `ApiClient.prototype`
  // spies U2.3's tests install don't leak a resolved value into later tests
  // — every test already re-sets whatever mock it needs before use, the
  // same pattern `openHome()`'s `homeLoadMock.mockResolvedValue(...)` uses.
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.Telegram = undefined;
});

describe("back stack (U2.2): Home -> Statistics -> Back -> Home", () => {
  it("lands back on Home", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    loadStatisticsMock.mockResolvedValue(statisticsReady("category"));
    tapMenuItem("statistics");
    await flush();
    expect(document.querySelector('[data-testid="grouping-toggle"]')).not.toBeNull();

    currentBackHandler(webApp)();
    await flush();

    expect(document.querySelector('[data-testid="menu-button"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="grouping-toggle"]')).toBeNull();
  });
});

describe("back stack (U2.2): Statistics (tag grouping) -> tag bar -> Expenses -> Back -> Statistics", () => {
  it("restores Statistics still grouped by tag, with its period intact", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    // Resolves per the actual `grouping` argument `showStatistics` passes
    // through — a fixed `mockResolvedValue` would mask this test's whole
    // point, since a stale `restore` closure calling `loadStatistics` with
    // the wrong grouping would otherwise still render as "category".
    loadStatisticsMock.mockImplementation((_client: unknown, _cache: unknown, _period: unknown, grouping: "category" | "tag") =>
      Promise.resolve(statisticsReady(grouping)),
    );
    tapMenuItem("statistics");
    await flush();

    // Toggle to the tag grouping — statistics.ts's own local re-render, no
    // refetch.
    document.querySelector<HTMLElement>('[data-testid="grouping-tag"]')?.click();
    expect(document.querySelectorAll('[data-testid="stats-bar"]')).toHaveLength(2);
    expect(loadStatisticsMock).toHaveBeenCalledTimes(1);

    // Tap a tag bar — routes into Expenses filtered to that tag.
    expensesLoadMock.mockResolvedValue(expensesReady());
    document.querySelector<HTMLElement>('[data-id="tag-1"]')?.click();
    await flush();
    expect(document.querySelector('[data-testid="ready"]')?.className).toContain("expenses");

    // Back from Expenses must restore Statistics, still grouped by tag.
    currentBackHandler(webApp)();
    await flush();

    const toggle = document.querySelector('[data-testid="grouping-toggle"]');
    expect(toggle).not.toBeNull();
    expect(document.querySelector('[data-testid="grouping-tag"]')?.className).toContain("active");
    expect(document.querySelector('[data-testid="grouping-category"]')?.className).not.toContain("active");
    // `goBack`'s restore re-enters `showStatistics`, which always re-fetches
    // (no cache-skip on Back) — the toggle itself stayed refetch-free (the
    // assertion right after it above), which is the actual "no refetch" AC.
    expect(loadStatisticsMock).toHaveBeenCalledTimes(2);
  });
});

function loadCategoriesMockImpl() {
  return vi.fn(async (_api: unknown, cache: { set: (s: unknown) => void }) => {
    cache.set({ data: EMPTY_CATEGORIES_DATA, syncedAt: "2026-09-05T00:00:00Z" });
    return { status: "ready" as const, ...EMPTY_CATEGORIES_DATA };
  });
}

function loadTagsMockImpl() {
  return vi.fn(async (_api: unknown, cache: { set: (s: unknown) => void }) => {
    cache.set({ data: EMPTY_TAGS_DATA, syncedAt: "2026-09-05T00:00:00Z" });
    return { status: "ready" as const, ...EMPTY_TAGS_DATA };
  });
}

describe("back stack (U2.3): Add Expense -> More -> create category -> Back -> Add Expense", () => {
  it("returns with the draft intact and categoryId cleared (D343, unchanged by the retired categoriesReturnTo)", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    loadAddExpenseDataMock.mockResolvedValue(addExpenseReady());
    tapMenuItem("add-expense");
    await flush();
    expect(document.querySelector('[data-testid="add-expense-form"]')).not.toBeNull();

    // Type an amount and pick a category, so returning with it cleared is an
    // actual assertion, not a no-op on an already-empty selection.
    const amountInput = document.querySelector<HTMLInputElement>('[data-testid="amount-input"]');
    expect(amountInput).not.toBeNull();
    amountInput!.value = "12.34";
    amountInput!.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLElement>('[data-testid="cp-cell"][data-category-id="cat-1"]')?.click();
    expect(document.querySelector('[data-testid="cp-cell"][aria-checked="true"]')).not.toBeNull();

    // "More" -> Categories.
    loadCategoriesMock.mockImplementation(loadCategoriesMockImpl());
    document.querySelector<HTMLElement>('[data-testid="cp-more"]')?.click();
    await flush();
    expect(document.querySelector('[data-testid="ready"]')?.className).toContain("categories");

    // "Add category" -> the create form -> name it and save.
    document.querySelector<HTMLElement>('[data-testid="cat-cell-add"]')?.click();
    expect(document.querySelector('[data-testid="cat-form"]')).not.toBeNull();
    const nameInput = document.querySelector<HTMLInputElement>('[data-testid="cat-name-input"]');
    nameInput!.value = "Snacks";
    nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
    vi.spyOn(ApiClient.prototype, "createCategory").mockResolvedValue({
      id: "cat-new",
      name: "Snacks",
      account_id: "acc-1",
      created_at: "2026-09-05T00:00:00Z",
    });
    currentMainButtonHandler(webApp)();
    await flush();

    // Saving lands back on the (refreshed) Categories list, not straight back
    // to Add Expense — only a BackButton tap does that.
    expect(document.querySelector('[data-testid="ready"]')?.className).toContain("categories");

    currentBackHandler(webApp)();
    await flush();

    expect(document.querySelector('[data-testid="add-expense-form"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('[data-testid="amount-input"]')?.value).toBe("12.34");
    expect(document.querySelector('[data-testid="cp-cell"][aria-checked="true"]')).toBeNull();
  });
});

describe("back stack (U2.3): Add Expense -> + Add tag -> create tag -> Back -> Add Expense", () => {
  it("returns with the draft intact and the new tag pre-selected (D805)", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    loadAddExpenseDataMock.mockResolvedValue(addExpenseReady());
    tapMenuItem("add-expense");
    await flush();

    const amountInput = document.querySelector<HTMLInputElement>('[data-testid="amount-input"]');
    amountInput!.value = "9.99";
    amountInput!.dispatchEvent(new Event("input", { bubbles: true }));

    // "+ Add tag" -> Tags.
    loadTagsMock.mockImplementation(loadTagsMockImpl());
    document.querySelector<HTMLElement>('[data-testid="tag-add-chip"]')?.click();
    await flush();
    expect(document.querySelector('[data-testid="ready"]')?.className).toContain("tags");

    // "Add tag" -> the create form -> name it and save.
    document.querySelector<HTMLElement>('[data-testid="tag-row-add"]')?.click();
    expect(document.querySelector('[data-testid="tag-form"]')).not.toBeNull();
    const nameInput = document.querySelector<HTMLInputElement>('[data-testid="tag-name-input"]');
    nameInput!.value = "Vacation";
    nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
    vi.spyOn(ApiClient.prototype, "createTag").mockResolvedValue({
      id: "tag-new",
      name: "Vacation",
      account_id: "acc-1",
      created_at: "2026-09-05T00:00:00Z",
    });
    currentMainButtonHandler(webApp)();
    await flush();
    expect(document.querySelector('[data-testid="ready"]')?.className).toContain("tags");

    currentBackHandler(webApp)();
    await flush();

    expect(document.querySelector('[data-testid="add-expense-form"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('[data-testid="amount-input"]')?.value).toBe("9.99");
    expect(document.querySelector('[data-tag-id="tag-new"]')?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("back stack (U2.3): Expenses -> row tap -> Detail -> Edit -> Back -> Detail", () => {
  it("lands back on Detail, not Home (the retired showExpenseDetail onBack parameter)", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    const expense = {
      id: "exp-1",
      amount: 500,
      category_id: "cat-1",
      comment: null,
      spent_at: "2026-09-05",
      user_id: "user-1",
      user_name: "Alex",
      tags: [],
    };
    expensesLoadMock.mockResolvedValue({
      status: "ready" as const,
      currency: "EUR" as const,
      categoryLabel: null,
      tagLabel: null,
      period: undefined,
      days: [
        {
          dayKey: "2026-09-05",
          label: "Today",
          subtotalMinor: 500,
          rows: [
            {
              id: "exp-1",
              spentAt: "2026-09-05",
              categoryId: "cat-1",
              categoryLabel: "Groceries",
              colorVar: "var(--category-slot-1)",
              minor: 500,
              comment: null,
              authorInitial: "A",
              tags: [],
            },
          ],
        },
      ],
      hasMore: false,
    });
    tapMenuItem("expenses");
    await flush();

    loadDetailMock.mockResolvedValue(detailReady(expense));
    document.querySelector<HTMLElement>('[data-testid="expense-row"][data-expense-id="exp-1"]')?.click();
    await flush();
    expect(document.querySelector('[data-testid="detail-screen"]')).not.toBeNull();

    loadAddExpenseDataMock.mockResolvedValue(addExpenseReady());
    document.querySelector<HTMLElement>('[data-action="open-picker"]')?.click();
    await flush();
    expect(document.querySelector('[data-testid="add-expense-form"]')).not.toBeNull();

    currentBackHandler(webApp)();
    await flush();

    expect(document.querySelector('[data-testid="detail-screen"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="menu-button"]')).toBeNull();
  });
});

describe("back stack (U2.3): Settings -> Language -> Back -> Settings", () => {
  it("lands back on Settings, refetched (the retired showLanguage onBack: showSettings)", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    loadSettingsMock.mockResolvedValue({ status: "ready" as const, currency: "EUR" as const, language: "en", role: "admin" });
    tapMenuItem("settings");
    await flush();
    expect(document.querySelector('[data-testid="settings-list"]')).not.toBeNull();

    loadLanguageMock.mockResolvedValue({ status: "ready" as const, language: "en", role: "admin" });
    document.querySelector<HTMLElement>('[data-testid="settings-language-row"]')?.click();
    await flush();
    expect(document.querySelector('[data-testid="language-list"]')).not.toBeNull();

    currentBackHandler(webApp)();
    await flush();

    expect(document.querySelector('[data-testid="settings-list"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="language-list"]')).toBeNull();
    expect(loadSettingsMock).toHaveBeenCalledTimes(2);
  });
});

describe("back stack (U2.3): Budgets -> a budgeted row -> Budget form -> Cancel -> Budgets", () => {
  it("lands back on Budgets, refetched (the retired showBudgetForm onCancelled: showBudgets())", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    const row = {
      planId: "plan-1",
      categoryId: "cat-1",
      label: "Groceries",
      colorVar: "var(--category-slot-1)",
      amountMinor: 10000,
      spentMinor: 4000,
      remainingMinor: 6000,
      fillPct: 40,
      notifyThreshold: 70,
      isOverThreshold: false,
      isExceeded: false,
    };
    loadBudgetsMock.mockResolvedValue({
      status: "ready" as const,
      currency: "EUR" as const,
      budgeted: [row],
      unbudgeted: [],
    });
    tapMenuItem("budgets");
    await flush();
    expect(document.querySelector('[data-testid="ready"]')?.className).toContain("budgets");

    document.querySelector<HTMLElement>('[data-testid="budget-row"][data-plan-id="plan-1"]')?.click();
    await flush();
    expect(document.querySelector('[data-testid="budget-form-screen"]')).not.toBeNull();

    // Untouched draft ⇒ `isDirty` is false ⇒ `requestClose` calls `onCancelled`
    // straight away, no discard-confirm popup in the way.
    document.querySelector<HTMLElement>('[data-action="cancel-budget"]')?.click();
    await flush();

    expect(document.querySelector('[data-testid="ready"]')?.className).toContain("budgets");
    expect(document.querySelector('[data-testid="budget-form-screen"]')).toBeNull();
    expect(loadBudgetsMock).toHaveBeenCalledTimes(2);
  });
});

describe("back stack (U2.3): Statistics -> category bar -> Expenses -> row tap -> Detail -> Back -> Expenses -> Back -> Statistics", () => {
  it("preserves the category filter across Detail's own Back (a 3-deep pop chain)", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    loadStatisticsMock.mockResolvedValue(statisticsReady("category"));
    tapMenuItem("statistics");
    await flush();

    expensesLoadMock.mockResolvedValue(expensesReadyWithCategoryRow());
    document.querySelector<HTMLElement>('[data-id="cat-1"]')?.click();
    await flush();
    expect(document.querySelector('[data-testid="filter-banner"]')?.textContent).toBe("Groceries");

    loadDetailMock.mockResolvedValue(
      detailReady({
        id: "exp-1",
        amount: 500,
        category_id: "cat-1",
        comment: null,
        spent_at: "2026-09-05",
        user_id: "user-1",
        user_name: "Alex",
        tags: [],
      }),
    );
    document.querySelector<HTMLElement>('[data-testid="expense-row"][data-expense-id="exp-1"]')?.click();
    await flush();
    expect(document.querySelector('[data-testid="detail-screen"]')).not.toBeNull();

    // Back from Detail must land on Expenses, still filtered to "Groceries" —
    // the whole point of `showExpenseDetail` dropping its `onBack` parameter
    // in favour of popping to whatever `showExpenses`'s own stack entry
    // captured (its `filter` closure), not a caller-supplied callback.
    currentBackHandler(webApp)();
    await flush();
    expect(document.querySelector('[data-testid="filter-banner"]')?.textContent).toBe("Groceries");
    expect(document.querySelector('[data-testid="detail-screen"]')).toBeNull();
    expect(expensesLoadMock).toHaveBeenCalledTimes(2);

    // And Back again must land on Statistics, three levels down from Detail.
    currentBackHandler(webApp)();
    await flush();
    expect(document.querySelector('[data-testid="grouping-toggle"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="filter-banner"]')).toBeNull();
  });
});

describe("Statistics (U3.4): picking Budgets under Year coerces to Month and dims the other tabs", () => {
  it("re-renders on the current month with the four other tabs dimmed, then re-enables all five on switching back to category", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    // Resolves per the actual period/grouping showStatistics passes through,
    // same reasoning as the tag-grouping test above — a fixed
    // mockResolvedValue would mask whether the D809 coercion actually reached
    // loadStatistics.
    loadStatisticsMock.mockImplementation(
      (
        _client: unknown,
        _cache: unknown,
        period: { unit: "day" | "week" | "month" | "year" | "custom"; offset: number },
        grouping: "category" | "tag" | "budget",
      ) => Promise.resolve(statisticsReady(grouping, period)),
    );
    tapMenuItem("statistics");
    await flush();

    document.querySelector<HTMLElement>('[data-testid="period-tab-year"]')?.click();
    await flush();
    expect(loadStatisticsMock).toHaveBeenCalledTimes(2);

    // Picking Budgets while Year is active must coerce the period to the
    // current month and refetch — the one case where this toggle loads
    // (D809) rather than re-rendering locally.
    document.querySelector<HTMLElement>('[data-testid="grouping-budget"]')?.click();
    // Synchronous assertion, before flush(): `showStatistics` mounts its own
    // "loading" state ahead of its first `await`, and statistics.ts's own
    // click handler must not clobber that back with a stale local re-render
    // (the still-Year `current.period`, budgetRows still `[]`) — the exact
    // self-contradictory "active AND disabled" Year tab a WARN in this
    // unit's review caught. Asserting here, not just after flush(), is what
    // would catch a regression of that fix.
    expect(loadStatisticsMock).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[data-testid="loading"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="grouping-toggle"]')).toBeNull();
    await flush();
    expect(loadStatisticsMock).toHaveBeenCalledTimes(3);
    const [, , coercedPeriod, coercedGrouping] = loadStatisticsMock.mock.calls[2];
    expect(coercedPeriod).toEqual({ unit: "month", offset: 0 });
    expect(coercedGrouping).toBe("budget");

    expect(document.querySelector('[data-testid="period-tab-month"]')?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('[data-testid="period-tab-year"]')?.hasAttribute("disabled")).toBe(true);
    expect(document.querySelector('[data-testid="period-tab-year"]')?.getAttribute("aria-disabled")).toBe("true");
    expect(document.querySelector('[data-testid="period-tab-day"]')?.hasAttribute("disabled")).toBe(true);
    expect(document.querySelector('[data-testid="period-tab-week"]')?.hasAttribute("disabled")).toBe(true);
    expect(document.querySelector('[data-testid="period-tab-custom"]')?.hasAttribute("disabled")).toBe(true);

    // Switching back to "By category" re-enables every tab, triggers no
    // refetch (the grouping toggle's own no-refetch invariant), and keeps
    // the month the Budgets coercion landed on.
    document.querySelector<HTMLElement>('[data-testid="grouping-category"]')?.click();
    expect(loadStatisticsMock).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[data-testid="period-tab-year"]')?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector('[data-testid="period-tab-month"]')?.getAttribute("aria-selected")).toBe("true");
  });
});
