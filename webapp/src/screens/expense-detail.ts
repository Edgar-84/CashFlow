/** Screen 03b — Expense detail: read one expense, edit it (routes to the
 * composer, screen 02b) or delete it (Telegram's own confirm popup, then
 * deletes immediately). docs/ui/screens/03b-expense-detail.md.
 * Reached by tapping a row on Screen 03a (screens/expenses.ts).
 *
 * Layers, same split as other screens:
 *  - data: `buildDetailData` (pure) turns an `ExpenseResponse` + the
 *    account's categories into the screen's shape; `loadDetail` fetches
 *    everything the screen needs, mirroring `loadHome`/`loadAddExpenseData`'s
 *    never-throws contract (plus a `not-found` branch for a 404, since a
 *    single record — unlike a list — has one anyway).
 *  - controller: `createDetailController` owns the one remaining piece of
 *    mutable state, the delete request.
 *  - presentation: `renderDetail` (pure, HTML string) and `mount` (thin DOM
 *    glue, the one part with no meaningful unit test — same accepted gap as
 *    every other screen's `mount`).
 *
 * V4/U1.5 deletes two things rather than adding them (D407/D408): the
 * field-picker edit mode (amount/category/comment/tags each round-tripping
 * its own `PATCH`) and the 5s-undo delete state machine. Editing now happens
 * entirely on screen 02b (`main.ts::showEditExpense`, handed the
 * already-loaded expense — no refetch); deleting now confirms via Telegram's
 * own popup and calls `DELETE` immediately on "Yes".
 */

import { assignCategoryColors, categorySlotCssVar, OTHER_COLOR_VAR } from "../lib/category-colors";
import { t } from "../lib/i18n";
import { formatAmount } from "../lib/money";
import { confirmAction, haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ForbiddenError, NotFoundError } from "../api/client";
import type { CategoryResponse, Currency, ExpenseResponse, Role, TagResponse, Uuid } from "../api/types";

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
  tags: TagResponse[];
  /** Whether Edit/Delete render at all — an admin, or the expense's own
   * author (any non-viewer role). A `viewer` never writes (api/CLAUDE.md);
   * a `member` only writes their own record (the default `own_only` grant),
   * so a partner's expense renders read-only same as a viewer's — both
   * spec'd identically in the screen doc's Edge cases. Best-effort UI hint
   * only: the server is the one enforcing this for real on `PATCH`/`DELETE`. */
  canWrite: boolean;
}

export function buildDetailData(
  expense: ExpenseResponse,
  categories: CategoryResponse[],
  currency: Currency,
  canWrite: boolean,
): DetailData {
  const category = categories.find((c) => c.id === expense.category_id);
  const colorBySlot = new Map(assignCategoryColors(categories).map((c) => [c.id, c.slot]));
  const slot = category ? (colorBySlot.get(category.id) ?? null) : null;
  return {
    id: expense.id,
    amountMinor: expense.amount,
    currency,
    categoryId: expense.category_id,
    categoryLabel: category?.name ?? t("category.unknown"),
    colorVar: category ? categorySlotCssVar(slot) : OTHER_COLOR_VAR,
    authorName: expense.user_name,
    comment: expense.comment,
    dayLabel: formatSpentDay(expense.spent_at),
    tags: expense.tags,
    canWrite,
  };
}

export interface ExpenseDetailApi {
  getMe(): Promise<{ id: Uuid; role: Role; currency: Currency }>;
  getExpense(id: Uuid): Promise<ExpenseResponse>;
  listCategories(): Promise<CategoryResponse[]>;
  deleteExpense(id: Uuid): Promise<void>;
}

export type DetailLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "forbidden" }
  | { status: "not-found" }
  | ({ status: "ready"; expense: ExpenseResponse } & DetailData);

/** Never throws — every failure resolves to a state the caller can render
 * directly, same contract as `loadHome`/`loadAddExpenseData`. */
export async function loadDetail(api: ExpenseDetailApi, id: Uuid): Promise<DetailLoadState> {
  try {
    const [me, expense, categories] = await Promise.all([api.getMe(), api.getExpense(id), api.listCategories()]);
    const canWrite = me.role !== "viewer" && (me.role === "admin" || expense.user_id === me.id);
    return { status: "ready", expense, ...buildDetailData(expense, categories, me.currency, canWrite) };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { status: "forbidden" };
    }
    if (err instanceof NotFoundError) {
      return { status: "not-found" };
    }
    const message = err instanceof Error ? err.message : t("error.fallback");
    return { status: "error", message };
  }
}

// -- controller ------------------------------------------------------------

export interface DetailViewState {
  data: DetailData;
  deleting: boolean;
  saveError: string | null;
}

/** A 404 on delete is treated as success — the row is gone either way,
 * whether this tap or a concurrent session removed it (screen doc's Edge
 * cases). Every other failure keeps the expense and surfaces a message. */
export type DeleteOutcome = { status: "success" } | { status: "error"; message: string } | { status: "blocked" };

function deleteErrorMessage(err: unknown): string {
  if (err instanceof ForbiddenError) {
    return t("detail.err.forbidden");
  }
  return t("detail.err.delete");
}

/** Owns the one piece of mutable state left on this screen: the in-flight
 * delete. `deleting` flips true synchronously (before the first `await`, a
 * plain consequence of how `async function` bodies run) so a caller that
 * renders right after calling `deleteExpense()` — without awaiting it first —
 * already sees the disabled/busy state; `finally` clears it once the request
 * settles either way. */
export function createDetailController(api: ExpenseDetailApi, initial: DetailData): DetailController {
  const data = initial;
  let deleting = false;
  let saveError: string | null = null;

  return {
    getState: () => ({ data, deleting, saveError }),
    async deleteExpense(): Promise<DeleteOutcome> {
      if (deleting) {
        return { status: "blocked" };
      }
      deleting = true;
      saveError = null;
      try {
        await api.deleteExpense(data.id);
        return { status: "success" };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return { status: "success" };
        }
        saveError = deleteErrorMessage(err);
        return { status: "error", message: saveError };
      } finally {
        deleting = false;
      }
    },
  };
}

export interface DetailController {
  getState(): DetailViewState;
  deleteExpense(): Promise<DeleteOutcome>;
}

// -- presentation --------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCard(data: DetailData): string {
  const author = data.authorName
    ? `<span class="detail-author">${escapeHtml(data.authorName)}</span>`
    : "";
  const tagNames = data.tags.map((tag) => tag.name);
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

/** `data-action="open-picker"` is kept on the Edit button though it no
 * longer opens a picker (U1.5 deleted it) — app.css's filled-button rule
 * still targets that attribute value and this unit doesn't touch app.css. */
function renderActions(deleting: boolean): string {
  const disabled = deleting ? " disabled" : "";
  return `<div class="detail-actions" data-testid="detail-actions">
    <button type="button" data-action="open-picker"${disabled}>${escapeHtml(t("detail.action.edit"))}</button>
    <button type="button" class="danger" data-action="delete"${disabled}>${escapeHtml(t("detail.action.delete"))}</button>
  </div>`;
}

export function renderDetailView(state: DetailViewState): string {
  const actions = state.data.canWrite ? renderActions(state.deleting) : "";
  const error = state.saveError
    ? `<p class="submit-error" data-testid="detail-save-error">${escapeHtml(state.saveError)}</p>`
    : "";
  return `<div class="detail-screen" data-testid="detail-screen">${renderCard(state.data)}${actions}${error}</div>`;
}

function renderSkeleton(): string {
  return `<div class="detail-skeleton" data-testid="loading">
    <div class="field-skeleton"></div>
  </div>`;
}

function renderError(message: string): string {
  return `<div class="detail-error" data-testid="error">
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">${escapeHtml(t("error.retry"))}</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="detail-readonly" data-testid="forbidden">
    <p>${escapeHtml(t("detail.forbidden"))}</p>
  </div>`;
}

function renderNotFound(): string {
  return `<div class="detail-not-found" data-testid="not-found">
    <p>${escapeHtml(t("detail.notFound"))}</p>
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
      return renderDetailView({ data: state, deleting: false, saveError: null });
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

export interface DetailHandlers {
  onRetry: () => void;
  onBack: () => void;
  onDeleted: () => void;
  onEdit: (expense: ExpenseResponse) => void;
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

  const expense = state.expense;
  const data: DetailData = state;
  const controller = createDetailController(api, data);
  // `#app` is a single root shared by every screen (main.ts) — once the user
  // navigates away, an in-flight delete must not touch it. `active` flips
  // false on Back/Edit and gates every callback that resolves after an
  // await, so a late `.then` can't stomp on whatever screen is showing by
  // then (same guard shape screens/add-expense.ts uses).
  let active = true;
  // Guards the confirm popup itself against a double tap on "Delete expense"
  // before it has rendered — one popup, one DELETE (screen doc's Edge cases).
  let confirming = false;

  setBackButtonHandler(() => {
    active = false;
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
      haptics.selection();
      active = false;
      handlers.onEdit(expense);
    });

    root.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
      if (confirming) {
        return;
      }
      confirming = true;
      void confirmAction(t("detail.confirm.message")).then(async (confirmed) => {
        confirming = false;
        if (!confirmed || !active) {
          return;
        }
        const promise = controller.deleteExpense();
        rerender();
        const outcome = await promise;
        if (!active) {
          return;
        }
        if (outcome.status === "success") {
          haptics.notification("success");
          active = false;
          handlers.onDeleted();
        } else if (outcome.status === "error") {
          haptics.notification("error");
          rerender();
        }
      });
    });
  };

  wire();
}
