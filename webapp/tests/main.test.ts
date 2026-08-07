import { describe, expect, it, vi } from "vitest";
import { boot, withArchivedCategory, withCreatedTagPreselected } from "../src/main";
import type { AddExpenseLoadState } from "../src/screens/add-expense";
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
