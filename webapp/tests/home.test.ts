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
  createHomeController,
  createMemoryCache,
  HOME_TILES,
  loadHome,
  renderHome,
  segmentTapTarget,
  type HomeApi,
  type HomeState,
} from "../src/screens/home";
import type { PeriodValue } from "../src/lib/period";
import type { TelegramWebApp } from "../src/lib/telegram";

const THIS_MONTH: PeriodValue = { unit: "month", offset: 0 };
const NOW = new Date(2026, 7, 4); // August 4, 2026 (local) — matches PERIOD_TOTAL/describe's own fixtures

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
      period: THIS_MONTH,
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
    expect(data.period).toBe(THIS_MONTH);
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
      period: THIS_MONTH,
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
      period: THIS_MONTH,
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
      period: THIS_MONTH,
    });

    const appended = category("cat-health", "Health", "2026-01-05T00:00:00Z");
    const second = buildHomeData({
      categories: [...CATEGORIES, appended],
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [],
      period: THIS_MONTH,
    });

    for (const id of ["cat-groceries", "cat-transport", "cat-cafe"]) {
      const before = first.segments.find((s) => s.categoryId === id);
      const after = second.segments.find((s) => s.categoryId === id);
      expect(after?.colorVar).toEqual(before?.colorVar);
    }
  });

  it("shows the over-budget strip only on month at offset 0 (D310, extended)", () => {
    const notThisMonth: PeriodValue[] = [
      { unit: "day", offset: 0 },
      { unit: "week", offset: 0 },
      { unit: "year", offset: 0 },
      { unit: "month", offset: -1 },
      { unit: "custom", offset: 0, start: "2026-07-09", end: "2026-07-17" },
    ];
    for (const period of notThisMonth) {
      const data = buildHomeData({
        categories: CATEGORIES,
        categoryTotals: CATEGORY_TOTALS,
        periodTotal: PERIOD_TOTAL,
        currency: "EUR",
        budgetProgress: [progress()],
        period,
      });
      expect(data.overBudget).toEqual([]);
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
  it("returns a ready state built from a fake ApiClient, carrying the requested period", async () => {
    const state = await loadHome(fakeApi(), createMemoryCache(), THIS_MONTH);
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.totalMinor).toBe(72470);
      expect(state.period).toEqual(THIS_MONTH);
    }
  });

  it("sends the period as a PeriodQuery to both statistics endpoints, offset explicit", async () => {
    const api = fakeApi();
    await loadHome(api, createMemoryCache(), { unit: "week", offset: -2 });
    expect(api.statisticsByCategory).toHaveBeenCalledWith({ period: "week", offset: -2 });
    expect(api.statisticsByPeriod).toHaveBeenCalledWith({ period: "week", offset: -2 });
  });

  it("returns empty when the period total is zero, tiles still included", async () => {
    const state = await loadHome(
      fakeApi({
        statisticsByCategory: vi.fn().mockResolvedValue([]),
        statisticsByPeriod: vi.fn().mockResolvedValue({ ...PERIOD_TOTAL, total: 0 }),
        listBudgetPlans: vi.fn().mockResolvedValue([]),
      }),
      createMemoryCache(),
      THIS_MONTH,
    );
    expect(state).toEqual({ status: "empty", tiles: HOME_TILES, period: THIS_MONTH });
  });

  it("maps a 403 to a forbidden state with tiles still reachable", async () => {
    const state = await loadHome(
      fakeApi({ statisticsByCategory: vi.fn().mockRejectedValue(new ForbiddenError()) }),
      createMemoryCache(),
      THIS_MONTH,
    );
    expect(state).toEqual({ status: "forbidden", tiles: HOME_TILES });
  });

  it("returns an error with no cached data to fall back on, carrying the attempted period", async () => {
    const state = await loadHome(
      fakeApi({ statisticsByCategory: vi.fn().mockRejectedValue(new RetryableError()) }),
      createMemoryCache(),
      { unit: "day", offset: -3 },
    );
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.period).toEqual({ unit: "day", offset: -3 });
    }
  });

  it("falls back to the last cached snapshot with a synced marker when offline, frozen at the cached period", async () => {
    const cache = createMemoryCache();
    const good = await loadHome(fakeApi(), cache, THIS_MONTH);
    expect(good.status).toBe("ready");

    const state = await loadHome(
      fakeApi({ statisticsByCategory: vi.fn().mockRejectedValue(new RetryableError()) }),
      cache,
      { unit: "year", offset: -1 }, // the period the user just tapped, never fetched
    );
    expect(state.status).toBe("offline");
    if (state.status === "offline") {
      expect(state.totalMinor).toBe(72470);
      expect(state.lastSyncedAt.length).toBeGreaterThan(0);
      expect(state.period).toEqual(THIS_MONTH); // frozen at the cached period, not the failed tap
    }
  });

  it("hides the over-budget strip when the requested period isn't month at offset 0", async () => {
    const state = await loadHome(fakeApi(), createMemoryCache(), { unit: "day", offset: 0 });
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.overBudget).toEqual([]);
    }
  });
});

describe("createHomeController", () => {
  it("discards a stale response when a newer load has started, in call order (last tap wins)", async () => {
    let resolveStale: (value: PeriodTotal) => void = () => {};
    let calls = 0;
    const statisticsByPeriod = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<PeriodTotal>((resolve) => {
          resolveStale = resolve;
        });
      }
      return Promise.resolve({ ...PERIOD_TOTAL, total: 999 });
    });
    const controller = createHomeController(fakeApi({ statisticsByPeriod }), createMemoryCache());

    const stale = controller.load({ unit: "day", offset: 0 }); // fires first, resolves last
    const latest = await controller.load({ unit: "month", offset: 0 }); // fires second, resolves first
    resolveStale(PERIOD_TOTAL);
    const staleResult = await stale;

    expect(staleResult).toBeNull();
    expect(latest).not.toBeNull();
    if (latest?.status === "ready") {
      expect(latest.totalMinor).toBe(999);
    }
  });

  it("resolves normally when calls are not interleaved", async () => {
    const controller = createHomeController(fakeApi(), createMemoryCache());
    const first = await controller.load(THIS_MONTH);
    const second = await controller.load({ unit: "day", offset: 0 });
    expect(first?.status).toBe("ready");
    expect(second?.status).toBe("ready");
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
      period: THIS_MONTH,
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
      period: THIS_MONTH,
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

    applyHomeChrome({ status: "loading", period: THIS_MONTH });

    expect(webApp.MainButton.hide).toHaveBeenCalledOnce();
  });

  it("wires the MainButton tap to the provided onAddExpense handler (U2.2)", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onAddExpense = vi.fn();

    applyHomeChrome({ status: "empty", tiles: HOME_TILES, period: THIS_MONTH }, onAddExpense);

    expect(webApp.MainButton.onClick).toHaveBeenCalledWith(onAddExpense);
  });

  it("does not wire an onClick handler when none is provided", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    applyHomeChrome({ status: "empty", tiles: HOME_TILES, period: THIS_MONTH });

    expect(webApp.MainButton.onClick).not.toHaveBeenCalled();
  });
});

describe("renderHome", () => {
  const readyData = buildHomeData({
    categories: CATEGORIES,
    categoryTotals: CATEGORY_TOTALS,
    periodTotal: PERIOD_TOTAL,
    currency: "EUR",
    budgetProgress: [progress()],
    period: THIS_MONTH,
  });

  it("renders a loading skeleton with the period control live and tiles already in the final layout", () => {
    const html = renderHome({ status: "loading", period: THIS_MONTH }, NOW);
    expect(html).toContain('data-testid="loading"');
    expect(html).toContain('data-testid="tiles"');
    expect(html).toContain('data-testid="period-selector"');
    expect(html).toContain('data-testid="period-tab-month"');
    expect(html).not.toContain("period-selector disabled");
  });

  it("names the period in force when empty, never a generic 'no data'", () => {
    const today = renderHome({ status: "empty", tiles: HOME_TILES, period: { unit: "day", offset: 0 } }, NOW);
    expect(today).toContain("Nothing today");

    const thisMonth = renderHome({ status: "empty", tiles: HOME_TILES, period: THIS_MONTH }, NOW);
    expect(thisMonth).toContain("Nothing in August");
    expect(thisMonth).toContain('data-tile="expenses"');
  });

  it("renders a retry affordance and the period control on error", () => {
    const html = renderHome(
      { status: "error", message: "The server is unreachable right now.", period: THIS_MONTH },
      NOW,
    );
    expect(html).toContain('data-action="retry"');
    expect(html).toContain("unreachable");
    expect(html).toContain('data-testid="period-selector"');
  });

  it("renders read-only with no broken Add-expense button on 403", () => {
    const html = renderHome({ status: "forbidden", tiles: HOME_TILES }, NOW);
    expect(html).toContain('data-tile="add-expense" disabled');
    expect(html).not.toContain('data-action="retry"');
  });

  it("renders the last-synced marker when offline, alongside the last known data, control frozen/disabled", () => {
    const html = renderHome({ status: "offline", lastSyncedAt: "2026-08-02T09:00:00.000Z", ...readyData }, NOW);
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-08-02T09:00:00.000Z");
    expect(html).toContain('data-testid="donut"');
    expect(html).toContain("period-selector disabled");
  });

  it("omits the legend for a single category", () => {
    const single = buildHomeData({
      categories: [CATEGORIES[0]],
      categoryTotals: [CATEGORY_TOTALS[0]],
      periodTotal: { ...PERIOD_TOTAL, total: 41260 },
      currency: "EUR",
      budgetProgress: [],
      period: THIS_MONTH,
    });
    const html = renderHome({ status: "ready", ...single }, NOW);
    expect(html).not.toContain('data-testid="legend"');
  });

  it("shows the over-budget strip when a category is exceeded on month at offset 0", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    expect(html).toContain('data-testid="over-budget"');
    expect(html).toContain("Café");
  });

  it("hides the over-budget strip outside month at offset 0, even with an exceeded budget", () => {
    const dayData = buildHomeData({
      categories: CATEGORIES,
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [progress()],
      period: { unit: "day", offset: 0 },
    });
    const html = renderHome({ status: "ready", ...dayData }, NOW);
    expect(html).not.toContain('data-testid="over-budget"');
  });

  it("embeds the period selector's own label for the active period", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    expect(html).toContain('data-testid="period-tab-month"');
    expect(html).toContain("August");
  });
});
