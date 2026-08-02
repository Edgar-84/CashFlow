import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type {
  BudgetPlanResponse,
  BudgetProgress,
  CategoryResponse,
  CategoryTotal,
  PeriodTotal,
} from "../src/api/types";
import {
  applyHomeChrome,
  buildHomeData,
  createMemoryCache,
  HOME_TILES,
  loadHome,
  renderHome,
  segmentTapTarget,
  type HomeApi,
  type HomeState,
} from "../src/screens/home";
import type { TelegramWebApp } from "../src/lib/telegram";

function category(id: string, name: string, created_at: string): CategoryResponse {
  return { id, name, account_id: "acc-1", created_at };
}

const CATEGORIES: CategoryResponse[] = [
  category("cat-groceries", "Groceries", "2026-01-01T00:00:00Z"),
  category("cat-transport", "Transport", "2026-01-02T00:00:00Z"),
  category("cat-cafe", "Café", "2026-01-03T00:00:00Z"),
];

const CATEGORY_TOTALS: CategoryTotal[] = [
  { category_id: "cat-groceries", total: 41260 },
  { category_id: "cat-transport", total: 16820 },
  { category_id: "cat-cafe", total: 14390 },
];

const PERIOD_TOTAL: PeriodTotal = {
  start: "2026-07-01T00:00:00Z",
  end: "2026-08-01T00:00:00Z",
  total: 72470,
};

const BUDGET_PLANS: BudgetPlanResponse[] = [
  {
    id: "plan-cafe",
    category_id: "cat-cafe",
    amount: 12000,
    period: "monthly",
    notify_threshold: 80,
    account_id: "acc-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

function progress(overrides: Partial<BudgetProgress> = {}): BudgetProgress {
  return {
    budget_plan_id: "plan-cafe",
    category_id: "cat-cafe",
    amount: 12000,
    spent: 14390,
    remaining: -2390,
    fill_pct: 119.9,
    notify_threshold: 80,
    is_over_threshold: true,
    is_exceeded: true,
    ...overrides,
  };
}

describe("buildHomeData", () => {
  it("builds segments in category creation order, a top-three legend by spend, and the over-budget strip", () => {
    const data = buildHomeData({
      categories: CATEGORIES,
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [progress()],
    });

    expect(data.totalMinor).toBe(72470);
    expect(data.segments.map((s) => s.categoryId)).toEqual([
      "cat-groceries",
      "cat-transport",
      "cat-cafe",
    ]);
    expect(data.legend.map((r) => r.categoryId)).toEqual([
      "cat-groceries",
      "cat-transport",
      "cat-cafe",
    ]);
    expect(data.legend[0].sharePct).toBeCloseTo((41260 / 72470) * 100, 5);
    expect(data.overBudget).toEqual([
      { categoryId: "cat-cafe", label: "Café", overMinor: 2390 },
    ]);
    expect(data.tiles).toBe(HOME_TILES);
  });

  it("keeps the legend to the top three by spend, not creation order", () => {
    const categories = [
      ...CATEGORIES,
      category("cat-health", "Health", "2026-01-04T00:00:00Z"),
    ];
    const totals: CategoryTotal[] = [
      ...CATEGORY_TOTALS,
      { category_id: "cat-health", total: 999999 },
    ];

    const data = buildHomeData({
      categories,
      categoryTotals: totals,
      periodTotal: { ...PERIOD_TOTAL, total: 72470 + 999999 },
      currency: "EUR",
      budgetProgress: [],
    });

    expect(data.legend.map((r) => r.categoryId)).toEqual([
      "cat-health",
      "cat-groceries",
      "cat-transport",
    ]);
  });

  it("folds more than six categories into a trailing Other donut slot", () => {
    const categories = Array.from({ length: 8 }, (_, i) =>
      category(`cat-${i}`, `Cat ${i}`, `2026-01-0${i + 1}T00:00:00Z`),
    );
    const totals: CategoryTotal[] = categories.map((c) => ({ category_id: c.id, total: 100 }));

    const data = buildHomeData({
      categories,
      categoryTotals: totals,
      periodTotal: { ...PERIOD_TOTAL, total: 800 },
      currency: "EUR",
      budgetProgress: [],
    });

    expect(data.segments).toHaveLength(7);
    expect(data.segments[6]).toMatchObject({ categoryId: null, label: "Other" });
  });

  it("category to colour mapping stays stable across two renders with a category appended", () => {
    const first = buildHomeData({
      categories: CATEGORIES,
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [],
    });

    const appended = category("cat-health", "Health", "2026-01-05T00:00:00Z");
    const second = buildHomeData({
      categories: [...CATEGORIES, appended],
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [],
    });

    for (const id of ["cat-groceries", "cat-transport", "cat-cafe"]) {
      const before = first.segments.find((s) => s.categoryId === id);
      const after = second.segments.find((s) => s.categoryId === id);
      expect(after?.colorVar).toEqual(before?.colorVar);
    }
  });
});

function fakeApi(overrides: Partial<HomeApi> = {}): HomeApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR" }),
    listCategories: vi.fn().mockResolvedValue(CATEGORIES),
    statisticsByCategory: vi.fn().mockResolvedValue(CATEGORY_TOTALS),
    statisticsByPeriod: vi.fn().mockResolvedValue(PERIOD_TOTAL),
    listBudgetPlans: vi.fn().mockResolvedValue(BUDGET_PLANS),
    getBudgetPlanProgress: vi.fn().mockResolvedValue(progress()),
    ...overrides,
  };
}

describe("loadHome", () => {
  it("returns a ready state built from a fake ApiClient", async () => {
    const state = await loadHome(fakeApi(), createMemoryCache());
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.totalMinor).toBe(72470);
    }
  });

  it("returns empty when the period total is zero, tiles still included", async () => {
    const state = await loadHome(
      fakeApi({
        statisticsByCategory: vi.fn().mockResolvedValue([]),
        statisticsByPeriod: vi.fn().mockResolvedValue({ ...PERIOD_TOTAL, total: 0 }),
        listBudgetPlans: vi.fn().mockResolvedValue([]),
      }),
      createMemoryCache(),
    );
    expect(state).toEqual({ status: "empty", tiles: HOME_TILES });
  });

  it("maps a 403 to a forbidden state with tiles still reachable", async () => {
    const state = await loadHome(
      fakeApi({ statisticsByCategory: vi.fn().mockRejectedValue(new ForbiddenError()) }),
      createMemoryCache(),
    );
    expect(state).toEqual({ status: "forbidden", tiles: HOME_TILES });
  });

  it("returns an error with no cached data to fall back on", async () => {
    const state = await loadHome(
      fakeApi({ statisticsByCategory: vi.fn().mockRejectedValue(new RetryableError()) }),
      createMemoryCache(),
    );
    expect(state.status).toBe("error");
  });

  it("falls back to the last cached snapshot with a synced marker when offline", async () => {
    const cache = createMemoryCache();
    const good = await loadHome(fakeApi(), cache);
    expect(good.status).toBe("ready");

    const state = await loadHome(
      fakeApi({ statisticsByCategory: vi.fn().mockRejectedValue(new RetryableError()) }),
      cache,
    );
    expect(state.status).toBe("offline");
    if (state.status === "offline") {
      expect(state.totalMinor).toBe(72470);
      expect(state.lastSyncedAt.length).toBeGreaterThan(0);
    }
  });
});

describe("segmentTapTarget", () => {
  it("resolves the tapped slot to its category", () => {
    const data = buildHomeData({
      categories: CATEGORIES,
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [],
    });

    expect(segmentTapTarget(data, 0)).toEqual({ categoryId: "cat-groceries", label: "Groceries" });
    expect(segmentTapTarget(data, 99)).toBeNull();
  });
});

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
    ...overrides,
  };
}

function installWebApp(webApp: TelegramWebApp): void {
  (globalThis as { window?: Window }).window = { Telegram: { WebApp: webApp } } as unknown as Window;
}

afterEach(() => {
  delete (globalThis as { window?: Window }).window;
});

describe("applyHomeChrome", () => {
  it("shows Add expense and hides the BackButton on a ready state", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    const ready: HomeState = {
      status: "ready",
      totalMinor: 0,
      currency: "EUR",
      segments: [],
      legend: [],
      overBudget: [],
      tiles: HOME_TILES,
    };
    applyHomeChrome(ready);

    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Add expense");
    expect(webApp.MainButton.show).toHaveBeenCalledOnce();
    expect(webApp.MainButton.enable).toHaveBeenCalledOnce();
    expect(webApp.BackButton.hide).toHaveBeenCalledOnce();
  });

  it("hides the MainButton for a forbidden (read-only) viewer", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    applyHomeChrome({ status: "forbidden", tiles: HOME_TILES });

    expect(webApp.MainButton.hide).toHaveBeenCalledOnce();
    expect(webApp.MainButton.show).not.toHaveBeenCalled();
  });

  it("hides the MainButton while loading", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    applyHomeChrome({ status: "loading" });

    expect(webApp.MainButton.hide).toHaveBeenCalledOnce();
  });
});

describe("renderHome", () => {
  const readyData = buildHomeData({
    categories: CATEGORIES,
    categoryTotals: CATEGORY_TOTALS,
    periodTotal: PERIOD_TOTAL,
    currency: "EUR",
    budgetProgress: [progress()],
  });

  it("renders a loading skeleton with tiles already in the final layout", () => {
    const html = renderHome({ status: "loading" });
    expect(html).toContain('data-testid="loading"');
    expect(html).toContain('data-testid="tiles"');
  });

  it("renders the empty state with tiles still reachable", () => {
    const html = renderHome({ status: "empty", tiles: HOME_TILES });
    expect(html).toContain("No expenses yet");
    expect(html).toContain('data-tile="expenses"');
  });

  it("renders a retry affordance on error", () => {
    const html = renderHome({ status: "error", message: "The server is unreachable right now." });
    expect(html).toContain('data-action="retry"');
    expect(html).toContain("unreachable");
  });

  it("renders read-only with no broken Add-expense button on 403", () => {
    const html = renderHome({ status: "forbidden", tiles: HOME_TILES });
    expect(html).toContain('data-tile="add-expense" disabled');
    expect(html).not.toContain('data-action="retry"');
  });

  it("renders the last-synced marker when offline, alongside the last known data", () => {
    const html = renderHome({ status: "offline", lastSyncedAt: "2026-08-02T09:00:00.000Z", ...readyData });
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-08-02T09:00:00.000Z");
    expect(html).toContain('data-testid="donut"');
  });

  it("omits the legend for a single category", () => {
    const single = buildHomeData({
      categories: [CATEGORIES[0]],
      categoryTotals: [CATEGORY_TOTALS[0]],
      periodTotal: { ...PERIOD_TOTAL, total: 41260 },
      currency: "EUR",
      budgetProgress: [],
    });
    const html = renderHome({ status: "ready", ...single });
    expect(html).not.toContain('data-testid="legend"');
  });

  it("shows the over-budget strip when a category is exceeded", () => {
    const html = renderHome({ status: "ready", ...readyData });
    expect(html).toContain('data-testid="over-budget"');
    expect(html).toContain("Café");
  });
});
