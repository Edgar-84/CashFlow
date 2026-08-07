import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type { CategoryResponse, ExpenseResponse } from "../src/api/types";
import {
  applyExpensesChrome,
  buildExpensesData,
  createExpensesController,
  createMemoryCache,
  groupByDay,
  renderExpenses,
  type ExpensesApi,
} from "../src/screens/expenses";
import type { PeriodValue } from "../src/lib/period";
import type { TelegramWebApp } from "../src/lib/telegram";

const NOW = new Date(2026, 7, 15); // 15 August 2026, local wall-clock

function category(id: string, name: string, created_at: string): CategoryResponse {
  return { id, name, account_id: "acc-1", created_at };
}

const CATEGORIES: CategoryResponse[] = [
  category("cat-groceries", "Groceries", "2026-01-01T00:00:00Z"),
  category("cat-transport", "Transport", "2026-01-02T00:00:00Z"),
];

function expense(overrides: Partial<ExpenseResponse> = {}): ExpenseResponse {
  return {
    id: "exp-1",
    amount: 1250,
    comment: null,
    category_id: "cat-groceries",
    spent_at: "2026-07-29",
    user_id: "user-1",
    account_id: "acc-1",
    created_at: "2026-07-29T10:00:00Z",
    updated_at: "2026-07-29T10:00:00Z",
    tags: [],
    user_name: "Alice",
    ...overrides,
  };
}

describe("groupByDay", () => {
  it("groups rows into per-day buckets with a running subtotal, preserving first-seen order", () => {
    const rows = [
      { ...buildRowFixture(expense({ id: "e1", created_at: "2026-07-29T10:00:00Z", amount: 1000 })) },
      { ...buildRowFixture(expense({ id: "e2", created_at: "2026-07-29T20:00:00Z", amount: 500 })) },
      { ...buildRowFixture(expense({ id: "e3", created_at: "2026-07-28T10:00:00Z", amount: 300 })) },
    ];
    const groups = groupByDay(rows, "UTC");
    expect(groups).toHaveLength(2);
    expect(groups[0].dayKey).toBe("2026-07-29");
    expect(groups[0].subtotalMinor).toBe(1500);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["e1", "e2"]);
    expect(groups[1].dayKey).toBe("2026-07-28");
    expect(groups[1].subtotalMinor).toBe(300);
  });

  it("buckets by the given tz, not UTC — a late-UTC timestamp can fall on the next local day", () => {
    const rows = [buildRowFixture(expense({ created_at: "2026-07-29T23:30:00Z" }))];
    expect(groupByDay(rows, "UTC")[0].dayKey).toBe("2026-07-29");
    expect(groupByDay(rows, "Europe/Belgrade")[0].dayKey).toBe("2026-07-30");
  });
});

// Minimal row builder mirroring screens/expenses.ts's private buildRow, used
// only to feed groupByDay directly in the tests above.
function buildRowFixture(e: ExpenseResponse) {
  return {
    id: e.id,
    createdAt: e.created_at,
    categoryId: e.category_id,
    categoryLabel: "Groceries",
    colorVar: "var(--category-slot-1)",
    minor: e.amount,
    comment: e.comment,
    authorInitial: e.user_name ? e.user_name.charAt(0) : null,
    tags: e.tags.map((t) => t.name),
  };
}

describe("buildExpensesData", () => {
  const EXPENSES: ExpenseResponse[] = [
    expense({ id: "e1", category_id: "cat-groceries", created_at: "2026-07-29T10:00:00Z", amount: 1000 }),
    expense({ id: "e2", category_id: "cat-transport", created_at: "2026-07-29T11:00:00Z", amount: 500 }),
    expense({ id: "e3", category_id: "cat-groceries", created_at: "2026-07-28T09:00:00Z", amount: 300 }),
  ];

  it("groups all rows by day when no filter is given", () => {
    const data = buildExpensesData({
      expenses: EXPENSES,
      categories: CATEGORIES,
      currency: "EUR",
      hasMore: false,
      tz: "UTC",
    });
    expect(data.categoryLabel).toBeNull();
    expect(data.period).toBeUndefined();
    expect(data.days.map((d) => d.rows.length)).toEqual([2, 1]);
  });

  it("does no filtering of its own — every passed-in row renders, filtering is the server's job (D402)", () => {
    const data = buildExpensesData({
      expenses: EXPENSES,
      categories: CATEGORIES,
      currency: "EUR",
      categoryId: "cat-transport",
      hasMore: false,
      tz: "UTC",
    });
    expect(data.categoryLabel).toBe("Transport");
    expect(data.days.flatMap((d) => d.rows).map((r) => r.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("falls back to a generic label when the filtered category id is unknown (e.g. deleted)", () => {
    const data = buildExpensesData({
      expenses: [],
      categories: CATEGORIES,
      currency: "EUR",
      categoryId: "cat-gone",
      hasMore: false,
      tz: "UTC",
    });
    expect(data.categoryLabel).toBe("this category");
    expect(data.days).toHaveLength(0);
  });

  it("carries the period value through unchanged, for the render layer to describe()", () => {
    const period: PeriodValue = { unit: "month", offset: 0 };
    const data = buildExpensesData({
      expenses: [],
      categories: CATEGORIES,
      currency: "EUR",
      period,
      hasMore: false,
      tz: "UTC",
    });
    expect(data.period).toBe(period);
  });

  it("maps a row's category colour stably via the fixed slot order", () => {
    const data = buildExpensesData({
      expenses: [EXPENSES[0]],
      categories: CATEGORIES,
      currency: "EUR",
      hasMore: false,
      tz: "UTC",
    });
    expect(data.days[0].rows[0].colorVar).toBe("var(--category-slot-1)");
    expect(data.days[0].rows[0].categoryLabel).toBe("Groceries");
  });
});

function fakeApi(overrides: Partial<ExpensesApi> = {}): ExpensesApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR" }),
    listCategories: vi.fn().mockResolvedValue(CATEGORIES),
    listExpenses: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function pageOf(count: number, opts: { startIndex?: number; day?: string } = {}): ExpenseResponse[] {
  const start = opts.startIndex ?? 0;
  const day = opts.day ?? "2026-07-29";
  return Array.from({ length: count }, (_, i) =>
    expense({ id: `e${start + i}`, created_at: `${day}T10:00:00Z`, amount: 100 }),
  );
}

describe("createExpensesController", () => {
  it("returns a ready state built from a fake ApiClient", async () => {
    const api = fakeApi({ listExpenses: vi.fn().mockResolvedValue(pageOf(3)) });
    const controller = createExpensesController(api, createMemoryCache(), {}, "UTC");
    const state = await controller.load();
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.days[0].rows).toHaveLength(3);
      expect(state.hasMore).toBe(false);
    }
  });

  it("second page appends without duplicating, advancing offset by the requested limit", async () => {
    const listExpenses = vi
      .fn()
      .mockResolvedValueOnce(pageOf(50, { startIndex: 0 }))
      .mockResolvedValueOnce(pageOf(10, { startIndex: 50, day: "2026-07-28" }));
    const api = fakeApi({ listExpenses });
    const controller = createExpensesController(api, createMemoryCache(), {}, "UTC");

    const first = await controller.load();
    expect(first.status).toBe("ready");
    if (first.status === "ready") {
      expect(first.hasMore).toBe(true);
    }

    const second = await controller.loadMore();
    expect(listExpenses).toHaveBeenNthCalledWith(2, { limit: 50, offset: 50 });
    expect(second.status).toBe("ready");
    if (second.status === "ready") {
      const allIds = second.days.flatMap((d) => d.rows.map((r) => r.id));
      expect(new Set(allIds).size).toBe(allIds.length);
      expect(allIds).toHaveLength(60);
      expect(second.hasMore).toBe(false);
    }
  });

  it("sends categoryId and period on every page, server-side (D402) — the same filter Load more carries", async () => {
    const listExpenses = vi
      .fn()
      .mockResolvedValueOnce(pageOf(50))
      .mockResolvedValueOnce(pageOf(1, { startIndex: 50 }));
    const api = fakeApi({ listExpenses });
    const period: PeriodValue = { unit: "month", offset: -1 };
    const controller = createExpensesController(
      api,
      createMemoryCache(),
      { categoryId: "cat-transport", period },
      "UTC",
    );

    await controller.load();
    expect(listExpenses).toHaveBeenNthCalledWith(1, {
      limit: 50,
      offset: 0,
      categoryId: "cat-transport",
      period: { period: "month", offset: -1 },
    });

    await controller.loadMore();
    expect(listExpenses).toHaveBeenNthCalledWith(2, {
      limit: 50,
      offset: 50,
      categoryId: "cat-transport",
      period: { period: "month", offset: -1 },
    });
  });

  it("shows an end-of-list marker once a short page confirms there is no more", async () => {
    const api = fakeApi({ listExpenses: vi.fn().mockResolvedValue(pageOf(1)) });
    const controller = createExpensesController(api, createMemoryCache(), {}, "UTC");
    const state = await controller.load();
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.hasMore).toBe(false);
    }
  });

  it("resolves to empty (naming the category) when a filtered page has nothing and there is no more", async () => {
    const api = fakeApi({ listExpenses: vi.fn().mockResolvedValue([]) });
    const controller = createExpensesController(
      api,
      createMemoryCache(),
      { categoryId: "cat-transport" },
      "UTC",
    );
    const state = await controller.load();
    expect(state).toEqual({ status: "empty", categoryLabel: "Transport", period: undefined });
  });

  it("resolves empty carrying the period value, for the render layer to name it", async () => {
    const period: PeriodValue = { unit: "month", offset: 0 };
    const api = fakeApi({ listExpenses: vi.fn().mockResolvedValue([]) });
    const controller = createExpensesController(api, createMemoryCache(), { period }, "UTC");
    const state = await controller.load();
    expect(state).toEqual({ status: "empty", categoryLabel: null, period });
  });

  it("resolves plain empty (no filter mentioned) when the whole account has nothing", async () => {
    const api = fakeApi({ listExpenses: vi.fn().mockResolvedValue([]) });
    const controller = createExpensesController(api, createMemoryCache(), {}, "UTC");
    const state = await controller.load();
    expect(state).toEqual({ status: "empty", categoryLabel: null, period: undefined });
  });

  it("renders normally (no error state) when own_only silently returns a short page", async () => {
    // A single-owner filtered page returned by the server (own_only), not an
    // error — the screen has no special-cased handling for this, it just
    // renders whatever page it received (plan's documented own_only risk).
    const api = fakeApi({ listExpenses: vi.fn().mockResolvedValue(pageOf(2)) });
    const controller = createExpensesController(api, createMemoryCache(), {}, "UTC");
    const state = await controller.load();
    expect(state.status).toBe("ready");
  });

  it("maps a 403 to a forbidden state", async () => {
    const api = fakeApi({ listCategories: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const controller = createExpensesController(api, createMemoryCache(), {}, "UTC");
    const state = await controller.load();
    expect(state).toEqual({ status: "forbidden" });
  });

  it("returns an error with no cached data to fall back on", async () => {
    const api = fakeApi({ listExpenses: vi.fn().mockRejectedValue(new RetryableError()) });
    const controller = createExpensesController(api, createMemoryCache(), {}, "UTC");
    const state = await controller.load();
    expect(state.status).toBe("error");
  });

  it("falls back to the last cached snapshot with a synced marker when offline", async () => {
    const cache = createMemoryCache();
    const goodApi = fakeApi({ listExpenses: vi.fn().mockResolvedValue(pageOf(2)) });
    const goodController = createExpensesController(goodApi, cache, {}, "UTC");
    const good = await goodController.load();
    expect(good.status).toBe("ready");

    const badApi = fakeApi({ listExpenses: vi.fn().mockRejectedValue(new RetryableError()) });
    const badController = createExpensesController(badApi, cache, {}, "UTC");
    const state = await badController.load();
    expect(state.status).toBe("offline");
    if (state.status === "offline") {
      expect(state.lastSyncedAt.length).toBeGreaterThan(0);
      expect(state.days[0].rows).toHaveLength(2);
    }
  });

  it("keeps the already-rendered page when loadMore itself fails, leaving hasMore true for a retry", async () => {
    const listExpenses = vi
      .fn()
      .mockResolvedValueOnce(pageOf(50))
      .mockRejectedValueOnce(new RetryableError());
    const api = fakeApi({ listExpenses });
    const controller = createExpensesController(api, createMemoryCache(), {}, "UTC");
    const first = await controller.load();
    expect(first.status).toBe("ready");

    const second = await controller.loadMore();
    expect(second.status).toBe("ready");
    if (second.status === "ready") {
      expect(second.hasMore).toBe(true);
      expect(second.days.flatMap((d) => d.rows)).toHaveLength(50);
    }
  });
});

describe("renderExpenses", () => {
  it("renders a loading skeleton", () => {
    const html = renderExpenses({ status: "loading" }, NOW);
    expect(html).toContain('data-testid="loading"');
  });

  it("renders a retry affordance on error", () => {
    const html = renderExpenses({ status: "error", message: "The server is unreachable right now." }, NOW);
    expect(html).toContain('data-action="retry"');
  });

  it("renders read-only on 403", () => {
    const html = renderExpenses({ status: "forbidden" }, NOW);
    expect(html).toContain("permission");
  });

  it("names the category alone in the empty state", () => {
    const html = renderExpenses({ status: "empty", categoryLabel: "Transport", period: undefined }, NOW);
    expect(html).toContain("Nothing here yet for Transport.");
  });

  it("names the period alone in the empty state", () => {
    const html = renderExpenses(
      { status: "empty", categoryLabel: null, period: { unit: "month", offset: 0 } },
      NOW,
    );
    expect(html).toContain("Nothing in August.");
  });

  it("names both halves in the empty state — period then category (V4, D404)", () => {
    const html = renderExpenses(
      { status: "empty", categoryLabel: "Transport", period: { unit: "month", offset: 0 } },
      NOW,
    );
    expect(html).toContain("Nothing in August for Transport.");
  });

  it("renders a generic empty message with no filter", () => {
    const html = renderExpenses({ status: "empty", categoryLabel: null, period: undefined }, NOW);
    expect(html).toContain("No expenses yet.");
  });

  it("renders day groups with subtotals, rows, and an end-of-list marker", () => {
    const data = buildExpensesData({
      expenses: [
        expense({ id: "e1", amount: 1000, created_at: "2026-07-29T10:00:00Z", tags: [{ id: "t1", name: "vacation", account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" }] }),
      ],
      categories: CATEGORIES,
      currency: "EUR",
      hasMore: false,
      tz: "UTC",
    });
    const html = renderExpenses({ status: "ready", ...data }, NOW);
    expect(html).toContain('data-testid="day-group"');
    expect(html).toContain('data-testid="expense-row"');
    expect(html).toContain("10.00");
    expect(html).toContain("Groceries");
    expect(html).toContain("vacation");
    expect(html).toContain("Alice".charAt(0));
    expect(html).toContain('data-testid="end-of-list"');
    expect(html).not.toContain('data-action="load-more"');
  });

  it("renders a Load more button while hasMore is true, not the end-of-list marker", () => {
    const data = buildExpensesData({
      expenses: pageOf(1),
      categories: CATEGORIES,
      currency: "EUR",
      hasMore: true,
      tz: "UTC",
    });
    const html = renderExpenses({ status: "ready", ...data }, NOW);
    expect(html).toContain('data-action="load-more"');
    expect(html).not.toContain('data-testid="end-of-list"');
  });

  it("shows the offline marker alongside the last known data", () => {
    const data = buildExpensesData({
      expenses: pageOf(1),
      categories: CATEGORIES,
      currency: "EUR",
      hasMore: false,
      tz: "UTC",
    });
    const html = renderExpenses({ status: "offline", lastSyncedAt: "2026-08-02T09:00:00.000Z", ...data }, NOW);
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-08-02T09:00:00.000Z");
  });

  it("shows the filter banner naming the category alone when only a category filter is active", () => {
    const data = buildExpensesData({
      expenses: EXPENSES_FOR_FILTER_TEST,
      categories: CATEGORIES,
      currency: "EUR",
      categoryId: "cat-transport",
      hasMore: false,
      tz: "UTC",
    });
    const html = renderExpenses({ status: "ready", ...data }, NOW);
    expect(html).toContain('data-testid="filter-banner"');
    expect(html).toContain(">Transport<");
  });

  it("shows the filter banner naming both halves — 'Transport · August' (V4)", () => {
    const data = buildExpensesData({
      expenses: EXPENSES_FOR_FILTER_TEST,
      categories: CATEGORIES,
      currency: "EUR",
      categoryId: "cat-transport",
      period: { unit: "month", offset: 0 },
      hasMore: false,
      tz: "UTC",
    });
    const html = renderExpenses({ status: "ready", ...data }, NOW);
    expect(html).toContain('data-testid="filter-banner"');
    expect(html).toContain(">Transport · August<");
  });

  it("shows the filter banner naming the period alone, rendered by the same describe() Home's label uses", () => {
    const data = buildExpensesData({
      expenses: EXPENSES_FOR_FILTER_TEST,
      categories: CATEGORIES,
      currency: "EUR",
      period: { unit: "month", offset: 0 },
      hasMore: false,
      tz: "UTC",
    });
    const html = renderExpenses({ status: "ready", ...data }, NOW);
    expect(html).toContain('data-testid="filter-banner"');
    expect(html).toContain(">August<");
  });

  it("renders no filter banner when unfiltered", () => {
    const data = buildExpensesData({
      expenses: EXPENSES_FOR_FILTER_TEST,
      categories: CATEGORIES,
      currency: "EUR",
      hasMore: false,
      tz: "UTC",
    });
    const html = renderExpenses({ status: "ready", ...data }, NOW);
    expect(html).not.toContain('data-testid="filter-banner"');
  });
});

const EXPENSES_FOR_FILTER_TEST: ExpenseResponse[] = [
  expense({ id: "e1", category_id: "cat-transport", amount: 500 }),
];

function fakeWebApp(overrides: Partial<TelegramWebApp> = {}): TelegramWebApp {
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
    BackButton: {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    HapticFeedback: {
      impactOccurred: vi.fn(),
      notificationOccurred: vi.fn(),
      selectionChanged: vi.fn(),
    },
    showConfirm: vi.fn(),
    ...overrides,
  };
}

function installWebApp(webApp: TelegramWebApp): void {
  (globalThis as { window?: Window }).window = { Telegram: { WebApp: webApp } } as unknown as Window;
}

afterEach(() => {
  delete (globalThis as { window?: Window }).window;
});

describe("applyExpensesChrome", () => {
  it("hides the MainButton (no primary action on this screen) and wires BackButton to onBack", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onBack = vi.fn();

    applyExpensesChrome(onBack);

    expect(webApp.MainButton.hide).toHaveBeenCalledOnce();
    expect(webApp.BackButton.onClick).toHaveBeenCalledWith(onBack);
    expect(webApp.BackButton.show).toHaveBeenCalledOnce();
  });
});
