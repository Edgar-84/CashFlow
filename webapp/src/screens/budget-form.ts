/** Screen 04b — Budget form (docs/ui/screens/04b-budget-form.md, plan unit
 * U3.1, `docs/plans/mini-app-v5.md`). Standalone screen module — **not yet
 * reachable from anywhere**; U3.2 wires `screens/budgets.ts` to navigate here
 * and deletes the inline form this replaces
 * (`screens/budgets.ts::renderBudgetForm`) together with its tests.
 *
 * `BudgetFormMode` carries the label, colour and current values because
 * `04-budgets.md` already loaded them — this screen fetches nothing on open,
 * same "no refetch" shape as `expense-detail.ts` handing a loaded expense to
 * screen 02b. D512: the contract in the plan omits `currency` from
 * `BudgetFormMode`, but region 3's currency suffix and region 2's spend line
 * both need it and this screen fetches nothing to derive it from — added to
 * both variants as the same kind of already-loaded value the rest of the
 * type carries, following the type's own stated rationale.
 *
 * D508 fix: the shipped inline form's Save button never re-evaluated after
 * the first render (`budgets.ts::mount`'s `wire()` called `setAmountDraft`
 * on `input` with no re-render), so a create draft — which starts with an
 * empty amount — stayed disabled forever. This screen follows
 * `add-expense.ts::wireForm`'s pattern instead: patch the inline error text
 * and the Save button's `disabled` property in place on every keystroke,
 * never re-render the form while a field has focus.
 */

import { formatAmount, parseAmount } from "../lib/money";
import { confirmAction, confirmDiscard, haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ApiError, ForbiddenError, NotFoundError } from "../api/client";
import type { BudgetPlanResponse, Currency, Uuid } from "../api/types";

export type BudgetFormMode =
  | { kind: "create"; categoryId: Uuid; categoryLabel: string; colorVar: string; currency: Currency }
  | {
      kind: "edit";
      planId: Uuid;
      categoryId: Uuid;
      categoryLabel: string;
      colorVar: string;
      currency: Currency;
      amountMinor: number;
      spentMinor: number;
      notifyThreshold: number;
    };

export interface BudgetFormApi {
  createBudgetPlan(d: { category_id: Uuid; amount: number; notify_threshold: number }): Promise<BudgetPlanResponse>;
  updateBudgetPlan(id: Uuid, d: { amount: number; notify_threshold: number }): Promise<BudgetPlanResponse>;
  deleteBudgetPlan(id: Uuid): Promise<void>;
}

// -- validation (moved from budgets.ts unchanged — same functions, same
//    strings, same rules; U3.2 deletes the originals) ------------------------

export const DEFAULT_NOTIFY_THRESHOLD = 70;

/** Inline amount error, same "never a popup" convention as
 * `add-expense.ts::amountError`. `null` while untouched (empty) or valid. */
export function amountFieldError(amountDraft: string): string | null {
  if (amountDraft.trim() === "") {
    return null;
  }
  return parseAmount(amountDraft) === null ? "Enter an amount greater than 0." : null;
}

/** Mirrors the bot's `_parse_notify_threshold` (bot/handlers/budgets.py):
 * a whole number 0-100. `null` while untouched (empty) or valid. */
export function thresholdFieldError(thresholdDraft: string): string | null {
  const trimmed = thresholdDraft.trim();
  if (trimmed === "") {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return "Enter a whole number 0-100.";
  }
  const value = Number(trimmed);
  return value >= 0 && value <= 100 ? null : "Enter a whole number 0-100.";
}

export function budgetFormValid(amountDraft: string, thresholdDraft: string): boolean {
  return (
    parseAmount(amountDraft) !== null &&
    thresholdDraft.trim() !== "" &&
    thresholdFieldError(thresholdDraft) === null
  );
}

/** Dirty rule (screen doc's Interactions section): in create mode, either
 * field differs from its initial value (empty amount, threshold `70`); in
 * edit mode, either differs from the plan's stored values. Gates Cancel and
 * BackButton's confirm popup. */
export function isDirty(mode: BudgetFormMode, amountDraft: string, thresholdDraft: string): boolean {
  if (mode.kind === "create") {
    return amountDraft.trim() !== "" || thresholdDraft.trim() !== String(DEFAULT_NOTIFY_THRESHOLD);
  }
  return (
    amountDraft.trim() !== formatAmount(mode.amountMinor) || thresholdDraft.trim() !== String(mode.notifyThreshold)
  );
}

// -- controller --------------------------------------------------------------

export interface BudgetFormViewState {
  mode: BudgetFormMode;
  amountDraft: string;
  thresholdDraft: string;
  saveError: string | null;
}

export type SaveOutcome = { status: "success" } | { status: "blocked" } | { status: "error"; message: string };
export type DeleteOutcome = { status: "success" } | { status: "error"; message: string };

export interface BudgetFormController {
  getState(): BudgetFormViewState;
  setAmountDraft(value: string): void;
  setThresholdDraft(value: string): void;
  save(): Promise<SaveOutcome>;
  deleteBudget(): Promise<DeleteOutcome>;
}

/** Mirrors `bot/handlers/budgets.py`'s own error copy, same mapping
 * `budgets.ts::saveErrorMessage` already uses — a deleted plan and a deleted
 * category both surface as `NotFoundError` and share the same "gone" copy
 * (screen doc's Edge cases: "the PATCH 404s and surfaces error.gone"). */
function saveErrorMessage(err: unknown): string {
  if (err instanceof ForbiddenError) {
    return "You don't have permission to do that.";
  }
  if (err instanceof NotFoundError) {
    return "That category no longer exists.";
  }
  if (err instanceof ApiError && err.status === 409) {
    return "A budget plan already exists for this category and period.";
  }
  if (err instanceof ApiError) {
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

/** Owns the draft and its two round trips. `saving`/`deleting` flip true
 * synchronously (before the first `await`) so a caller that calls `save()`
 * twice back to back — a double tap — has its second call rejected with
 * `blocked` before either request lands, same guard shape
 * `expense-detail.ts::createDetailController` uses for delete. */
export function createBudgetFormController(api: BudgetFormApi, mode: BudgetFormMode): BudgetFormController {
  let amountDraft = mode.kind === "edit" ? formatAmount(mode.amountMinor) : "";
  let thresholdDraft = mode.kind === "edit" ? String(mode.notifyThreshold) : String(DEFAULT_NOTIFY_THRESHOLD);
  let saveError: string | null = null;
  let saving = false;
  let deleting = false;

  return {
    getState: () => ({ mode, amountDraft, thresholdDraft, saveError }),
    setAmountDraft(value): void {
      amountDraft = value;
    },
    setThresholdDraft(value): void {
      thresholdDraft = value;
    },
    async save(): Promise<SaveOutcome> {
      if (saving || !budgetFormValid(amountDraft, thresholdDraft)) {
        return { status: "blocked" };
      }
      const minor = parseAmount(amountDraft);
      if (minor === null) {
        return { status: "blocked" };
      }
      const threshold = Number(thresholdDraft.trim());
      saving = true;
      saveError = null;
      try {
        if (mode.kind === "create") {
          await api.createBudgetPlan({ category_id: mode.categoryId, amount: minor, notify_threshold: threshold });
        } else {
          await api.updateBudgetPlan(mode.planId, { amount: minor, notify_threshold: threshold });
        }
        return { status: "success" };
      } catch (err) {
        saveError = saveErrorMessage(err);
        return { status: "error", message: saveError };
      } finally {
        saving = false;
      }
    },
    async deleteBudget(): Promise<DeleteOutcome> {
      if (mode.kind !== "edit" || deleting) {
        return { status: "error", message: "That budget plan no longer exists." };
      }
      deleting = true;
      saveError = null;
      try {
        await api.deleteBudgetPlan(mode.planId);
        return { status: "success" };
      } catch (err) {
        saveError = saveErrorMessage(err);
        return { status: "error", message: saveError };
      } finally {
        deleting = false;
      }
    },
  };
}

// -- presentation --------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderBudgetForm(state: BudgetFormViewState): string {
  const { mode, amountDraft, thresholdDraft, saveError } = state;
  const isEdit = mode.kind === "edit";
  const amountErr = amountFieldError(amountDraft);
  const thresholdErr = thresholdFieldError(thresholdDraft);
  const valid = budgetFormValid(amountDraft, thresholdDraft);
  const spentLine = isEdit
    ? `<p class="budget-form-spent" data-testid="budget-form-spent">Spent ${escapeHtml(formatAmount(mode.spentMinor))} of ${escapeHtml(formatAmount(mode.amountMinor))} ${escapeHtml(mode.currency)} this month</p>`
    : "";
  const deleteTrigger = isEdit
    ? `<button type="button" class="budget-form-delete" data-testid="budget-form-delete" data-action="delete-budget">Delete budget</button>`
    : "";
  return `<div class="budget-form-screen" data-testid="budget-form-screen">
    <div class="budget-form-header">
      <span class="dot" aria-hidden="true" style="background:${mode.colorVar}"></span>
      <span class="budget-form-category" data-testid="budget-form-category">${escapeHtml(mode.categoryLabel)}</span>
    </div>
    ${spentLine}
    <div class="budget-form-field">
      <label class="cat-form-label" for="budget-amount-input">Monthly limit</label>
      <div class="card field">
        <input id="budget-amount-input" class="amount-input" data-testid="budget-amount-input" inputmode="decimal" value="${escapeHtml(amountDraft)}" placeholder="0.00" />
        <div class="currency-suffix">${escapeHtml(mode.currency)}</div>
      </div>
      <p class="field-error" data-testid="budget-amount-error" aria-live="polite">${amountErr ? escapeHtml(amountErr) : ""}</p>
    </div>
    <div class="budget-form-field">
      <label class="cat-form-label" for="budget-threshold-input">Warn me at</label>
      <div class="card field">
        <input id="budget-threshold-input" class="amount-input" data-testid="budget-threshold-input" inputmode="numeric" value="${escapeHtml(thresholdDraft)}" placeholder="${DEFAULT_NOTIFY_THRESHOLD}" />
        <div class="currency-suffix">%</div>
      </div>
      <p class="field-error" data-testid="budget-threshold-error" aria-live="polite">${thresholdErr ? escapeHtml(thresholdErr) : ""}</p>
    </div>
    ${saveError ? `<p class="submit-error" data-testid="budget-form-save-error">${escapeHtml(saveError)}</p>` : ""}
    <div class="detail-edit-actions budget-form-actions">
      <button type="button" data-action="save-budget"${valid ? "" : " disabled"}>Save</button>
      <button type="button" data-action="cancel-budget">Cancel</button>
    </div>
    ${deleteTrigger}
  </div>`;
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface BudgetFormHandlers {
  onSaved: () => void;
  onCancelled: () => void;
  onDeleted: () => void;
}

export function mount(root: HTMLElement, mode: BudgetFormMode, api: BudgetFormApi, handlers: BudgetFormHandlers): void {
  if (typeof document === "undefined") {
    return;
  }

  const controller = createBudgetFormController(api, mode);
  // `#app` is shared by every screen (main.ts) — once the user navigates
  // away, an in-flight save/delete must not touch it. Same guard shape
  // `expense-detail.ts`/`add-expense.ts` already use.
  let active = true;
  // Guards the delete confirm popup against a double tap before it renders —
  // one popup, one DELETE (same shape as `expense-detail.ts`'s `confirming`).
  let confirming = false;

  root.innerHTML = renderBudgetForm(controller.getState());
  // Screen doc's "Telegram" section: this is the first screen to answer
  // MainButton-or-custom with custom — MainButton stays hidden for its
  // whole lifetime.
  mainButton.hide();

  const requestClose = (): void => {
    const state = controller.getState();
    if (!isDirty(state.mode, state.amountDraft, state.thresholdDraft)) {
      active = false;
      handlers.onCancelled();
      return;
    }
    void confirmDiscard("Discard changes?").then((confirmed) => {
      if (confirmed && active) {
        active = false;
        handlers.onCancelled();
      }
    });
  };

  setBackButtonHandler(requestClose);

  const patchValidity = (): void => {
    const state = controller.getState();
    const amountErrorEl = root.querySelector<HTMLElement>('[data-testid="budget-amount-error"]');
    if (amountErrorEl) {
      amountErrorEl.textContent = amountFieldError(state.amountDraft) ?? "";
    }
    const thresholdErrorEl = root.querySelector<HTMLElement>('[data-testid="budget-threshold-error"]');
    if (thresholdErrorEl) {
      thresholdErrorEl.textContent = thresholdFieldError(state.thresholdDraft) ?? "";
    }
    const saveButton = root.querySelector<HTMLButtonElement>('[data-action="save-budget"]');
    if (saveButton) {
      saveButton.disabled = !budgetFormValid(state.amountDraft, state.thresholdDraft);
    }
  };

  const showSaveError = (message: string | null): void => {
    const actions = root.querySelector('.budget-form-actions');
    const existing = root.querySelector<HTMLElement>('[data-testid="budget-form-save-error"]');
    if (!message) {
      existing?.remove();
      return;
    }
    if (existing) {
      existing.textContent = message;
      return;
    }
    const banner = document.createElement("p");
    banner.className = "submit-error";
    banner.dataset.testid = "budget-form-save-error";
    banner.textContent = message;
    actions?.before(banner);
  };

  const wire = (): void => {
    const amountInput = root.querySelector<HTMLInputElement>('[data-testid="budget-amount-input"]');
    amountInput?.addEventListener("input", () => {
      controller.setAmountDraft(amountInput.value);
      patchValidity();
    });

    const thresholdInput = root.querySelector<HTMLInputElement>('[data-testid="budget-threshold-input"]');
    thresholdInput?.addEventListener("input", () => {
      controller.setThresholdDraft(thresholdInput.value);
      patchValidity();
    });

    root.querySelector('[data-action="save-budget"]')?.addEventListener("click", () => {
      const saveButton = root.querySelector<HTMLButtonElement>('[data-action="save-budget"]');
      if (saveButton) {
        saveButton.disabled = true;
      }
      void controller.save().then((outcome) => {
        if (!active) {
          return;
        }
        if (outcome.status === "success") {
          haptics.notification("success");
          active = false;
          handlers.onSaved();
        } else if (outcome.status === "error") {
          showSaveError(outcome.message);
          patchValidity();
        }
        // "blocked" only fires from a stale double tap racing the button's
        // own `disabled` — nothing left to update.
      });
    });

    root.querySelector('[data-action="cancel-budget"]')?.addEventListener("click", requestClose);

    root.querySelector('[data-action="delete-budget"]')?.addEventListener("click", () => {
      if (confirming || mode.kind !== "edit") {
        return;
      }
      confirming = true;
      void confirmAction("Delete this budget plan?").then(async (confirmed) => {
        confirming = false;
        if (!confirmed || !active) {
          return;
        }
        haptics.impact();
        const outcome = await controller.deleteBudget();
        if (!active) {
          return;
        }
        if (outcome.status === "success") {
          haptics.notification("success");
          active = false;
          handlers.onDeleted();
        } else {
          showSaveError(outcome.message);
        }
      });
    });
  };

  wire();

  // Screen doc's Viewport section: focus the amount field on open in create
  // mode only, so the keyboard opens over regions 5-8; edit mode leaves the
  // whole form visible first.
  if (mode.kind === "create") {
    root.querySelector<HTMLInputElement>('[data-testid="budget-amount-input"]')?.focus();
  }
}
