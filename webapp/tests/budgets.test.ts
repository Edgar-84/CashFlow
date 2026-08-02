import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError, ForbiddenError, NotFoundError, RetryableError } from "../src/api/client";
import type { BudgetPlanResponse, BudgetProgress, CategoryResponse } from "../src/api/types";
import {
  amountFieldError,
  applyBudgetsChrome,
  budgetFormValid,
  buildBudgetsData,
  createBudgetsController,
  createMemoryCache,
  DEFAULT_NOTIFY_THRESHOLD,
  loadBudgets,
  nextUnbudgeted,
  renderBudgets,
  renderBudgetsView,
  thresholdFieldError,
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
    createBudgetPlan: vi.fn(),
    updateBudgetPlan: vi.fn(),
    deleteBudgetPlan: vi.fn(),
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

// -- amountFieldError / thresholdFieldError / budgetFormValid ----------------

describe("amountFieldError", () => {
  it("is null while untouched and for a valid amount", () => {
    expect(amountFieldError("")).toBeNull();
    expect(amountFieldError("50.00")).toBeNull();
  });

  it("flags a non-positive or unparsable amount", () => {
    expect(amountFieldError("0")).not.toBeNull();
    expect(amountFieldError("abc")).not.toBeNull();
  });
});

describe("thresholdFieldError", () => {
  it("is null while untouched and for 0-100", () => {
    expect(thresholdFieldError("")).toBeNull();
    expect(thresholdFieldError("0")).toBeNull();
    expect(thresholdFieldError("80")).toBeNull();
    expect(thresholdFieldError("100")).toBeNull();
  });

  it("flags out-of-range or non-integer input", () => {
    expect(thresholdFieldError("101")).not.toBeNull();
    expect(thresholdFieldError("-1")).not.toBeNull();
    expect(thresholdFieldError("abc")).not.toBeNull();
    expect(thresholdFieldError("50.5")).not.toBeNull();
  });
});

describe("budgetFormValid", () => {
  it("requires both a valid amount and a valid, non-empty threshold", () => {
    expect(budgetFormValid("50.00", "80")).toBe(true);
    expect(budgetFormValid("0", "80")).toBe(false);
    expect(budgetFormValid("50.00", "")).toBe(false);
    expect(budgetFormValid("50.00", "101")).toBe(false);
  });
});

// -- createBudgetsController ---------------------------------------------------

describe("createBudgetsController", () => {
  it("startCreate populates the draft from the unbudgeted category and defaults the threshold", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const controller = createBudgetsController(fakeApi(), data);
    controller.startCreate("cat-transport");
    const state = controller.getState();
    expect(state.edit).toEqual({
      kind: "create",
      categoryId: "cat-transport",
      categoryLabel: "Transport",
      colorVar: "var(--category-slot-2)",
    });
    expect(state.amountDraft).toBe("");
    expect(state.thresholdDraft).toBe(String(DEFAULT_NOTIFY_THRESHOLD));
  });

  it("startEdit populates the draft from the existing plan's amount/threshold", () => {
    const data = buildBudgetsData({
      categories: CATEGORIES,
      plans: [plan({ amount: 12345, notify_threshold: 65 })],
      progress: [progress({ amount: 12345, notify_threshold: 65 })],
      currency: "EUR",
    });
    const controller = createBudgetsController(fakeApi(), data);
    controller.startEdit("plan-groceries");
    const state = controller.getState();
    expect(state.edit).toEqual({ kind: "edit", planId: "plan-groceries" });
    expect(state.amountDraft).toBe("123.45");
    expect(state.thresholdDraft).toBe("65");
  });

  it("cancelEdit closes the form and clears any save error", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const controller = createBudgetsController(fakeApi(), data);
    controller.startCreate("cat-groceries");
    controller.cancelEdit();
    expect(controller.getState().edit).toEqual({ kind: "closed" });
  });

  it("save() on create moves the category from unbudgeted to budgeted and resets the form", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const api = fakeApi({
      createBudgetPlan: vi.fn().mockResolvedValue(plan({ category_id: "cat-transport", amount: 5000, notify_threshold: 70 })),
      getBudgetPlanProgress: vi.fn().mockResolvedValue(
        progress({ category_id: "cat-transport", amount: 5000, spent: 0, remaining: 5000, fill_pct: 0, notify_threshold: 70 }),
      ),
    });
    const controller = createBudgetsController(api, data);
    controller.startCreate("cat-transport");
    controller.setAmountDraft("50.00");
    controller.setThresholdDraft("70");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "success" });
    expect(api.createBudgetPlan).toHaveBeenCalledWith({ category_id: "cat-transport", amount: 5000, notify_threshold: 70 });
    const state = controller.getState();
    expect(state.edit).toEqual({ kind: "closed" });
    expect(state.data.unbudgeted).toEqual([
      { categoryId: "cat-groceries", label: "Groceries", colorVar: "var(--category-slot-1)" },
    ]);
    expect(state.data.budgeted).toHaveLength(1);
    expect(state.data.budgeted[0]).toMatchObject({ categoryId: "cat-transport", label: "Transport", amountMinor: 5000 });
  });

  it("save() on edit replaces the row in place, keeping its label/colour", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [progress()], currency: "EUR" });
    const api = fakeApi({
      updateBudgetPlan: vi.fn().mockResolvedValue(plan({ amount: 30000, notify_threshold: 90 })),
      getBudgetPlanProgress: vi.fn().mockResolvedValue(progress({ amount: 30000, spent: 10000, notify_threshold: 90 })),
    });
    const controller = createBudgetsController(api, data);
    controller.startEdit("plan-groceries");
    controller.setAmountDraft("300.00");
    controller.setThresholdDraft("90");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "success" });
    expect(api.updateBudgetPlan).toHaveBeenCalledWith("plan-groceries", { amount: 30000, notify_threshold: 90 });
    const state = controller.getState();
    expect(state.data.budgeted[0]).toMatchObject({ label: "Groceries", colorVar: "var(--category-slot-1)", amountMinor: 30000 });
  });

  it("save() re-inserts the new row into budgeted in category creation order, not appended at the end", async () => {
    const THREE: CategoryResponse[] = [
      category("cat-a", "A", "2026-01-01T00:00:00Z"),
      category("cat-b", "B", "2026-01-02T00:00:00Z"),
      category("cat-c", "C", "2026-01-03T00:00:00Z"),
    ];
    const cPlan = plan({ id: "plan-c", category_id: "cat-c", amount: 9000, notify_threshold: 80 });
    const data = buildBudgetsData({
      categories: THREE,
      plans: [cPlan],
      progress: [progress({ budget_plan_id: "plan-c", category_id: "cat-c", amount: 9000 })],
      currency: "EUR",
    });
    const api = fakeApi({
      createBudgetPlan: vi.fn().mockResolvedValue(plan({ id: "plan-a", category_id: "cat-a", amount: 5000, notify_threshold: 80 })),
      getBudgetPlanProgress: vi.fn().mockResolvedValue(progress({ budget_plan_id: "plan-a", category_id: "cat-a", amount: 5000 })),
    });
    const controller = createBudgetsController(api, data);
    controller.startCreate("cat-a");
    controller.setAmountDraft("50.00");
    await controller.save();
    const state = controller.getState();
    expect(state.data.budgeted.map((r) => r.categoryId)).toEqual(["cat-a", "cat-c"]);
  });

  it("save() commits the plan with a zero-spend fallback when the follow-up progress fetch fails", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const api = fakeApi({
      createBudgetPlan: vi.fn().mockResolvedValue(plan({ category_id: "cat-transport", amount: 5000, notify_threshold: 70 })),
      getBudgetPlanProgress: vi.fn().mockRejectedValue(new RetryableError()),
    });
    const controller = createBudgetsController(api, data);
    controller.startCreate("cat-transport");
    controller.setAmountDraft("50.00");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "success" });
    const state = controller.getState();
    expect(state.data.unbudgeted.map((r) => r.categoryId)).toEqual(["cat-groceries"]);
    expect(state.data.budgeted[0]).toMatchObject({
      categoryId: "cat-transport",
      amountMinor: 5000,
      spentMinor: 0,
      fillPct: null,
      spentKnown: false,
    });
  });

  it("save() marks a real amount<=0 'no limit' plan as spentKnown (distinct from the fallback's unknown spend)", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const api = fakeApi({
      createBudgetPlan: vi.fn().mockResolvedValue(plan({ category_id: "cat-transport", amount: 5000, notify_threshold: 70 })),
      getBudgetPlanProgress: vi.fn().mockResolvedValue(
        progress({ category_id: "cat-transport", amount: 5000, spent: 0, remaining: 5000, fill_pct: null, notify_threshold: 70 }),
      ),
    });
    const controller = createBudgetsController(api, data);
    controller.startCreate("cat-transport");
    controller.setAmountDraft("50.00");
    await controller.save();
    const state = controller.getState();
    expect(state.data.budgeted[0]).toMatchObject({ fillPct: null, spentKnown: true });
  });

  it("save() is blocked (no API call) with an invalid amount or threshold", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const api = fakeApi();
    const controller = createBudgetsController(api, data);
    controller.startCreate("cat-groceries");
    controller.setAmountDraft("0");
    controller.setThresholdDraft("80");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "blocked" });
    expect(api.createBudgetPlan).not.toHaveBeenCalled();
  });

  it("save() maps a 409 to the duplicate-plan message and keeps the form open", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const api = fakeApi({ createBudgetPlan: vi.fn().mockRejectedValue(new ApiError("Conflict", 409)) });
    const controller = createBudgetsController(api, data);
    controller.startCreate("cat-groceries");
    controller.setAmountDraft("50.00");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "error", message: "A budget plan already exists for this category and period." });
    expect(controller.getState().edit.kind).toBe("create");
  });

  it("save() maps a 403 to a human forbidden message", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const api = fakeApi({ createBudgetPlan: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const controller = createBudgetsController(api, data);
    controller.startCreate("cat-groceries");
    controller.setAmountDraft("50.00");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "error", message: "You don't have permission to do that." });
  });

  it("save() maps a 404 (stale category) to a human message", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const api = fakeApi({ createBudgetPlan: vi.fn().mockRejectedValue(new NotFoundError()) });
    const controller = createBudgetsController(api, data);
    controller.startCreate("cat-groceries");
    controller.setAmountDraft("50.00");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "error", message: "That category no longer exists." });
  });

  it("deleteBudget() moves the row back to unbudgeted on success", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [progress()], currency: "EUR" });
    const api = fakeApi({ deleteBudgetPlan: vi.fn().mockResolvedValue(undefined) });
    const controller = createBudgetsController(api, data);
    const outcome = await controller.deleteBudget("plan-groceries");
    expect(outcome).toEqual({ status: "success" });
    const state = controller.getState();
    expect(state.data.budgeted).toEqual([]);
    expect(state.data.unbudgeted).toContainEqual({ categoryId: "cat-groceries", label: "Groceries", colorVar: "var(--category-slot-1)" });
  });

  it("deleteBudget() re-inserts the freed category into unbudgeted in creation order, not appended at the end", async () => {
    const THREE: CategoryResponse[] = [
      category("cat-a", "A", "2026-01-01T00:00:00Z"),
      category("cat-b", "B", "2026-01-02T00:00:00Z"),
      category("cat-c", "C", "2026-01-03T00:00:00Z"),
    ];
    const aPlan = plan({ id: "plan-a", category_id: "cat-a" });
    const bPlan = plan({ id: "plan-b", category_id: "cat-b" });
    const data = buildBudgetsData({
      categories: THREE,
      plans: [aPlan, bPlan],
      progress: [
        progress({ budget_plan_id: "plan-a", category_id: "cat-a" }),
        progress({ budget_plan_id: "plan-b", category_id: "cat-b" }),
      ],
      currency: "EUR",
    });
    const api = fakeApi({ deleteBudgetPlan: vi.fn().mockResolvedValue(undefined) });
    const controller = createBudgetsController(api, data);
    await controller.deleteBudget("plan-a");
    expect(controller.getState().data.unbudgeted.map((r) => r.categoryId)).toEqual(["cat-a", "cat-c"]);
  });

  it("deleteBudget() closes an open edit form for the deleted plan", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [progress()], currency: "EUR" });
    const api = fakeApi({ deleteBudgetPlan: vi.fn().mockResolvedValue(undefined) });
    const controller = createBudgetsController(api, data);
    controller.startEdit("plan-groceries");
    await controller.deleteBudget("plan-groceries");
    expect(controller.getState().edit).toEqual({ kind: "closed" });
  });

  it("deleteBudget() surfaces a 403/404 as a human message and keeps the row", async () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [progress()], currency: "EUR" });
    const api = fakeApi({ deleteBudgetPlan: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const controller = createBudgetsController(api, data);
    const outcome = await controller.deleteBudget("plan-groceries");
    expect(outcome).toEqual({ status: "error", message: "You don't have permission to do that." });
    expect(controller.getState().data.budgeted).toHaveLength(1);
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

  it("renders 'Spend unknown' instead of 'No limit set' for a row whose spend fetch fell back (spentKnown: false)", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [progress()], currency: "EUR" });
    const unknownRow = { ...data.budgeted[0], fillPct: null, spentKnown: false };
    const html = renderBudgetsView({
      data: { ...data, budgeted: [unknownRow] },
      edit: { kind: "closed" },
      amountDraft: "",
      thresholdDraft: "80",
      saveError: null,
    });
    expect(html).toContain("Spend unknown");
    expect(html).not.toContain("No limit set");
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

  it("renders the create form with the category name and a disabled Save until valid, no Delete button", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const html = renderBudgetsView({
      data,
      edit: { kind: "create", categoryId: "cat-groceries", categoryLabel: "Groceries", colorVar: "var(--category-slot-1)" },
      amountDraft: "",
      thresholdDraft: "80",
      saveError: null,
    });
    expect(html).toContain("Set budget for Groceries");
    expect(html).toContain('data-action="save-budget" disabled');
    expect(html).not.toContain('data-action="delete-budget"');
  });

  it("renders the edit form with a Delete button and the save error", () => {
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [plan()], progress: [progress()], currency: "EUR" });
    const html = renderBudgetsView({
      data,
      edit: { kind: "edit", planId: "plan-groceries" },
      amountDraft: "200.00",
      thresholdDraft: "80",
      saveError: "A budget plan already exists for this category and period.",
    });
    expect(html).toContain('data-action="delete-budget"');
    expect(html).toContain("already exists");
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

  it("invokes onMainButtonTap with the next unbudgeted category id when MainButton is tapped", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const data = buildBudgetsData({ categories: CATEGORIES, plans: [], progress: [], currency: "EUR" });
    const onTap = vi.fn();
    applyBudgetsChrome({ status: "ready", ...data }, vi.fn(), onTap);
    const handler = (webApp.MainButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    expect(onTap).toHaveBeenCalledWith("cat-groceries");
  });
});
