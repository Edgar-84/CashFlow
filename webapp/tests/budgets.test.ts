import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type { BudgetPlanResponse, BudgetProgress, CategoryResponse } from "../src/api/types";
import {
  applyBudgetsChrome,
  buildBudgetsData,
  createMemoryCache,
  loadBudgets,
  nextUnbudgeted,
  renderBudgets,
  renderBudgetsView,
  type BudgetsApi,
  type BudgetsCache,
} from "../src/screens/budgets";
import type { TelegramWebApp } from "../src/lib/telegram";

function category(id: string, name: string, createdAt = "2026-01-01T00:00:00Z"): CategoryResponse {
  return { id, name, account_id: "acc-1", created_at: createdAt };
}

function plan(overrides: Partial<BudgetPlanResponse> = {}): BudgetPlanResponse {
  return {
    id: "plan-groceries",
    category_id: "cat-groceries",
    amount: 20000,
    period: "monthly",
    notify_threshold: 80,
    account_id: "acc-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function progress(overrides: Partial<BudgetProgress> = {}): BudgetProgress {
  return {
    budget_plan_id: "plan-groceries",
    category_id: "cat-groceries",
    amount: 20000,
    spent: 10000,
    remaining: 10000,
    fill_pct: 50,
    notify_threshold: 80,
    is_over_threshold: false,
    is_exceeded: false,
    ...overrides,
  };
}

const CATEGORIES: CategoryResponse[] = [
  category("cat-groceries", "Groceries", "2026-01-01T00:00:00Z"),
  category("cat-transport", "Transport", "2026-01-02T00:00:00Z"),
];

// -- buildBudgetsData --------------------------------------------------------

describe("buildBudgetsData", () => {
  it("splits categories into budgeted (with progress) and unbudgeted rows", () => {
    const data = buildBudgetsData({
      categories: CATEGORIES,
      plans: [plan()],
      progress: [progress()],
      currency: "EUR",
    });
    expect(data.budgeted).toHaveLength(1);
    expect(data.budgeted[0]).toMatchObject({
      planId: "plan-groceries",
      categoryId: "cat-groceries",
      label: "Groceries",
      colorVar: "var(--category-slot-1)",
      amountMinor: 20000,
      spentMinor: 10000,
      fillPct: 50,
      notifyThreshold: 80,
    });
    expect(data.unbudgeted).toEqual([
      { categoryId: "cat-transport", label: "Transport", colorVar: "var(--category-slot-2)" },
    ]);
  });

  it("falls back to 'Unknown category' and the neutral colour for a stale/deleted category id", () => {
    const staleplan = plan({ id: "plan-stale", category_id: "cat-deleted" });
    const data = buildBudgetsData({
      categories: CATEGORIES,
      plans: [staleplan],
      progress: [progress({ budget_plan_id: "plan-stale", category_id: "cat-deleted" })],
      currency: "EUR",
    });
    expect(data.budgeted).toHaveLength(1);
    expect(data.budgeted[0]).toMatchObject({ label: "Unknown category", colorVar: "var(--ink-secondary)" });
    expect(data.unbudgeted).toEqual([
      { categoryId: "cat-groceries", label: "Groceries", colorVar: "var(--category-slot-1)" },
      { categoryId: "cat-transport", label: "Transport", colorVar: "var(--category-slot-2)" },
    ]);
  });

  it("lists every category as unbudgeted when there are no plans", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "USD" });
    expect(data.budgeted).toEqual([]);
    expect(data.unbudgeted).toHaveLength(2);
  });

  it("skips a plan whose progress fetch is missing rather than crashing", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [], currency: "EUR" });
    expect(data.budgeted).toEqual([]);
  });
});

// -- loadBudgets --------------------------------------------------------------

function fakeApi(overrides: Partial<BudgetsApi> = {}): BudgetsApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR" }),
    listCategories: vi.fn().mockResolvedValue(CATEGORIES),
    listBudgetPlans: vi.fn().mockResolvedValue([plan()]),
    getBudgetPlanProgress: vi.fn().mockResolvedValue(progress()),
    ...overrides,
  };
}

describe("loadBudgets", () => {
  it("resolves ready from a successful fetch", async () => {
    const cache = createMemoryCache();
    const state = await loadBudgets(fakeApi(), cache);
    expect(state.status).toBe("ready");
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.budgeted).toHaveLength(1);
    expect(state.unbudgeted).toHaveLength(1);
  });

  it("resolves empty when the account has no categories at all", async () => {
    const cache = createMemoryCache();
    const state = await loadBudgets(fakeApi({ listCategories: vi.fn().mockResolvedValue([]) }), cache);
    expect(state).toEqual({ status: "empty" });
  });

  it("resolves forbidden on a 403", async () => {
    const cache = createMemoryCache();
    const state = await loadBudgets(
      fakeApi({ getMe: vi.fn().mockRejectedValue(new ForbiddenError()) }),
      cache,
    );
    expect(state).toEqual({ status: "forbidden" });
  });

  it("resolves error with no cache and a network failure", async () => {
    const cache = createMemoryCache();
    const state = await loadBudgets(
      fakeApi({ getMe: vi.fn().mockRejectedValue(new RetryableError()) }),
      cache,
    );
    expect(state.status).toBe("error");
  });

  it("falls back to a cached snapshot as offline on a later failure", async () => {
    const cache: BudgetsCache = createMemoryCache();
    const okApi = fakeApi();
    const first = await loadBudgets(okApi, cache);
    expect(first.status).toBe("ready");

    const failingApi = fakeApi({ getMe: vi.fn().mockRejectedValue(new RetryableError()) });
    const second = await loadBudgets(failingApi, cache);
    expect(second.status).toBe("offline");
    if (second.status !== "offline") throw new Error("expected offline");
    expect(second.budgeted).toHaveLength(1);
  });
});

// -- nextUnbudgeted -----------------------------------------------------------

describe("nextUnbudgeted", () => {
  it("returns the first unbudgeted row in creation order", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    expect(nextUnbudgeted(data)).toEqual({ categoryId: "cat-groceries", label: "Groceries", colorVar: "var(--category-slot-1)" });
  });

  it("returns null once every category has a plan", () => {
    const data = buildBudgetsData({
      categories: CATEGORIES,
      plans: [plan(), plan({ id: "plan-transport", category_id: "cat-transport" })],
      progress: [progress(), progress({ budget_plan_id: "plan-transport", category_id: "cat-transport" })],
      currency: "EUR",
    });
    expect(nextUnbudgeted(data)).toBeNull();
  });
});

// -- renderBudgets / renderBudgetsView -----------------------------------------

describe("renderBudgets", () => {
  it("renders the loading skeleton", () => {
    expect(renderBudgets({ status: "loading" })).toContain('data-testid="loading"');
  });

  it("renders the error state with a retry affordance", () => {
    const html = renderBudgets({ status: "error", message: "Backend unreachable" });
    expect(html).toContain("Backend unreachable");
    expect(html).toContain('data-action="retry"');
  });

  it("renders the forbidden state", () => {
    expect(renderBudgets({ status: "forbidden" })).toContain("don't have permission");
  });

  it("renders the empty (no categories) state", () => {
    expect(renderBudgets({ status: "empty" })).toContain("Add a category first");
  });

  it("renders 'no budgets yet' plus the unbudgeted invitations when there are no plans", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const html = renderBudgets({ status: "ready", ...data });
    expect(html).toContain('data-testid="no-budgets"');
    expect(html).toContain("No budgets yet");
    expect(html).toContain('data-testid="budget-invite"');
    expect(html).toContain("Groceries");
    expect(html).toContain("Transport");
  });

  it("renders a budgeted row with the amount, bar fill and threshold tick", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [progress()], currency: "EUR" });
    const html = renderBudgets({ status: "ready", ...data });
    expect(html).toContain('data-plan-id="plan-groceries"');
    expect(html).toContain("100.00 / 200.00 EUR");
    expect(html).toContain('style="width:50%;background:var(--category-slot-1)"');
    expect(html).toContain('style="left:80%"');
  });

  it("renders the exceeded state with an icon, text, and the status-red class (not colour alone)", () => {
    const data = buildBudgetsData({
      categories: CATEGORIES,
      plans: [plan()],
      progress: [progress({ spent: 25000, remaining: -5000, fill_pct: 125, is_over_threshold: true, is_exceeded: true })],
      currency: "EUR",
    });
    const html = renderBudgets({ status: "ready", ...data });
    expect(html).toContain("budget-status--over");
    expect(html).toContain("⚠ Over by 50.00 EUR");
  });

  it("renders the past-threshold-but-not-exceeded state distinctly from exceeded", () => {
    const data = buildBudgetsData({
      categories: CATEGORIES,
      plans: [plan()],
      progress: [progress({ spent: 17000, fill_pct: 85, is_over_threshold: true, is_exceeded: false })],
      currency: "EUR",
    });
    const html = renderBudgets({ status: "ready", ...data });
    expect(html).toContain("budget-status--warn");
    expect(html).toContain("Approaching limit");
    expect(html).not.toContain("budget-status--over");
  });

  it("renders the offline banner with the last-synced marker", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [progress()], currency: "EUR" });
    const html = renderBudgets({ status: "offline", lastSyncedAt: "2026-08-02T09:00:00Z", ...data });
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-08-02T09:00:00Z");
  });

  it("never renders a form inside the Budgets screen — no budget-form/amountDraft/spentKnown leaks out of the deleted inline form", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [progress()], currency: "EUR" });
    const html = renderBudgetsView(data);
    expect(html).not.toContain("budget-form");
    expect(html).not.toContain('data-action="save-budget"');
    expect(html).not.toContain('data-action="cancel-budget"');
    expect(html).not.toContain('data-action="delete-budget"');
  });
});

// -- applyBudgetsChrome ---------------------------------------------------------

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

describe("applyBudgetsChrome", () => {
  it("wires BackButton and shows a contextual MainButton for the next unbudgeted category", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [progress()], currency: "EUR" });
    const onBack = vi.fn();
    applyBudgetsChrome({ status: "ready", ...data }, onBack);
    expect(webApp.BackButton.onClick).toHaveBeenCalled();
    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Set budget for Transport");
    expect(webApp.MainButton.show).toHaveBeenCalled();
  });

  it("hides MainButton once every category has a plan", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const data = buildBudgetsData({
      categories: CATEGORIES,
      plans: [plan(), plan({ id: "plan-transport", category_id: "cat-transport" })],
      progress: [progress(), progress({ budget_plan_id: "plan-transport", category_id: "cat-transport" })],
      currency: "EUR",
    });
    applyBudgetsChrome({ status: "ready", ...data }, vi.fn());
    expect(webApp.MainButton.hide).toHaveBeenCalled();
  });

  it("hides MainButton while loading", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    applyBudgetsChrome({ status: "loading" }, vi.fn());
    expect(webApp.MainButton.hide).toHaveBeenCalled();
  });

  it("invokes onMainButtonTap with the next unbudgeted row and the screen's currency when MainButton is tapped", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const onTap = vi.fn();
    applyBudgetsChrome({ status: "ready", ...data }, vi.fn(), onTap);
    const handler = (webApp.MainButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    expect(onTap).toHaveBeenCalledWith(
      { categoryId: "cat-groceries", label: "Groceries", colorVar: "var(--category-slot-1)" },
      "EUR",
    );
  });
});
