import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
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
  loadHome,
  pickerValueForPeriod,
  renderHome,
  resolveDayDate,
  type HomeApi,
  type HomeState,
} from "../src/screens/home";
import type { PeriodValue } from "../src/lib/period";
import { formatAmount } from "../src/lib/money";
import type { TelegramWebApp } from "../src/lib/telegram";

const THIS_MONTH: PeriodValue = { unit: "month", offset: 0 };
const NOW = new Date(2026, 7, 4); // August 4, 2026 (local) — matches PERIOD_TOTAL/describe's own fixtures
const TODAY = "2026-08-04"; // family_tz `today` matching NOW, U2.5's HomeData.today
const ACCOUNT_NAME = "The Smiths"; // UserMeResponse.account_name (U3.2's HomeData.accountName)

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
  it("builds segments in category creation order, ranked rows by spend descending, and the over-budget strip", () => {
    const data = buildHomeData({
      categories: CATEGORIES,
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [progress()],
      period: THIS_MONTH,
      today: TODAY,
      accountName: ACCOUNT_NAME,
    });

    expect(data.totalMinor).toBe(72470);
    expect(data.segments.map((s) => s.categoryId)).toEqual([
      "cat-groceries",
      "cat-transport",
      "cat-cafe",
    ]);
    expect(data.rows.map((r) => r.categoryId)).toEqual([
      "cat-groceries",
      "cat-transport",
      "cat-cafe",
    ]);
    expect(data.rows[0].sharePct).toBeCloseTo((41260 / 72470) * 100, 5);
    expect(data.overBudget).toEqual([
      { categoryId: "cat-cafe", label: "Café", overMinor: 2390 },
    ]);
    expect(data.period).toBe(THIS_MONTH);
  });

  it("ranks all non-zero categories by spend, not just the top three (the old legend cap is gone)", () => {
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
      today: TODAY,
      accountName: ACCOUNT_NAME,
    });

    expect(data.rows.map((r) => r.categoryId)).toEqual([
      "cat-health",
      "cat-groceries",
      "cat-transport",
      "cat-cafe",
    ]);
  });

  it("omits a category with a zero total from the ranked rows", () => {
    const categories = [
      ...CATEGORIES,
      category("cat-unused", "Unused", "2026-01-05T00:00:00Z"),
    ];
    const totals: CategoryTotal[] = [
      ...CATEGORY_TOTALS,
      { category_id: "cat-unused", total: 0 },
    ];

    const data = buildHomeData({
      categories,
      categoryTotals: totals,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [],
      period: THIS_MONTH,
      today: TODAY,
      accountName: ACCOUNT_NAME,
    });

    expect(data.rows.map((r) => r.categoryId)).not.toContain("cat-unused");
  });

  it("folds more than six categories into a trailing Other donut slot, but the ranked rows don't fold", () => {
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
      today: TODAY,
      accountName: ACCOUNT_NAME,
    });

    expect(data.segments).toHaveLength(7);
    expect(data.segments[6]).toMatchObject({ categoryId: null, label: "Other" });
    expect(data.rows).toHaveLength(8);
  });

  it("category to colour mapping stays stable across two renders with a category appended", () => {
    const first = buildHomeData({
      categories: CATEGORIES,
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [],
      period: THIS_MONTH,
      today: TODAY,
      accountName: ACCOUNT_NAME,
    });

    const appended = category("cat-health", "Health", "2026-01-05T00:00:00Z");
    const second = buildHomeData({
      categories: [...CATEGORIES, appended],
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [],
      period: THIS_MONTH,
      today: TODAY,
      accountName: ACCOUNT_NAME,
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
        today: TODAY,
        accountName: ACCOUNT_NAME,
      });
      expect(data.overBudget).toEqual([]);
    }
  });
});

function fakeApi(overrides: Partial<HomeApi> = {}): HomeApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR", today: TODAY, account_name: ACCOUNT_NAME }),
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

  it("returns empty when the period total is zero, carrying the account name for the side menu", async () => {
    const state = await loadHome(
      fakeApi({
        statisticsByCategory: vi.fn().mockResolvedValue([]),
        statisticsByPeriod: vi.fn().mockResolvedValue({ ...PERIOD_TOTAL, total: 0 }),
        listBudgetPlans: vi.fn().mockResolvedValue([]),
      }),
      createMemoryCache(),
      THIS_MONTH,
    );
    expect(state).toEqual({ status: "empty", period: THIS_MONTH, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME });
  });

  it("maps a 403 to a forbidden state", async () => {
    const state = await loadHome(
      fakeApi({ statisticsByCategory: vi.fn().mockRejectedValue(new ForbiddenError()) }),
      createMemoryCache(),
      THIS_MONTH,
    );
    expect(state).toEqual({ status: "forbidden" });
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

describe("pickerValueForPeriod", () => {
  it("seeds the picker with the previously applied custom range", () => {
    expect(pickerValueForPeriod({ unit: "custom", offset: 0, start: "2026-07-09", end: "2026-07-17" })).toEqual({
      start: "2026-07-09",
      end: "2026-07-17",
    });
  });

  it("opens empty for any non-custom period, even one with a leftover offset", () => {
    expect(pickerValueForPeriod(THIS_MONTH)).toEqual({});
    expect(pickerValueForPeriod({ unit: "day", offset: -3 })).toEqual({});
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

describe("resolveDayDate", () => {
  it("returns today unshifted at offset 0", () => {
    expect(resolveDayDate("2026-08-07", 0)).toBe("2026-08-07");
  });

  it("(U2.5) resolves the AC's own example — the Day tab showing 3 August while today is 7 August", () => {
    expect(resolveDayDate("2026-08-07", -4)).toBe("2026-08-03");
  });

  it("resolves yesterday and two days ago the same way the fixed pills do", () => {
    expect(resolveDayDate("2026-08-07", -1)).toBe("2026-08-06");
    expect(resolveDayDate("2026-08-07", -2)).toBe("2026-08-05");
  });

  it("crosses a month boundary correctly, never drifting via UTC/local conversion (D120's bug class)", () => {
    expect(resolveDayDate("2026-08-01", -1)).toBe("2026-07-31");
  });
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
      rows: [],
      overBudget: [],
      period: THIS_MONTH,
      today: TODAY,
      accountName: ACCOUNT_NAME,
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

    applyHomeChrome({ status: "forbidden" });

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

    applyHomeChrome({ status: "empty", period: THIS_MONTH, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME }, onAddExpense);
    (webApp.MainButton.onClick as Mock).mock.calls[0][0]();

    expect(onAddExpense).toHaveBeenCalledOnce();
  });

  it("(U2.5) carries the Day tab's resolved date — family_tz `today` shifted by offset, never new Date() — to onAddExpense", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onAddExpense = vi.fn();

    applyHomeChrome(
      { status: "empty", period: { unit: "day", offset: -1 }, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME },
      onAddExpense,
    );
    (webApp.MainButton.onClick as Mock).mock.calls[0][0]();

    expect(onAddExpense).toHaveBeenCalledWith("2026-08-03");
  });

  it("(U2.5) passes no date to onAddExpense from a non-Day tab — screen 02 defaults to today, unchanged", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onAddExpense = vi.fn();

    applyHomeChrome(
      { status: "empty", period: THIS_MONTH, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME },
      onAddExpense,
    );
    (webApp.MainButton.onClick as Mock).mock.calls[0][0]();

    expect(onAddExpense).toHaveBeenCalledWith(undefined);
  });

  it("does not wire an onClick handler when none is provided", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    applyHomeChrome({ status: "empty", period: THIS_MONTH, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME });

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
    today: TODAY,
    accountName: ACCOUNT_NAME,
  });

  it("renders a loading skeleton with the period control live and in the final layout", () => {
    const html = renderHome({ status: "loading", period: THIS_MONTH }, NOW);
    expect(html).toContain('data-testid="loading"');
    expect(html).toContain('data-testid="period-selector"');
    expect(html).toContain('data-testid="period-tab-month"');
    expect(html).not.toContain("period-selector disabled");
  });

  it("(U3.2/D409) renders no ☰ while loading or on error — neither state's chart card has one, and error's retry button sits exactly where an absolutely positioned ☰ would overlap it", () => {
    expect(renderHome({ status: "loading", period: THIS_MONTH }, NOW)).not.toContain('data-testid="menu-button"');
    expect(
      renderHome({ status: "error", message: "The server is unreachable right now.", period: THIS_MONTH }, NOW),
    ).not.toContain('data-testid="menu-button"');
  });

  it("(U3.2/D409) renders no navigation tiles anywhere on the page, in any state", () => {
    const states: HomeState[] = [
      { status: "loading", period: THIS_MONTH },
      { status: "error", message: "oops", period: THIS_MONTH },
      { status: "forbidden" },
      { status: "empty", period: THIS_MONTH, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME },
      { status: "ready", ...readyData },
      { status: "offline", lastSyncedAt: "2026-08-02T09:00:00.000Z", ...readyData },
    ];
    for (const state of states) {
      const html = renderHome(state, NOW);
      expect(html).not.toContain('data-testid="tiles"');
      expect(html).not.toContain("data-tile=");
      expect(html).not.toContain('class="tile"');
    }
  });

  it("(U3.2/D409) sits a 44px ☰ at the bottom-left of the chart card, before the yellow Add button in DOM order", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    expect(html).toContain('data-testid="menu-button"');
    expect(html).toContain('aria-label="Menu"');
    const cardOpenIndex = html.indexOf('class="card chart-card"');
    const menuButtonIndex = html.indexOf('data-testid="menu-button"');
    const addButtonIndex = html.indexOf('data-testid="add-button"');
    expect(menuButtonIndex).toBeGreaterThan(cardOpenIndex);
    expect(menuButtonIndex).toBeLessThan(addButtonIndex);
  });

  it("(U3.2/D409) keeps the ☰ visible for a read-only (403) viewer, alongside the disabled/hidden Add affordances", () => {
    const html = renderHome({ status: "forbidden" }, NOW);
    expect(html).toContain('data-testid="menu-button"');
  });

  it("hides the yellow Add button while loading, matching MainButton (applyHomeChrome hides it too)", () => {
    const html = renderHome({ status: "loading", period: THIS_MONTH }, NOW);
    expect(html).not.toContain('data-testid="add-button"');
  });

  it("names the period's unit deictically when empty, never a generic 'no data' (D405)", () => {
    const today = renderHome(
      { status: "empty", period: { unit: "day", offset: 0 }, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME },
      NOW,
    );
    expect(today).toContain("There were no expenses on this day.");

    const thisMonth = renderHome(
      { status: "empty", period: THIS_MONTH, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME },
      NOW,
    );
    expect(thisMonth).toContain("There were no expenses in this month.");
  });

  it("draws a complete ring at the donut's own 200px/30px geometry, in --separator, with no segment gaps (D405)", () => {
    const html = renderHome(
      { status: "empty", period: THIS_MONTH, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME },
      NOW,
    );
    expect(html).toContain('data-testid="donut"');
    expect(html).toContain(`viewBox="0 0 200 200"`);
    expect(html).toContain(`r="${74}"`);
    expect(html).toContain(`stroke-width="${30}"`);
    expect(html).toContain('stroke="var(--separator)"');
    // A populated donut's segments carry stroke-dasharray to cut gaps between
    // slices; the empty ring is a single unbroken circle, no dasharray at all.
    expect(html).not.toContain("stroke-dasharray");
  });

  it("shows the formatted zero total for the account's currency in the ring's hole, --ink-secondary not --ink (D405)", () => {
    const html = renderHome(
      { status: "empty", period: THIS_MONTH, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME },
      NOW,
    );
    expect(html).toContain('<div class="amt amt-zero">0.00 EUR</div>');
  });

  it("occupies the same donut slot as a populated period — switching to empty moves nothing above the ranked rows", () => {
    const emptyHtml = renderHome(
      { status: "empty", period: THIS_MONTH, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME },
      NOW,
    );
    const readyHtml = renderHome({ status: "ready", ...readyData }, NOW);
    expect(emptyHtml).toContain('class="donut-wrap"');
    expect(readyHtml).toContain('class="donut-wrap"');
  });

  it("keeps the yellow Add button present on an empty period (both Add affordances stay enabled — there is no disabled variant of this button)", () => {
    const html = renderHome(
      { status: "empty", period: THIS_MONTH, currency: "EUR", today: TODAY, accountName: ACCOUNT_NAME },
      NOW,
    );
    expect(html).toContain('data-testid="add-button"');
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

  it("renders read-only with no broken Add-expense button on 403, and hides both the yellow Add button and MainButton's markup", () => {
    const html = renderHome({ status: "forbidden" }, NOW);
    expect(html).not.toContain('data-action="retry"');
    expect(html).not.toContain('data-testid="add-button"');
  });

  it("renders the yellow Add button as a 56px --accent circle, absolute (never fixed) within the chart card, with the copy table's accessible name and design-system.md's SVG + glyph", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    expect(html).toContain('data-testid="add-button"');
    expect(html).toContain('aria-label="Add expense"');
    // design-system.md's Iconography table: the `+` is a 24px-box, 2.5px-stroke
    // inline SVG (matching Calendar/Warning/etc.), not a text glyph.
    expect(html).toContain('<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"');
    expect(html).toContain('stroke-width="2.5"');
    // The button's class carries all of its geometry (app.css's `.add-btn`
    // rule: `position: absolute`, 56px, `--accent`) — asserted here only by
    // presence of the class, not by re-deriving app.css's rule in the test.
    expect(html).toContain('class="add-btn"');
  });

  it("renders the populated donut's segments with no button semantics — no role, no tabindex, no data-action (D404: display-only)", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    const donutIndex = html.indexOf('data-testid="donut"');
    const donutCloseIndex = html.indexOf("</svg>", donutIndex);
    const donutMarkup = html.slice(donutIndex, donutCloseIndex);
    expect(donutMarkup).toContain("data-category-id");
    expect(donutMarkup).not.toContain("role=");
    expect(donutMarkup).not.toContain("tabindex");
    expect(donutMarkup).not.toContain("data-action");
  });

  it("places the yellow Add button after the donut and before the ranked rows (Focus order: donut -> Add button -> rows)", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    const cardOpenIndex = html.indexOf('class="card chart-card"');
    const donutIndex = html.indexOf('data-testid="donut"');
    const addButtonIndex = html.indexOf('data-testid="add-button"');
    const rowsIndex = html.indexOf('data-testid="ranked-rows"');
    expect(cardOpenIndex).toBeGreaterThan(-1);
    expect(donutIndex).toBeGreaterThan(cardOpenIndex);
    expect(addButtonIndex).toBeGreaterThan(donutIndex);
    expect(addButtonIndex).toBeLessThan(rowsIndex);
  });

  it("keeps the yellow Add button present and enabled while offline, same as MainButton", () => {
    const html = renderHome({ status: "offline", lastSyncedAt: "2026-08-02T09:00:00.000Z", ...readyData }, NOW);
    expect(html).toContain('data-testid="add-button"');
  });

  it("renders the last-synced marker when offline, alongside the last known data, control frozen/disabled", () => {
    const html = renderHome({ status: "offline", lastSyncedAt: "2026-08-02T09:00:00.000Z", ...readyData }, NOW);
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-08-02T09:00:00.000Z");
    expect(html).toContain('data-testid="donut"');
    expect(html).toContain("period-selector disabled");
  });

  it("renders exactly one ranked row for a single category (the old <=1 suppression is gone)", () => {
    const single = buildHomeData({
      categories: [CATEGORIES[0]],
      categoryTotals: [CATEGORY_TOTALS[0]],
      periodTotal: { ...PERIOD_TOTAL, total: 41260 },
      currency: "EUR",
      budgetProgress: [],
      period: THIS_MONTH,
      today: TODAY,
      accountName: ACCOUNT_NAME,
    });
    const html = renderHome({ status: "ready", ...single }, NOW);
    expect(html.match(/data-testid="ranked-row"/g)).toHaveLength(1);
    expect(html).toContain("Groceries");
  });

  it("makes ranked rows keyboard-reachable and activatable, not mouse-only divs", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    expect(html).toContain('role="button" tabindex="0"');
    expect(html).toContain('aria-label="Groceries, 57%, 412.60"');
  });

  it("renders the top-ranked row's swatch, name, share and amount in that order", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    // "Groceries" is data.rows[0] (highest spend) — its swatch/name/pct/val
    // are each's first occurrence in document order. `>Groceries<` (the
    // `.nm` span's text node), not a bare substring match, since the row's
    // own `aria-label` attribute also contains "Groceries" earlier in the
    // markup.
    const swatchIndex = html.indexOf('class="swatch"');
    const nameIndex = html.indexOf(">Groceries<");
    const pctIndex = html.indexOf('class="pct"');
    const valIndex = html.indexOf('class="val"');
    expect(swatchIndex).toBeGreaterThan(-1);
    expect(swatchIndex).toBeLessThan(nameIndex);
    expect(nameIndex).toBeLessThan(pctIndex);
    expect(pctIndex).toBeLessThan(valIndex);
  });

  it("renders a 30-character category name in full and the amount intact (CSS handles the ellipsis, JS never truncates)", () => {
    const longName = "A".repeat(30);
    const data = buildHomeData({
      categories: [category("cat-long", longName, "2026-01-01T00:00:00Z")],
      categoryTotals: [{ category_id: "cat-long", total: 5000 }],
      periodTotal: { ...PERIOD_TOTAL, total: 5000 },
      currency: "EUR",
      budgetProgress: [],
      period: THIS_MONTH,
      today: TODAY,
      accountName: ACCOUNT_NAME,
    });
    const html = renderHome({ status: "ready", ...data }, NOW);
    expect(html).toContain(longName);
    expect(html).toContain(formatAmount(5000));
  });

  it("renders all ranked rows without folding, even past six categories", () => {
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
      today: TODAY,
      accountName: ACCOUNT_NAME,
    });
    const html = renderHome({ status: "ready", ...data }, NOW);
    expect(html.match(/data-testid="ranked-row"/g)).toHaveLength(8);
  });

  it("shows the over-budget strip when a category is exceeded on month at offset 0", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    expect(html).toContain('data-testid="over-budget"');
    expect(html).toContain("Café");
  });

  it("orders the over-budget strip before the ranked rows (Layout table region 3 before region 4)", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    const stripIndex = html.indexOf('data-testid="over-budget"');
    const rowsIndex = html.indexOf('data-testid="ranked-rows"');
    expect(stripIndex).toBeGreaterThan(-1);
    expect(rowsIndex).toBeGreaterThan(-1);
    expect(stripIndex).toBeLessThan(rowsIndex);
  });

  it("hides the over-budget strip outside month at offset 0, even with an exceeded budget", () => {
    const dayData = buildHomeData({
      categories: CATEGORIES,
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [progress()],
      period: { unit: "day", offset: 0 },
      today: TODAY,
      accountName: ACCOUNT_NAME,
    });
    const html = renderHome({ status: "ready", ...dayData }, NOW);
    expect(html).not.toContain('data-testid="over-budget"');
  });

  it("embeds the period selector's own label for the active period", () => {
    const html = renderHome({ status: "ready", ...readyData }, NOW);
    expect(html).toContain('data-testid="period-tab-month"');
    expect(html).toContain("August");
  });

  it("renders a custom range's label as a human span, not a pair of ISO strings, with the arrows hidden", () => {
    const customData = buildHomeData({
      categories: CATEGORIES,
      categoryTotals: CATEGORY_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      budgetProgress: [progress()],
      period: { unit: "custom", offset: 0, start: "2026-07-09", end: "2026-07-17" },
      today: TODAY,
      accountName: ACCOUNT_NAME,
    });
    const html = renderHome({ status: "ready", ...customData }, NOW);
    expect(html).toContain("9 – 17 Jul");
    expect(html).not.toContain("2026-07-09");
    expect(html).not.toContain('data-testid="period-arrow-prev"');
    expect(html).not.toContain('data-testid="period-arrow-next"');
  });

  it("reads the custom-period empty sentence, not the applied range (D405 — deictic, not period-named)", () => {
    const html = renderHome(
      {
        status: "empty",
        period: { unit: "custom", offset: 0, start: "2026-07-09", end: "2026-07-17" },
        currency: "EUR",
        today: TODAY,
        accountName: ACCOUNT_NAME,
      },
      NOW,
    );
    expect(html).toContain('<p class="empty-copy">There were no expenses in this period.</p>');
  });
});
