import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ApiError, ForbiddenError, NotFoundError, RetryableError } from "../src/api/client";
import type { CategoryResponse, ExpenseResponse, TagResponse } from "../src/api/types";
import {
  amountError,
  applyAddExpenseChrome,
  applyEditExpenseChrome,
  commentScrollOffset,
  createController,
  createMemoryCache,
  datePillOptions,
  draftFromExpense,
  editButtonState,
  editChanges,
  emptyDraft,
  isDirty,
  isEditDirty,
  loadAddExpenseData,
  nextDatePillFocusIndex,
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
const TODAY = "2026-08-04"; // a Tuesday

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

  it("stays false for a date change alone (docs/ui/screens/02-add-expense.md's BackButton AC)", () => {
    expect(isDirty({ ...emptyDraft(), spentAt: "2026-08-02" })).toBe(false);
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

describe("datePillOptions", () => {
  it("returns today/yesterday/two days ago, in that order, when one of them is selected", () => {
    expect(datePillOptions(TODAY, TODAY)).toEqual([
      { date: "2026-08-04", label: "today" },
      { date: "2026-08-03", label: "yesterday" },
      { date: "2026-08-02", label: "two days ago" },
    ]);
  });

  it("appends a fourth pill, labelled by weekday, for a selected date outside the three", () => {
    // 2026-07-20 is a Monday.
    const options = datePillOptions(TODAY, "2026-07-20");
    expect(options).toHaveLength(4);
    expect(options[3]).toEqual({ date: "2026-07-20", label: "monday" });
  });

  it("does not duplicate a fourth pill when the selected date already matches a fixed one", () => {
    expect(datePillOptions(TODAY, "2026-08-03")).toHaveLength(3);
  });
});

describe("nextDatePillFocusIndex", () => {
  it("moves right/left by one, wrapping at the ends of the pill row", () => {
    expect(nextDatePillFocusIndex(4, 0, "ArrowRight")).toBe(1);
    expect(nextDatePillFocusIndex(4, 3, "ArrowRight")).toBe(0);
    expect(nextDatePillFocusIndex(4, 0, "ArrowLeft")).toBe(3);
    expect(nextDatePillFocusIndex(4, 2, "ArrowLeft")).toBe(1);
  });

  it("ignores unrelated keys and an empty row", () => {
    expect(nextDatePillFocusIndex(4, 1, "Enter")).toBe(1);
    expect(nextDatePillFocusIndex(0, 0, "ArrowRight")).toBe(0);
  });
});

describe("commentScrollOffset", () => {
  it("is zero when the field's bottom is already within the visible viewport", () => {
    expect(commentScrollOffset(400, 600)).toBe(0);
    expect(commentScrollOffset(600, 600)).toBe(0);
  });

  it("is the exact overhang once the field's bottom is below viewportStableHeight (the keyboard-aware height, not 100vh)", () => {
    expect(commentScrollOffset(700, 600)).toBe(100);
  });
});

describe("draftFromExpense", () => {
  it("maps an expense's amount, category, date, tags and comment into a draft", () => {
    const expense = expenseResponse({
      amount: 1250,
      category_id: "cat-transport",
      spent_at: "2026-07-20",
      comment: "weekly shop",
      tags: [tag("tag-vacation", "vacation"), tag("tag-work", "work")],
    });

    expect(draftFromExpense(expense)).toEqual({
      amountInput: "12.50",
      categoryId: "cat-transport",
      tagIds: ["tag-vacation", "tag-work"],
      comment: "weekly shop",
      spentAt: "2026-07-20",
    });
  });

  it("maps a null comment and no tags to an empty comment and an empty tag list", () => {
    const draft = draftFromExpense(expenseResponse({ comment: null, tags: [] }));
    expect(draft.comment).toBe("");
    expect(draft.tagIds).toEqual([]);
  });
});

// -- loadAddExpenseData ---------------------------------------------------

function fakeApi(overrides: Partial<AddExpenseApi> = {}): AddExpenseApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR", account_name: "Family", today: TODAY }),
    listCategories: vi.fn().mockResolvedValue(CATEGORIES),
    listTags: vi.fn().mockResolvedValue(TAGS),
    createExpense: vi.fn().mockResolvedValue(expenseResponse()),
    ...overrides,
  };
}

describe("loadAddExpenseData", () => {
  it("returns ready with categories/tags/currency/account name/today from a fake ApiClient", async () => {
    const state = await loadAddExpenseData(fakeApi(), createMemoryCache());
    expect(state).toEqual({
      status: "ready",
      categories: CATEGORIES,
      tags: TAGS,
      currency: "EUR",
      accountName: "Family",
      today: TODAY,
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
      spentAt: null,
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
      spent_at: undefined,
    });
    expect(controller.getDraft()).toEqual(emptyDraft());
  });

  it("carries both tags when two are selected (AC: multi-select)", async () => {
    const api = fakeApi();
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");
    controller.toggleTag("tag-vacation");
    controller.toggleTag("tag-work");

    await controller.submit();

    expect(api.createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ tag_ids: ["tag-vacation", "tag-work"] }),
    );
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
      spent_at: undefined,
    });
  });

  it("omits spent_at (server defaults to today in family_tz) when the date wasn't changed", async () => {
    const api = fakeApi();
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("10");
    controller.setCategoryId("cat-groceries");

    await controller.submit();

    expect(api.createExpense).toHaveBeenCalledWith(expect.objectContaining({ spent_at: undefined }));
  });

  it("sends the picked date's spent_at once the date pill/calendar overrides it", async () => {
    const api = fakeApi();
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("10");
    controller.setCategoryId("cat-groceries");
    controller.setSpentAt("2026-08-02");

    await controller.submit();

    expect(api.createExpense).toHaveBeenCalledWith(expect.objectContaining({ spent_at: "2026-08-02" }));
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
    const api = fakeApi({ createExpense: vi.fn().mockRejectedValue(new ApiError("Request failed (422).", 422)) });
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "error", message: "Request failed (422)." });
  });

  // -- U3.5: stale/archived category recovery ------------------------------

  it("a 404 (stale category) shows the exact sentence, clears the selection, refetches, and keeps the rest of the draft", async () => {
    const REFETCHED = [category("cat-transport", "Transport")];
    const api = fakeApi({
      createExpense: vi.fn().mockRejectedValue(new NotFoundError()),
      listCategories: vi.fn().mockResolvedValue(REFETCHED),
    });
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");
    controller.toggleTag("tag-vacation");
    controller.setComment("weekly shop");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "error", message: "That category no longer exists." });
    expect(api.listCategories).toHaveBeenCalledOnce();
    const draft = controller.getDraft();
    expect(draft.categoryId).toBeNull();
    expect(draft.amountInput).toBe("38.40");
    expect(draft.tagIds).toEqual(["tag-vacation"]);
    expect(draft.comment).toBe("weekly shop");
    expect(controller.getCategories()).toEqual(REFETCHED);
  });

  it("a 409 (archived category, D302) shows the exact sentence and the same recovery as 404", async () => {
    const REFETCHED = [category("cat-transport", "Transport")];
    const api = fakeApi({
      createExpense: vi.fn().mockRejectedValue(new ApiError("Conflict", 409)),
      listCategories: vi.fn().mockResolvedValue(REFETCHED),
    });
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "error", message: "That category was archived. Choose another." });
    expect(controller.getDraft().categoryId).toBeNull();
    expect(controller.getCategories()).toEqual(REFETCHED);
  });

  it("a failed refetch after a stale-category error still clears the selection, keeping the last-known list", async () => {
    const api = fakeApi({
      createExpense: vi.fn().mockRejectedValue(new NotFoundError()),
      listCategories: vi.fn().mockRejectedValue(new RetryableError()),
    });
    const controller = createController(api, CATEGORIES, "EUR");
    controller.setAmountInput("38.40");
    controller.setCategoryId("cat-groceries");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "error", message: "That category no longer exists." });
    expect(controller.getDraft().categoryId).toBeNull();
    expect(controller.getCategories()).toEqual(CATEGORIES);
  });

  it("neither message mentions a status code", async () => {
    const notFound = createController(
      fakeApi({ createExpense: vi.fn().mockRejectedValue(new NotFoundError()) }),
      CATEGORIES,
      "EUR",
    );
    notFound.setAmountInput("38.40");
    notFound.setCategoryId("cat-groceries");
    const notFoundOutcome = await notFound.submit();

    const conflict = createController(
      fakeApi({ createExpense: vi.fn().mockRejectedValue(new ApiError("Conflict", 409)) }),
      CATEGORIES,
      "EUR",
    );
    conflict.setAmountInput("38.40");
    conflict.setCategoryId("cat-groceries");
    const conflictOutcome = await conflict.submit();

    for (const outcome of [notFoundOutcome, conflictOutcome]) {
      if (outcome.status === "error") {
        expect(outcome.message).not.toMatch(/\d{3}/);
      }
    }
  });
});

describe("createController submit — edit mode (U1.4's hook)", () => {
  it("PATCHes the expense being edited instead of POSTing a new one, carrying only the changed field", async () => {
    const expense = expenseResponse({ id: "exp-1", spent_at: "2026-08-02" });
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse());
    const api = fakeApi({ updateExpense });
    const controller = createController(
      api,
      CATEGORIES,
      "EUR",
      draftFromExpense(expense),
      "edit",
      expense,
    );
    controller.setAmountInput("50.00");

    const outcome = await controller.submit();

    expect(outcome.status).toBe("success");
    expect(api.createExpense).not.toHaveBeenCalled();
    expect(updateExpense).toHaveBeenCalledOnce();
    // AC: "the PATCH carries only the changed fields" — amount changed,
    // category/tags/comment/date did not, so none of them appear.
    expect(updateExpense).toHaveBeenCalledWith("exp-1", { amount: 5000 });
  });

  it("changing only the date sends only spent_at, leaving the amount untouched (Edge cases)", async () => {
    const expense = expenseResponse({ id: "exp-1", spent_at: "2026-08-02" });
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse());
    const api = fakeApi({ updateExpense });
    const controller = createController(api, CATEGORIES, "EUR", draftFromExpense(expense), "edit", expense);
    controller.setSpentAt("2026-07-01");

    await controller.submit();

    expect(updateExpense).toHaveBeenCalledWith("exp-1", { spent_at: "2026-07-01" });
  });

  it("changing only the category sends only category_id", async () => {
    const expense = expenseResponse({ id: "exp-1" });
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse());
    const api = fakeApi({ updateExpense });
    const controller = createController(api, CATEGORIES, "EUR", draftFromExpense(expense), "edit", expense);
    controller.setCategoryId("cat-transport");

    await controller.submit();

    expect(updateExpense).toHaveBeenCalledWith("exp-1", { category_id: "cat-transport" });
  });

  it("resolves a 'today' pill selection (null spentAt) to today, not the expense's original date", async () => {
    const expense = expenseResponse({ spent_at: "2026-07-20" });
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse());
    const api = fakeApi({ updateExpense });
    const controller = createController(
      api,
      CATEGORIES,
      "EUR",
      draftFromExpense(expense),
      "edit",
      expense,
      TODAY,
    );
    controller.setSpentAt(null); // the date row's own "today" convention

    await controller.submit();

    expect(updateExpense).toHaveBeenCalledWith(expense.id, expect.objectContaining({ spent_at: TODAY }));
  });

  it("rejects instead of silently posting a new expense when mode is 'edit' with no initialExpense", async () => {
    const api = fakeApi();
    const controller = createController(api, CATEGORIES, "EUR", validDraft(), "edit", null);

    await expect(controller.submit()).rejects.toThrow(/edit mode requires initialExpense/);

    expect(api.createExpense).not.toHaveBeenCalled();
  });

  it("sends an empty tag_ids array (not omitted) once every tag is cleared", async () => {
    const expense = expenseResponse({ tags: [tag("tag-vacation", "vacation")] });
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse());
    const api = fakeApi({ updateExpense });
    const controller = createController(
      api,
      CATEGORIES,
      "EUR",
      draftFromExpense(expense),
      "edit",
      expense,
    );
    controller.toggleTag("tag-vacation");

    await controller.submit();

    expect(updateExpense).toHaveBeenCalledWith(expense.id, expect.objectContaining({ tag_ids: [] }));
  });

  it("leaves the draft in place after a successful save, unlike create mode's reset", async () => {
    const expense = expenseResponse();
    const api = fakeApi({ updateExpense: vi.fn().mockResolvedValue(expenseResponse()) });
    const controller = createController(
      api,
      CATEGORIES,
      "EUR",
      draftFromExpense(expense),
      "edit",
      expense,
    );
    controller.setAmountInput("50.00");
    const changedDraft = controller.getDraft();

    await controller.submit();

    expect(controller.getDraft()).toEqual(changedDraft);
  });

  it("a duplicate rapid submit in edit mode still issues exactly one PATCH", async () => {
    let resolveUpdate: (value: ExpenseResponse) => void = () => {};
    const updateExpense = vi.fn(
      () =>
        new Promise<ExpenseResponse>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const expense = expenseResponse();
    const api = fakeApi({ updateExpense });
    const controller = createController(
      api,
      CATEGORIES,
      "EUR",
      draftFromExpense(expense),
      "edit",
      expense,
    );
    controller.setAmountInput("50.00");

    const first = controller.submit();
    const second = controller.submit();
    resolveUpdate(expenseResponse());
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(updateExpense).toHaveBeenCalledOnce();
    expect(firstOutcome.status).toBe("success");
    expect(secondOutcome).toEqual({ status: "blocked" });
  });

  it("is blocked (no PATCH sent) when nothing differs from the stored expense — MainButton's own disabled guard", async () => {
    const expense = expenseResponse();
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse());
    const api = fakeApi({ updateExpense });
    const controller = createController(api, CATEGORIES, "EUR", draftFromExpense(expense), "edit", expense);

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "blocked" });
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it("re-toggling a tag off and back on leaves the draft clean, so submit is still blocked", async () => {
    const expense = expenseResponse({ tags: [tag("tag-vacation", "vacation")] });
    const updateExpense = vi.fn().mockResolvedValue(expenseResponse());
    const api = fakeApi({ updateExpense });
    const controller = createController(api, CATEGORIES, "EUR", draftFromExpense(expense), "edit", expense);
    controller.toggleTag("tag-vacation");
    controller.toggleTag("tag-vacation");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "blocked" });
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it("maps 403 to the edit-specific message, distinct from create mode's", async () => {
    const expense = expenseResponse();
    const api = fakeApi({ updateExpense: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const controller = createController(api, CATEGORIES, "EUR", draftFromExpense(expense), "edit", expense);
    controller.setComment("changed");

    const outcome = await controller.submit();

    expect(outcome).toEqual({
      status: "error",
      message: "You don't have permission to edit this expense.",
    });
  });

  // -- U1.4: stale expense vs. stale category, both a 404 on the same PATCH -

  it("a 404 with no category_id in the payload is a stale *expense*, not a stale category", async () => {
    // Only the comment changed — `editChanges` never puts `category_id` in
    // the payload, so `services/expense_service.py::update`'s own category
    // check never runs server-side; a 404 here can only be the expense.
    const expense = expenseResponse();
    const updateExpense = vi.fn().mockRejectedValue(new NotFoundError());
    const api = fakeApi({ updateExpense });
    const controller = createController(api, CATEGORIES, "EUR", draftFromExpense(expense), "edit", expense);
    controller.setComment("changed");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "error", message: "That expense no longer exists." });
    // Not the stale-*category* recovery — no refetch, selection untouched.
    expect(api.listCategories).not.toHaveBeenCalled();
    expect(controller.getDraft().categoryId).toBe("cat-groceries");
  });

  it("a 404 with category_id in the payload falls back to the stale-category message and recovery", async () => {
    const expense = expenseResponse();
    const REFETCHED = [category("cat-transport", "Transport")];
    const updateExpense = vi.fn().mockRejectedValue(new NotFoundError());
    const api = fakeApi({ updateExpense, listCategories: vi.fn().mockResolvedValue(REFETCHED) });
    const controller = createController(api, CATEGORIES, "EUR", draftFromExpense(expense), "edit", expense);
    controller.setCategoryId("cat-transport");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "error", message: "That category no longer exists." });
    expect(api.listCategories).toHaveBeenCalledOnce();
    expect(controller.getDraft().categoryId).toBeNull();
  });
});

// -- editChanges / isEditDirty / editButtonState (U1.4) --------------------

describe("editChanges", () => {
  it("is empty when the draft matches the stored expense exactly", () => {
    const expense = expenseResponse();
    expect(editChanges(draftFromExpense(expense), expense, TODAY)).toEqual({});
  });

  it("carries only amount when only the amount changed", () => {
    const expense = expenseResponse({ amount: 3840 });
    const draft = { ...draftFromExpense(expense), amountInput: "50.00" };
    expect(editChanges(draft, expense, TODAY)).toEqual({ amount: 5000 });
  });

  it("carries only category_id when only the category changed", () => {
    const expense = expenseResponse({ category_id: "cat-groceries" });
    const draft = { ...draftFromExpense(expense), categoryId: "cat-transport" };
    expect(editChanges(draft, expense, TODAY)).toEqual({ category_id: "cat-transport" });
  });

  it("carries only spent_at when only the date changed", () => {
    const expense = expenseResponse({ spent_at: "2026-08-02" });
    const draft = { ...draftFromExpense(expense), spentAt: "2026-07-01" };
    expect(editChanges(draft, expense, TODAY)).toEqual({ spent_at: "2026-07-01" });
  });

  it("resolves a null (today-pill) spentAt against 'today', not the expense's own date", () => {
    const expense = expenseResponse({ spent_at: "2026-07-20" });
    const draft = { ...draftFromExpense(expense), spentAt: null };
    expect(editChanges(draft, expense, TODAY)).toEqual({ spent_at: TODAY });
  });

  it("treats tags as a set — reordering the same tags is not a change", () => {
    const expense = expenseResponse({ tags: [tag("tag-vacation", "vacation"), tag("tag-work", "work")] });
    const draft = { ...draftFromExpense(expense), tagIds: ["tag-work", "tag-vacation"] };
    expect(editChanges(draft, expense, TODAY)).toEqual({});
  });

  it("carries tag_ids when the tag set actually differs", () => {
    const expense = expenseResponse({ tags: [tag("tag-vacation", "vacation")] });
    const draft = { ...draftFromExpense(expense), tagIds: ["tag-vacation", "tag-work"] };
    expect(editChanges(draft, expense, TODAY)).toEqual({ tag_ids: ["tag-vacation", "tag-work"] });
  });

  it("carries comment: null when a comment is cleared entirely", () => {
    const expense = expenseResponse({ comment: "weekly shop" });
    const draft = { ...draftFromExpense(expense), comment: "" };
    expect(editChanges(draft, expense, TODAY)).toEqual({ comment: null });
  });

  it("carries every field at once when everything changed", () => {
    const expense = expenseResponse({
      amount: 3840,
      category_id: "cat-groceries",
      spent_at: "2026-08-02",
      comment: null,
      tags: [],
    });
    const draft: Draft = {
      amountInput: "50.00",
      categoryId: "cat-transport",
      spentAt: "2026-07-01",
      comment: "new note",
      tagIds: ["tag-vacation"],
    };
    expect(editChanges(draft, expense, TODAY)).toEqual({
      amount: 5000,
      category_id: "cat-transport",
      spent_at: "2026-07-01",
      comment: "new note",
      tag_ids: ["tag-vacation"],
    });
  });
});

describe("isEditDirty", () => {
  it("is false for an unmodified edit draft", () => {
    const expense = expenseResponse();
    expect(isEditDirty(draftFromExpense(expense), expense, TODAY)).toBe(false);
  });

  it("is true once any field differs", () => {
    const expense = expenseResponse();
    const draft = { ...draftFromExpense(expense), comment: "changed" };
    expect(isEditDirty(draft, expense, TODAY)).toBe(true);
  });
});

describe("editButtonState", () => {
  it("reads 'Choose a category' disabled when the category is cleared", () => {
    const expense = expenseResponse();
    const draft = { ...draftFromExpense(expense), categoryId: null };
    expect(editButtonState(draft, expense, TODAY)).toEqual({ label: "Choose a category", enabled: false });
  });

  it("reads 'Enter an amount' disabled when the amount is unparseable", () => {
    const expense = expenseResponse();
    const draft = { ...draftFromExpense(expense), amountInput: "abc" };
    expect(editButtonState(draft, expense, TODAY)).toEqual({ label: "Enter an amount", enabled: false });
  });

  it("reads 'Save changes' disabled when nothing differs", () => {
    const expense = expenseResponse();
    expect(editButtonState(draftFromExpense(expense), expense, TODAY)).toEqual({
      label: "Save changes",
      enabled: false,
    });
  });

  it("reads 'Save changes' enabled once a field differs", () => {
    const expense = expenseResponse();
    const draft = { ...draftFromExpense(expense), comment: "changed" };
    expect(editButtonState(draft, expense, TODAY)).toEqual({ label: "Save changes", enabled: true });
  });

  it("stays enabled for an archived current category not in the account's active list", () => {
    // Unlike `submitButtonState`, this must not require `categoryId` to be
    // found in any `categories` list — the archived-category edge case
    // depends on that category staying selected without blocking Save.
    const expense = expenseResponse({ category_id: "cat-archived" });
    const draft = { ...draftFromExpense(expense), comment: "changed" };
    expect(editButtonState(draft, expense, TODAY)).toEqual({ label: "Save changes", enabled: true });
  });
});

// -- renderAddExpense / renderForm ----------------------------------------

const READY = {
  categories: CATEGORIES,
  tags: TAGS,
  currency: "EUR" as const,
  accountName: "Family",
  today: TODAY,
};

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

  it("renders only the '+ Add tag' chip when the account has no tags", () => {
    const html = renderForm({ ...READY, tags: [] }, emptyDraft());
    expect(html).toContain('data-testid="tag-chips"');
    expect(html).toContain('data-testid="tag-add-chip"');
    expect(html).not.toContain('data-tag-id');
  });

  it("puts '+ Add tag' last, after every real tag chip", () => {
    const html = renderForm(READY, emptyDraft());
    const tagIdIndex = html.indexOf('data-tag-id="tag-vacation"');
    const addChipIndex = html.indexOf('data-testid="tag-add-chip"');
    expect(tagIdIndex).toBeGreaterThan(-1);
    expect(addChipIndex).toBeGreaterThan(tagIdIndex);
  });

  it("marks a selected tag chip active and leaves others unselected", () => {
    const html = renderForm(READY, { ...emptyDraft(), tagIds: ["tag-vacation"] });
    expect(html).toMatch(/class="chip active"[^>]*data-tag-id="tag-vacation"/);
  });

  it("caps the comment field at 4096 characters with no counter", () => {
    const html = renderForm(READY, emptyDraft());
    expect(html).toContain('maxlength="4096"');
    expect(html).not.toMatch(/\d+\s*\/\s*4096/);
  });

  it("labels the Tags and Comment regions", () => {
    const html = renderForm(READY, emptyDraft());
    expect(html).toContain('<div class="field-label">Tags</div>');
    expect(html).toContain('<div class="field-label">Comment</div>');
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

  // -- U1.4: 02b's archived-current-category edge case --------------------

  it("renders the selected category dimmed and disabled when it's archived (not in the active list)", () => {
    const archived = { ...category("cat-archived", "Retired"), is_active: false, color_slot: 3 };
    const html = renderForm({ ...READY, categories: [...CATEGORIES, archived] }, {
      ...emptyDraft(),
      categoryId: "cat-archived",
    });
    expect(html).toMatch(/class="cp-cell selected cp-cell-archived"[^>]*data-category-id="cat-archived"[^>]* disabled/);
    expect(html).toContain(">Retired<");
    expect(html).toContain("background:var(--category-slot-3)");
  });

  it("does not render any archived category when none is currently selected", () => {
    const archived = { ...category("cat-archived", "Retired"), is_active: false };
    const html = renderForm({ ...READY, categories: [...CATEGORIES, archived] }, {
      ...emptyDraft(),
      categoryId: "cat-groceries",
    });
    expect(html).not.toContain("cat-archived");
    expect(html).not.toContain("cp-cell-archived");
  });

  it("stops rendering the archived cell once the selection moves to a different (active) category", () => {
    const archived = { ...category("cat-archived", "Retired"), is_active: false };
    const html = renderForm({ ...READY, categories: [...CATEGORIES, archived] }, {
      ...emptyDraft(),
      categoryId: "cat-transport",
    });
    expect(html).not.toContain("cat-archived");
  });

  it("renders a submit error banner when passed one", () => {
    const html = renderForm(READY, emptyDraft(), { submitError: "That category no longer exists." });
    expect(html).toContain('data-testid="submit-error"');
    expect(html).toContain("That category no longer exists.");
  });

  it("renders three date pills reading today/yesterday/two days ago, with today's dates above, today selected", () => {
    const html = renderForm(READY, emptyDraft());
    expect(html).toContain('data-testid="date-pill-2026-08-04"');
    expect(html).toContain('data-testid="date-pill-2026-08-03"');
    expect(html).toContain('data-testid="date-pill-2026-08-02"');
    expect(html).toMatch(/class="date-pill selected"[^>]*data-date="2026-08-04"/);
    expect(html).toMatch(/8\/4[\s\S]*?today/);
    expect(html).toMatch(/8\/3[\s\S]*?yesterday/);
    expect(html).toMatch(/8\/2[\s\S]*?two days ago/);
    expect(html).toContain('data-testid="date-calendar-button"');
  });

  it("selects the yesterday pill once the draft's date is set to it", () => {
    const html = renderForm(READY, { ...emptyDraft(), spentAt: "2026-08-03" });
    expect(html).toMatch(/class="date-pill selected"[^>]*data-date="2026-08-03"/);
    expect(html).not.toMatch(/class="date-pill selected"[^>]*data-date="2026-08-04"/);
  });

  it("adds a fourth selected pill for a date outside the three shortcuts", () => {
    const html = renderForm(READY, { ...emptyDraft(), spentAt: "2026-07-20" });
    expect(html).toMatch(/class="date-pill selected"[^>]*data-date="2026-07-20"/);
    // The three fixed pills stay present, unselected.
    expect(html).toContain('data-testid="date-pill-2026-08-04"');
    expect(html).toContain('data-testid="date-pill-2026-08-03"');
    expect(html).toContain('data-testid="date-pill-2026-08-02"');
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

describe("applyEditExpenseChrome (U1.4)", () => {
  it("shows 'Save changes' disabled when the draft matches the stored expense", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const expense = expenseResponse();

    applyEditExpenseChrome(draftFromExpense(expense), expense, TODAY);

    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Save changes");
    expect(webApp.MainButton.disable).toHaveBeenCalledOnce();
  });

  it("shows 'Save changes' enabled once a field differs", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const expense = expenseResponse();

    applyEditExpenseChrome({ ...draftFromExpense(expense), comment: "changed" }, expense, TODAY);

    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Save changes");
    expect(webApp.MainButton.enable).toHaveBeenCalledOnce();
  });

  it("falls back to the same 'Choose a category' guard as create mode", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const expense = expenseResponse();

    applyEditExpenseChrome({ ...draftFromExpense(expense), categoryId: null }, expense, TODAY);

    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Choose a category");
    expect(webApp.MainButton.disable).toHaveBeenCalledOnce();
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

  it("(U1.4) accepts an edit-mode dirty check and its own discard copy", async () => {
    const showConfirm = vi.fn((_message: string, callback: (confirmed: boolean) => void) => callback(true));
    const webApp = fakeWebApp({ showConfirm });
    installWebApp(webApp);
    const onClose = vi.fn();
    const expense = expenseResponse();

    wireBackButton(() => ({ ...draftFromExpense(expense), comment: "changed" }), onClose, {
      isDirtyFn: (d) => isEditDirty(d, expense, TODAY),
      message: "Discard changes?",
    });
    const handler = (webApp.BackButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    await Promise.resolve();
    await Promise.resolve();

    expect(showConfirm).toHaveBeenCalledWith("Discard changes?", expect.any(Function));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("(U1.4) closes immediately, no popup, when the edit-mode dirty check says clean", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onClose = vi.fn();
    const expense = expenseResponse();

    wireBackButton(() => draftFromExpense(expense), onClose, {
      isDirtyFn: (d) => isEditDirty(d, expense, TODAY),
      message: "Discard changes?",
    });
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
