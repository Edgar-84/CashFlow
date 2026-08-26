/** Screen 03a — Expenses list (docs/ui/screens/03-expenses.md). A flat list of
 * 38 rows answers nothing; grouped by day with a per-day subtotal answers
 * "was Saturday expensive?" with no interaction. Each row: category colour,
 * category name, author initial, tags, amount.
 *
 * Layers, same split as screens/home.ts and screens/add-expense.ts:
 *  - data: `buildExpensesData`/`groupByDay` — pure, turn a page of
 *    `ExpenseResponse[]` + `CategoryResponse[]` into day groups. Directly
 *    unit-testable, no network.
 *  - controller: `createExpensesController` owns the accumulated pages
 *    (offset, `hasMore`, an optional category+period filter) and the
 *    never-throws/cache-fallback contract every screen's data layer follows
 *    (mirrors `loadHome`/`loadAddExpenseData`). The filter is applied
 *    **server-side** (V4/D402/D403): `category_id` and `period` travel on
 *    every `GET /expenses` call this controller makes, so a category with no
 *    expenses on the first page no longer renders as "nothing here yet"
 *    while its expenses sit on page 2.
 *  - presentation: `renderExpenses` (pure, HTML string) and `mount` (thin DOM
 *    glue, the one part with no meaningful unit test — same accepted gap as
 *    `home.ts`/`add-expense.ts`'s `mount`). Both take an explicit `now: Date`
 *    (mirrors `home.ts`) so the period half of the filter/empty copy renders
 *    through the same `lib/period.ts::describe` Home's label uses.
 *
 * Day grouping keys off `spent_at` (D410/D314), the day the expense
 * happened, not `created_at` (when the row was typed) — a backdated expense
 * groups and subtotals under the day it was spent. `spent_at` is a bare
 * `YYYY-MM-DD` already resolved server-side, so no device timezone ever
 * enters this module: `parseCalendarDate` builds a **local** `Date` from its
 * y/m/d components (never `new Date("YYYY-MM-DD")`, which parses as UTC
 * midnight and can drift a day under a negative offset — D120's bug class,
 * same convention as `screens/add-expense.ts`'s own private date helpers).
 */

import { assignCategoryColors, categorySlotCssVar, OTHER_COLOR_VAR } from "../lib/category-colors";
import { t } from "../lib/i18n";
import { formatAmount } from "../lib/money";
import { describe as describePeriod, toQuery, type PeriodQuery, type PeriodValue } from "../lib/period";
import { haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ForbiddenError } from "../api/client";
import type { CategoryResponse, Currency, ExpenseResponse, Uuid } from "../api/types";

const PAGE_SIZE = 50;

export interface ExpenseRow {
  id: Uuid;
  spentAt: string;
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
  categoryLabel: string | null;
  period: PeriodValue | undefined;
  days: ExpenseDayGroup[];
  hasMore: boolean;
}

export type ExpensesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "forbidden" }
  | { status: "empty"; categoryLabel: string | null; period: PeriodValue | undefined }
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
    spentAt: expense.spent_at,
    categoryId: expense.category_id,
    categoryLabel: category?.name ?? t("category.unknown"),
    colorVar: category ? categorySlotCssVar(slot) : OTHER_COLOR_VAR,
    minor: expense.amount,
    comment: expense.comment,
    authorInitial: expense.user_name ? expense.user_name.trim().charAt(0).toUpperCase() || null : null,
    tags: expense.tags.map((tag) => tag.name),
  };
}

/** `row.spentAt` ("YYYY-MM-DD") parsed into a **local** `Date` — never
 * `new Date("YYYY-MM-DD")`, which parses as UTC midnight and can render a
 * day early under a negative offset (D120's bug class). */
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

/** Groups rows (assumed already newest-`created_at`-first, the API's
 * `ORDER BY created_at DESC`) into per-day buckets with a running subtotal,
 * keyed off `spent_at` (D410) — already `YYYY-MM-DD`, so it doubles as the
 * group key with no further parsing. Rows *within* a group keep the input's
 * first-seen order, but the **groups themselves** are sorted by `dayKey`
 * descending: since `spent_at` and `created_at` can diverge (a backdated
 * expense), first-seen-day order is no longer the same thing as newest-day
 * order, and `docs/ui/screens/03-expenses.md` requires "newest day first"
 * regardless. A plain string compare sorts `YYYY-MM-DD` correctly. */
export function groupByDay(rows: ExpenseRow[]): ExpenseDayGroup[] {
  const byKey = new Map<string, ExpenseDayGroup>();
  for (const row of rows) {
    const key = row.spentAt;
    let group = byKey.get(key);
    if (!group) {
      group = { dayKey: key, label: formatSpentDay(key), subtotalMinor: 0, rows: [] };
      byKey.set(key, group);
    }
    group.rows.push(row);
    group.subtotalMinor += row.minor;
  }
  return [...byKey.values()].sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0));
}

/** Pure: turns an accumulated page of raw expenses + categories into the
 * screen's ready-state shape. `expenses` is already filtered by the server
 * (`category_id`/`period` travel on the `GET /expenses` call itself, D402) —
 * this function does no filtering of its own, only labels the filter that's
 * already in force for the banner/empty copy. */
export function buildExpensesData(input: {
  expenses: ExpenseResponse[];
  categories: CategoryResponse[];
  currency: Currency;
  categoryId?: Uuid;
  period?: PeriodValue;
  hasMore: boolean;
}): ExpensesData {
  const categoryLabel = input.categoryId
    ? (input.categories.find((c) => c.id === input.categoryId)?.name ?? t("expenses.unknownCategory"))
    : null;
  const colorBySlot = new Map(assignCategoryColors(input.categories).map((c) => [c.id, c.slot]));
  const categoryById = new Map(input.categories.map((c) => [c.id, c]));
  const rows = input.expenses.map((e) => buildRow(e, categoryById, colorBySlot));
  return {
    currency: input.currency,
    categoryLabel,
    period: input.period,
    days: groupByDay(rows),
    hasMore: input.hasMore,
  };
}

export interface ExpensesApi {
  listExpenses(opts: {
    limit: number;
    offset: number;
    categoryId?: Uuid;
    period?: PeriodQuery;
  }): Promise<ExpenseResponse[]>;
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
  period?: PeriodValue;
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
): ExpensesController {
  let expenses: ExpenseResponse[] = [];
  let categories: CategoryResponse[] = [];
  let currency: Currency = "USD";
  let offset = 0;
  let hasMore = true;
  const periodQuery = filter.period ? toQuery(filter.period) : undefined;

  function buildState(): ExpensesState {
    const data = buildExpensesData({
      expenses,
      categories,
      currency,
      categoryId: filter.categoryId,
      period: filter.period,
      hasMore,
    });
    if (data.days.length === 0 && !hasMore) {
      return { status: "empty", categoryLabel: data.categoryLabel, period: data.period };
    }
    cache.set({ data, syncedAt: new Date().toISOString() });
    return { status: "ready", ...data };
  }

  async function fetchPage(): Promise<void> {
    const page = await api.listExpenses({
      limit: PAGE_SIZE,
      offset,
      categoryId: filter.categoryId,
      period: periodQuery,
    });
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
        const message = err instanceof Error ? err.message : t("error.fallback");
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

// Non-escaping counterpart to `t()`'s own vars mechanism — the templated
// filter banner and empty-state strings are composed here raw and escaped
// exactly once by their caller's own `escapeHtml` wrap (home.ts's
// `budgetAlertMessage` convention; pure modules don't share this helper).
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? vars[name] : match));
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
  return `<div class="offline-banner" data-testid="offline">${t("offline.banner", { time: lastSyncedAt })}</div>`;
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
    <button type="button" data-action="retry">${escapeHtml(t("error.retry"))}</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="expenses-readonly" data-testid="forbidden">
    <p>${escapeHtml(t("expenses.forbidden"))}</p>
  </div>`;
}

/** Combines the two filter halves into the banner/copy text — "Transport ·
 * August" when both are in force, either alone otherwise, `null` when
 * neither is (docs/ui/screens/03-expenses.md's Copy table, `filter.*`). */
function filterBannerText(categoryLabel: string | null, periodLabel: string | null): string | null {
  if (categoryLabel && periodLabel) {
    return fillTemplate(t("expenses.filter.both"), { category: categoryLabel, period: periodLabel });
  }
  return categoryLabel ?? periodLabel;
}

/** Same two halves, the empty-state phrasing (`empty.*`) — period first,
 * category second, unlike the banner's order. */
function emptyMessage(categoryLabel: string | null, periodLabel: string | null): string {
  if (categoryLabel && periodLabel) {
    return fillTemplate(t("expenses.empty.both"), { category: categoryLabel, period: periodLabel });
  }
  if (categoryLabel) {
    return fillTemplate(t("expenses.empty.categoryOnly"), { category: categoryLabel });
  }
  if (periodLabel) {
    return fillTemplate(t("expenses.empty.periodOnly"), { period: periodLabel });
  }
  return t("expenses.empty.unfiltered");
}

function renderEmpty(categoryLabel: string | null, period: PeriodValue | undefined, now: Date): string {
  const periodLabel = period ? describePeriod(period, now) : null;
  const message = emptyMessage(categoryLabel, periodLabel);
  return `<div class="expenses-empty" data-testid="empty">
    <p>${escapeHtml(message)}</p>
  </div>`;
}

function renderReady(data: ExpensesData, lastSyncedAt: string | undefined, now: Date): string {
  const periodLabel = data.period ? describePeriod(data.period, now) : null;
  const banner = filterBannerText(data.categoryLabel, periodLabel);
  const footer = data.hasMore
    ? `<button type="button" class="load-more" data-action="load-more">${escapeHtml(t("expenses.loadMore"))}</button>`
    : `<p class="end-of-list" data-testid="end-of-list">${escapeHtml(t("expenses.endOfList"))}</p>`;
  return `<div class="expenses-ready" data-testid="ready">
    ${renderOfflineBanner(lastSyncedAt)}
    ${banner ? `<p class="exp-filter" data-testid="filter-banner">${escapeHtml(banner)}</p>` : ""}
    ${data.days.map((d) => renderDayGroup(d, data.currency)).join("")}
    ${footer}
  </div>`;
}

export function renderExpenses(state: ExpensesState, now: Date): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "error":
      return renderError(state.message);
    case "forbidden":
      return renderForbidden();
    case "empty":
      return renderEmpty(state.categoryLabel, state.period, now);
    case "ready":
      return renderReady(state, undefined, now);
    case "offline":
      return renderReady(state, state.lastSyncedAt, now);
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

export function mount(root: HTMLElement, state: ExpensesState, handlers: ExpensesHandlers, now: Date): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderExpenses(state, now);

  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);
  root.querySelector('[data-action="load-more"]')?.addEventListener("click", handlers.onLoadMore);

  root.querySelectorAll<HTMLElement>("[data-expense-id]").forEach((el) => {
    el.addEventListener("click", () => {
      haptics.selection();
      handlers.onRowTap(el.dataset.expenseId as Uuid);
    });
  });
}
