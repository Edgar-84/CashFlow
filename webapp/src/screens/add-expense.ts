/** Screen 02 — Add expense (docs/design/mini-app-ux.md §4). The one-surface
 * composer: amount focused on open, category chips (required, single-select),
 * tag chips (optional, multi-select), comment, then the Telegram MainButton
 * restates the action and submits.
 *
 * Layers, same split as screens/home.ts:
 *  - data: `loadAddExpenseData` fetches the categories/tags/currency the form
 *    needs, mirroring `loadHome`'s never-throws contract.
 *  - draft: `createController` owns the in-progress `Draft` and the
 *    double-submit guard (D118/D123's shape) — pure aside from the awaited
 *    `createExpense` call, so it's directly unit-testable without a DOM.
 *  - presentation: `renderAddExpense`/`renderForm` (pure, HTML strings) and
 *    `mount` (thin DOM glue, the one part with no meaningful unit test — same
 *    accepted gap as home.ts's `mount`).
 */

import { formatAmount, parseAmount } from "../lib/money";
import { confirmDiscard, haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ApiError, ForbiddenError, NotFoundError } from "../api/client";
import type {
  CategoryResponse,
  Currency,
  ExpenseCreate,
  ExpenseResponse,
  TagResponse,
  Uuid,
} from "../api/types";

// -- data --------------------------------------------------------------------

export interface AddExpenseApi {
  getMe(): Promise<{ currency: Currency }>;
  listCategories(): Promise<CategoryResponse[]>;
  listTags(): Promise<TagResponse[]>;
  createExpense(data: ExpenseCreate): Promise<ExpenseResponse>;
}

export interface AddExpenseFormData {
  categories: CategoryResponse[];
  tags: TagResponse[];
  currency: Currency;
}

export interface AddExpenseSnapshot {
  data: AddExpenseFormData;
  syncedAt: string;
}

export interface AddExpenseCache {
  get(): AddExpenseSnapshot | null;
  set(snapshot: AddExpenseSnapshot): void;
}

export function createMemoryCache(): AddExpenseCache {
  let snapshot: AddExpenseSnapshot | null = null;
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
    },
  };
}

export type AddExpenseLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "forbidden" }
  | { status: "empty" }
  | ({ status: "ready" } & AddExpenseFormData)
  | ({ status: "offline"; lastSyncedAt: string } & AddExpenseFormData);

/** Loads the categories/tags/currency the form's chips need. Never throws —
 * every failure resolves to a state the caller can render directly, same
 * contract as `screens/home.ts::loadHome`. */
export async function loadAddExpenseData(
  api: AddExpenseApi,
  cache: AddExpenseCache,
): Promise<AddExpenseLoadState> {
  try {
    const [me, categories, tags] = await Promise.all([
      api.getMe(),
      api.listCategories(),
      api.listTags(),
    ]);
    const data: AddExpenseFormData = { categories, tags, currency: me.currency };
    cache.set({ data, syncedAt: new Date().toISOString() });
    return categories.length === 0 ? { status: "empty" } : { status: "ready", ...data };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { status: "forbidden" };
    }
    const cached = cache.get();
    if (cached) {
      return { status: "offline", lastSyncedAt: cached.syncedAt, ...cached.data };
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { status: "error", message };
  }
}

// -- draft ---------------------------------------------------------------

export interface Draft {
  amountInput: string;
  categoryId: Uuid | null;
  tagIds: Uuid[];
  comment: string;
}

export function emptyDraft(): Draft {
  return { amountInput: "", categoryId: null, tagIds: [], comment: "" };
}

export function isDirty(draft: Draft): boolean {
  return (
    draft.amountInput.trim() !== "" ||
    draft.categoryId !== null ||
    draft.tagIds.length > 0 ||
    draft.comment.trim() !== ""
  );
}

/** The inline amount error (never a popup, per the AC). `null` while the
 * field is untouched (empty) or the amount is valid. */
export function amountError(amountInput: string): string | null {
  if (amountInput.trim() === "") {
    return null;
  }
  return parseAmount(amountInput) === null ? "Enter an amount greater than 0." : null;
}

export interface SubmitButtonState {
  label: string;
  enabled: boolean;
}

/** MainButton label/enabled per the AC: disabled and "Choose a category"
 * until one is picked, then restates the action (`Add 38.40 EUR to
 * Groceries`). Fills a gap the AC doesn't name: a category picked before a
 * valid amount keeps the button disabled too, with an "Enter an amount"
 * label — "Add ... to Category" shouldn't promise a submit that would fail
 * validation. */
export function submitButtonState(
  draft: Draft,
  categories: CategoryResponse[],
  currency: Currency,
): SubmitButtonState {
  if (!draft.categoryId) {
    return { label: "Choose a category", enabled: false };
  }
  const category = categories.find((c) => c.id === draft.categoryId);
  const minor = parseAmount(draft.amountInput);
  if (minor === null || !category) {
    return { label: "Enter an amount", enabled: false };
  }
  return { label: `Add ${formatAmount(minor)} ${currency} to ${category.name}`, enabled: true };
}

export type SubmitOutcome =
  | { status: "success"; expense: ExpenseResponse }
  | { status: "blocked" }
  | { status: "error"; message: string };

function submitErrorMessage(err: unknown): string {
  if (err instanceof ForbiddenError) {
    return "You don't have permission to add expenses.";
  }
  if (err instanceof NotFoundError) {
    return "That category no longer exists. Choose another and try again.";
  }
  if (err instanceof ApiError) {
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

export interface AddExpenseController {
  getDraft(): Draft;
  setAmountInput(value: string): void;
  setCategoryId(id: Uuid): void;
  toggleTag(id: Uuid): void;
  setComment(value: string): void;
  submit(): Promise<SubmitOutcome>;
}

/** Owns the in-progress draft and the double-submit guard. `submitting` is
 * flipped synchronously before the first `await`, so two `submit()` calls
 * issued back-to-back (a real double-tap) both run before either resolves —
 * the second sees the flag already set and short-circuits. Only the first
 * reaches `createExpense` (AC: "exactly one POST", same shape as the bot's
 * D118/D123 confirm-step guard: disable/clear before the call). On success
 * the draft resets, so a stray replayed call afterwards is rejected by
 * `submitButtonState` (no category) rather than issuing a second write. */
export function createController(
  api: Pick<AddExpenseApi, "createExpense">,
  categories: CategoryResponse[],
  currency: Currency,
): AddExpenseController {
  let draft = emptyDraft();
  let submitting = false;

  return {
    getDraft: () => draft,
    setAmountInput(value) {
      draft = { ...draft, amountInput: value };
    },
    setCategoryId(id) {
      draft = { ...draft, categoryId: id };
    },
    toggleTag(id) {
      draft = {
        ...draft,
        tagIds: draft.tagIds.includes(id)
          ? draft.tagIds.filter((t) => t !== id)
          : [...draft.tagIds, id],
      };
    },
    setComment(value) {
      draft = { ...draft, comment: value };
    },
    async submit(): Promise<SubmitOutcome> {
      if (submitting) {
        return { status: "blocked" };
      }
      const minor = parseAmount(draft.amountInput);
      const { enabled } = submitButtonState(draft, categories, currency);
      if (!enabled || minor === null || !draft.categoryId) {
        return { status: "blocked" };
      }
      submitting = true;
      try {
        const expense = await api.createExpense({
          amount: minor,
          category_id: draft.categoryId,
          tag_ids: draft.tagIds.length > 0 ? draft.tagIds : undefined,
          comment: draft.comment.trim() === "" ? undefined : draft.comment.trim(),
        });
        draft = emptyDraft();
        return { status: "success", expense };
      } catch (err) {
        return { status: "error", message: submitErrorMessage(err) };
      } finally {
        submitting = false;
      }
    },
  };
}

// -- chrome ------------------------------------------------------------------

/** Telegram chrome for Add-expense: MainButton is the submit, per
 * `submitButtonState`. */
export function applyAddExpenseChrome(
  draft: Draft,
  categories: CategoryResponse[],
  currency: Currency,
): void {
  const { label, enabled } = submitButtonState(draft, categories, currency);
  mainButton.show(label);
  mainButton.setEnabled(enabled);
}

/** BackButton on a dirty draft confirms before discarding — Telegram's own
 * popup, never a custom modal (webapp/CLAUDE.md). A clean draft closes
 * immediately with no prompt. */
export function wireBackButton(getDraft: () => Draft, onClose: () => void): void {
  setBackButtonHandler(() => {
    void (async () => {
      if (!isDirty(getDraft())) {
        onClose();
        return;
      }
      const discard = await confirmDiscard("Discard this expense?");
      if (discard) {
        onClose();
      }
    })();
  });
}

// -- presentation --------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderChip(opts: { id: string; label: string; selected: boolean; attr: string }): string {
  return (
    `<button type="button" class="chip${opts.selected ? " active" : ""}" ` +
    `data-${opts.attr}="${opts.id}" aria-pressed="${opts.selected}">${escapeHtml(opts.label)}</button>`
  );
}

function renderCategoryChips(categories: CategoryResponse[], selectedId: Uuid | null): string {
  const chips = categories
    .map((c) => renderChip({ id: c.id, label: c.name, selected: c.id === selectedId, attr: "category-id" }))
    .join("");
  return `<div class="chip-row" data-testid="category-chips">${chips}</div>`;
}

function renderTagChips(tags: TagResponse[], selectedIds: Uuid[]): string {
  if (tags.length === 0) {
    return "";
  }
  const chips = tags
    .map((t) => renderChip({ id: t.id, label: t.name, selected: selectedIds.includes(t.id), attr: "tag-id" }))
    .join("");
  return `<div class="chip-row" data-testid="tag-chips">${chips}</div>`;
}

export function renderForm(
  data: AddExpenseFormData,
  draft: Draft,
  opts: { submitError?: string | null; lastSyncedAt?: string } = {},
): string {
  const error = amountError(draft.amountInput);
  return `<div class="add-expense-form" data-testid="add-expense-form">
    ${opts.lastSyncedAt ? `<div class="offline-banner" data-testid="offline">Offline — showing data from ${escapeHtml(opts.lastSyncedAt)}</div>` : ""}
    <div class="card field">
      <input class="amount-input" data-testid="amount-input" inputmode="decimal" autofocus
        value="${escapeHtml(draft.amountInput)}" placeholder="0.00" />
      <div class="currency-suffix">${escapeHtml(data.currency)}</div>
    </div>
    <p class="field-error" data-testid="amount-error">${error ? escapeHtml(error) : ""}</p>
    ${renderCategoryChips(data.categories, draft.categoryId)}
    ${renderTagChips(data.tags, draft.tagIds)}
    <textarea class="comment-input" data-testid="comment-input" placeholder="Add a note (optional)">${escapeHtml(draft.comment)}</textarea>
    ${opts.submitError ? `<p class="submit-error" data-testid="submit-error">${escapeHtml(opts.submitError)}</p>` : ""}
  </div>`;
}

function renderSkeleton(): string {
  return `<div class="add-expense-skeleton" data-testid="loading">
    <div class="field-skeleton"></div>
    <div class="chips-skeleton"></div>
  </div>`;
}

function renderError(message: string): string {
  return `<div class="add-expense-error" data-testid="error">
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">Try again</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="add-expense-readonly" data-testid="forbidden">
    <p>You don't have permission to add expenses.</p>
  </div>`;
}

function renderEmpty(): string {
  return `<div class="add-expense-empty" data-testid="empty">
    <p>Add a category first — every expense needs one.</p>
  </div>`;
}

export function renderAddExpense(state: AddExpenseLoadState): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "error":
      return renderError(state.message);
    case "forbidden":
      return renderForbidden();
    case "empty":
      return renderEmpty();
    case "ready":
      return renderForm(state, emptyDraft());
    case "offline":
      return renderForm(state, emptyDraft(), { lastSyncedAt: state.lastSyncedAt });
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as home.ts::mount) ---------------------------------------

export interface AddExpenseHandlers {
  onRetry: () => void;
  onClose: () => void;
  onSuccess: () => void;
}

export function mount(
  root: HTMLElement,
  state: AddExpenseLoadState,
  api: AddExpenseApi,
  handlers: AddExpenseHandlers,
): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderAddExpense(state);
  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);

  if (state.status !== "ready" && state.status !== "offline") {
    setBackButtonHandler(() => handlers.onClose());
    mainButton.hide();
    return;
  }

  const data: AddExpenseFormData = state;
  const lastSyncedAt = state.status === "offline" ? state.lastSyncedAt : undefined;
  const controller = createController(api, data.categories, data.currency);

  const wireForm = (): void => {
    const amountInput = root.querySelector<HTMLInputElement>('[data-testid="amount-input"]');
    amountInput?.addEventListener("input", () => {
      controller.setAmountInput(amountInput.value);
      const errorEl = root.querySelector<HTMLElement>('[data-testid="amount-error"]');
      if (errorEl) {
        errorEl.textContent = amountError(controller.getDraft().amountInput) ?? "";
      }
      applyAddExpenseChrome(controller.getDraft(), data.categories, data.currency);
    });

    root.querySelectorAll<HTMLElement>("[data-category-id]").forEach((el) => {
      el.addEventListener("click", () => {
        haptics.selection();
        controller.setCategoryId(el.dataset.categoryId as Uuid);
        rerenderForm();
      });
    });

    root.querySelectorAll<HTMLElement>("[data-tag-id]").forEach((el) => {
      el.addEventListener("click", () => {
        haptics.selection();
        controller.toggleTag(el.dataset.tagId as Uuid);
        rerenderForm();
      });
    });

    const commentInput = root.querySelector<HTMLTextAreaElement>('[data-testid="comment-input"]');
    commentInput?.addEventListener("input", () => {
      controller.setComment(commentInput.value);
    });
  };

  const rerenderForm = (submitError?: string | null): void => {
    const container = root.querySelector<HTMLElement>('[data-testid="add-expense-form"]');
    if (!container) {
      return;
    }
    container.outerHTML = renderForm(data, controller.getDraft(), { submitError, lastSyncedAt });
    wireForm();
    applyAddExpenseChrome(controller.getDraft(), data.categories, data.currency);
  };

  wireForm();
  applyAddExpenseChrome(controller.getDraft(), data.categories, data.currency);
  wireBackButton(controller.getDraft, handlers.onClose);

  mainButton.onClick(() => {
    void (async () => {
      const outcome = await controller.submit();
      if (outcome.status === "success") {
        haptics.notification("success");
        handlers.onSuccess();
      } else if (outcome.status === "error") {
        rerenderForm(outcome.message);
      }
      // "blocked" is the double-submit guard itself firing — the button was
      // already disabled, or this is a duplicate tap; no UI change needed.
    })();
  });

  root.querySelector<HTMLInputElement>('[data-testid="amount-input"]')?.focus();
}
