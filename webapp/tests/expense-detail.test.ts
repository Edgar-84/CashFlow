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
import { setLanguage } from "../src/lib/i18n";
import type { TelegramWebApp } from "../src/lib/telegram";

function category(id: string, name: string): CategoryResponse {
  return { id, name, account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" };
}

function tag(id: string, name: string): TagResponse {
  return { id, name, account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" };
}

const CATEGORIES: CategoryResponse[] = [category("cat-groceries", "Groceries"), category("cat-transport", "Transport")];

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
  it("turns an expense + categories into the detail shape", () => {
    const data = buildDetailData(expenseResponse(), CATEGORIES, "EUR", true);
    expect(data).toMatchObject({
      id: "exp-1",
      amountMinor: 3840,
      currency: "EUR",
      categoryId: "cat-groceries",
      categoryLabel: "Groceries",
      authorName: "Edgar",
      comment: "weekly shop",
      dayLabel: "Sun, Aug 2",
      canWrite: true,
    });
    expect(data.tags).toEqual([tag("tag-vacation", "vacation")]);
    expect(data.colorVar).toBe("var(--category-slot-1)");
  });

  it("falls back to 'Unknown' and the neutral colour for a stale/deleted category id", () => {
    const data = buildDetailData(expenseResponse({ category_id: "cat-deleted" }), CATEGORIES, "EUR", true);
    expect(data.categoryLabel).toBe("Unknown");
    expect(data.colorVar).toBe("var(--ink-secondary)");
  });

  it("reads the day line off spent_at, not created_at (D410) — a backdated expense shows the day it was spent", () => {
    const data = buildDetailData(
      expenseResponse({ spent_at: "2026-08-03", created_at: "2026-08-07T10:00:00Z" }),
      CATEGORIES,
      "EUR",
      true,
    );
    expect(data.dayLabel).toBe("Mon, Aug 3");
  });
});

// -- loadDetail --------------------------------------------------------

function fakeApi(overrides: Partial<ExpenseDetailApi> = {}): ExpenseDetailApi {
  return {
    getMe: vi.fn().mockResolvedValue({ id: "user-1", role: "member", currency: "EUR" }),
    getExpense: vi.fn().mockResolvedValue(expenseResponse()),
    listCategories: vi.fn().mockResolvedValue(CATEGORIES),
    deleteExpense: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("loadDetail", () => {
  it("returns ready with the built detail data", async () => {
    const state = await loadDetail(fakeApi(), "exp-1");
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.categoryLabel).toBe("Groceries");
      expect(state.expense).toEqual(expenseResponse());
      expect(state.canWrite).toBe(true);
    }
  });

  it("hides write access for a viewer role", async () => {
    const state = await loadDetail(fakeApi({ getMe: vi.fn().mockResolvedValue({ id: "user-2", role: "viewer", currency: "EUR" }) }), "exp-1");
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.canWrite).toBe(false);
    }
  });

  it("hides write access for a member viewing a partner's expense", async () => {
    const state = await loadDetail(fakeApi({ getMe: vi.fn().mockResolvedValue({ id: "user-2", role: "member", currency: "EUR" }) }), "exp-1");
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.canWrite).toBe(false);
    }
  });

  it("grants write access to an admin viewing a partner's expense", async () => {
    const state = await loadDetail(fakeApi({ getMe: vi.fn().mockResolvedValue({ id: "user-2", role: "admin", currency: "EUR" }) }), "exp-1");
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.canWrite).toBe(true);
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

// -- createDetailController — delete -----------------------------------

async function readyData(overrides: Partial<ExpenseResponse> = {}) {
  const state = await loadDetail(fakeApi({ getExpense: vi.fn().mockResolvedValue(expenseResponse(overrides)) }), "exp-1");
  if (state.status !== "ready") {
    throw new Error("expected ready");
  }
  return state;
}

describe("createDetailController — delete, confirms then deletes immediately (D408)", () => {
  it("deleteExpense calls the API exactly once and reports success", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn().mockResolvedValue(undefined);
    const controller = createDetailController(fakeApi({ deleteExpense }), data);

    const outcome = await controller.deleteExpense();

    expect(outcome).toEqual({ status: "success" });
    expect(deleteExpense).toHaveBeenCalledOnce();
    expect(deleteExpense).toHaveBeenCalledWith("exp-1");
  });

  it("flips deleting true synchronously before the API call resolves, guarding a concurrent call", async () => {
    const data = await readyData();
    let resolveDelete: () => void = () => {};
    const deleteExpense = vi.fn().mockReturnValue(new Promise<void>((resolve) => (resolveDelete = resolve)));
    const controller = createDetailController(fakeApi({ deleteExpense }), data);

    const first = controller.deleteExpense();
    expect(controller.getState().deleting).toBe(true);
    const second = await controller.deleteExpense();
    expect(second).toEqual({ status: "blocked" });

    resolveDelete();
    await first;
    expect(controller.getState().deleting).toBe(false);
    expect(deleteExpense).toHaveBeenCalledOnce();
  });

  it("a 404 on delete is treated as success — the expense is gone either way", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn().mockRejectedValue(new NotFoundError());
    const controller = createDetailController(fakeApi({ deleteExpense }), data);

    const outcome = await controller.deleteExpense();

    expect(outcome).toEqual({ status: "success" });
  });

  it("maps a 403 delete failure to a human message and keeps the expense", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn().mockRejectedValue(new ForbiddenError());
    const controller = createDetailController(fakeApi({ deleteExpense }), data);

    const outcome = await controller.deleteExpense();

    expect(outcome).toEqual({ status: "error", message: "You don't have permission to do that." });
    expect(controller.getState().saveError).toBe("You don't have permission to do that.");
  });

  it("maps any other delete failure to a fixed human message", async () => {
    const data = await readyData();
    const deleteExpense = vi.fn().mockRejectedValue(new ApiError("Request failed (500).", 500));
    const controller = createDetailController(fakeApi({ deleteExpense }), data);

    const outcome = await controller.deleteExpense();

    expect(outcome).toEqual({ status: "error", message: "Couldn't delete that expense." });
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

  it("renders category, author, tags, comment and both actions for a writable expense", async () => {
    const data = await readyData();
    const html = renderDetail(data);
    expect(html).toContain('data-testid="detail-category"');
    expect(html).toContain("Groceries");
    expect(html).toContain("Edgar");
    expect(html).toContain("weekly shop");
    expect(html).toContain("vacation");
    expect(html).toContain('data-action="open-picker"');
    expect(html).toContain("Edit");
    expect(html).toContain('data-action="delete"');
    expect(html).toContain("Delete expense");
  });

  it("renders no field-picker and no editable field anywhere on the screen", async () => {
    const data = await readyData();
    const html = renderDetail(data);
    expect(html).not.toContain("field-picker");
    expect(html).not.toContain('data-action="edit-amount"');
    expect(html).not.toContain('data-testid="detail-amount-input"');
  });

  it("renders neither action for a read-only viewer", async () => {
    const state = await loadDetail(fakeApi({ getMe: vi.fn().mockResolvedValue({ id: "user-2", role: "viewer", currency: "EUR" }) }), "exp-1");
    if (state.status !== "ready") {
      throw new Error("expected ready");
    }
    const html = renderDetail(state);
    expect(html).not.toContain('data-testid="detail-actions"');
    expect(html).not.toContain('data-action="delete"');
  });
});

describe("renderDetailView — deleting disables both actions, no undo banner", () => {
  it("disables both actions while a delete is in flight", async () => {
    const data = await readyData();
    const html = renderDetailView({ data, deleting: true, saveError: null });
    expect(html).toContain('data-action="open-picker" disabled');
    expect(html).toContain('data-action="delete" disabled');
  });

  it("shows a save error under the actions after a failed delete, expense still shown", async () => {
    const data = await readyData();
    const html = renderDetailView({ data, deleting: false, saveError: "Couldn't delete that expense." });
    expect(html).toContain('data-testid="detail-save-error"');
    expect(html).toContain("Couldn't delete that expense.");
    expect(html).toContain('data-testid="detail"');
  });

  it("never renders an undo banner", async () => {
    const data = await readyData();
    const html = renderDetailView({ data, deleting: false, saveError: null });
    expect(html).not.toContain("undo");
    expect(html).not.toContain("Undo");
  });
});

describe("renders real RU content, not an EN fallback", () => {
  afterEach(() => {
    setLanguage("en");
  });

  it("translates the action labels and the forbidden/not-found copy", async () => {
    setLanguage("ru");
    const data = await readyData();
    const html = renderDetailView({ data, deleting: false, saveError: null });
    expect(html).toContain("Изменить");
    expect(html).toContain("Удалить расход");
    expect(renderDetail({ status: "forbidden" })).toContain("У вас нет прав на просмотр этого расхода.");
    expect(renderDetail({ status: "not-found" })).toContain("Этот расход больше не существует.");
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
