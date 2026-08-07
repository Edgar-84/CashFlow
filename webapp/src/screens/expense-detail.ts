/** Screen 03b — Expense detail, edit, delete (docs/design/mini-app-ux.md §5's
 * `E --> D[Expense detail] --> ED[Edit]` / `D --> DL[Delete + undo]` flow).
 * Reached by tapping a row on Screen 03a (screens/expenses.ts).
 *
 * Layers, same split as screens/add-expense.ts:
 *  - data: `buildDetailData` (pure) turns an `ExpenseResponse` + the account's
 *    categories/tags into the screen's shape; `loadDetail` fetches everything
 *    the screen needs, mirroring `loadHome`/`loadAddExpenseData`'s
 *    never-throws contract (plus a `not-found` branch for a 404, since a
 *    single record — unlike a list — has one anyway).
 *  - controller: `createDetailController` owns the field-picker edit mode,
 *    per-field drafts, and the delete/undo state machine.
 *  - presentation: `renderDetail` (pure, HTML string) and `mount` (thin DOM
 *    glue, the one part with no meaningful unit test — same accepted gap as
 *    every other screen's `mount`).
 *
 * Edit ("round-trips one field at a time", plan AC): a field-picker (mirrors
 * `bot/handlers/expenses.py`'s `/editexpense` picker -> field -> value flow)
 * rather than one combined form — each field commits with its own `PATCH`,
 * independent of the others.
 *
 * Delete: unlike the list screen, a single detail view has no "row" to
 * animate — tapping Delete swaps the action buttons for an inline "Undo"
 * banner. `requestDelete`/`cancelDelete`/`confirmDelete` are the pure,
 * directly-testable state transitions; the actual 5s wait is DOM/mount glue
 * (`setTimeout`), consistent with every other screen's mount being the one
 * untested layer. A cancelled delete never calls the API; a failed delete
 * (403/404/network) flips back to the ready detail view with the failure
 * message, i.e. "restores the row" in the sense that the expense was never
 * removed from the account.
 *
 * Known gap (same accepted shape as screens/expenses.ts's day grouping):
 * no `offline` state here — a single-record view has no useful cached copy
 * across sessions the way an accumulated list page does, and the AC only
 * names 403/404, so a network failure on load renders `error` with retry.
 */

import { assignCategoryColors, categorySlotCssVar, OTHER_COLOR_VAR } from "../lib/category-colors";
import { formatAmount, parseAmount } from "../lib/money";
import { haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { amountError } from "./add-expense";
import { ApiError, ForbiddenError, NotFoundError } from "../api/client";
import type {
  CategoryResponse,
  Currency,
  ExpenseResponse,
  ExpenseUpdate,
  TagResponse,
  Uuid,
} from "../api/types";

// -- data --------------------------------------------------------------------

/** `expense.spent_at` ("YYYY-MM-DD") parsed into a **local** `Date` — never
 * `new Date("YYYY-MM-DD")`, which parses as UTC midnight and can render a day
 * early under a negative offset (D120's bug class). Private copy, same
 * convention as `screens/expenses.ts`'s own. */
function parseCalendarDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatSpentDay(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(parseCalendarDate(dateStr));
}

export interface DetailData {
  id: Uuid;
  amountMinor: number;
  currency: Currency;
  categoryId: Uuid;
  categoryLabel: string;
  colorVar: string;
  authorName: string | null;
  comment: string | null;
  dayLabel: string;
  categories: CategoryResponse[];
  tags: TagResponse[];
  selectedTagIds: Uuid[];
}

export function buildDetailData(
  expense: ExpenseResponse,
  categories: CategoryResponse[],
  tags: TagResponse[],
  currency: Currency,
): DetailData {
  const category = categories.find((c) => c.id === expense.category_id);
  const colorBySlot = new Map(assignCategoryColors(categories).map((c) => [c.id, c.slot]));
  const slot = category ? (colorBySlot.get(category.id) ?? null) : null;
  return {
    id: expense.id,
    amountMinor: expense.amount,
    currency,
    categoryId: expense.category_id,
    categoryLabel: category?.name ?? "Unknown",
    colorVar: category ? categorySlotCssVar(slot) : OTHER_COLOR_VAR,
    authorName: expense.user_name,
    comment: expense.comment,
    dayLabel: formatSpentDay(expense.spent_at),
    categories,
    tags,
    selectedTagIds: expense.tags.map((t) => t.id),
  };
}

export interface ExpenseDetailApi {
  getMe(): Promise<{ currency: Currency }>;
  getExpense(id: Uuid): Promise<ExpenseResponse>;
  listCategories(): Promise<CategoryResponse[]>;
  listTags(): Promise<TagResponse[]>;
  updateExpense(id: Uuid, data: ExpenseUpdate): Promise<ExpenseResponse>;
  deleteExpense(id: Uuid): Promise<void>;
}

export type DetailLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "forbidden" }
  | { status: "not-found" }
  | ({ status: "ready" } & DetailData);

function errorMessage(err: unknown): string {
  if (err instanceof ForbiddenError) {
    return "You don't have permission to do that.";
  }
  if (err instanceof NotFoundError) {
    return "That expense no longer exists.";
  }
  if (err instanceof ApiError) {
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

/** Never throws — every failure resolves to a state the caller can render
 * directly, same contract as `loadHome`/`loadAddExpenseData`. */
export async function loadDetail(api: ExpenseDetailApi, id: Uuid): Promise<DetailLoadState> {
  try {
    const [me, expense, categories, tags] = await Promise.all([
      api.getMe(),
      api.getExpense(id),
      api.listCategories(),
      api.listTags(),
    ]);
    return { status: "ready", ...buildDetailData(expense, categories, tags, me.currency) };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { status: "forbidden" };
    }
    if (err instanceof NotFoundError) {
      return { status: "not-found" };
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { status: "error", message };
  }
}

// -- controller ------------------------------------------------------------

export type FieldEditMode = "closed" | "picker" | "amount" | "comment" | "category" | "tags";

export interface DetailViewState {
  data: DetailData;
  edit: FieldEditMode;
  amountDraft: string;
  commentDraft: string;
  tagsDraft: Uuid[];
  pendingDelete: boolean;
  saveError: string | null;
}

export type DeleteOutcome = { status: "success" } | { status: "error"; message: string } | { status: "blocked" };

export interface DetailController {
  getState(): DetailViewState;
  openPicker(): void;
  startEdit(field: "amount" | "comment" | "category" | "tags"): void;
  cancelEdit(): void;
  setAmountDraft(value: string): void;
  setCommentDraft(value: string): void;
  toggleTagDraft(id: Uuid): void;
  saveAmount(): Promise<boolean>;
  saveComment(): Promise<boolean>;
  saveCategory(id: Uuid): Promise<boolean>;
  saveTags(): Promise<boolean>;
  requestDelete(): void;
  cancelDelete(): void;
  confirmDelete(): Promise<DeleteOutcome>;
}

/** Owns the field-picker edit mode, per-field drafts, and the delete/undo
 * state machine. Each `save*` is its own round trip (plan AC: "edit
 * round-trips one field at a time") — a failure leaves `edit` unchanged so
 * the user can retry or cancel, and never touches any other field. */
export function createDetailController(api: ExpenseDetailApi, initial: DetailData): DetailController {
  let data = initial;
  let edit: FieldEditMode = "closed";
  let amountDraft = "";
  let commentDraft = "";
  let tagsDraft: Uuid[] = [];
  let pendingDelete = false;
  let saveError: string | null = null;
  let deleting = false;

  function applyUpdated(updated: ExpenseResponse): void {
    data = buildDetailData(updated, data.categories, data.tags, data.currency);
  }

  async function save(mutate: () => Promise<ExpenseResponse>): Promise<boolean> {
    saveError = null;
    try {
      const updated = await mutate();
      applyUpdated(updated);
      edit = "closed";
      return true;
    } catch (err) {
      saveError = errorMessage(err);
      return false;
    }
  }

  return {
    getState: () => ({ data, edit, amountDraft, commentDraft, tagsDraft, pendingDelete, saveError }),
    openPicker(): void {
      edit = "picker";
      saveError = null;
    },
    startEdit(field): void {
      edit = field;
      saveError = null;
      if (field === "amount") {
        amountDraft = formatAmount(data.amountMinor);
      } else if (field === "comment") {
        commentDraft = data.comment ?? "";
      } else if (field === "tags") {
        tagsDraft = [...data.selectedTagIds];
      }
    },
    cancelEdit(): void {
      edit = "closed";
      saveError = null;
    },
    setAmountDraft(value): void {
      amountDraft = value;
    },
    setCommentDraft(value): void {
      commentDraft = value;
    },
    toggleTagDraft(id): void {
      tagsDraft = tagsDraft.includes(id) ? tagsDraft.filter((t) => t !== id) : [...tagsDraft, id];
    },
    saveAmount(): Promise<boolean> {
      const minor = parseAmount(amountDraft);
      if (minor === null) {
        return Promise.resolve(false);
      }
      return save(() => api.updateExpense(data.id, { amount: minor }));
    },
    saveComment(): Promise<boolean> {
      const trimmed = commentDraft.trim();
      return save(() => api.updateExpense(data.id, { comment: trimmed === "" ? null : trimmed }));
    },
    saveCategory(id): Promise<boolean> {
      return save(() => api.updateExpense(data.id, { category_id: id }));
    },
    saveTags(): Promise<boolean> {
      return save(() => api.updateExpense(data.id, { tag_ids: tagsDraft }));
    },
    requestDelete(): void {
      pendingDelete = true;
      saveError = null;
    },
    cancelDelete(): void {
      pendingDelete = false;
    },
    async confirmDelete(): Promise<DeleteOutcome> {
      if (!pendingDelete || deleting) {
        return { status: "blocked" };
      }
      deleting = true;
      try {
        await api.deleteExpense(data.id);
        return { status: "success" };
      } catch (err) {
        pendingDelete = false;
        saveError = errorMessage(err);
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

function renderChip(opts: { id: string; label: string; selected: boolean; attr: string }): string {
  return (
    `<button type="button" class="chip${opts.selected ? " active" : ""}" ` +
    `data-${opts.attr}="${opts.id}" aria-pressed="${opts.selected}">${escapeHtml(opts.label)}</button>`
  );
}

function renderCard(data: DetailData): string {
  const author = data.authorName
    ? `<span class="detail-author">${escapeHtml(data.authorName)}</span>`
    : "";
  const tagNames = data.tags.filter((t) => data.selectedTagIds.includes(t.id)).map((t) => t.name);
  const tags =
    tagNames.length > 0
      ? `<div class="detail-tags" data-testid="detail-tags">${escapeHtml(tagNames.join(", "))}</div>`
      : "";
  const comment = data.comment
    ? `<p class="detail-comment" data-testid="detail-comment">${escapeHtml(data.comment)}</p>`
    : "";
  return `<div class="card detail-card" data-testid="detail">
    <div class="detail-header">
      <span class="dot" style="background:${data.colorVar}"></span>
      <span class="detail-category" data-testid="detail-category">${escapeHtml(data.categoryLabel)}</span>
    </div>
    <div class="detail-amount" data-testid="detail-amount">${escapeHtml(formatAmount(data.amountMinor))} ${escapeHtml(data.currency)}</div>
    <div class="detail-meta">
      <span>${escapeHtml(data.dayLabel)}</span>
      ${author}
    </div>
    ${comment}
    ${tags}
  </div>`;
}

function renderActions(): string {
  return `<div class="detail-actions" data-testid="detail-actions">
    <button type="button" data-action="open-picker">Edit</button>
    <button type="button" class="danger" data-action="delete">Delete</button>
  </div>`;
}

function renderPicker(): string {
  return `<div class="detail-field-picker" data-testid="field-picker">
    <button type="button" data-action="edit-amount">Amount</button>
    <button type="button" data-action="edit-category">Category</button>
    <button type="button" data-action="edit-comment">Comment</button>
    <button type="button" data-action="edit-tags">Tags</button>
    <button type="button" data-action="cancel-edit">Cancel</button>
  </div>`;
}

function renderAmountEdit(state: DetailViewState): string {
  const error = amountError(state.amountDraft);
  return `<div class="detail-edit" data-testid="edit-amount">
    <div class="card field">
      <input class="amount-input" data-testid="detail-amount-input" inputmode="decimal" value="${escapeHtml(state.amountDraft)}" />
      <div class="currency-suffix">${escapeHtml(state.data.currency)}</div>
    </div>
    <p class="field-error" data-testid="detail-amount-error">${error ? escapeHtml(error) : state.saveError ? escapeHtml(state.saveError) : ""}</p>
    <div class="detail-edit-actions">
      <button type="button" data-action="save-amount">Save</button>
      <button type="button" data-action="cancel-edit">Cancel</button>
    </div>
  </div>`;
}

function renderCommentEdit(state: DetailViewState): string {
  return `<div class="detail-edit" data-testid="edit-comment">
    <textarea class="comment-input" data-testid="detail-comment-input" placeholder="Add a note">${escapeHtml(state.commentDraft)}</textarea>
    ${state.saveError ? `<p class="submit-error" data-testid="detail-save-error">${escapeHtml(state.saveError)}</p>` : ""}
    <div class="detail-edit-actions">
      <button type="button" data-action="save-comment">Save</button>
      <button type="button" data-action="cancel-edit">Cancel</button>
    </div>
  </div>`;
}

function renderCategoryEdit(state: DetailViewState): string {
  const chips = state.data.categories
    .map((c) => renderChip({ id: c.id, label: c.name, selected: c.id === state.data.categoryId, attr: "category-id" }))
    .join("");
  return `<div class="detail-edit" data-testid="edit-category">
    <div class="chip-row" data-testid="detail-category-chips">${chips}</div>
    ${state.saveError ? `<p class="submit-error" data-testid="detail-save-error">${escapeHtml(state.saveError)}</p>` : ""}
    <div class="detail-edit-actions">
      <button type="button" data-action="cancel-edit">Cancel</button>
    </div>
  </div>`;
}

function renderTagsEdit(state: DetailViewState): string {
  const chips = state.data.tags
    .map((t) => renderChip({ id: t.id, label: t.name, selected: state.tagsDraft.includes(t.id), attr: "tag-id" }))
    .join("");
  return `<div class="detail-edit" data-testid="edit-tags">
    <div class="chip-row" data-testid="detail-tag-chips">${chips}</div>
    ${state.saveError ? `<p class="submit-error" data-testid="detail-save-error">${escapeHtml(state.saveError)}</p>` : ""}
    <div class="detail-edit-actions">
      <button type="button" data-action="save-tags">Done</button>
      <button type="button" data-action="cancel-edit">Cancel</button>
    </div>
  </div>`;
}

function renderPendingDelete(): string {
  return `<div class="detail-undo" data-testid="pending-delete">
    <p>Expense deleted.</p>
    <button type="button" data-action="undo-delete">Undo</button>
  </div>`;
}

export function renderDetailView(state: DetailViewState): string {
  if (state.pendingDelete) {
    return `<div class="detail-screen" data-testid="detail-screen">${renderCard(state.data)}${renderPendingDelete()}</div>`;
  }
  let section: string;
  switch (state.edit) {
    case "closed":
      section = renderActions();
      break;
    case "picker":
      section = renderPicker();
      break;
    case "amount":
      section = renderAmountEdit(state);
      break;
    case "comment":
      section = renderCommentEdit(state);
      break;
    case "category":
      section = renderCategoryEdit(state);
      break;
    case "tags":
      section = renderTagsEdit(state);
      break;
  }
  if (state.saveError && state.edit !== "amount" && state.edit !== "comment" && state.edit !== "category" && state.edit !== "tags") {
    section = `<p class="submit-error" data-testid="detail-save-error">${escapeHtml(state.saveError)}</p>${section}`;
  }
  return `<div class="detail-screen" data-testid="detail-screen">${renderCard(state.data)}${section}</div>`;
}

function renderSkeleton(): string {
  return `<div class="detail-skeleton" data-testid="loading">
    <div class="field-skeleton"></div>
  </div>`;
}

function renderError(message: string): string {
  return `<div class="detail-error" data-testid="error">
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">Try again</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="detail-readonly" data-testid="forbidden">
    <p>You don't have permission to view this expense.</p>
  </div>`;
}

function renderNotFound(): string {
  return `<div class="detail-not-found" data-testid="not-found">
    <p>That expense no longer exists.</p>
  </div>`;
}

export function renderDetail(state: DetailLoadState): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "error":
      return renderError(state.message);
    case "forbidden":
      return renderForbidden();
    case "not-found":
      return renderNotFound();
    case "ready":
      return renderDetailView({
        data: state,
        edit: "closed",
        amountDraft: "",
        commentDraft: "",
        tagsDraft: [],
        pendingDelete: false,
        saveError: null,
      });
  }
}

// -- chrome ------------------------------------------------------------------

/** No MainButton (same choice as screens/expenses.ts — actions are in-content
 * buttons, not a single primary action). BackButton always returns to the
 * Expenses list (the design's flow diagram has no other entry point). */
export function applyDetailChrome(onBack: () => void): void {
  mainButton.hide();
  setBackButtonHandler(onBack);
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

const UNDO_WINDOW_MS = 5000;

export interface DetailHandlers {
  onRetry: () => void;
  onBack: () => void;
  onDeleted: () => void;
}

export function mount(root: HTMLElement, state: DetailLoadState, api: ExpenseDetailApi, handlers: DetailHandlers): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderDetail(state);
  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);

  if (state.status !== "ready") {
    return;
  }

  const data: DetailData = state;
  const controller = createDetailController(api, data);
  let deleteTimer: ReturnType<typeof setTimeout> | null = null;
  // `#app` is a single root shared by every screen (main.ts) — once the user
  // navigates away, a still-running delete timer or in-flight save must not
  // touch it. `active` flips false on Back (which also cancels any pending
  // timer outright) and gates every callback that resolves after an await,
  // so a late `.then` can't stomp on whatever screen is showing by then.
  let active = true;

  setBackButtonHandler(() => {
    active = false;
    if (deleteTimer) {
      clearTimeout(deleteTimer);
      deleteTimer = null;
    }
    handlers.onBack();
  });

  const rerender = (): void => {
    if (!active) {
      return;
    }
    root.innerHTML = renderDetailView(controller.getState());
    wire();
  };

  const wire = (): void => {
    root.querySelector('[data-action="open-picker"]')?.addEventListener("click", () => {
      controller.openPicker();
      rerender();
    });
    root.querySelector('[data-action="cancel-edit"]')?.addEventListener("click", () => {
      controller.cancelEdit();
      rerender();
    });
    root.querySelector('[data-action="edit-amount"]')?.addEventListener("click", () => {
      controller.startEdit("amount");
      rerender();
    });
    root.querySelector('[data-action="edit-comment"]')?.addEventListener("click", () => {
      controller.startEdit("comment");
      rerender();
    });
    root.querySelector('[data-action="edit-category"]')?.addEventListener("click", () => {
      controller.startEdit("category");
      rerender();
    });
    root.querySelector('[data-action="edit-tags"]')?.addEventListener("click", () => {
      controller.startEdit("tags");
      rerender();
    });

    const amountInput = root.querySelector<HTMLInputElement>('[data-testid="detail-amount-input"]');
    amountInput?.addEventListener("input", () => controller.setAmountDraft(amountInput.value));
    root.querySelector('[data-action="save-amount"]')?.addEventListener("click", () => {
      void controller.saveAmount().then((ok) => {
        if (ok) {
          haptics.notification("success");
        }
        rerender();
      });
    });

    const commentInput = root.querySelector<HTMLTextAreaElement>('[data-testid="detail-comment-input"]');
    commentInput?.addEventListener("input", () => controller.setCommentDraft(commentInput.value));
    root.querySelector('[data-action="save-comment"]')?.addEventListener("click", () => {
      void controller.saveComment().then((ok) => {
        if (ok) {
          haptics.notification("success");
        }
        rerender();
      });
    });

    root.querySelectorAll<HTMLElement>("[data-category-id]").forEach((el) => {
      el.addEventListener("click", () => {
        haptics.selection();
        void controller.saveCategory(el.dataset.categoryId as Uuid).then((ok) => {
          if (ok) {
            haptics.notification("success");
          }
          rerender();
        });
      });
    });

    root.querySelectorAll<HTMLElement>("[data-tag-id]").forEach((el) => {
      el.addEventListener("click", () => {
        haptics.selection();
        controller.toggleTagDraft(el.dataset.tagId as Uuid);
        rerender();
      });
    });
    root.querySelector('[data-action="save-tags"]')?.addEventListener("click", () => {
      void controller.saveTags().then((ok) => {
        if (ok) {
          haptics.notification("success");
        }
        rerender();
      });
    });

    root.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
      haptics.impact();
      controller.requestDelete();
      rerender();
      deleteTimer = setTimeout(() => {
        deleteTimer = null;
        void controller.confirmDelete().then((outcome) => {
          if (!active) {
            return;
          }
          if (outcome.status === "success") {
            active = false;
            handlers.onDeleted();
          } else if (outcome.status === "error") {
            rerender();
          }
        });
      }, UNDO_WINDOW_MS);
    });
    root.querySelector('[data-action="undo-delete"]')?.addEventListener("click", () => {
      if (deleteTimer) {
        clearTimeout(deleteTimer);
        deleteTimer = null;
      }
      controller.cancelDelete();
      rerender();
    });
  };

  wire();
}
