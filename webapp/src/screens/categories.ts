/** Screen 06 — Categories (docs/ui/screens/06-categories.md). List only
 * (plan unit U2.1, "06a"): a 4-column grid of every active category (colour
 * circle, name, a small "{count} · {amount}" caption) plus a grey "Add
 * category" cell, and a collapsible archived section below. Tapping any
 * category cell or the "Add category" cell is a stub for this unit — U2.2
 * wires them to the create/edit screen (06b).
 *
 * Same three-layer split as every other screen:
 *  - data: `loadCategories`/`buildCategoriesData` — orchestrates the
 *    ApiClient calls and turns them into a `CategoriesState`. Never throws,
 *    same never-throws/cache-fallback contract as `loadBudgets`/`loadHome`.
 *  - presentation: `renderCategories`/`renderCategoriesView` (pure, HTML
 *    strings).
 *  - mount: thin DOM glue, the one part with no meaningful unit test (same
 *    accepted gap as every other screen's `mount`). Owns the one piece of
 *    in-screen state this unit has — whether the archived section is
 *    expanded — since that's a pure client-side toggle, not a fetch.
 *
 * `GET /statistics/by-category` only returns categories with at least one
 * expense in the period (`services/statistics_service.py::by_category`
 * builds its result from a `defaultdict` over actual expenses) — a category
 * absent from that response has spent 0 this month, not "unknown"; see
 * `monthTotalFor` below.
 */

import { assignCategoryColors, categorySlotCssVar } from "../lib/category-colors";
import { formatAmount } from "../lib/money";
import { haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ForbiddenError } from "../api/client";
import type { CategoryResponse, CategoryTotal, Currency, Uuid } from "../api/types";

// -- data ---------------------------------------------------------------

export interface CategoryRow {
  id: Uuid;
  name: string;
  colorVar: string;
  expenseCount: number;
  monthTotalMinor: number;
}

export interface CategoriesData {
  currency: Currency;
  active: CategoryRow[];
  archived: CategoryRow[];
}

function monthTotalFor(categoryId: Uuid, totals: CategoryTotal[]): number {
  return totals.find((t) => t.category_id === categoryId)?.total ?? 0;
}

export function buildCategoriesData(input: {
  categories: CategoryResponse[];
  monthTotals: CategoryTotal[];
  currency: Currency;
}): CategoriesData {
  // Sorted `created_at ASC` across active AND archived — `category-colors.ts`'s
  // fallback position rule is "position in the account's list", not "position
  // among active categories only", so an archived category still occupies its
  // original index for a null-slot neighbour's fallback colour.
  const ordered = [...input.categories].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const colorBySlot = new Map(assignCategoryColors(ordered).map((c) => [c.id, c.slot]));

  const active: CategoryRow[] = [];
  const archived: CategoryRow[] = [];
  for (const category of ordered) {
    const row: CategoryRow = {
      id: category.id,
      name: category.name,
      colorVar: categorySlotCssVar(colorBySlot.get(category.id) ?? null),
      expenseCount: category.expense_count ?? 0,
      monthTotalMinor: monthTotalFor(category.id, input.monthTotals),
    };
    (category.is_active === false ? archived : active).push(row);
  }

  return { currency: input.currency, active, archived };
}

export interface CategoriesApi {
  getMe(): Promise<{ currency: Currency }>;
  listCategories(opts: { includeUsage?: boolean; includeArchived?: boolean }): Promise<CategoryResponse[]>;
  statisticsByCategory(query: { period: "month"; offset: number }): Promise<CategoryTotal[]>;
}

export interface CategoriesSnapshot {
  data: CategoriesData;
  syncedAt: string;
}

export interface CategoriesCache {
  get(): CategoriesSnapshot | null;
  set(snapshot: CategoriesSnapshot): void;
}

export function createMemoryCache(): CategoriesCache {
  let snapshot: CategoriesSnapshot | null = null;
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
    },
  };
}

export type CategoriesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "forbidden" }
  | ({ status: "ready" } & CategoriesData)
  | ({ status: "offline"; lastSyncedAt: string } & CategoriesData);

/** Never throws — every failure resolves to a `CategoriesState` the caller
 * can render directly, same contract as `loadBudgets`/`loadHome`. Unlike
 * Budgets, there is no top-level "empty" status: zero categories is a
 * `ready` sub-case (`active.length === 0`) so the "Add category" cell still
 * renders alongside the empty copy (docs/ui/screens/06-categories.md's
 * Empty state). */
export async function loadCategories(api: CategoriesApi, cache: CategoriesCache): Promise<CategoriesState> {
  try {
    const [me, categories] = await Promise.all([
      api.getMe(),
      api.listCategories({ includeUsage: true, includeArchived: true }),
    ]);
    const monthTotals = await api.statisticsByCategory({ period: "month", offset: 0 });
    const data = buildCategoriesData({ categories, monthTotals, currency: me.currency });
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

// -- chrome ---------------------------------------------------------------

/** BackButton always returns to Home. No MainButton on this screen — the
 * "Add category" cell is the add affordance, and a MainButton would be a
 * second, not-yet-built entry point to the same action. */
export function applyCategoriesChrome(onBack: () => void): void {
  setBackButtonHandler(onBack);
  mainButton.hide();
}

// -- presentation -----------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function captionText(row: CategoryRow): string {
  return `${row.expenseCount} · ${formatAmount(row.monthTotalMinor)}`;
}

function captionAriaLabel(row: CategoryRow): string {
  const expenseWord = row.expenseCount === 1 ? "1 expense" : `${row.expenseCount} expenses`;
  return `${row.name}, ${expenseWord}, ${formatAmount(row.monthTotalMinor)} this month`;
}

function renderCell(row: CategoryRow): string {
  return `<button type="button" class="cat-cell" data-testid="cat-cell" data-category-id="${row.id}" aria-label="${escapeHtml(captionAriaLabel(row))}">
    <span class="cat-cell-swatch" style="background:${row.colorVar}" aria-hidden="true"></span>
    <span class="cat-cell-name" aria-hidden="true">${escapeHtml(row.name)}</span>
    <span class="cat-cell-caption" aria-hidden="true">${escapeHtml(captionText(row))}</span>
  </button>`;
}

function renderAddCell(): string {
  return `<button type="button" class="cat-cell cat-cell-add" data-testid="cat-cell-add" aria-label="Add category">
    <span class="cat-cell-swatch cat-cell-add-swatch" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
        <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      </svg>
    </span>
    <span class="cat-cell-name" aria-hidden="true">Add category</span>
  </button>`;
}

function renderGrid(active: CategoryRow[]): string {
  return `<div class="cat-grid" data-testid="cat-grid">
    ${active.map(renderCell).join("")}
    ${renderAddCell()}
  </div>`;
}

/** `role="button"`/`tabindex="0"` on the `.row` div — the same convention
 * `home.ts::renderRankedRows` uses for this exact class, not a native
 * `<button>` (which would need its own border/background/font resets `.row`
 * doesn't carry). The spec's Interactions table treats an archived-row tap
 * as the same kind of stub as an active cell's ("same stub as above"), and
 * its Accessibility section's focus order includes archived rows, so this
 * still needs to be reachable even with no handler wired yet. */
function renderArchivedRow(row: CategoryRow): string {
  return `<div class="row cat-archived-row" data-testid="cat-archived-row" role="button" tabindex="0" aria-label="${escapeHtml(captionAriaLabel(row))}">
    <span class="swatch" style="background:${row.colorVar}" aria-hidden="true"></span>
    <span class="nm" aria-hidden="true">${escapeHtml(row.name)}</span>
    <span class="cat-archived-caption" aria-hidden="true">${escapeHtml(captionText(row))}</span>
  </div>`;
}

function renderArchivedSection(archived: CategoryRow[], expanded: boolean): string {
  if (archived.length === 0) {
    return "";
  }
  return `<div class="cat-archived" data-testid="cat-archived">
    <button type="button" class="cat-archived-header" data-action="toggle-archived" aria-expanded="${expanded}">
      <span>Archived (${archived.length})</span>
      <span class="cat-archived-chevron${expanded ? " cat-archived-chevron--open" : ""}" aria-hidden="true"></span>
    </button>
    ${
      expanded
        ? `<p class="cat-archived-explain">Archived categories keep their history in reports, but you can't pick them for new expenses.</p>
    ${archived.map(renderArchivedRow).join("")}`
        : ""
    }
  </div>`;
}

export interface CategoriesViewState {
  data: CategoriesData;
  lastSyncedAt?: string;
  archivedExpanded: boolean;
}

// `CategoriesData.currency` is not rendered here — captions show only the
// formatted amount, no trailing currency code, matching home.ts's ranked
// rows. It stays on the data model for callers/tests that need it.
export function renderCategoriesView(state: CategoriesViewState): string {
  const { active, archived } = state.data;
  return `<div class="categories-ready" data-testid="ready">
    ${state.lastSyncedAt ? `<div class="offline-banner" data-testid="offline">Offline — showing data from ${escapeHtml(state.lastSyncedAt)}</div>` : ""}
    ${active.length === 0 ? `<p class="categories-empty-note" data-testid="empty-note">No categories yet</p>` : ""}
    ${renderGrid(active)}
    ${renderArchivedSection(archived, state.archivedExpanded)}
  </div>`;
}

function renderSkeleton(): string {
  const cells = Array.from({ length: 8 }, () => `<div class="cat-cell-skeleton"></div>`).join("");
  return `<div class="categories-skeleton" data-testid="loading">
    <div class="cat-grid">${cells}</div>
  </div>`;
}

function renderError(message: string): string {
  return `<div class="categories-error" data-testid="error">
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">Try again</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="categories-readonly" data-testid="forbidden">
    <p>You have read-only access to this account.</p>
  </div>`;
}

export const GRID_COLUMNS = 4;

/** Pure index arithmetic for the grid's arrow-key navigation
 * (`docs/ui/screens/06-categories.md`'s Accessibility section, matching
 * `category-picker.md`'s "wrapping by row" rule). Left/Right wrap linearly
 * across the whole cell list (end of the grid wraps to its start); Up/Down
 * jump a full row and wrap to the opposite edge, clamped into range for a
 * ragged last row (fewer than `GRID_COLUMNS` cells) so an out-of-bounds jump
 * never returns an invalid index. Returns `from` unchanged for any other key. */
export function nextGridFocusIndex(cellCount: number, from: number, key: string): number {
  if (cellCount === 0) {
    return from;
  }
  switch (key) {
    case "ArrowRight":
      return (from + 1) % cellCount;
    case "ArrowLeft":
      return (from - 1 + cellCount) % cellCount;
    case "ArrowDown": {
      const next = from + GRID_COLUMNS;
      return next < cellCount ? next : next % cellCount;
    }
    case "ArrowUp": {
      const prev = from - GRID_COLUMNS;
      return prev >= 0 ? prev : (prev + cellCount) % cellCount;
    }
    default:
      return from;
  }
}

export function renderCategories(state: CategoriesState, archivedExpanded = false): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "error":
      return renderError(state.message);
    case "forbidden":
      return renderForbidden();
    case "ready":
      return renderCategoriesView({ data: state, archivedExpanded });
    case "offline":
      return renderCategoriesView({ data: state, lastSyncedAt: state.lastSyncedAt, archivedExpanded });
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface CategoriesHandlers {
  onRetry: () => void;
  onBack: () => void;
}

export function mount(root: HTMLElement, state: CategoriesState, handlers: CategoriesHandlers): void {
  if (typeof document === "undefined") {
    return;
  }

  let archivedExpanded = false;

  const render = (): void => {
    root.innerHTML = renderCategories(state, archivedExpanded);
    wire();
  };

  function wire(): void {
    root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);
    root.querySelector('[data-action="toggle-archived"]')?.addEventListener("click", () => {
      haptics.selection();
      archivedExpanded = !archivedExpanded;
      render();
    });
    // Category cells and the "Add category" cell are stubs for this unit
    // (docs/ui/screens/06-categories.md's Interactions table) — no click
    // handler is wired yet. U2.2 wires the create/edit destination (screen
    // 06b). Arrow-key navigation between them is wired regardless — it's a
    // pure focus move, independent of what tapping a cell eventually does.
    const grid = root.querySelector<HTMLElement>('[data-testid="cat-grid"]');
    const cells = grid ? Array.from(grid.querySelectorAll<HTMLElement>(".cat-cell")) : [];
    grid?.addEventListener("keydown", (e) => {
      const from = cells.indexOf(document.activeElement as HTMLElement);
      if (from === -1) {
        return;
      }
      const nextIndex = nextGridFocusIndex(cells.length, from, e.key);
      if (nextIndex === from) {
        return;
      }
      e.preventDefault();
      cells[nextIndex]?.focus();
    });
  }

  render();
}
