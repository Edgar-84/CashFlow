/** Screen 03a — Expenses list (docs/design/mini-app-ux.md §4). A flat list of
 * 38 rows answers nothing; grouped by day with a per-day subtotal answers
 * "was Saturday expensive?" with no interaction. Each row: category colour,
 * category name, author initial, tags, amount.
 *
 * Layers, same split as screens/home.ts and screens/add-expense.ts:
 *  - data: `buildExpensesData`/`groupByDay` — pure, turn a page of
 *    `ExpenseResponse[]` + `CategoryResponse[]` into day groups. Directly
 *    unit-testable, no network.
 *  - controller: `createExpensesController` owns the accumulated pages
 *    (offset, `hasMore`, an optional category filter) and the
 *    never-throws/cache-fallback contract every screen's data layer follows
 *    (mirrors `loadHome`/`loadAddExpenseData`).
 *  - presentation: `renderExpenses` (pure, HTML string) and `mount` (thin DOM
 *    glue, the one part with no meaningful unit test — same accepted gap as
 *    `home.ts`/`add-expense.ts`'s `mount`).
 *
 * Known gap (asked and confirmed by the human before this unit was written):
 * day grouping uses the **device** timezone, not `family_tz` — nothing in the
 * current Contracts exposes `family_tz` to the browser (`GET /users/me`
 * doesn't carry it, there is no other endpoint for it). This is a list-display
 * grouping, not the month-boundary financial math D120/webapp/CLAUDE.md's
 * ironclad rule is about, so it's treated as a `lib/dates.ts::formatDay`-style
 * gap-fill (already tz-parameterized, no locked format) rather than a
 * blocking contract change. `groupByDay`/`createExpensesController` both take
 * an explicit `tz` for exactly this reason — the real fix, if ever needed, is
 * threading `family_tz` onto `UserMeResponse` and passing it in at the real
 * call site (`main.ts`), not touching this module.
 */

import { assignCategoryColors, categorySlotCssVar, OTHER_COLOR_VAR } from "../lib/category-colors";
import { formatDay } from "../lib/dates";
import { formatAmount } from "../lib/money";
import { haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ForbiddenError } from "../api/client";
import type { CategoryResponse, Currency, ExpenseResponse, IsoTimestamp, Uuid } from "../api/types";

const PAGE_SIZE = 50;

export interface ExpenseRow {
  id: Uuid;
  createdAt: IsoTimestamp;
  categoryId: Uuid;
  categoryLabel: string;
  colorVar: string;
  minor: number;
  comment: string | null;
  authorInitial: string | null;
  tags: string[];
}

export interface ExpenseDayGroup {
  dayKey: string;
  label: string;
  subtotalMinor: number;
  rows: ExpenseRow[];
}

export interface ExpensesData {
  currency: Currency;
  filterLabel: string | null;
  days: ExpenseDayGroup[];
  hasMore: boolean;
}

export type ExpensesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "forbidden" }
  | { status: "empty"; filterLabel: string | null }
  | ({ status: "ready" } & ExpensesData)
  | ({ status: "offline"; lastSyncedAt: string } & ExpensesData);

// -- data ------------------------------------------------------------------

function buildRow(
  expense: ExpenseResponse,
  categoryById: Map<Uuid, CategoryResponse>,
  colorBySlot: Map<Uuid, number | null>,
): ExpenseRow {
  const category = categoryById.get(expense.category_id);
  const slot = category ? (colorBySlot.get(category.id) ?? null) : null;
  return {
    id: expense.id,
    createdAt: expense.created_at,
    categoryId: expense.category_id,
    categoryLabel: category?.name ?? "Unknown",
    colorVar: category ? categorySlotCssVar(slot) : OTHER_COLOR_VAR,
    minor: expense.amount,
    comment: expense.comment,
    authorInitial: expense.user_name ? expense.user_name.trim().charAt(0).toUpperCase() || null : null,
    tags: expense.tags.map((t) => t.name),
  };
}

function dayKeyFor(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Groups rows (assumed already newest-first, the API's `ORDER BY created_at
 * DESC`) into per-day buckets with a running subtotal. Days come out in
 * first-seen order, i.e. the same order as the input — no re-sort needed. */
export function groupByDay(rows: ExpenseRow[], tz: string): ExpenseDayGroup[] {
  const groups: ExpenseDayGroup[] = [];
  const byKey = new Map<string, ExpenseDayGroup>();
  for (const row of rows) {
    const key = dayKeyFor(row.createdAt, tz);
    let group = byKey.get(key);
    if (!group) {
      group = { dayKey: key, label: formatDay(row.createdAt, tz), subtotalMinor: 0, rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
    group.subtotalMinor += row.minor;
  }
  return groups;
}

/** Pure: turns an accumulated page of raw expenses + categories into the
 * screen's ready-state shape, applying the optional category filter
 * client-side (there is no `category_id` query param on `GET /expenses` —
 * only `limit`/`offset`, per the plan's Contracts, so filtering a fetched
 * page is the only option without a backend change). */
export function buildExpensesData(input: {
  expenses: ExpenseResponse[];
  categories: CategoryResponse[];
  currency: Currency;
  categoryId?: Uuid;
  hasMore: boolean;
  tz: string;
}): ExpensesData {
  const filtered = input.categoryId
    ? input.expenses.filter((e) => e.category_id === input.categoryId)
    : input.expenses;
  const filterLabel = input.categoryId
    ? (input.categories.find((c) => c.id === input.categoryId)?.name ?? "this category")
    : null;
  const colorBySlot = new Map(assignCategoryColors(input.categories).map((c) => [c.id, c.slot]));
  const categoryById = new Map(input.categories.map((c) => [c.id, c]));
  const rows = filtered.map((e) => buildRow(e, categoryById, colorBySlot));
  return {
    currency: input.currency,
    filterLabel,
    days: groupByDay(rows, input.tz),
    hasMore: input.hasMore,
  };
}

export interface ExpensesApi {
  listExpenses(opts: { limit: number; offset: number }): Promise<ExpenseResponse[]>;
  listCategories(): Promise<CategoryResponse[]>;
  getMe(): Promise<{ currency: Currency }>;
}

export interface ExpensesSnapshot {
  data: ExpensesData;
  syncedAt: string;
}

export interface ExpensesCache {
  get(): ExpensesSnapshot | null;
  set(snapshot: ExpensesSnapshot): void;
}

export function createMemoryCache(): ExpensesCache {
  let snapshot: ExpensesSnapshot | null = null;
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
    },
  };
}

export interface ExpensesFilter {
  categoryId?: Uuid;
}

export interface ExpensesController {
  load(): Promise<ExpensesState>;
  loadMore(): Promise<ExpensesState>;
}

/** Owns the accumulated raw pages and the `own_only`-safe offset bookkeeping
 * (offset always advances by the *requested* `limit`, never by how many rows
 * survived the server's own_only filter — see the plan's documented
 * "Pagination vs own_only" risk: a short page must not desync the next raw
 * DB page). `load()`/`loadMore()` never throw, mirroring
 * `loadHome`/`loadAddExpenseData`'s contract. */
export function createExpensesController(
  api: ExpensesApi,
  cache: ExpensesCache,
  filter: ExpensesFilter = {},
  tz: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ExpensesController {
  let expenses: ExpenseResponse[] = [];
  let categories: CategoryResponse[] = [];
  let currency: Currency = "USD";
  let offset = 0;
  let hasMore = true;

  function buildState(): ExpensesState {
    const data = buildExpensesData({
      expenses,
      categories,
      currency,
      categoryId: filter.categoryId,
      hasMore,
      tz,
    });
    if (data.days.length === 0 && !hasMore) {
      return { status: "empty", filterLabel: data.filterLabel };
    }
    cache.set({ data, syncedAt: new Date().toISOString() });
    return { status: "ready", ...data };
  }

  async function fetchPage(): Promise<void> {
    const page = await api.listExpenses({ limit: PAGE_SIZE, offset });
    expenses = [...expenses, ...page];
    hasMore = page.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return {
    async load(): Promise<ExpensesState> {
      expenses = [];
      offset = 0;
      hasMore = true;
      try {
        const [me, cats] = await Promise.all([api.getMe(), api.listCategories()]);
        currency = me.currency;
        categories = cats;
        await fetchPage();
        return buildState();
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
    },
    async loadMore(): Promise<ExpensesState> {
      if (!hasMore) {
        return buildState();
      }
      try {
        await fetchPage();
      } catch {
        // Keeps whatever is already rendered; hasMore stays true so a retry
        // is just tapping "Load more" again, no lost state.
      }
      return buildState();
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

function renderRow(row: ExpenseRow): string {
  const tags = row.tags.length > 0 ? `<div class="exp-tags">${escapeHtml(row.tags.join(", "))}</div>` : "";
  const comment = row.comment ? `<div class="exp-comment">${escapeHtml(row.comment)}</div>` : "";
  const author = row.authorInitial
    ? `<span class="exp-author" aria-hidden="true">${escapeHtml(row.authorInitial)}</span>`
    : "";
  return `<div class="exp-row" data-testid="expense-row" data-expense-id="${row.id}">
    <span class="dot" style="background:${row.colorVar}"></span>
    <div class="exp-main">
      <div class="exp-title">${escapeHtml(row.categoryLabel)}</div>
      ${comment}
      ${tags}
    </div>
    ${author}
    <span class="exp-amount">${escapeHtml(formatAmount(row.minor))}</span>
  </div>`;
}

function renderDayGroup(group: ExpenseDayGroup, currency: Currency): string {
  return `<div class="card exp-day" data-testid="day-group" data-day="${group.dayKey}">
    <div class="exp-day-header">
      <span>${escapeHtml(group.label)}</span>
      <span class="exp-day-subtotal">${escapeHtml(formatAmount(group.subtotalMinor))} ${escapeHtml(currency)}</span>
    </div>
    ${group.rows.map(renderRow).join("")}
  </div>`;
}

function renderOfflineBanner(lastSyncedAt: string | undefined): string {
  if (!lastSyncedAt) {
    return "";
  }
  return `<div class="offline-banner" data-testid="offline">Offline — showing data from ${escapeHtml(lastSyncedAt)}</div>`;
}

function renderSkeleton(): string {
  return `<div class="expenses-skeleton" data-testid="loading">
    <div class="exp-day-skeleton"></div>
    <div class="exp-day-skeleton"></div>
  </div>`;
}

function renderError(message: string): string {
  return `<div class="expenses-error" data-testid="error">
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">Try again</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="expenses-readonly" data-testid="forbidden">
    <p>You don't have permission to view expenses.</p>
  </div>`;
}

function renderEmpty(filterLabel: string | null): string {
  const message = filterLabel ? `Nothing here yet for ${escapeHtml(filterLabel)}.` : "No expenses yet.";
  return `<div class="expenses-empty" data-testid="empty">
    <p>${message}</p>
  </div>`;
}

function renderReady(data: ExpensesData, lastSyncedAt: string | undefined): string {
  const footer = data.hasMore
    ? `<button type="button" class="load-more" data-action="load-more">Load more</button>`
    : `<p class="end-of-list" data-testid="end-of-list">You've reached the end.</p>`;
  return `<div class="expenses-ready" data-testid="ready">
    ${renderOfflineBanner(lastSyncedAt)}
    ${data.filterLabel ? `<p class="exp-filter" data-testid="filter-banner">Filtered: ${escapeHtml(data.filterLabel)}</p>` : ""}
    ${data.days.map((d) => renderDayGroup(d, data.currency)).join("")}
    ${footer}
  </div>`;
}

export function renderExpenses(state: ExpensesState): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "error":
      return renderError(state.message);
    case "forbidden":
      return renderForbidden();
    case "empty":
      return renderEmpty(state.filterLabel);
    case "ready":
      return renderReady(state, undefined);
    case "offline":
      return renderReady(state, state.lastSyncedAt);
  }
}

// -- chrome ------------------------------------------------------------------

/** Telegram chrome for Expenses: no MainButton (the design doc names none for
 * this screen, unlike Home/Add-expense), BackButton always wired to `onBack`
 * (→ Home, per the design's flow diagram). */
export function applyExpensesChrome(onBack: () => void): void {
  mainButton.hide();
  setBackButtonHandler(onBack);
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as home.ts/add-expense.ts's mount) ------------------------

export interface ExpensesHandlers {
  onRetry: () => void;
  onLoadMore: () => void;
  onRowTap: (id: Uuid) => void;
}

export function mount(root: HTMLElement, state: ExpensesState, handlers: ExpensesHandlers): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderExpenses(state);

  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);
  root.querySelector('[data-action="load-more"]')?.addEventListener("click", handlers.onLoadMore);

  root.querySelectorAll<HTMLElement>("[data-expense-id]").forEach((el) => {
    el.addEventListener("click", () => {
      haptics.selection();
      handlers.onRowTap(el.dataset.expenseId as Uuid);
    });
  });
}
