import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ApiError, ForbiddenError, NotFoundError, RetryableError } from "../src/api/client";
import type { CategoryResponse, ExpenseResponse, TagResponse } from "../src/api/types";
import {
  amountError,
  applyAddExpenseChrome,
  createController,
  createMemoryCache,
  emptyDraft,
  isDirty,
  loadAddExpenseData,
  renderAddExpense,
  renderForm,
  submitButtonState,
  wireBackButton,
  type AddExpenseApi,
  type Draft,
} from "../src/screens/add-expense";
import type { TelegramWebApp } from "../src/lib/telegram";

function category(id: string, name: string): CategoryResponse {
  return { id, name, account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" };
}

function tag(id: string, name: string): TagResponse {
  return { id, name, account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" };
}

const CATEGORIES: CategoryResponse[] = [category("cat-groceries", "Groceries"), category("cat-transport", "Transport")];
const TAGS: TagResponse[] = [tag("tag-vacation", "vacation")];

function expenseResponse(overrides: Partial<ExpenseResponse> = {}): ExpenseResponse {
  return {
    id: "exp-1",
    amount: 3840,
    comment: null,
    category_id: "cat-groceries",
    spent_at: "2026-08-02",
    user_id: "user-1",
    account_id: "acc-1",
    created_at: "2026-08-02T09:00:00Z",
    updated_at: "2026-08-02T09:00:00Z",
    tags: [],
    user_name: "Edgar",
    ...overrides,
  };
}

// -- pure helpers -------------------------------------------------------

describe("amountError", () => {
  it("is null for an untouched (empty) field", () => {
    expect(amountError("")).toBeNull();
  });

  it("is null for a valid amount", () => {
    expect(amountError("38.40")).toBeNull();
  });

  it("flags an unparseable or non-positive amount", () => {
    expect(amountError("abc")).toBe("Enter an amount greater than 0.");
    expect(amountError("0")).toBe("Enter an amount greater than 0.");
    expect(amountError("-1")).toBe("Enter an amount greater than 0.");
  });
});

describe("isDirty", () => {
  it("is false for a fresh draft", () => {
    expect(isDirty(emptyDraft())).toBe(false);
  });

  it("is true once any field has content", () => {
    expect(isDirty({ ...emptyDraft(), amountInput: "5" })).toBe(true);
    expect(isDirty({ ...emptyDraft(), categoryId: "cat-groceries" })).toBe(true);
    expect(isDirty({ ...emptyDraft(), tagIds: ["tag-vacation"] })).toBe(true);
    expect(isDirty({ ...emptyDraft(), comment: "note" })).toBe(true);
  });
});

describe("submitButtonState", () => {
  it("is disabled and labelled 'Choose a category' with no category picked", () => {
    const state = submitButtonState({ ...emptyDraft(), amountInput: "38.40" }, CATEGORIES, "EUR");
    expect(state).toEqual({ label: "Choose a category", enabled: false });
  });

  it("stays disabled once a category is picked but the amount isn't valid yet", () => {
    const state = submitButtonState({ ...emptyDraft(), categoryId: "cat-groceries" }, CATEGORIES, "EUR");
    expect(state).toEqual({ label: "Enter an amount", enabled: false });
  });

  it("restates the action once both a category and a valid amount are set", () => {
    const state = submitButtonState(
      { ...emptyDraft(), categoryId: "cat-groceries", amountInput: "38.40" },
      CATEGORIES,
      "EUR",
    );
    expect(state).toEqual({ label: "Add 38.40 EUR to Groceries", enabled: true });
  });

  it("stays disabled for a stale category id no longer in the list", () => {
    const state = submitButtonState(
      { ...emptyDraft(), categoryId: "cat-deleted", amountInput: "38.40" },
      CATEGORIES,
      "EUR",
    );
    expect(state.enabled).toBe(false);
  });
});

// -- loadAddExpenseData ---------------------------------------------------

function fakeApi(overrides: Partial<AddExpenseApi> = {}): AddExpenseApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR", account_name: "Family" }),
    listCategories: vi.fn().mockResolvedValue(CATEGORIES),
    listTags: vi.fn().mockResolvedValue(TAGS),
    createExpense: vi.fn().mockResolvedValue(expenseResponse()),
    ...overrides,
  };
}

describe("loadAddExpenseData", () => {
  it("returns ready with categories/tags/currency/account name from a fake ApiClient", async () => {
    const state = await loadAddExpenseData(fakeApi(), createMemoryCache());
    expect(state).toEqual({
      status: "ready",
      categories: CATEGORIES,
      tags: TAGS,
      currency: "EUR",
      accountName: "Family",
    });
  });

  it("returns empty when the account has no categories", async () => {
    const state = await loadAddExpenseData(
      fakeApi({ listCategories: vi.fn().mockResolvedValue([]) }),
      createMemoryCache(),
    );
    expect(state).toEqual({ status: "empty" });
  });

  it("maps a 403 to forbidden", async () => {
    const state = await loadAddExpenseData(
      fakeApi({ listCategories: vi.fn().mockRejectedValue(new ForbiddenError()) }),
      createMemoryCache(),
    );
    expect(state).toEqual({ status: "forbidden" });
  });

  it("returns an error with no cached data to fall back on", async () => {
    const state = await loadAddExpenseData(
      fakeApi({ listCategories: vi.fn().mockRejectedValue(new RetryableError()) }),
      createMemoryCache(),
    );
    expect(state.status).toBe("error");
  });

  it("falls back to the last cached snapshot with a synced marker when offline", async () => {
    const cache = createMemoryCache();
    const good = await loadAddExpenseData(fakeApi(), cache);
    expect(good.status).toBe("ready");

    const state = await loadAddExpenseData(
      fakeApi({ listCategories: vi.fn().mockRejectedValue(new RetryableError()) }),
      cache,
    );
    expect(state.status).toBe("offline");
    if (state.status === "offline") {
      expect(state.categories).toEqual(CATEGORIES);
      expect(state.lastSyncedAt.length).toBeGreaterThan(0);
    }
  });
});

// -- createController / submit -------------------------------------------

function validDraft(): Draft {
  return { ...emptyDraft(), amountInput: "38.40", categoryId: "cat-groceries" };
}

describe("createController seeding", () => {
  it("starts from an empty draft by default", () => {
    const controller = createController(fakeApi(), CATEGORIES, "EUR");
    expect(controller.getDraft()).toEqual(emptyDraft());
  });

  it("seeds the draft from an initial value — the 'returning from More' case", () => {
    const initialDraft: Draft = {
      amountInput: "12.50",
      categoryId: null,
      tagIds: ["tag-vacation"],
      comment: "weekly shop",
    };
    const controller = createController(fakeApi(), CATEGORIES, "EUR", initialDraft);
    expect(controller.getDraft()).toEqual(initialDraft);
  });
});

describe("createController submit", () => {
  it("is a no-op (blocked) when the draft can't submit yet", async () => {
    const api = fakeApi();
    const controller = createController(api, CATEGORIES, "EUR");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "blocked" });
    expect(api.createExpense).not.toHaveBeenCalled();
  });

  it("posts exactly one expense on a valid draft, then resets the draft", async () => {
    const api = fakeApi();
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");
    controller.toggleTag("tag-vacation");
    controller.setComment("  weekly shop  ");

    const outcome = await controller.submit();

    expect(outcome.status).toBe("success");
    expect(api.createExpense).toHaveBeenCalledOnce();
    expect(api.createExpense).toHaveBeenCalledWith({
      amount: 3840,
      category_id: "cat-groceries",
      tag_ids: ["tag-vacation"],
      comment: "weekly shop",
    });
    expect(controller.getDraft()).toEqual(emptyDraft());
  });

  it("omits tag_ids and comment when neither is set", async () => {
    const api = fakeApi();
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("10");
    controller.setCategoryId("cat-groceries");

    await controller.submit();

    expect(api.createExpense).toHaveBeenCalledWith({
      amount: 1000,
      category_id: "cat-groceries",
      tag_ids: undefined,
      comment: undefined,
    });
  });

  it("a duplicate rapid submit issues exactly one POST", async () => {
    let resolveCreate: (value: ExpenseResponse) => void = () => {};
    const createExpense = vi.fn(
      () =>
        new Promise<ExpenseResponse>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const api = fakeApi({ createExpense });
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");

    const first = controller.submit();
    const second = controller.submit();
    resolveCreate(expenseResponse());
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(api.createExpense).toHaveBeenCalledOnce();
    expect(firstOutcome.status).toBe("success");
    expect(secondOutcome).toEqual({ status: "blocked" });
  });

  it("maps 403 to a human message and preserves the draft", async () => {
    const api = fakeApi({ createExpense: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "error", message: "You don't have permission to add expenses." });
    expect(controller.getDraft().amountInput).toBe("38.40");
  });

  it("maps a stale-category 404 to a human message and preserves the draft", async () => {
    const api = fakeApi({ createExpense: vi.fn().mockRejectedValue(new NotFoundError()) });
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");

    const outcome = await controller.submit();

    expect(outcome).toEqual({
      status: "error",
      message: "That category no longer exists. Choose another and try again.",
    });
    expect(controller.getDraft().categoryId).toBe("cat-groceries");
  });

  it("maps a network failure to a retryable message and preserves the draft", async () => {
    const api = fakeApi({ createExpense: vi.fn().mockRejectedValue(new RetryableError()) });
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");

    const outcome = await controller.submit();

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.message.length).toBeGreaterThan(0);
    }
    expect(controller.getDraft().amountInput).toBe("38.40");
  });

  it("maps an unmapped ApiError to its own message", async () => {
    const api = fakeApi({ createExpense: vi.fn().mockRejectedValue(new ApiError("Request failed (409).", 409)) });
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "error", message: "Request failed (409)." });
  });
});

// -- renderAddExpense / renderForm ----------------------------------------

const READY = { categories: CATEGORIES, tags: TAGS, currency: "EUR" as const, accountName: "Family" };

describe("renderAddExpense", () => {
  it("renders a loading skeleton with a live, focused amount field and 8 grid skeletons", () => {
    const html = renderAddExpense({ status: "loading" });
    expect(html).toContain('data-testid="loading"');
    // The amount field is real markup here too — AC: focused before any
    // network call resolves, "typing never waits on a fetch".
    expect(html).toContain('data-testid="amount-input"');
    expect(html).toContain("autofocus");
    expect(html.match(/class="cat-cell-skeleton"/g)?.length).toBe(8);
  });

  it("carries a typed-ahead amount into the loading skeleton", () => {
    const html = renderAddExpense({ status: "loading" }, { ...emptyDraft(), amountInput: "12.50" });
    expect(html).toContain('data-testid="amount-input"');
    expect(html).toContain('value="12.50"');
  });

  it("renders a retry affordance on error", () => {
    const html = renderAddExpense({ status: "error", message: "The server is unreachable right now." });
    expect(html).toContain('data-action="retry"');
    expect(html).toContain("unreachable");
  });

  it("renders a read-only message on forbidden, no chips or inputs", () => {
    const html = renderAddExpense({ status: "forbidden" });
    expect(html).toContain('data-testid="forbidden"');
    expect(html).not.toContain("amount-input");
  });

  it("renders the empty state naming what's missing", () => {
    const html = renderAddExpense({ status: "empty" });
    expect(html).toContain("category first");
  });

  it("renders the form focused on the amount field with the category grid, no inline error yet", () => {
    const html = renderAddExpense({ status: "ready", ...READY });
    expect(html).toContain('data-testid="amount-input"');
    expect(html).toContain("autofocus");
    expect(html).toContain('data-category-id="cat-groceries"');
    expect(html).toContain('data-tag-id="tag-vacation"');
    expect(html).not.toContain('data-testid="offline"');
  });

  it("renders the currency code beside the amount, in a non-tappable element", () => {
    const html = renderAddExpense({ status: "ready", ...READY });
    expect(html).toContain('data-testid="currency-suffix">EUR</div>');
  });

  it("renders the account name under an Account label, in a non-tappable element", () => {
    const html = renderAddExpense({ status: "ready", ...READY });
    expect(html).toContain('data-testid="account-field"');
    expect(html).toContain('data-testid="account-name">Family</div>');
  });

  it("renders the category grid as the U3.1 component, not the old chip row", () => {
    const html = renderAddExpense({ status: "ready", ...READY });
    expect(html).toContain('data-testid="category-picker"');
    expect(html).toContain('data-testid="cp-more"');
    expect(html).not.toContain('data-testid="category-chips"');
  });

  it("colours each category swatch by its assigned slot", () => {
    const html = renderAddExpense({ status: "ready", ...READY });
    expect(html).toContain("background:var(--category-slot-1)");
    expect(html).toContain("background:var(--category-slot-2)");
  });

  it("omits the tag chip row when the account has no tags", () => {
    const html = renderForm({ ...READY, tags: [] }, emptyDraft());
    expect(html).not.toContain('data-testid="tag-chips"');
  });

  it("shows the offline banner and last-synced marker", () => {
    const html = renderAddExpense({ status: "offline", lastSyncedAt: "2026-08-02T09:00:00.000Z", ...READY });
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-08-02T09:00:00.000Z");
  });

  it("shows the inline amount error, never a popup, once the field is invalid", () => {
    const html = renderForm(READY, { ...emptyDraft(), amountInput: "abc" });
    expect(html).toContain('data-testid="amount-error"');
    expect(html).toContain("Enter an amount greater than 0.");
  });

  it("marks the picked category cell selected", () => {
    const html = renderForm(READY, { ...emptyDraft(), categoryId: "cat-groceries" });
    expect(html).toMatch(/class="cp-cell selected"[^>]*data-category-id="cat-groceries"/);
  });

  it("renders a submit error banner when passed one", () => {
    const html = renderForm(READY, emptyDraft(), { submitError: "That category no longer exists." });
    expect(html).toContain('data-testid="submit-error"');
    expect(html).toContain("That category no longer exists.");
  });
});

// -- applyAddExpenseChrome -------------------------------------------------

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

describe("applyAddExpenseChrome", () => {
  it("shows the disabled 'Choose a category' MainButton with an empty draft", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    applyAddExpenseChrome(emptyDraft(), CATEGORIES, "EUR");

    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Choose a category");
    expect(webApp.MainButton.disable).toHaveBeenCalledOnce();
  });

  it("shows the enabled restated action once the draft is valid", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    applyAddExpenseChrome(validDraft(), CATEGORIES, "EUR");

    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Add 38.40 EUR to Groceries");
    expect(webApp.MainButton.enable).toHaveBeenCalledOnce();
  });
});

describe("wireBackButton", () => {
  it("closes immediately with no confirm popup for a clean draft", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onClose = vi.fn();

    wireBackButton(() => emptyDraft(), onClose);
    const handler = (webApp.BackButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();

    expect(webApp.showConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("confirms via Telegram's popup before discarding a dirty draft", async () => {
    const showConfirm = vi.fn((_message: string, callback: (confirmed: boolean) => void) => callback(true));
    const webApp = fakeWebApp({ showConfirm });
    installWebApp(webApp);
    const onClose = vi.fn();

    wireBackButton(() => validDraft(), onClose);
    const handler = (webApp.BackButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    await Promise.resolve();
    await Promise.resolve();

    expect(showConfirm).toHaveBeenCalledWith("Discard this expense?", expect.any(Function));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the draft when the user declines to discard", async () => {
    const showConfirm = vi.fn((_message: string, callback: (confirmed: boolean) => void) => callback(false));
    const webApp = fakeWebApp({ showConfirm });
    installWebApp(webApp);
    const onClose = vi.fn();

    wireBackButton(() => validDraft(), onClose);
    const handler = (webApp.BackButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    await Promise.resolve();
    await Promise.resolve();

    expect(onClose).not.toHaveBeenCalled();
  });
});
