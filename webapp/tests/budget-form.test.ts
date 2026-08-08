import { describe, expect, it, vi } from "vitest";
import { ApiError, ForbiddenError, NotFoundError } from "../src/api/client";
import {
  amountFieldError,
  budgetFormValid,
  createBudgetFormController,
  DEFAULT_NOTIFY_THRESHOLD,
  isDirty,
  renderBudgetForm,
  thresholdFieldError,
  type BudgetFormApi,
  type BudgetFormMode,
} from "../src/screens/budget-form";

function fakeApi(overrides: Partial<BudgetFormApi> = {}): BudgetFormApi {
  return {
    createBudgetPlan: vi.fn().mockResolvedValue({
      id: "plan-groceries",
      category_id: "cat-groceries",
      amount: 5000,
      period: "monthly",
      notify_threshold: 70,
      account_id: "acc-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }),
    updateBudgetPlan: vi.fn().mockResolvedValue({
      id: "plan-groceries",
      category_id: "cat-groceries",
      amount: 30000,
      period: "monthly",
      notify_threshold: 90,
      account_id: "acc-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }),
    deleteBudgetPlan: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const CREATE_MODE: BudgetFormMode = {
  kind: "create",
  categoryId: "cat-groceries",
  categoryLabel: "Groceries",
  colorVar: "var(--category-slot-1)",
  currency: "EUR",
};

const EDIT_MODE: BudgetFormMode = {
  kind: "edit",
  planId: "plan-groceries",
  categoryId: "cat-groceries",
  categoryLabel: "Groceries",
  colorVar: "var(--category-slot-1)",
  currency: "EUR",
  amountMinor: 20000,
  spentMinor: 10000,
  notifyThreshold: 80,
};

// -- amountFieldError / thresholdFieldError / budgetFormValid ----------------
// Moved unchanged from budgets.test.ts (U3.1 contract) — U3.2 removes the
// originals along with the inline form they validated.

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

// -- isDirty ------------------------------------------------------------

describe("isDirty", () => {
  it("create mode is clean at the initial empty amount / default threshold", () => {
    expect(isDirty(CREATE_MODE, "", String(DEFAULT_NOTIFY_THRESHOLD))).toBe(false);
  });

  it("create mode is dirty once either field changes", () => {
    expect(isDirty(CREATE_MODE, "50.00", String(DEFAULT_NOTIFY_THRESHOLD))).toBe(true);
    expect(isDirty(CREATE_MODE, "", "65")).toBe(true);
  });

  it("edit mode is clean at the plan's own stored values", () => {
    expect(isDirty(EDIT_MODE, "200.00", "80")).toBe(false);
  });

  it("edit mode is dirty once either field differs from the plan", () => {
    expect(isDirty(EDIT_MODE, "300.00", "80")).toBe(true);
    expect(isDirty(EDIT_MODE, "200.00", "90")).toBe(true);
  });
});

// -- createBudgetFormController ----------------------------------------------

describe("createBudgetFormController", () => {
  it("create mode starts with an empty amount and the default threshold", () => {
    const controller = createBudgetFormController(fakeApi(), CREATE_MODE);
    const state = controller.getState();
    expect(state.amountDraft).toBe("");
    expect(state.thresholdDraft).toBe(String(DEFAULT_NOTIFY_THRESHOLD));
  });

  it("edit mode starts prefilled from the plan's stored amount/threshold", () => {
    const controller = createBudgetFormController(fakeApi(), EDIT_MODE);
    const state = controller.getState();
    expect(state.amountDraft).toBe("200.00");
    expect(state.thresholdDraft).toBe("80");
  });

  // D508 regression: the shipped inline form rendered Save disabled in create
  // mode and never re-evaluated it, because `budgets.ts::mount` called
  // `setAmountDraft` on `input` with no re-render. `mount`'s own input
  // listener does exactly `controller.setAmountDraft(value)` then
  // recomputes `budgetFormValid` — this is that computation, the same one a
  // dispatched `input` event drives, with `mount()` itself excluded as the
  // accepted DOM-glue gap (not unit-testable under Node).
  it("D508: create mode is invalid on open and becomes valid the moment a valid amount is set", () => {
    const controller = createBudgetFormController(fakeApi(), CREATE_MODE);
    expect(budgetFormValid(controller.getState().amountDraft, controller.getState().thresholdDraft)).toBe(false);
    controller.setAmountDraft("12.50");
    const state = controller.getState();
    expect(budgetFormValid(state.amountDraft, state.thresholdDraft)).toBe(true);
    expect(amountFieldError(state.amountDraft)).toBeNull();
  });

  it("setAmountDraft/setThresholdDraft update the inline error live", () => {
    const controller = createBudgetFormController(fakeApi(), CREATE_MODE);
    controller.setAmountDraft("abc");
    expect(amountFieldError(controller.getState().amountDraft)).not.toBeNull();
    controller.setThresholdDraft("101");
    expect(thresholdFieldError(controller.getState().thresholdDraft)).not.toBeNull();
  });

  it("save() blocked while the draft is invalid, and issues no request", async () => {
    const api = fakeApi();
    const controller = createBudgetFormController(api, CREATE_MODE);
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "blocked" });
    expect(api.createBudgetPlan).not.toHaveBeenCalled();
  });

  it("save() in create mode calls createBudgetPlan with the parsed minor-unit amount", async () => {
    const api = fakeApi();
    const controller = createBudgetFormController(api, CREATE_MODE);
    controller.setAmountDraft("50.00");
    controller.setThresholdDraft("70");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "success" });
    expect(api.createBudgetPlan).toHaveBeenCalledWith({
      category_id: "cat-groceries",
      amount: 5000,
      notify_threshold: 70,
    });
  });

  it("save() in edit mode calls updateBudgetPlan, not create", async () => {
    const api = fakeApi();
    const controller = createBudgetFormController(api, EDIT_MODE);
    controller.setAmountDraft("300.00");
    controller.setThresholdDraft("90");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "success" });
    expect(api.updateBudgetPlan).toHaveBeenCalledWith("plan-groceries", { amount: 30000, notify_threshold: 90 });
    expect(api.createBudgetPlan).not.toHaveBeenCalled();
  });

  it("double-tapping save() issues exactly one request", async () => {
    const api = fakeApi();
    const controller = createBudgetFormController(api, CREATE_MODE);
    controller.setAmountDraft("50.00");
    const [first, second] = await Promise.all([controller.save(), controller.save()]);
    expect([first, second]).toContainEqual({ status: "blocked" });
    expect([first, second]).toContainEqual({ status: "success" });
    expect(api.createBudgetPlan).toHaveBeenCalledTimes(1);
  });

  it("save() maps a 409 to the duplicate-plan message and preserves the draft", async () => {
    const api = fakeApi({ createBudgetPlan: vi.fn().mockRejectedValue(new ApiError("Conflict", 409)) });
    const controller = createBudgetFormController(api, CREATE_MODE);
    controller.setAmountDraft("50.00");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "error", message: "A budget plan already exists for this category and period." });
    expect(controller.getState().amountDraft).toBe("50.00");
  });

  it("save() maps a 403 to a human forbidden message", async () => {
    const api = fakeApi({ createBudgetPlan: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const controller = createBudgetFormController(api, CREATE_MODE);
    controller.setAmountDraft("50.00");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "error", message: "You don't have permission to do that." });
  });

  it("save() maps a 404 (category/plan gone) to a human message", async () => {
    const api = fakeApi({ updateBudgetPlan: vi.fn().mockRejectedValue(new NotFoundError()) });
    const controller = createBudgetFormController(api, EDIT_MODE);
    controller.setAmountDraft("300.00");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "error", message: "That category no longer exists." });
  });

  it("deleteBudget() in edit mode calls deleteBudgetPlan and succeeds", async () => {
    const api = fakeApi();
    const controller = createBudgetFormController(api, EDIT_MODE);
    const outcome = await controller.deleteBudget();
    expect(outcome).toEqual({ status: "success" });
    expect(api.deleteBudgetPlan).toHaveBeenCalledWith("plan-groceries");
  });

  it("deleteBudget() in create mode is a no-op error, never calls the API", async () => {
    const api = fakeApi();
    const controller = createBudgetFormController(api, CREATE_MODE);
    const outcome = await controller.deleteBudget();
    expect(outcome.status).toBe("error");
    expect(api.deleteBudgetPlan).not.toHaveBeenCalled();
  });

  it("deleteBudget() surfaces a 403 as a human message", async () => {
    const api = fakeApi({ deleteBudgetPlan: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const controller = createBudgetFormController(api, EDIT_MODE);
    const outcome = await controller.deleteBudget();
    expect(outcome).toEqual({ status: "error", message: "You don't have permission to do that." });
  });
});

// -- renderBudgetForm -----------------------------------------------------

describe("renderBudgetForm", () => {
  it("create mode: header, empty amount, threshold defaulted to 70, no spent line, no Delete", () => {
    const html = renderBudgetForm({ mode: CREATE_MODE, amountDraft: "", thresholdDraft: "70", saveError: null });
    expect(html).toContain('data-testid="budget-form-category">Groceries<');
    expect(html).toContain('style="background:var(--category-slot-1)"');
    expect(html).toContain('placeholder="70"');
    expect(html).toContain('value="70"');
    expect(html).not.toContain('data-testid="budget-form-spent"');
    expect(html).not.toContain('data-action="delete-budget"');
  });

  it("D508: Save is disabled on open in create mode and enabled once a valid amount is typed", () => {
    const closed = renderBudgetForm({ mode: CREATE_MODE, amountDraft: "", thresholdDraft: "70", saveError: null });
    expect(closed).toContain('data-action="save-budget" disabled');

    const typed = renderBudgetForm({ mode: CREATE_MODE, amountDraft: "12.50", thresholdDraft: "70", saveError: null });
    expect(typed).toContain('data-action="save-budget">Save');
    expect(typed).not.toContain('data-action="save-budget" disabled');
  });

  it("edit mode: names the category, states the spend, shows Delete, and Save starts enabled", () => {
    const html = renderBudgetForm({ mode: EDIT_MODE, amountDraft: "200.00", thresholdDraft: "80", saveError: null });
    expect(html).toContain('data-testid="budget-form-spent">Spent 100.00 of 200.00 EUR this month<');
    expect(html).toContain('data-testid="budget-form-delete"');
    expect(html).toContain("Delete budget");
    expect(html).toContain('data-action="save-budget">Save');
  });

  it("edit mode: Save goes disabled if the amount is cleared", () => {
    const html = renderBudgetForm({ mode: EDIT_MODE, amountDraft: "", thresholdDraft: "80", saveError: null });
    expect(html).toContain('data-action="save-budget" disabled');
  });

  it("shows the inline amount/threshold errors, live-announced", () => {
    const html = renderBudgetForm({ mode: CREATE_MODE, amountDraft: "abc", thresholdDraft: "150", saveError: null });
    expect(html).toContain('data-testid="budget-amount-error" aria-live="polite">Enter an amount greater than 0.<');
    expect(html).toContain('data-testid="budget-threshold-error" aria-live="polite">Enter a whole number 0-100.<');
  });

  it("renders the submit-error banner only when a save failed", () => {
    const withError = renderBudgetForm({
      mode: CREATE_MODE,
      amountDraft: "",
      thresholdDraft: "70",
      saveError: "Something went wrong. Please try again.",
    });
    expect(withError).toContain('data-testid="budget-form-save-error"');
    expect(withError).toContain("Something went wrong. Please try again.");

    const clean = renderBudgetForm({ mode: CREATE_MODE, amountDraft: "", thresholdDraft: "70", saveError: null });
    expect(clean).not.toContain('data-testid="budget-form-save-error"');
  });

  it("both inputs carry a real <label for>, not placeholder-only labelling", () => {
    const html = renderBudgetForm({ mode: CREATE_MODE, amountDraft: "", thresholdDraft: "70", saveError: null });
    expect(html).toContain('<label class="cat-form-label" for="budget-amount-input">Monthly limit</label>');
    expect(html).toContain('<label class="cat-form-label" for="budget-threshold-input">Warn me at</label>');
  });

  it("the currency suffix comes from the mode, not a literal", () => {
    const usd: BudgetFormMode = { ...CREATE_MODE, currency: "USD" };
    const html = renderBudgetForm({ mode: usd, amountDraft: "", thresholdDraft: "70", saveError: null });
    expect(html).toContain('<div class="currency-suffix">USD</div>');
  });
});
