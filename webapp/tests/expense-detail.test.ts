import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ForbiddenError, NotFoundError, RetryableError } from "../src/api/client";
import type { CategoryResponse, ExpenseResponse, TagResponse } from "../src/api/types";
import {
  applyDetailChrome,
  buildDetailData,
  createDetailController,
  loadDetail,
  renderDetail,
  renderDetailView,
  type ExpenseDetailApi,
} from "../src/screens/expense-detail";
import type { TelegramWebApp } from "../src/lib/telegram";

function category(id: string, name: string): CategoryResponse {
  return { id, name, account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" };
}

function tag(id: string, name: string): TagResponse {
  return { id, name, account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" };
}

const CATEGORIES: CategoryResponse[] = [category("cat-groceries", "Groceries"), category("cat-transport", "Transport")];
const TAGS: TagResponse[] = [tag("tag-vacation", "vacation"), tag("tag-work", "work")];

function expenseResponse(overrides: Partial<ExpenseResponse> = {}): ExpenseResponse {
  return {
    id: "exp-1",
    amount: 3840,
    comment: "weekly shop",
    category_id: "cat-groceries",
    spent_at: "2026-08-02",
    user_id: "user-1",
    account_id: "acc-1",
    created_at: "2026-08-02T09:00:00Z",
    updated_at: "2026-08-02T09:00:00Z",
    tags: [tag("tag-vacation", "vacation")],
    user_name: "Edgar",
    ...overrides,
  };
}

// -- buildDetailData -------------------------------------------------------

describe("buildDetailData", () => {
  it("turns an expense + categories/tags into the detail shape", () => {
    const data = buildDetailData(expenseResponse(), CATEGORIES, TAGS, "EUR", "UTC");
    expect(data).toMatchObject({
      id: "exp-1",
      amountMinor: 3840,
      currency: "EUR",
      categoryId: "cat-groceries",
      categoryLabel: "Groceries",
      authorName: "Edgar",
      comment: "weekly shop",
      selectedTagIds: ["tag-vacation"],
    });
    expect(data.colorVar).toBe("var(--category-slot-1)");
  });

  it("falls back to 'Unknown' and the neutral colour for a stale/deleted category id", () => {
    const data = buildDetailData(expenseResponse({ category_id: "cat-deleted" }), CATEGORIES, TAGS, "EUR", "UTC");
    expect(data.categoryLabel).toBe("Unknown");
    expect(data.colorVar).toBe("var(--ink-secondary)");
  });
});

// -- loadDetail --------------------------------------------------------

function fakeApi(overrides: Partial<ExpenseDetailApi> = {}): ExpenseDetailApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR" }),
    getExpense: vi.fn().mockResolvedValue(expenseResponse()),
    listCategories: vi.fn().mockResolvedValue(CATEGORIES),
    listTags: vi.fn().mockResolvedValue(TAGS),
    updateExpense: vi.fn().mockResolvedValue(expenseResponse()),
    deleteExpense: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("loadDetail", () => {
  it("returns ready with the built detail data", async () => {
    const state = await loadDetail(fakeApi(), "exp-1", "UTC");
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.categoryLabel).toBe("Groceries");
      expect(state.tags).toEqual(TAGS);
    }
  });

  it("maps a 403 to forbidden", async () => {
    const state = await loadDetail(fakeApi({ getExpense: vi.fn().mockRejectedValue(new ForbiddenError()) }), "exp-1");
    expect(state).toEqual({ status: "forbidden" });
  });

  it("maps a 404 to not-found", async () => {
    const state = await loadDetail(fakeApi({ getExpense: vi.fn().mockRejectedValue(new NotFoundError()) }), "exp-1");
    expect(state).toEqual({ status: "not-found" });
  });

  it("maps a network failure to error", async () => {
    const state = await loadDetail(fakeApi({ getExpense: vi.fn().mockRejectedValue(new RetryableError()) }), "exp-1");
    expect(state.status).toBe("error");
  });
});

// -- createDetailController -----------------------------------------------

async function readyData(overrides: Partial<ExpenseResponse> = {}) {
  const state = await loadDetail(fakeApi({ getExpense: vi.fn().mockResolvedValue(expenseResponse(overrides)) }), "exp-1", "UTC");
  if (state.status !== "ready") {
    throw new Error("expected ready");
  }
  return state;
}

describe("createDetailController — edit round-trips one field at a time", () => {
  it("saves an amount edit with its own PATCH, leaving other fields untouched", async () => {
    const data = await readyData();
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse({ amount: 5000 }));
    const controller = createDetailController(fakeApi({ updateExpense }), data, "UTC");

    controller.startEdit("amount");
    controller.setAmountDraft("50.00");
    const ok = await controller.saveAmount();

    expect(ok).toBe(true);
    expect(updateExpense).toHaveBeenCalledOnce();
    expect(updateExpense).toHaveBeenCalledWith("exp-1", { amount: 5000 });
    expect(controller.getState().data.amountMinor).toBe(5000);
    expect(controller.getState().edit).toBe("closed");
  });

  it("rejects an invalid amount draft without calling the API", async () => {
    const data = await readyData();
    const updateExpense = vi.fn();
    const controller = createDetailController(fakeApi({ updateExpense }), data, "UTC");

    controller.startEdit("amount");
    controller.setAmountDraft("abc");
    const ok = await controller.saveAmount();

    expect(ok).toBe(false);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it("saves a comment edit, sending null for a cleared comment", async () => {
    const data = await readyData();
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse({ comment: null }));
    const controller = createDetailController(fakeApi({ updateExpense }), data, "UTC");

    controller.startEdit("comment");
    controller.setCommentDraft("   ");
    await controller.saveComment();

    expect(updateExpense).toHaveBeenCalledOnce();
    expect(updateExpense).toHaveBeenCalledWith("exp-1", { comment: null });
    expect(controller.getState().data.comment).toBeNull();
  });

  it("saves a category pick immediately, one PATCH per tap", async () => {
    const data = await readyData();
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse({ category_id: "cat-transport" }));
    const controller = createDetailController(fakeApi({ updateExpense }), data, "UTC");

    controller.startEdit("category");
    const ok = await controller.saveCategory("cat-transport");

    expect(ok).toBe(true);
    expect(updateExpense).toHaveBeenCalledOnce();
    expect(updateExpense).toHaveBeenCalledWith("exp-1", { category_id: "cat-transport" });
    expect(controller.getState().data.categoryLabel).toBe("Transport");
  });

  it("saves the whole tag selection as one PATCH when Done is tapped", async () => {
    const data = await readyData();
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse({ tags: [tag("tag-work", "work")] }));
    const controller = createDetailController(fakeApi({ updateExpense }), data, "UTC");

    controller.startEdit("tags");
    controller.toggleTagDraft("tag-vacation");
    controller.toggleTagDraft("tag-work");
    await controller.saveTags();

    expect(updateExpense).toHaveBeenCalledOnce();
    expect(updateExpense).toHaveBeenCalledWith("exp-1", { tag_ids: ["tag-work"] });
    expect(controller.getState().data.selectedTagIds).toEqual(["tag-work"]);
  });

  it("keeps the edit open with a human message when a save fails", async () => {
    const data = await readyData();
    const updateExpense = vi.fn().mockRejectedValue(new ForbiddenError());
    const controller = createDetailController(fakeApi({ updateExpense }), data, "UTC");

    controller.startEdit("amount");
    controller.setAmountDraft("50.00");
    const ok = await controller.saveAmount();

    expect(ok).toBe(false);
    expect(controller.getState().edit).toBe("amount");
    expect(controller.getState().saveError).toBe("You don't have permission to do that.");
  });

  it("cancelEdit discards the draft without calling the API", async () => {
    const data = await readyData();
    const updateExpense = vi.fn();
    const controller = createDetailController(fakeApi({ updateExpense }), data, "UTC");

    controller.startEdit("amount");
    controller.setAmountDraft("999.00");
    controller.cancelEdit();

    expect(controller.getState().edit).toBe("closed");
    expect(controller.getState().data.amountMinor).toBe(3840);
    expect(updateExpense).not.toHaveBeenCalled();
  });
});

describe("createDetailController — delete with a 5s undo, before the API call", () => {
  it("requestDelete flips pendingDelete without calling the API", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn();
    const controller = createDetailController(fakeApi({ deleteExpense }), data, "UTC");

    controller.requestDelete();

    expect(controller.getState().pendingDelete).toBe(true);
    expect(deleteExpense).not.toHaveBeenCalled();
  });

  it("cancelDelete (undo) restores state with no API call ever made", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn();
    const controller = createDetailController(fakeApi({ deleteExpense }), data, "UTC");

    controller.requestDelete();
    controller.cancelDelete();

    expect(controller.getState().pendingDelete).toBe(false);
    expect(deleteExpense).not.toHaveBeenCalled();
  });

  it("confirmDelete after the undo window calls the API exactly once", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn().mockResolvedValue(undefined);
    const controller = createDetailController(fakeApi({ deleteExpense }), data, "UTC");

    controller.requestDelete();
    const outcome = await controller.confirmDelete();

    expect(outcome).toEqual({ status: "success" });
    expect(deleteExpense).toHaveBeenCalledOnce();
    expect(deleteExpense).toHaveBeenCalledWith("exp-1");
  });

  it("confirmDelete is blocked (no-op) without a pending delete", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn();
    const controller = createDetailController(fakeApi({ deleteExpense }), data, "UTC");

    const outcome = await controller.confirmDelete();

    expect(outcome).toEqual({ status: "blocked" });
    expect(deleteExpense).not.toHaveBeenCalled();
  });

  it("a failed delete restores the row (pendingDelete clears) with a human message", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn().mockRejectedValue(new NotFoundError());
    const controller = createDetailController(fakeApi({ deleteExpense }), data, "UTC");

    controller.requestDelete();
    const outcome = await controller.confirmDelete();

    expect(outcome).toEqual({ status: "error", message: "That expense no longer exists." });
    expect(controller.getState().pendingDelete).toBe(false);
    expect(controller.getState().saveError).toBe("That expense no longer exists.");
  });

  it("maps a 403 delete failure to a human message", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn().mockRejectedValue(new ForbiddenError());
    const controller = createDetailController(fakeApi({ deleteExpense }), data, "UTC");

    controller.requestDelete();
    const outcome = await controller.confirmDelete();

    expect(outcome).toEqual({ status: "error", message: "You don't have permission to do that." });
  });

  it("maps an unmapped ApiError to its own message on delete", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn().mockRejectedValue(new ApiError("Request failed (409).", 409));
    const controller = createDetailController(fakeApi({ deleteExpense }), data, "UTC");

    controller.requestDelete();
    const outcome = await controller.confirmDelete();

    expect(outcome).toEqual({ status: "error", message: "Request failed (409)." });
  });
});

// -- renderDetail / renderDetailView ---------------------------------------

describe("renderDetail", () => {
  it("renders a loading skeleton", () => {
    expect(renderDetail({ status: "loading" })).toContain('data-testid="loading"');
  });

  it("renders a retry affordance on error", () => {
    const html = renderDetail({ status: "error", message: "The server is unreachable right now." });
    expect(html).toContain('data-action="retry"');
    expect(html).toContain("unreachable");
  });

  it("renders a human message on forbidden", () => {
    const html = renderDetail({ status: "forbidden" });
    expect(html).toContain('data-testid="forbidden"');
    expect(html).toContain("permission");
  });

  it("renders a human message on not-found", () => {
    const html = renderDetail({ status: "not-found" });
    expect(html).toContain('data-testid="not-found"');
    expect(html).toContain("no longer exists");
  });

  it("renders category, author, tags, comment for a ready expense", async () => {
    const data = await readyData();
    const html = renderDetail(data);
    expect(html).toContain('data-testid="detail-category"');
    expect(html).toContain("Groceries");
    expect(html).toContain("Edgar");
    expect(html).toContain("weekly shop");
    expect(html).toContain("vacation");
    expect(html).toContain('data-action="open-picker"');
    expect(html).toContain('data-action="delete"');
  });
});

describe("renderDetailView — edit and delete states", () => {
  it("renders the field picker", async () => {
    const data = await readyData();
    const controller = createDetailController(fakeApi(), data, "UTC");
    controller.openPicker();
    const html = renderDetailView(controller.getState());
    expect(html).toContain('data-testid="field-picker"');
    expect(html).toContain('data-action="edit-amount"');
    expect(html).toContain('data-action="edit-category"');
    expect(html).toContain('data-action="edit-comment"');
    expect(html).toContain('data-action="edit-tags"');
  });

  it("renders the category chips with the current pick marked active", async () => {
    const data = await readyData();
    const controller = createDetailController(fakeApi(), data, "UTC");
    controller.startEdit("category");
    const html = renderDetailView(controller.getState());
    expect(html).toContain('data-category-id="cat-groceries" aria-pressed="true"');
    expect(html).toContain('data-category-id="cat-transport" aria-pressed="false"');
  });

  it("renders the undo banner while a delete is pending, no action buttons", async () => {
    const data = await readyData();
    const controller = createDetailController(fakeApi(), data, "UTC");
    controller.requestDelete();
    const html = renderDetailView(controller.getState());
    expect(html).toContain('data-testid="pending-delete"');
    expect(html).toContain('data-action="undo-delete"');
    expect(html).not.toContain('data-action="delete"');
  });
});

// -- applyDetailChrome -------------------------------------------------

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

describe("applyDetailChrome", () => {
  it("hides the MainButton and wires BackButton to onBack", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onBack = vi.fn();

    applyDetailChrome(onBack);

    expect(webApp.MainButton.hide).toHaveBeenCalledOnce();
    expect(webApp.BackButton.show).toHaveBeenCalledOnce();
    const handler = (webApp.BackButton.onClick as ReturnType<typeof vi.fn>).mock.calls[0][0] as () => void;
    handler();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
