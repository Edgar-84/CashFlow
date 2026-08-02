import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type { CategoryResponse, CategoryTotal, PeriodTotal, TagResponse, TagTotal } from "../src/api/types";
import {
  applyStatisticsChrome,
  buildStatisticsData,
  createMemoryCache,
  loadStatistics,
  PERIOD_PRESETS,
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

const PERIOD_TOTAL: PeriodTotal = { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z", total: 30000 };
const CATEGORY_TOTALS: CategoryTotal[] = [
  { category_id: "cat-groceries", total: 20000 },
  { category_id: "cat-transport", total: 10000 },
];
const TAG_TOTALS: TagTotal[] = [
  { tag_id: "tag-vacation", total: 18000 },
  { tag_id: "tag-work", total: 6000 },
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
      monthsBack: 0,
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

  it("carries monthsBack and grouping through untouched", () => {
    const data = build({ monthsBack: 2, grouping: "tag" });
    expect(data.monthsBack).toBe(2);
    expect(data.grouping).toBe("tag");
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
    ...overrides,
  };
}

describe("loadStatistics", () => {
  it("resolves ready from a successful fetch", async () => {
    const cache = createMemoryCache();
    const state = await loadStatistics(fakeApi(), cache, 0, "category");
    expect(state.status).toBe("ready");
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.categoryBars).toHaveLength(2);
    expect(state.tagBars).toHaveLength(2);
  });

  it("sends months_back and nothing else to each statistics endpoint, for every preset", async () => {
    for (const preset of PERIOD_PRESETS) {
      const api = fakeApi();
      const cache = createMemoryCache();
      await loadStatistics(api, cache, preset.monthsBack, "category");
      expect(api.statisticsByPeriod).toHaveBeenCalledWith({ months_back: preset.monthsBack });
      expect(api.statisticsByCategory).toHaveBeenCalledWith({ months_back: preset.monthsBack });
      expect(api.statisticsByTag).toHaveBeenCalledWith({ months_back: preset.monthsBack });
    }
  });

  it("fetches both groupings' totals in one call, so a later grouping switch never needs a second fetch", async () => {
    const api = fakeApi();
    const cache = createMemoryCache();
    await loadStatistics(api, cache, 0, "category");
    expect(api.statisticsByCategory).toHaveBeenCalledTimes(1);
    expect(api.statisticsByTag).toHaveBeenCalledTimes(1);
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
      0,
      "category",
    );
    expect(state).toEqual({ status: "empty", monthsBack: 0, grouping: "category" });
  });

  it("resolves forbidden on a 403", async () => {
    const cache = createMemoryCache();
    const state = await loadStatistics(
      fakeApi({ statisticsByPeriod: vi.fn().mockRejectedValue(new ForbiddenError()) }),
      cache,
      0,
      "category",
    );
    expect(state).toEqual({ status: "forbidden" });
  });

  it("resolves offline from the cache after a prior successful load", async () => {
    const cache = createMemoryCache();
    await loadStatistics(fakeApi(), cache, 0, "category");
    const state = await loadStatistics(
      fakeApi({ statisticsByPeriod: vi.fn().mockRejectedValue(new RetryableError()) }),
      cache,
      0,
      "category",
    );
    expect(state.status).toBe("offline");
    if (state.status !== "offline") throw new Error("expected offline");
    expect(state.categoryBars).toHaveLength(2);
  });

  it("resolves error with a human message and no cache", async () => {
    const cache = createMemoryCache();
    const state = await loadStatistics(
      fakeApi({ statisticsByPeriod: vi.fn().mockRejectedValue(new RetryableError()) }),
      cache,
      1,
      "tag",
    );
    expect(state).toMatchObject({ status: "error", monthsBack: 1, grouping: "tag" });
  });
});

// -- renderStatistics -----------------------------------------------------------

describe("renderStatistics", () => {
  it("renders zero-width bar-slot skeletons at loading, matching the ready layout", () => {
    const html = renderStatistics({ status: "loading", monthsBack: 0, grouping: "category" });
    expect(html).toContain('data-testid="loading"');
    expect(html).toContain("stats-bar-skeleton");
    expect(html).not.toContain("stats-bar-fill");
  });

  it("marks the active preset chip", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      monthsBack: 1,
      grouping: "category",
    });
    const html = renderStatistics({ status: "ready", ...data });
    expect(html).toMatch(/class="chip active"[^>]*data-preset="1"/);
    expect(html).toContain('data-preset="0">This month');
  });

  it("prints every category bar's value and the leader at full width", () => {
    const data = buildStatisticsData({
      categories: CATEGORIES,
      tags: TAGS,
      categoryTotals: CATEGORY_TOTALS,
      tagTotals: TAG_TOTALS,
      periodTotal: PERIOD_TOTAL,
      currency: "EUR",
      monthsBack: 0,
      grouping: "category",
    });
    const html = renderStatistics({ status: "ready", ...data });
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
      monthsBack: 0,
      grouping: "tag",
    });
    const html = renderStatistics({ status: "ready", ...data });
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
      monthsBack: 0,
      grouping: "category",
    });
    const html = renderStatistics({ status: "ready", ...data });
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
      monthsBack: 0,
      grouping: "tag",
    });
    const html = renderStatistics({ status: "ready", ...data });
    expect(html).toContain('data-testid="bars-empty"');
    expect(html).toContain("tagged");
  });

  it("renders the empty-period state with presets and grouping toggle still reachable", () => {
    const html = renderStatistics({ status: "empty", monthsBack: 0, grouping: "category" });
    expect(html).toContain('data-testid="empty"');
    expect(html).toContain('data-testid="period-presets"');
    expect(html).toContain('data-testid="grouping-toggle"');
  });

  it("renders a retry affordance on error, never a raw status code", () => {
    const html = renderStatistics({ status: "error", message: "The server is unreachable right now. Please try again.", monthsBack: 0, grouping: "category" });
    expect(html).toContain('data-action="retry"');
    expect(html).not.toMatch(/\b[45]\d\d\b/);
  });

  it("renders a read-only message on forbidden", () => {
    const html = renderStatistics({ status: "forbidden" });
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
      monthsBack: 0,
      grouping: "category",
    });
    const html = renderStatistics({ status: "offline", lastSyncedAt: "2026-01-05T10:00:00.000Z", ...data });
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-01-05T10:00:00.000Z");
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
