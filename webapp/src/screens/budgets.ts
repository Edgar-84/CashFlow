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
 *  - presentation: `renderBudgets`/`renderBudgetsView` (pure, HTML strings)
 *    and `mount` (thin DOM glue, the one part with no meaningful unit test —
 *    same accepted gap as every other screen's `mount`).
 *
 * V5 (D506/D511, plan unit U3.2): the create/edit form is no longer part of
 * this screen. Tapping a budgeted row, an unbudgeted category, or MainButton
 * navigates to a separate standalone form screen instead — `main.ts` owns
 * that routing, translating a tap here into the destination screen's own
 * mode type. MainButton still offers the next unbudgeted category
 * (`nextUnbudgeted`, first in creation order), but `applyBudgetsChrome` only
 * needs applying once per load now — there is no more in-screen mutation to
 * react to.
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
import { formatAmount } from "../lib/money";
import { haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ForbiddenError } from "../api/client";
import type {
  BudgetPlanResponse,
  BudgetProgress,
  CategoryResponse,
  Currency,
  Uuid,
} from "../api/types";

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
}

function rowFrom(plan: BudgetPlanResponse, progress: BudgetProgress, label: string, colorVar: string): BudgetRow {
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

  return { currency: input.currency, budgeted, unbudgeted };
}

export interface BudgetsApi {
  getMe(): Promise<{ currency: Currency }>;
  listCategories(): Promise<CategoryResponse[]>;
  listBudgetPlans(): Promise<BudgetPlanResponse[]>;
  getBudgetPlanProgress(id: Uuid): Promise<BudgetProgress>;
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
 * as `home.ts::applyHomeChrome`'s `onAddExpense`) navigates to the
 * standalone form screen in create mode for it — `main.ts` is the one
 * caller, applied once per load (V5: no more in-screen mutation to react
 * to). */
export function applyBudgetsChrome(
  state: BudgetsState,
  onBack: () => void,
  onMainButtonTap?: (row: UnbudgetedRow, currency: Currency) => void,
): void {
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
    mainButton.onClick(() => onMainButtonTap(next, state.currency));
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
  if (row.fillPct === null) {
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

export function renderBudgetsView(data: BudgetsData, lastSyncedAt?: string): string {
  return `<div class="budgets-ready" data-testid="ready">
    ${lastSyncedAt ? `<div class="offline-banner" data-testid="offline">Offline — showing data from ${escapeHtml(lastSyncedAt)}</div>` : ""}
    ${renderBudgetedList(data.budgeted, data.currency)}
    ${renderUnbudgetedList(data.unbudgeted)}
  </div>`;
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
      return renderBudgetsView(state);
    case "offline":
      return renderBudgetsView(state, state.lastSyncedAt);
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface BudgetsHandlers {
  onRetry: () => void;
  onBack: () => void;
  /** Tapping a budgeted row (edit mode) or an unbudgeted category (create
   * mode) — `main.ts` translates the row plus this screen's already-loaded
   * `currency` into the standalone form screen's own mode type and
   * navigates there (D506/D512). Navigation only; this screen issues no
   * write itself. */
  onOpenBudget: (row: BudgetRow, currency: Currency) => void;
  onOpenUnbudgeted: (row: UnbudgetedRow, currency: Currency) => void;
}

export function mount(root: HTMLElement, state: BudgetsState, handlers: BudgetsHandlers): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderBudgets(state);
  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);

  if (state.status !== "ready" && state.status !== "offline") {
    return;
  }

  root.querySelectorAll<HTMLElement>("[data-plan-id]").forEach((el) => {
    const row = state.budgeted.find((r) => r.planId === el.dataset.planId);
    if (!row) {
      return;
    }
    el.addEventListener("click", () => {
      haptics.selection();
      handlers.onOpenBudget(row, state.currency);
    });
  });
  root.querySelectorAll<HTMLElement>("[data-category-id]").forEach((el) => {
    const row = state.unbudgeted.find((r) => r.categoryId === el.dataset.categoryId);
    if (!row) {
      return;
    }
    el.addEventListener("click", () => {
      haptics.selection();
      handlers.onOpenUnbudgeted(row, state.currency);
    });
  });
}
