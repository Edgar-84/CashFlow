import { describe, expect, it, vi } from "vitest";
import {
  boot,
  budgetFormModeFromRow,
  budgetFormModeFromUnbudgeted,
  budgetToastMessage,
  withArchivedCategory,
  withCreatedTagPreselected,
} from "../src/main";
import type { AddExpenseLoadState } from "../src/screens/add-expense";
import type { HomeBudgetAlert } from "../src/screens/home";
import type { BudgetRow, UnbudgetedRow } from "../src/screens/budgets";
import type { CategoryResponse, ExpenseResponse } from "../src/api/types";

describe("boot", () => {
  it("resolves without throwing when no DOM is present (vitest's node environment)", async () => {
    await expect(boot()).resolves.toBeUndefined();
  });
});

describe("withCreatedTagPreselected", () => {
  it("appends the created tag id when it isn't already selected", () => {
    expect(withCreatedTagPreselected(["tag-vacation"], "tag-new")).toEqual(["tag-vacation", "tag-new"]);
  });

  it("leaves the draft's tags unchanged when nothing was created", () => {
    expect(withCreatedTagPreselected(["tag-vacation"], null)).toEqual(["tag-vacation"]);
  });

  it("doesn't duplicate a tag that's already selected (e.g. a rename, not a create)", () => {
    expect(withCreatedTagPreselected(["tag-vacation"], "tag-vacation")).toEqual(["tag-vacation"]);
  });
});

// -- budgetFormModeFromRow / budgetFormModeFromUnbudgeted (U3.2, Budgets ->
//    the standalone budget form screen, D506/D512) --------------------------

describe("budgetFormModeFromRow", () => {
  it("builds an edit mode carrying the plan's current values and the screen's already-loaded currency", () => {
    const row: BudgetRow = {
      planId: "plan-groceries",
      categoryId: "cat-groceries",
      label: "Groceries",
      colorVar: "var(--category-slot-1)",
      amountMinor: 20000,
      spentMinor: 10000,
      remainingMinor: 10000,
      fillPct: 50,
      notifyThreshold: 80,
      isOverThreshold: false,
      isExceeded: false,
    };
    expect(budgetFormModeFromRow(row, "EUR")).toEqual({
      kind: "edit",
      planId: "plan-groceries",
      categoryId: "cat-groceries",
      categoryLabel: "Groceries",
      colorVar: "var(--category-slot-1)",
      currency: "EUR",
      amountMinor: 20000,
      spentMinor: 10000,
      notifyThreshold: 80,
    });
  });
});

describe("budgetFormModeFromUnbudgeted", () => {
  it("builds a create mode for the tapped category and the screen's already-loaded currency", () => {
    const row: UnbudgetedRow = { categoryId: "cat-transport", label: "Transport", colorVar: "var(--category-slot-2)" };
    expect(budgetFormModeFromUnbudgeted(row, "USD")).toEqual({
      kind: "create",
      categoryId: "cat-transport",
      categoryLabel: "Transport",
      colorVar: "var(--category-slot-2)",
      currency: "USD",
    });
  });
});

// -- withArchivedCategory (U1.4, screen 02b's archived-current-category edge
//    case) ----------------------------------------------------------------

function category(id: string, overrides: Partial<CategoryResponse> = {}): CategoryResponse {
  return { id, name: "Groceries", account_id: "acc-1", created_at: "2026-01-01T00:00:00Z", ...overrides };
}

function readyState(categories: CategoryResponse[]): AddExpenseLoadState {
  return {
    status: "ready",
    categories,
    tags: [],
    currency: "EUR",
    accountName: "Family",
    today: "2026-08-04",
  };
}

function expense(categoryId: string): ExpenseResponse {
  return {
    id: "exp-1",
    amount: 3840,
    comment: null,
    category_id: categoryId,
    spent_at: "2026-08-02",
    user_id: "user-1",
    account_id: "acc-1",
    created_at: "2026-08-02T09:00:00Z",
    updated_at: "2026-08-02T09:00:00Z",
    tags: [],
    user_name: "Edgar",
  };
}

// -- budgetToastMessage (U4.3, D608/D609) — the toast's one trigger: which
//    category's alert, if any, the just-saved expense should surface on the
//    next Home load. ---------------------------------------------------------

function alert(overrides: Partial<HomeBudgetAlert> = {}): HomeBudgetAlert {
  return {
    kind: "approaching",
    categoryId: "cat-cafe",
    label: "Café",
    fillPct: 82,
    spentMinor: 41000,
    limitMinor: 50000,
    overMinor: null,
    ...overrides,
  };
}

describe("budgetToastMessage", () => {
  it("returns the approaching line for the saved expense's category when it carries one", () => {
    expect(budgetToastMessage([alert()], "cat-cafe", "PLN")).toBe(
      "Café is at 82% — 410.00 of 500.00 PLN",
    );
  });

  it("returns the exceeded line for the saved expense's category when it carries one", () => {
    const exceeded = alert({ kind: "exceeded", overMinor: 2390, categoryId: "cat-groceries", label: "Groceries" });
    expect(budgetToastMessage([exceeded], "cat-groceries", "EUR")).toBe(
      "Groceries is over budget by 23.90 EUR",
    );
  });

  it("returns null when the saved category has no alert (no budget, or below its threshold)", () => {
    expect(budgetToastMessage([alert({ categoryId: "cat-cafe" })], "cat-transport", "EUR")).toBeNull();
  });

  it("returns null when categoryId is null (no expense saved since the last Home load)", () => {
    expect(budgetToastMessage([alert()], null, "EUR")).toBeNull();
  });

  it("returns null when the alert list is empty", () => {
    expect(budgetToastMessage([], "cat-cafe", "EUR")).toBeNull();
  });

  it("picks the matching alert out of several, regardless of position", () => {
    const alerts = [
      alert({ categoryId: "cat-groceries", label: "Groceries", kind: "exceeded", overMinor: 500 }),
      alert({ categoryId: "cat-cafe", label: "Café" }),
      alert({ categoryId: "cat-transport", label: "Transport", fillPct: 91 }),
    ];
    expect(budgetToastMessage(alerts, "cat-transport", "EUR")).toBe(
      "Transport is at 91% — 410.00 of 500.00 EUR",
    );
  });
});

describe("withArchivedCategory", () => {
  it("is a no-op when the expense's category is already in the loaded list", async () => {
    const state = readyState([category("cat-groceries")]);
    const getCategory = vi.fn();

    const result = await withArchivedCategory(state, expense("cat-groceries"), getCategory);

    expect(result).toBe(state);
    expect(getCategory).not.toHaveBeenCalled();
  });

  it("fetches and splices in the one archived category by id when it's missing", async () => {
    const state = readyState([category("cat-transport")]);
    const archived = category("cat-groceries", { is_active: false, color_slot: 3 });
    const getCategory = vi.fn().mockResolvedValue(archived);

    const result = await withArchivedCategory(state, expense("cat-groceries"), getCategory);

    expect(getCategory).toHaveBeenCalledWith("cat-groceries");
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.categories).toEqual([category("cat-transport"), archived]);
    }
  });

  it("is a no-op (and never throws) when the category fetch fails — the category is gone entirely", async () => {
    const state = readyState([category("cat-transport")]);
    const getCategory = vi.fn().mockRejectedValue(new Error("404"));

    const result = await withArchivedCategory(state, expense("cat-deleted"), getCategory);

    expect(result).toBe(state);
  });

  it("is a no-op for a state with no categories to splice into (loading/error/forbidden/empty)", async () => {
    const state: AddExpenseLoadState = { status: "loading" };
    const getCategory = vi.fn();

    const result = await withArchivedCategory(state, expense("cat-groceries"), getCategory);

    expect(result).toBe(state);
    expect(getCategory).not.toHaveBeenCalled();
  });
});
