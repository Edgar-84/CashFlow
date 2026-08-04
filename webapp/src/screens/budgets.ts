/** Screen 04 — Budgets (docs/design/mini-app-ux.md §4). Every bar carries a
 * tick at the notify threshold; the bar is the category's own colour, never
 * repainted by status; state is spelled out in words with an icon (status
 * red is reserved for `is_exceeded`, per docs/ui/design-system.md's colour
 * rule). Categories with
 * no budget sit at the bottom as an invitation.
 *
 * Layers, same split as every other screen:
 *  - data: `loadBudgets`/`buildBudgetsData` — orchestrates the ApiClient
 *    calls (`GET /budgets` + one `GET /budgets/{id}/progress` per plan, same
 *    N-small-calls shape U2.1's Home already established for its
 *    over-budget strip) and turns them into a `BudgetsState`. Never throws,
 *    same never-throws/cache-fallback contract as `loadHome`.
 *  - controller: `createBudgetsController` owns the create/edit form (one
 *    shared form for both, keyed by `BudgetEditMode`) and its `POST`/
 *    `PATCH`/`DELETE` round trips. A successful mutation updates `data`
 *    in place from the mutation's own response + a fresh progress fetch,
 *    rather than reloading the whole screen.
 *  - presentation: `renderBudgets`/`renderBudgetsView` (pure, HTML strings)
 *    and `mount` (thin DOM glue, the one part with no meaningful unit test —
 *    same accepted gap as every other screen's `mount`).
 *
 * MainButton is contextual (design doc §4's "Telegram" note): it offers the
 * next unbudgeted category (`nextUnbudgeted`, first in creation order) and
 * opens the create form for it on tap — unlike every prior screen, this
 * needs to react to in-screen mutations (creating a plan changes what
 * "next" means), so `mount` re-applies chrome after every state change
 * instead of once at load, per `applyBudgetsChrome`'s reusable shape.
 *
 * Delete uses Telegram's own confirm popup (`confirmDiscard`, already
 * screen-agnostic despite its name) rather than expense-detail's 5s-undo —
 * the design doc's Telegram note for this screen names no undo affordance,
 * unlike D216's expense-delete AC.
 *
 * Known gap, same accepted shape as expense-detail.ts: "category deleted
 * underneath a plan" (design doc §4 states list) can't actually happen
 * under the DB's `budget_plans.category_id REFERENCES categories(id) ON
 * DELETE RESTRICT` (docs/SCHEMA.sql) — a category with a live plan can never
 * be deleted. `buildBudgetsData` still keeps the same defensive fallback
 * every other screen has for a stale/mismatched category id, in case the
 * client's own categories fetch is out of sync with the plans fetch.
 */

import { assignCategoryColors, categorySlotCssVar, OTHER_COLOR_VAR } from "../lib/category-colors";
import { formatAmount, parseAmount } from "../lib/money";
import { confirmDiscard, haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ApiError, ForbiddenError, NotFoundError } from "../api/client";
import type {
  BudgetPlanResponse,
  BudgetProgress,
  CategoryResponse,
  Currency,
  Uuid,
} from "../api/types";

export const DEFAULT_NOTIFY_THRESHOLD = 80;

// -- data --------------------------------------------------------------------

export interface BudgetRow {
  planId: Uuid;
  categoryId: Uuid;
  label: string;
  colorVar: string;
  amountMinor: number;
  spentMinor: number;
  remainingMinor: number;
  fillPct: number | null;
  notifyThreshold: number;
  isOverThreshold: boolean;
  isExceeded: boolean;
  /** `false` only for `fetchProgress`'s failure fallback (see below) — the
   * plan was written server-side but its real spend/fill couldn't be read
   * back, so `fillPct`/`isExceeded`/etc. here are placeholders, not the
   * server's numbers. Distinguishes "no limit set" (a real `amount <= 0`
   * plan, `fillPct: null` from the API) from "we don't know yet" so the
   * two don't render the same misleading copy. */
  spentKnown: boolean;
}

export interface UnbudgetedRow {
  categoryId: Uuid;
  label: string;
  colorVar: string;
}

export interface BudgetsData {
  currency: Currency;
  budgeted: BudgetRow[];
  unbudgeted: UnbudgetedRow[];
  /** Every fetched category's id in `created_at ASC` order — lets the
   * controller re-sort `budgeted`/`unbudgeted` back into creation order
   * after a local create/delete mutation moves a row between the two
   * arrays, instead of leaving it appended at the end (which would
   * contradict `nextUnbudgeted`'s "first in creation order" contract). */
  categoryOrder: Uuid[];
}

function sortByCategoryOrder<T extends { categoryId: Uuid }>(rows: T[], order: Uuid[]): T[] {
  const index = new Map(order.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => (index.get(a.categoryId) ?? Infinity) - (index.get(b.categoryId) ?? Infinity));
}

function rowFrom(
  plan: BudgetPlanResponse,
  progress: BudgetProgress,
  label: string,
  colorVar: string,
  spentKnown = true,
): BudgetRow {
  return {
    planId: plan.id,
    categoryId: plan.category_id,
    label,
    colorVar,
    amountMinor: progress.amount,
    spentMinor: progress.spent,
    remainingMinor: progress.remaining,
    fillPct: progress.fill_pct,
    notifyThreshold: progress.notify_threshold,
    isOverThreshold: progress.is_over_threshold,
    isExceeded: progress.is_exceeded,
    spentKnown,
  };
}

export function buildBudgetsData(input: {
  categories: CategoryResponse[];
  plans: BudgetPlanResponse[];
  progress: BudgetProgress[];
  currency: Currency;
}): BudgetsData {
  const orderedCategories = [...input.categories].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const colorBySlot = new Map(assignCategoryColors(orderedCategories).map((c) => [c.id, c.slot]));
  const progressByPlanId = new Map(input.progress.map((p) => [p.budget_plan_id, p]));
  const planByCategoryId = new Map(input.plans.map((p) => [p.category_id, p]));

  const budgeted: BudgetRow[] = [];
  const unbudgeted: UnbudgetedRow[] = [];

  for (const category of orderedCategories) {
    const colorVar = categorySlotCssVar(colorBySlot.get(category.id) ?? null);
    const plan = planByCategoryId.get(category.id);
    if (!plan) {
      unbudgeted.push({ categoryId: category.id, label: category.name, colorVar });
      continue;
    }
    const progress = progressByPlanId.get(plan.id);
    if (!progress) {
      continue;
    }
    budgeted.push(rowFrom(plan, progress, category.name, colorVar));
  }

  // Defensive fallback (see file header) for a plan whose category_id has no
  // matching row in this fetch — same "Unknown"/neutral-colour shape every
  // other screen uses for a stale/deleted category.
  const knownCategoryIds = new Set(orderedCategories.map((c) => c.id));
  for (const plan of input.plans) {
    if (knownCategoryIds.has(plan.category_id)) {
      continue;
    }
    const progress = progressByPlanId.get(plan.id);
    if (!progress) {
      continue;
    }
    budgeted.push(rowFrom(plan, progress, "Unknown category", OTHER_COLOR_VAR));
  }

  return { currency: input.currency, budgeted, unbudgeted, categoryOrder: orderedCategories.map((c) => c.id) };
}

export interface BudgetsApi {
  getMe(): Promise<{ currency: Currency }>;
  listCategories(): Promise<CategoryResponse[]>;
  listBudgetPlans(): Promise<BudgetPlanResponse[]>;
  getBudgetPlanProgress(id: Uuid): Promise<BudgetProgress>;
  createBudgetPlan(data: { category_id: Uuid; amount: number; notify_threshold: number }): Promise<BudgetPlanResponse>;
  updateBudgetPlan(id: Uuid, data: { amount?: number; notify_threshold?: number }): Promise<BudgetPlanResponse>;
  deleteBudgetPlan(id: Uuid): Promise<void>;
}

export interface BudgetsSnapshot {
  data: BudgetsData;
  syncedAt: string;
}

export interface BudgetsCache {
  get(): BudgetsSnapshot | null;
  set(snapshot: BudgetsSnapshot): void;
}

export function createMemoryCache(): BudgetsCache {
  let snapshot: BudgetsSnapshot | null = null;
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
    },
  };
}

export type BudgetsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "forbidden" }
  | { status: "empty" }
  | ({ status: "ready" } & BudgetsData)
  | ({ status: "offline"; lastSyncedAt: string } & BudgetsData);

/** Never throws — every failure resolves to a `BudgetsState` the caller can
 * render directly, same contract as `loadHome`/`loadAddExpenseData`.
 * `empty` mirrors `loadAddExpenseData`'s defensive "no categories at all"
 * case (root CLAUDE.md guarantees a seeded "General" category, so this is
 * expected to be unreachable in practice); "no budgets yet" with categories
 * present is a `ready` sub-case (`budgeted.length === 0`), not a separate
 * top-level status — the AC's "no-budgets empty state" still needs the
 * unbudgeted invitations rendered alongside it. */
export async function loadBudgets(api: BudgetsApi, cache: BudgetsCache): Promise<BudgetsState> {
  try {
    const [me, categories, plans] = await Promise.all([api.getMe(), api.listCategories(), api.listBudgetPlans()]);
    if (categories.length === 0) {
      return { status: "empty" };
    }
    const progress = await Promise.all(plans.map((plan) => api.getBudgetPlanProgress(plan.id)));
    const data = buildBudgetsData({ categories, plans, progress, currency: me.currency });
    cache.set({ data, syncedAt: new Date().toISOString() });
    return { status: "ready", ...data };
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

// -- controller --------------------------------------------------------------

export type BudgetEditMode =
  | { kind: "closed" }
  | { kind: "create"; categoryId: Uuid; categoryLabel: string; colorVar: string }
  | { kind: "edit"; planId: Uuid };

export interface BudgetsViewState {
  data: BudgetsData;
  lastSyncedAt?: string;
  edit: BudgetEditMode;
  amountDraft: string;
  thresholdDraft: string;
  saveError: string | null;
}

export type SaveOutcome = { status: "success" } | { status: "blocked" } | { status: "error"; message: string };
export type DeleteOutcome = { status: "success" } | { status: "error"; message: string };

export interface BudgetsController {
  getState(): BudgetsViewState;
  startCreate(categoryId: Uuid): void;
  startEdit(planId: Uuid): void;
  cancelEdit(): void;
  setAmountDraft(value: string): void;
  setThresholdDraft(value: string): void;
  save(): Promise<SaveOutcome>;
  deleteBudget(planId: Uuid): Promise<DeleteOutcome>;
}

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

function saveErrorMessage(err: unknown): string {
  if (err instanceof ForbiddenError) {
    return "You don't have permission to do that.";
  }
  if (err instanceof NotFoundError) {
    return "That category no longer exists.";
  }
  if (err instanceof ApiError && err.status === 409) {
    // Mirrors bot/handlers/budgets.py::_error_message's 409 wording exactly.
    return "A budget plan already exists for this category and period.";
  }
  if (err instanceof ApiError) {
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

/** `createBudgetPlan`/`updateBudgetPlan` already committed the write —
 * a failure here is only the read-back that keeps the local row's spend/
 * fill accurate, so it must not undo the mutation or leave `data` stale
 * (review finding on this unit: `data` was previously left untouched on a
 * pure progress-fetch failure even though the plan had already been
 * written, so a retry re-hit the API and surfaced a spurious 409). Falls
 * back to a zero-spend/no-fill-pct placeholder built from the plan's own
 * fields, flagged via `spentKnown: false` so the renderer can say "spend
 * unknown" instead of the real API's "no limit set" (a second review
 * finding on this unit — the two cases share `fillPct: null` but mean very
 * different things). The next full `loadBudgets` reload (e.g. leaving and
 * returning to the screen) recomputes the real spend. */
async function fetchProgress(api: BudgetsApi, plan: BudgetPlanResponse): Promise<{ progress: BudgetProgress; spentKnown: boolean }> {
  try {
    return { progress: await api.getBudgetPlanProgress(plan.id), spentKnown: true };
  } catch {
    return {
      progress: {
        budget_plan_id: plan.id,
        category_id: plan.category_id,
        amount: plan.amount,
        spent: 0,
        remaining: plan.amount,
        fill_pct: null,
        notify_threshold: plan.notify_threshold,
        is_over_threshold: false,
        is_exceeded: false,
      },
      spentKnown: false,
    };
  }
}

/** Owns the shared create/edit form and its round trips. A successful save
 * moves the category between `unbudgeted`/`budgeted` in `data` from the
 * mutation's own response plus one fresh `getBudgetPlanProgress` call
 * (create/update return a `BudgetPlanResponse`, not progress) rather than
 * reloading the whole screen — same "update from the response" shape as
 * `expense-detail.ts::createDetailController`'s `applyUpdated`. */
export function createBudgetsController(api: BudgetsApi, initial: BudgetsData): BudgetsController {
  let data = initial;
  let edit: BudgetEditMode = { kind: "closed" };
  let amountDraft = "";
  let thresholdDraft = String(DEFAULT_NOTIFY_THRESHOLD);
  let saveError: string | null = null;
  let saving = false;

  function findRow(planId: Uuid): BudgetRow | undefined {
    return data.budgeted.find((row) => row.planId === planId);
  }

  return {
    getState: () => ({ data, edit, amountDraft, thresholdDraft, saveError }),
    startCreate(categoryId): void {
      const category = data.unbudgeted.find((c) => c.categoryId === categoryId);
      if (!category) {
        return;
      }
      edit = { kind: "create", categoryId, categoryLabel: category.label, colorVar: category.colorVar };
      amountDraft = "";
      thresholdDraft = String(DEFAULT_NOTIFY_THRESHOLD);
      saveError = null;
    },
    startEdit(planId): void {
      const row = findRow(planId);
      if (!row) {
        return;
      }
      edit = { kind: "edit", planId };
      amountDraft = formatAmount(row.amountMinor);
      thresholdDraft = String(row.notifyThreshold);
      saveError = null;
    },
    cancelEdit(): void {
      edit = { kind: "closed" };
      saveError = null;
    },
    setAmountDraft(value): void {
      amountDraft = value;
    },
    setThresholdDraft(value): void {
      thresholdDraft = value;
    },
    async save(): Promise<SaveOutcome> {
      if (saving || edit.kind === "closed" || !budgetFormValid(amountDraft, thresholdDraft)) {
        return { status: "blocked" };
      }
      const minor = parseAmount(amountDraft);
      const threshold = Number(thresholdDraft.trim());
      if (minor === null) {
        return { status: "blocked" };
      }
      saving = true;
      saveError = null;
      try {
        if (edit.kind === "create") {
          const { categoryId, categoryLabel, colorVar } = edit;
          const plan = await api.createBudgetPlan({ category_id: categoryId, amount: minor, notify_threshold: threshold });
          const { progress, spentKnown } = await fetchProgress(api, plan);
          data = {
            ...data,
            unbudgeted: data.unbudgeted.filter((c) => c.categoryId !== categoryId),
            budgeted: sortByCategoryOrder(
              [...data.budgeted, rowFrom(plan, progress, categoryLabel, colorVar, spentKnown)],
              data.categoryOrder,
            ),
          };
        } else {
          const { planId } = edit;
          const existing = findRow(planId);
          const plan = await api.updateBudgetPlan(planId, { amount: minor, notify_threshold: threshold });
          const { progress, spentKnown } = await fetchProgress(api, plan);
          const label = existing?.label ?? "Unknown category";
          const colorVar = existing?.colorVar ?? OTHER_COLOR_VAR;
          data = {
            ...data,
            budgeted: data.budgeted.map((row) =>
              row.planId === planId ? rowFrom(plan, progress, label, colorVar, spentKnown) : row,
            ),
          };
        }
        edit = { kind: "closed" };
        return { status: "success" };
      } catch (err) {
        saveError = saveErrorMessage(err);
        return { status: "error", message: saveError };
      } finally {
        saving = false;
      }
    },
    async deleteBudget(planId): Promise<DeleteOutcome> {
      const row = findRow(planId);
      if (!row) {
        return { status: "error", message: "That budget plan no longer exists." };
      }
      try {
        await api.deleteBudgetPlan(planId);
        data = {
          ...data,
          budgeted: data.budgeted.filter((r) => r.planId !== planId),
          unbudgeted: sortByCategoryOrder(
            [...data.unbudgeted, { categoryId: row.categoryId, label: row.label, colorVar: row.colorVar }],
            data.categoryOrder,
          ),
        };
        if (edit.kind === "edit" && edit.planId === planId) {
          edit = { kind: "closed" };
        }
        return { status: "success" };
      } catch (err) {
        saveError = saveErrorMessage(err);
        return { status: "error", message: saveError };
      }
    },
  };
}

/** First unbudgeted category in creation order — what the contextual
 * MainButton offers (design doc §4's "Telegram" note). `null` once every
 * category has a plan. */
export function nextUnbudgeted(data: Pick<BudgetsData, "unbudgeted">): UnbudgetedRow | null {
  return data.unbudgeted[0] ?? null;
}

// -- chrome ------------------------------------------------------------------

/** BackButton always returns to Home. MainButton is hidden for every
 * non-ready state and once every category has a plan; otherwise it offers
 * the next unbudgeted category and `onMainButtonTap` (optional, same shape
 * as `home.ts::applyHomeChrome`'s `onAddExpense`) opens the create form for
 * it. Callable repeatedly — `mount` re-applies this after every mutation
 * since creating/deleting a plan changes what "next" means. */
export function applyBudgetsChrome(state: BudgetsState, onBack: () => void, onMainButtonTap?: (categoryId: Uuid) => void): void {
  setBackButtonHandler(onBack);
  if (state.status !== "ready" && state.status !== "offline") {
    mainButton.hide();
    return;
  }
  const next = nextUnbudgeted(state);
  if (!next) {
    mainButton.hide();
    return;
  }
  mainButton.show(`Set budget for ${next.label}`);
  mainButton.setEnabled(true);
  if (onMainButtonTap) {
    mainButton.onClick(() => onMainButtonTap(next.categoryId));
  }
}

// -- presentation --------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderBudgetRow(row: BudgetRow, currency: Currency): string {
  const pct = row.fillPct === null ? 0 : Math.min(100, Math.max(0, row.fillPct));
  const tick = Math.min(100, Math.max(0, row.notifyThreshold));
  let statusClass = "budget-status--ok";
  let statusText: string;
  if (!row.spentKnown) {
    // fetchProgress's failure fallback — a real number here would be a
    // fabricated 0, so say so instead of pretending we know the spend.
    statusText = "Spend unknown — reopen to refresh";
  } else if (row.fillPct === null) {
    statusText = "No limit set";
  } else if (row.isExceeded) {
    statusClass = "budget-status--over";
    // `remaining` is the API's own number (BudgetProgress.remaining,
    // negative once exceeded) — never re-derived from spent/amount here,
    // so this can't silently drift from budget_service's own formula.
    statusText = `⚠ Over by ${formatAmount(-row.remainingMinor)} ${currency}`;
  } else if (row.isOverThreshold) {
    statusClass = "budget-status--warn";
    statusText = "⚠ Approaching limit";
  } else {
    statusText = "On track";
  }
  return `<div class="budget-row" data-testid="budget-row" data-plan-id="${row.planId}">
    <div class="budget-row-head">
      <span class="dot" style="background:${row.colorVar}"></span>
      <span class="budget-cat">${escapeHtml(row.label)}</span>
      <span class="budget-amt">${escapeHtml(formatAmount(row.spentMinor))} / ${escapeHtml(formatAmount(row.amountMinor))} ${escapeHtml(currency)}</span>
    </div>
    <div class="budget-bar-track">
      <div class="budget-bar-fill" style="width:${pct}%;background:${row.colorVar}"></div>
      <div class="budget-bar-tick" data-testid="budget-tick" style="left:${tick}%"></div>
    </div>
    <div class="budget-status ${statusClass}" data-testid="budget-status">${statusText}</div>
  </div>`;
}

function renderBudgetedList(rows: BudgetRow[], currency: Currency): string {
  if (rows.length === 0) {
    return `<div class="budgets-empty-note" data-testid="no-budgets"><p>No budgets yet — set one below.</p></div>`;
  }
  return `<div class="card" data-testid="budgeted-list">${rows.map((row) => renderBudgetRow(row, currency)).join("")}</div>`;
}

function renderUnbudgetedList(rows: UnbudgetedRow[]): string {
  if (rows.length === 0) {
    return "";
  }
  const items = rows
    .map(
      (r) =>
        `<button type="button" class="budget-invite" data-testid="budget-invite" data-category-id="${r.categoryId}">
          <span class="dot" style="background:${r.colorVar}"></span>
          <span class="budget-invite-nm">${escapeHtml(r.label)}</span>
          <span class="budget-invite-cta">Set a budget</span>
        </button>`,
    )
    .join("");
  return `<div class="card budget-invites" data-testid="unbudgeted-list">${items}</div>`;
}

function renderBudgetForm(state: BudgetsViewState): string {
  if (state.edit.kind === "closed") {
    return "";
  }
  const edit = state.edit;
  const isCreate = edit.kind === "create";
  const title = edit.kind === "create" ? `Set budget for ${escapeHtml(edit.categoryLabel)}` : "Edit budget";
  const amountErr = amountFieldError(state.amountDraft);
  const thresholdErr = thresholdFieldError(state.thresholdDraft);
  const valid = budgetFormValid(state.amountDraft, state.thresholdDraft);
  return `<div class="card budget-form" data-testid="budget-form">
    <p class="budget-form-title">${title}</p>
    <div class="card field">
      <input class="amount-input" data-testid="budget-amount-input" inputmode="decimal" value="${escapeHtml(state.amountDraft)}" placeholder="0.00" />
      <div class="currency-suffix">${escapeHtml(state.data.currency)}</div>
    </div>
    <p class="field-error" data-testid="budget-amount-error">${amountErr ? escapeHtml(amountErr) : ""}</p>
    <div class="card field">
      <input class="amount-input" data-testid="budget-threshold-input" inputmode="numeric" value="${escapeHtml(state.thresholdDraft)}" placeholder="80" />
      <div class="currency-suffix">%</div>
    </div>
    <p class="field-error" data-testid="budget-threshold-error">${thresholdErr ? escapeHtml(thresholdErr) : ""}</p>
    ${state.saveError ? `<p class="submit-error" data-testid="budget-save-error">${escapeHtml(state.saveError)}</p>` : ""}
    <div class="detail-edit-actions">
      <button type="button" data-action="save-budget"${valid ? "" : " disabled"}>Save</button>
      ${!isCreate ? '<button type="button" class="danger" data-action="delete-budget">Delete</button>' : ""}
      <button type="button" data-action="cancel-budget">Cancel</button>
    </div>
  </div>`;
}

export function renderBudgetsView(state: BudgetsViewState): string {
  return `<div class="budgets-ready" data-testid="ready">
    ${state.lastSyncedAt ? `<div class="offline-banner" data-testid="offline">Offline — showing data from ${escapeHtml(state.lastSyncedAt)}</div>` : ""}
    ${renderBudgetedList(state.data.budgeted, state.data.currency)}
    ${renderUnbudgetedList(state.data.unbudgeted)}
    ${renderBudgetForm(state)}
  </div>`;
}

function defaultViewState(data: BudgetsData, lastSyncedAt: string | undefined): BudgetsViewState {
  return {
    data,
    lastSyncedAt,
    edit: { kind: "closed" },
    amountDraft: "",
    thresholdDraft: String(DEFAULT_NOTIFY_THRESHOLD),
    saveError: null,
  };
}

function renderSkeleton(): string {
  return `<div class="budgets-skeleton" data-testid="loading">
    <div class="budget-row-skeleton"></div>
    <div class="budget-row-skeleton"></div>
  </div>`;
}

function renderError(message: string): string {
  return `<div class="budgets-error" data-testid="error">
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">Try again</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="budgets-readonly" data-testid="forbidden">
    <p>You don't have permission to view budgets.</p>
  </div>`;
}

function renderEmpty(): string {
  return `<div class="budgets-empty" data-testid="empty">
    <p>Add a category first — every budget needs one.</p>
  </div>`;
}

export function renderBudgets(state: BudgetsState): string {
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
      return renderBudgetsView(defaultViewState(state, undefined));
    case "offline":
      return renderBudgetsView(defaultViewState(state, state.lastSyncedAt));
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface BudgetsHandlers {
  onRetry: () => void;
  onBack: () => void;
}

export function mount(root: HTMLElement, state: BudgetsState, api: BudgetsApi, handlers: BudgetsHandlers): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderBudgets(state);
  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);

  if (state.status !== "ready" && state.status !== "offline") {
    return;
  }

  const controller = createBudgetsController(api, state);
  // Same #app-is-shared-across-screens guard expense-detail.ts's mount uses:
  // an in-flight save/delete must not touch `root` after Back navigated away.
  let active = true;

  setBackButtonHandler(() => {
    active = false;
    handlers.onBack();
  });

  const refreshChrome = (): void => {
    if (!active) {
      return;
    }
    const current = controller.getState().data;
    const ready: BudgetsState = { status: "ready", ...current };
    applyBudgetsChrome(ready, handlers.onBack, (categoryId) => {
      controller.startCreate(categoryId);
      rerender();
    });
  };

  const rerender = (): void => {
    if (!active) {
      return;
    }
    root.innerHTML = renderBudgetsView(controller.getState());
    wire();
    refreshChrome();
  };

  function wire(): void {
    root.querySelectorAll<HTMLElement>("[data-plan-id]").forEach((el) => {
      el.addEventListener("click", () => {
        haptics.selection();
        controller.startEdit(el.dataset.planId as Uuid);
        rerender();
      });
    });
    root.querySelectorAll<HTMLElement>("[data-category-id]").forEach((el) => {
      el.addEventListener("click", () => {
        haptics.selection();
        controller.startCreate(el.dataset.categoryId as Uuid);
        rerender();
      });
    });

    const amountInput = root.querySelector<HTMLInputElement>('[data-testid="budget-amount-input"]');
    amountInput?.addEventListener("input", () => controller.setAmountDraft(amountInput.value));
    const thresholdInput = root.querySelector<HTMLInputElement>('[data-testid="budget-threshold-input"]');
    thresholdInput?.addEventListener("input", () => controller.setThresholdDraft(thresholdInput.value));

    root.querySelector('[data-action="save-budget"]')?.addEventListener("click", () => {
      void controller.save().then((outcome) => {
        if (outcome.status === "success") {
          haptics.notification("success");
        }
        rerender();
      });
    });
    root.querySelector('[data-action="cancel-budget"]')?.addEventListener("click", () => {
      controller.cancelEdit();
      rerender();
    });
    root.querySelector('[data-action="delete-budget"]')?.addEventListener("click", () => {
      const current = controller.getState().edit;
      if (current.kind !== "edit") {
        return;
      }
      const planId = current.planId;
      void confirmDiscard("Delete this budget plan?").then((confirmed) => {
        if (!confirmed || !active) {
          return;
        }
        haptics.impact();
        void controller.deleteBudget(planId).then((outcome) => {
          if (!active) {
            return;
          }
          if (outcome.status === "success") {
            haptics.notification("success");
          }
          rerender();
        });
      });
    });
  }

  wire();
  refreshChrome();
}
