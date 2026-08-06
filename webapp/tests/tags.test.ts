import { describe, expect, it, vi } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type { TagResponse, TagTotal } from "../src/api/types";
import {
  applyTagsChrome,
  buildTagsData,
  createMemoryCache,
  loadTags,
  renderTags,
  renderTagsView,
  type TagsApi,
  type TagsCache,
} from "../src/screens/tags";
import type { TelegramWebApp } from "../src/lib/telegram";

function tag(id: string, name: string, overrides: Partial<TagResponse> = {}): TagResponse {
  return {
    id,
    name,
    account_id: "acc-1",
    created_at: "2026-01-01T00:00:00Z",
    is_active: true,
    expense_count: 0,
    ...overrides,
  };
}

function total(tagId: string, minor: number): TagTotal {
  return { tag_id: tagId, total: minor };
}

const TAGS: TagResponse[] = [
  tag("tag-vacation", "vacation", { created_at: "2026-01-01T00:00:00Z", expense_count: 12 }),
  tag("tag-work", "work", { created_at: "2026-01-02T00:00:00Z", expense_count: 5 }),
];

// -- buildTagsData ------------------------------------------------------

describe("buildTagsData", () => {
  it("builds active rows with expense count and this-month total", () => {
    const data = buildTagsData({
      tags: TAGS,
      monthTotals: [total("tag-vacation", 34000), total("tag-work", 8000)],
      currency: "EUR",
    });
    expect(data.active).toEqual([
      { id: "tag-vacation", name: "vacation", expenseCount: 12, monthTotalMinor: 34000 },
      { id: "tag-work", name: "work", expenseCount: 5, monthTotalMinor: 8000 },
    ]);
    expect(data.archived).toEqual([]);
  });

  it("defaults a tag absent from the by-tag response to a 0 month total, not an error", () => {
    const data = buildTagsData({
      tags: TAGS,
      monthTotals: [total("tag-vacation", 34000)], // work has no expenses this month
      currency: "EUR",
    });
    expect(data.active.find((r) => r.id === "tag-work")).toMatchObject({ monthTotalMinor: 0, expenseCount: 5 });
  });

  it("renders an unused tag's count as a plain 0, not an error", () => {
    const unused = [tag("tag-unused", "unused", { expense_count: 0 })];
    const data = buildTagsData({ tags: unused, monthTotals: [], currency: "EUR" });
    expect(data.active[0]).toMatchObject({ expenseCount: 0, monthTotalMinor: 0 });
  });

  it("splits archived tags (is_active: false) into their own list", () => {
    const withArchived = [
      ...TAGS,
      tag("tag-old", "old", { created_at: "2026-01-03T00:00:00Z", is_active: false, expense_count: 3 }),
    ];
    const data = buildTagsData({ tags: withArchived, monthTotals: [], currency: "EUR" });
    expect(data.active).toHaveLength(2);
    expect(data.archived).toEqual([{ id: "tag-old", name: "old", expenseCount: 3, monthTotalMinor: 0 }]);
  });

  it("orders rows by created_at ASC", () => {
    const shuffled = [TAGS[1], TAGS[0]];
    const data = buildTagsData({ tags: shuffled, monthTotals: [], currency: "EUR" });
    expect(data.active.map((r) => r.id)).toEqual(["tag-vacation", "tag-work"]);
  });
});

// -- loadTags ------------------------------------------------------------

function fakeApi(overrides: Partial<TagsApi> = {}): TagsApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR" }),
    listTags: vi.fn().mockResolvedValue(TAGS),
    statisticsByTag: vi.fn().mockResolvedValue([total("tag-vacation", 34000), total("tag-work", 8000)]),
    ...overrides,
  };
}

describe("loadTags", () => {
  it("resolves ready from a successful fetch, requesting usage and archived rows", async () => {
    const cache = createMemoryCache();
    const api = fakeApi();
    const state = await loadTags(api, cache);
    expect(state.status).toBe("ready");
    expect(api.listTags).toHaveBeenCalledWith({ includeUsage: true, includeArchived: true });
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.active).toHaveLength(2);
  });

  it("resolves forbidden on a 403", async () => {
    const cache = createMemoryCache();
    const state = await loadTags(fakeApi({ getMe: vi.fn().mockRejectedValue(new ForbiddenError()) }), cache);
    expect(state).toEqual({ status: "forbidden" });
  });

  it("resolves error with no cache on a network failure", async () => {
    const cache = createMemoryCache();
    const state = await loadTags(fakeApi({ getMe: vi.fn().mockRejectedValue(new RetryableError()) }), cache);
    expect(state.status).toBe("error");
  });

  it("falls back to a cached snapshot as offline on a later failure", async () => {
    const cache: TagsCache = createMemoryCache();
    const first = await loadTags(fakeApi(), cache);
    expect(first.status).toBe("ready");

    const failingApi = fakeApi({ getMe: vi.fn().mockRejectedValue(new RetryableError()) });
    const second = await loadTags(failingApi, cache);
    expect(second.status).toBe("offline");
    if (second.status !== "offline") throw new Error("expected offline");
    expect(second.active).toHaveLength(2);
  });
});

// -- renderTags / renderTagsView ------------------------------------------

describe("renderTags", () => {
  it("renders 6 skeleton rows while loading", () => {
    const html = renderTags({ status: "loading" });
    expect(html).toContain('data-testid="loading"');
    expect(html.match(/tag-row-skeleton/g)).toHaveLength(6);
  });

  it("renders the error state with a retry affordance", () => {
    const html = renderTags({ status: "error", message: "Backend unreachable" });
    expect(html).toContain("Backend unreachable");
    expect(html).toContain('data-action="retry"');
  });

  it("renders the read-only message on forbidden, with no Add-tag row", () => {
    const html = renderTags({ status: "forbidden" });
    expect(html).toContain("read-only access");
    expect(html).not.toContain('data-testid="tag-row-add"');
  });

  it("renders every active tag as a row plus the Add-tag row", () => {
    const data = buildTagsData({
      tags: TAGS,
      monthTotals: [total("tag-vacation", 34000), total("tag-work", 8000)],
      currency: "EUR",
    });
    const html = renderTags({ status: "ready", ...data });
    expect(html.match(/data-testid="tag-row"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="tag-row-add"');
    expect(html).toContain("vacation");
    expect(html).toContain("12 · 340.00");
    expect(html).toContain("work");
    expect(html).toContain("5 · 80.00");
  });

  it("gives each active row an aria-label with the name, count and this-month total, and hides the visual spans from AT", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [total("tag-vacation", 34000)], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).toContain('aria-label="vacation, 12 expenses, 340.00 this month"');
    expect(html).toContain('aria-label="work, 5 expenses, 0.00 this month"');
    expect(html).toContain('class="nm" aria-hidden="true"');
    expect(html).toContain('class="tag-row-caption" aria-hidden="true"');
  });

  it("uses singular 'expense' in the aria-label for a count of exactly 1", () => {
    const one = [tag("tag-one", "solo", { expense_count: 1 })];
    const data = buildTagsData({ tags: one, monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).toContain('aria-label="solo, 1 expense, 0.00 this month"');
    expect(html).not.toContain("1 expenses");
  });

  it("shows empty.explain plus the Add-tag row when there are zero active tags", () => {
    const data = buildTagsData({ tags: [], monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).toContain("Tags cut across categories");
    expect(html).toContain('data-testid="tag-row-add"');
  });

  it("omits the empty-explain note once at least one tag is active", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).not.toContain("Tags cut across categories");
  });

  it("omits the archived section entirely when nothing is archived", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).not.toContain('data-testid="tag-archived"');
  });

  it("shows a collapsed archived header without the explanation or rows by default", () => {
    const withArchived = [...TAGS, tag("tag-old", "old", { is_active: false, expense_count: 3 })];
    const data = buildTagsData({ tags: withArchived, monthTotals: [], currency: "EUR" });
    const html = renderTagsView({ data, archivedExpanded: false });
    expect(html).toContain("Archived (1)");
    expect(html).not.toContain("keep their history");
    expect(html).not.toContain('data-testid="tag-archived-row"');
  });

  it("expands to show the explanation and archived rows", () => {
    const withArchived = [...TAGS, tag("tag-old", "old", { is_active: false, expense_count: 3 })];
    const data = buildTagsData({ tags: withArchived, monthTotals: [], currency: "EUR" });
    const html = renderTagsView({ data, archivedExpanded: true });
    expect(html).toContain("keep their history");
    expect(html).toContain('data-testid="tag-archived-row"');
    expect(html).toContain("old");
  });

  it("renders the archived toggle with aria-expanded reflecting its state", () => {
    const withArchived = [...TAGS, tag("tag-old", "old", { is_active: false, expense_count: 3 })];
    const data = buildTagsData({ tags: withArchived, monthTotals: [], currency: "EUR" });
    expect(renderTagsView({ data, archivedExpanded: false })).toContain('aria-expanded="false"');
    expect(renderTagsView({ data, archivedExpanded: true })).toContain('aria-expanded="true"');
  });

  it("makes an archived row focusable (role=button, tabindex=0) with its own aria-label, since it's still a stub the user can tab to", () => {
    const withArchived = [...TAGS, tag("tag-old", "old", { is_active: false, expense_count: 3 })];
    const data = buildTagsData({ tags: withArchived, monthTotals: [], currency: "EUR" });
    const html = renderTagsView({ data, archivedExpanded: true });
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="old, 3 expenses, 0.00 this month"');
  });

  it("renders the offline banner with the last-synced marker", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "offline", lastSyncedAt: "2026-08-02T09:00:00Z", ...data });
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-08-02T09:00:00Z");
  });
});

// -- applyTagsChrome -------------------------------------------------------

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

describe("applyTagsChrome", () => {
  it("wires BackButton and hides MainButton (the Add-tag row is the add affordance, not MainButton)", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onBack = vi.fn();
    applyTagsChrome(onBack);
    expect(webApp.BackButton.onClick).toHaveBeenCalled();
    expect(webApp.BackButton.show).toHaveBeenCalled();
    expect(webApp.MainButton.hide).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });
});
