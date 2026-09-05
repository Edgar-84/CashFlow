import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type { BudgetFill, CategoryResponse, CategoryTotal, PeriodTotal, TagResponse, TagTotal } from "../src/api/types";
import { setLanguage, t } from "../src/lib/i18n";
import { toQuery, type PeriodValue } from "../src/lib/period";
import {
  applyStatisticsChrome,
  buildStatisticsData,
  createMemoryCache,
  loadStatistics,
  pickerValueForPeriod,
  renderStatistics,
  type StatisticsApi,
} from "../src/screens/statistics";
import type { TelegramWebApp } from "../src/lib/telegram";

function category(id: string, name: string, createdAt = "2026-01-01T00:00:00Z"): CategoryResponse {
  return { id, name, account_id: "acc-1", created_at: createdAt };
}

function tag(id: string, name: string): TagResponse {
  return { id, name, account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" };
}

const CATEGORIES: CategoryResponse[] = [
  category("cat-groceries", "Groceries", "2026-01-01T00:00:00Z"),
  category("cat-transport", "Transport", "2026-01-02T00:00:00Z"),
];
const TAGS: TagResponse[] = [tag("tag-vacation", "vacation"), tag("tag-work", "work")];

const MONTH_PERIOD: PeriodValue = { unit: "month", offset: 0 };
const NOW = new Date(2026, 0, 15); // January 15, 2026 (local)

const PERIOD_TOTAL: PeriodTotal = { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z", total: 30000 };
const CATEGORY_TOTALS: CategoryTotal[] = [
  { category_id: "cat-groceries", total: 20000 },
  { category_id: "cat-transport", total: 10000 },
];
const TAG_TOTALS: TagTotal[] = [
  { tag_id: "tag-vacation", total: 18000 },
  { tag_id: "tag-work", total: 6000 },
];
const BUDGET_FILLS: BudgetFill[] = [
  {
    budget_plan_id: "plan-groceries",
    category_id: "cat-groceries",
    amount: 20000,
    spent: 15000,
    remaining: 5000,
    fill_pct: 75,
    notify_threshold: 80,
    is_over_threshold: false,
    is_exceeded: false,
  },
  {
    budget_plan_id: "plan-transport",
    category_id: "cat-transport",
    amount: 10000,
    spent: 12000,
    remaining: -2000,
    fill_pct: 120,
    notify_threshold: 80,
    is_over_threshold: true,
    is_exceeded: true,
  },
];

// -- buildStatisticsData ------------------------------------------------------

describe("buildStatisticsData", () => {
  function build(overrides: Partial<Parameters<typeof buildStatisticsData>[0]> = {}) {
    return buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "category",
      ...overrides,
    });
  }

  it("sorts category bars descending with the leader at full width and every value printed", () => {
    const data = build();
    expect(data.categoryBars).toEqual([
      { id: "cat-groceries", label: "Groceries", colorVar: "var(--category-slot-1)", minor: 20000, widthPct: 100 },
      { id: "cat-transport", label: "Transport", colorVar: "var(--category-slot-2)", minor: 10000, widthPct: 50 },
    ]);
  });

  it("sorts tag bars descending with the leader at full width and no colour", () => {
    const data = build();
    expect(data.tagBars).toHaveLength(2);
    expect(data.tagBars[0]).toEqual({ id: "tag-vacation", label: "vacation", colorVar: null, minor: 18000, widthPct: 100 });
    expect(data.tagBars[1]).toMatchObject({ id: "tag-work", label: "work", colorVar: null, minor: 6000 });
    expect(data.tagBars[1].widthPct).toBeCloseTo(100 / 3);
  });

  it("drops zero-total rows from the ranked list", () => {
    const data = build({ categoryTotals: [...CATEGORY_TOTALS, { category_id: "cat-none", total: 0 }] });
    expect(data.categoryBars.map((b) => b.id)).toEqual(["cat-groceries", "cat-transport"]);
  });

  it("falls back to 'Unknown category'/'Unknown tag' for a stale id", () => {
    const data = build({
      categoryTotals: [{ category_id: "cat-deleted", total: 500 }],
      tagTotals: [{ tag_id: "tag-deleted", total: 500 }],
    });
    expect(data.categoryBars[0]).toMatchObject({ label: "Unknown category", colorVar: "var(--ink-secondary)" });
    expect(data.tagBars[0]).toMatchObject({ label: "Unknown tag", colorVar: null });
  });

  it("builds a donut segment per category from category totals, unaffected by grouping", () => {
    const data = build({ grouping: "tag" });
    expect(data.segments).toHaveLength(2);
    expect(data.segments[0]).toMatchObject({ categoryId: "cat-groceries", colorVar: "var(--category-slot-1)" });
    expect(data.totalMinor).toBe(30000);
  });

  it("carries period and grouping through untouched", () => {
    const period: PeriodValue = { unit: "year", offset: -2 };
    const data = build({ period, grouping: "tag" });
    expect(data.period).toEqual(period);
    expect(data.grouping).toBe("tag");
  });

  it("defaults to no budget rows when budgetFills is omitted", () => {
    const data = build();
    expect(data.budgetRows).toEqual([]);
  });

  it("maps budget fills to rows in category order, with an exceeded plan flagged", () => {
    const data = build({ budgetFills: BUDGET_FILLS, grouping: "budget" });
    expect(data.budgetRows).toEqual([
      {
        planId: "plan-groceries",
        categoryId: "cat-groceries",
        label: "Groceries",
        colorVar: "var(--category-slot-1)",
        amountMinor: 20000,
        spentMinor: 15000,
        remainingMinor: 5000,
        fillPct: 75,
        notifyThreshold: 80,
        isOverThreshold: false,
        isExceeded: false,
      },
      {
        planId: "plan-transport",
        categoryId: "cat-transport",
        label: "Transport",
        colorVar: "var(--category-slot-2)",
        amountMinor: 10000,
        spentMinor: 12000,
        remainingMinor: -2000,
        fillPct: 120,
        notifyThreshold: 80,
        isOverThreshold: true,
        isExceeded: true,
      },
    ]);
  });

  it("falls back to 'Unknown category' for a plan whose category is archived (D808)", () => {
    const data = build({
      budgetFills: [{ ...BUDGET_FILLS[0], category_id: "cat-archived" }],
    });
    expect(data.budgetRows).toEqual([
      expect.objectContaining({ label: "Unknown category", colorVar: "var(--ink-secondary)" }),
    ]);
  });
});

// -- loadStatistics ------------------------------------------------------------

function fakeApi(overrides: Partial<StatisticsApi> = {}): StatisticsApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR" }),
    listCategories: vi.fn().mockResolvedValue(CATEGORIES),
    listTags: vi.fn().mockResolvedValue(TAGS),
    statisticsByPeriod: vi.fn().mockResolvedValue(PERIOD_TOTAL),
    statisticsByCategory: vi.fn().mockResolvedValue(CATEGORY_TOTALS),
    statisticsByTag: vi.fn().mockResolvedValue(TAG_TOTALS),
    statisticsByBudget: vi.fn().mockResolvedValue(BUDGET_FILLS),
    ...overrides,
  };
}

const PERIOD_CASES: readonly PeriodValue[] = [
  { unit: "day", offset: 0 },
  { unit: "week", offset: -1 },
  { unit: "month", offset: 0 },
  { unit: "year", offset: -2 },
  { unit: "custom", offset: 0, start: "2026-07-09", end: "2026-07-17" },
];

describe("loadStatistics", () => {
  it("resolves ready from a successful fetch", async () => {
    const cache = createMemoryCache();
    const state = await loadStatistics(fakeApi(), cache, MONTH_PERIOD, "category");
    expect(state.status).toBe("ready");
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.categoryBars).toHaveLength(2);
    expect(state.tagBars).toHaveLength(2);
  });

  it("sends period/offset (or custom dates) and never months_back, for each of the five period units", async () => {
    for (const period of PERIOD_CASES) {
      const api = fakeApi();
      const cache = createMemoryCache();
      await loadStatistics(api, cache, period, "category");
      const query = toQuery(period);
      expect(api.statisticsByPeriod).toHaveBeenCalledWith(query);
      expect(api.statisticsByCategory).toHaveBeenCalledWith(query);
      expect(api.statisticsByTag).toHaveBeenCalledWith(query);
      expect(query).not.toHaveProperty("months_back");
    }
  });

  it("fetches both groupings' totals in one call, so a later grouping switch never needs a second fetch", async () => {
    const api = fakeApi();
    const cache = createMemoryCache();
    await loadStatistics(api, cache, MONTH_PERIOD, "category");
    expect(api.statisticsByCategory).toHaveBeenCalledTimes(1);
    expect(api.statisticsByTag).toHaveBeenCalledTimes(1);
  });

  it("fetches by-budget in the same load whenever the unit is month (D810)", async () => {
    const api = fakeApi();
    const cache = createMemoryCache();
    const state = await loadStatistics(api, cache, MONTH_PERIOD, "budget");
    expect(api.statisticsByBudget).toHaveBeenCalledWith(toQuery(MONTH_PERIOD));
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.budgetRows).toHaveLength(2);
  });

  it("never calls by-budget for a non-month unit, even under the budget grouping", async () => {
    for (const period of PERIOD_CASES.filter((p) => p.unit !== "month")) {
      const api = fakeApi();
      const cache = createMemoryCache();
      await loadStatistics(api, cache, period, "budget");
      expect(api.statisticsByBudget).not.toHaveBeenCalled();
    }
  });

  it("resolves empty when the period total is zero", async () => {
    const cache = createMemoryCache();
    const state = await loadStatistics(
      fakeApi({
        statisticsByPeriod: vi.fn().mockResolvedValue({ ...PERIOD_TOTAL, total: 0 }),
        statisticsByCategory: vi.fn().mockResolvedValue([]),
        statisticsByTag: vi.fn().mockResolvedValue([]),
      }),
      cache,
      MONTH_PERIOD,
      "category",
    );
    expect(state).toEqual({ status: "empty", period: MONTH_PERIOD, grouping: "category" });
  });

  it("resolves forbidden on a 403", async () => {
    const cache = createMemoryCache();
    const state = await loadStatistics(
      fakeApi({ statisticsByPeriod: vi.fn().mockRejectedValue(new ForbiddenError()) }),
      cache,
      MONTH_PERIOD,
      "category",
    );
    expect(state).toEqual({ status: "forbidden" });
  });

  it("resolves offline from the cache after a prior successful load", async () => {
    const cache = createMemoryCache();
    await loadStatistics(fakeApi(), cache, MONTH_PERIOD, "category");
    const state = await loadStatistics(
      fakeApi({ statisticsByPeriod: vi.fn().mockRejectedValue(new RetryableError()) }),
      cache,
      MONTH_PERIOD,
      "category",
    );
    expect(state.status).toBe("offline");
    if (state.status !== "offline") throw new Error("expected offline");
    expect(state.categoryBars).toHaveLength(2);
  });

  it("resolves error with a human message and no cache", async () => {
    const cache = createMemoryCache();
    const period: PeriodValue = { unit: "month", offset: -1 };
    const state = await loadStatistics(
      fakeApi({ statisticsByPeriod: vi.fn().mockRejectedValue(new RetryableError()) }),
      cache,
      period,
      "tag",
    );
    expect(state).toMatchObject({ status: "error", period, grouping: "tag" });
  });
});

// -- renderStatistics -----------------------------------------------------------

describe("renderStatistics", () => {
  it("renders zero-width bar-slot skeletons at loading, matching the ready layout", () => {
    const html = renderStatistics({ status: "loading", period: MONTH_PERIOD, grouping: "category" }, NOW);
    expect(html).toContain('data-testid="loading"');
    expect(html).toContain("stats-bar-skeleton");
    expect(html).not.toContain("stats-bar-fill");
  });

  it("prints every category bar's value and the leader at full width", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "category",
    });
    const html = renderStatistics({ status: "ready", ...data }, NOW);
    expect(html).toContain("200.00");
    expect(html).toContain("100.00");
    expect(html).toContain("width:100%");
    expect(html).toContain("width:50%");
  });

  it("renders the tag grouping's bars when grouping is tag", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "tag",
    });
    const html = renderStatistics({ status: "ready", ...data }, NOW);
    expect(html).toContain("vacation");
    expect(html).toContain("work");
    expect(html).not.toContain("Groceries");
  });

  it("renders no bar list for a single category (AC: no legend needed)", () => {
    const data = buildStatisticsData({
      categories: [CATEGORIES[0]],
      tags: TAGS,
      categoryTotals: [CATEGORY_TOTALS[0]],
      tagTotals: TAG_TOTALS,
      periodTotal: { ...PERIOD_TOTAL, total: 20000 },
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "category",
    });
    const html = renderStatistics({ status: "ready", ...data }, NOW);
    expect(html).not.toContain('data-testid="stats-bars"');
    expect(html).toContain('data-testid="donut"');
  });

  it("shows a grouping-specific empty note when the active grouping has no rows", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: [],
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "tag",
    });
    const html = renderStatistics({ status: "ready", ...data }, NOW);
    expect(html).toContain('data-testid="bars-empty"');
    expect(html).toContain("tagged");
  });

  it("renders two budget rows reading 'spent of limit', the exceeded one marked", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      budgetFills: BUDGET_FILLS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "budget",
    });
    const html = renderStatistics({ status: "ready", ...data }, NOW);
    expect(html).toContain('data-testid="grouping-budget"');
    expect(html).toContain(t("statistics.budget.of", { spent: "150.00", limit: "200.00" }));
    expect(html).toContain(t("statistics.budget.of", { spent: "120.00", limit: "100.00" }));
    expect(html).toContain(t("statistics.budget.exceeded", { amount: "20.00" }));
    expect((html.match(/data-testid="budget-row"/g) ?? []).length).toBe(2);
  });

  it("shows 'No budgets set.' for the Budgets grouping with zero plans", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      budgetFills: [],
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "budget",
    });
    const html = renderStatistics({ status: "ready", ...data }, NOW);
    expect(html).toContain('data-testid="bars-empty"');
    expect(html).toContain(t("statistics.bars.emptyBudget"));
  });

  it("renders the empty-period state with the grouping toggle still reachable", () => {
    const html = renderStatistics({ status: "empty", period: MONTH_PERIOD, grouping: "category" }, NOW);
    expect(html).toContain('data-testid="empty"');
    expect(html).toContain('data-testid="grouping-toggle"');
  });

  it("renders a retry affordance on error, never a raw status code", () => {
    const html = renderStatistics(
      {
        status: "error",
        message: "The server is unreachable right now. Please try again.",
        period: MONTH_PERIOD,
        grouping: "category",
      },
      NOW,
    );
    expect(html).toContain('data-action="retry"');
    expect(html).not.toMatch(/\b[45]\d\d\b/);
  });

  it("renders a read-only message on forbidden", () => {
    const html = renderStatistics({ status: "forbidden" }, NOW);
    expect(html).toContain('data-testid="forbidden"');
  });

  it("shows the offline banner with the last-synced marker", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "category",
    });
    const html = renderStatistics(
      { status: "offline", lastSyncedAt: "2026-01-05T10:00:00.000Z", ...data },
      NOW,
    );
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-01-05T10:00:00.000Z");
  });

  // -- period selector (U2.2) -------------------------------------------------

  it("renders the five period tabs in order, with the current unit active", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "category",
    });
    const html = renderStatistics({ status: "ready", ...data }, NOW);
    const order = ["day", "week", "month", "year", "custom"];
    const positions = order.map((unit) => html.indexOf(`data-testid="period-tab-${unit}"`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(html).toMatch(/period-tab active"[^>]*data-unit="month"/);
  });

  it("clamps the next-period arrow at offset 0 for every live state", () => {
    const nextArrowDisabled = /data-action="next"[^>]*aria-disabled="true"[^>]*data-testid="period-arrow-next"/;
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "category",
    });

    const empty = renderStatistics({ status: "empty", period: MONTH_PERIOD, grouping: "category" }, NOW);
    expect(empty).toMatch(nextArrowDisabled);

    const error = renderStatistics(
      { status: "error", message: "Offline.", period: MONTH_PERIOD, grouping: "category" },
      NOW,
    );
    expect(error).toMatch(nextArrowDisabled);

    const ready = renderStatistics({ status: "ready", ...data }, NOW);
    expect(ready).toMatch(nextArrowDisabled);

    const offline = renderStatistics({ status: "offline", lastSyncedAt: "2026-01-05T10:00:00.000Z", ...data }, NOW);
    expect(offline).toMatch(nextArrowDisabled);
  });

  it("does not disable the period selector while offline, unlike Home", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "category",
    });
    const html = renderStatistics({ status: "offline", lastSyncedAt: "2026-01-05T10:00:00.000Z", ...data }, NOW);
    expect(html).toMatch(/class="period-selector"[^>]*data-testid="period-selector"/);
    expect(html).not.toContain('class="period-selector disabled"');
  });

  it("keeps the period selector bare — no card wrapper around region 2", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "category",
    });
    const html = renderStatistics({ status: "ready", ...data }, NOW);
    expect(html).not.toContain('class="chart-card"');
  });
});

// -- applyStatisticsChrome -----------------------------------------------------

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

describe("applyStatisticsChrome", () => {
  it("wires BackButton and always hides MainButton (no MainButton named for this screen)", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onBack = vi.fn();
    applyStatisticsChrome(onBack);
    expect(webApp.BackButton.onClick).toHaveBeenCalled();
    expect(webApp.MainButton.hide).toHaveBeenCalled();
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
    expect(pickerValueForPeriod(MONTH_PERIOD)).toEqual({});
    expect(pickerValueForPeriod({ unit: "day", offset: -3 })).toEqual({});
  });
});

// -- i18n (U3.10) --------------------------------------------------------

describe("renders in Russian", () => {
  afterEach(() => setLanguage("en"));

  it("translates the grouping toggle, forbidden and empty-period copy", () => {
    setLanguage("ru");
    const forbidden = renderStatistics({ status: "forbidden" }, NOW);
    expect(forbidden).toContain(t("statistics.forbidden"));

    const empty = renderStatistics({ status: "empty", period: MONTH_PERIOD, grouping: "tag" }, NOW);
    expect(empty).toContain(t("statistics.byCategory"));
    expect(empty).toContain(t("statistics.byTag"));
    expect(empty).toContain(t("statistics.emptyPeriod"));
  });

  it("translates the unknown-category/-tag fallback labels and the empty-bars notes", () => {
    setLanguage("ru");
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: [{ category_id: "cat-deleted", total: 500 }],
      tagTotals: [],
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "tag",
    });
    expect(data.categoryBars[0]).toMatchObject({ label: t("statistics.unknownCategory") });

    const html = renderStatistics({ status: "ready", ...data }, NOW);
    expect(html).toContain(t("statistics.bars.emptyTag"));
  });

  it("translates the offline banner and the retry error copy", () => {
    setLanguage("ru");
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      period: MONTH_PERIOD,
      grouping: "category",
    });
    const offline = renderStatistics({ status: "offline", lastSyncedAt: "2026-01-15T09:00:00.000Z", ...data }, NOW);
    expect(offline).toContain(t("offline.banner", { time: "2026-01-15T09:00:00.000Z" }));

    const error = renderStatistics({ status: "error", message: "boom", period: MONTH_PERIOD, grouping: "category" }, NOW);
    expect(error).toContain(t("error.retry"));
  });
});
