/** Screen 06 — Categories (docs/ui/screens/06-categories.md). "06a", the
 * list: a 4-column grid of every active category (colour circle, name, a
 * small "{count} · {amount}" caption) plus a grey "Add category" cell, and a
 * collapsible archived section below. Tapping an active cell or the "Add
 * category" cell navigates to "06b" — the create/rename/recolour form
 * (docs/ui/screens/06b-category-form.md, plan unit U2.2), also in this file
 * below the "-- form --" marker. An archived row's tap stays a stub;
 * U2.3 wires the delete-or-hide destination.
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

import { assignCategoryColors, categorySlotCssVar, categorySlotName } from "../lib/category-colors";
import { formatAmount } from "../lib/money";
import { confirmDiscard, haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ApiError, ForbiddenError } from "../api/client";
import type { CategoryResponse, CategoryTotal, Currency, Uuid } from "../api/types";

// -- data ---------------------------------------------------------------

export interface CategoryRow {
  id: Uuid;
  name: string;
  colorVar: string;
  /** Raw `color_slot` (`null` = never explicitly chosen, position-fallback
   * applies elsewhere) — screen 06b's form needs this, not the resolved
   * `colorVar`, to seed its edit-mode draft and "already taken" set. */
  colorSlot: number | null;
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
      colorSlot: category.color_slot ?? null,
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
  /** Opens the 06b form pre-filled for this category (an active cell tap). */
  onSelectCategory: (id: Uuid) => void;
  /** Opens the 06b form empty (the "Add category" cell tap). */
  onAddCategory: () => void;
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
    // Archived-row tap stays a stub — U2.3 wires the delete-or-hide
    // destination. Arrow-key navigation between grid cells is wired
    // regardless — it's a pure focus move, independent of what a tap does.
    const grid = root.querySelector<HTMLElement>('[data-testid="cat-grid"]');
    const cells = grid ? Array.from(grid.querySelectorAll<HTMLElement>(".cat-cell")) : [];
    for (const cell of cells) {
      const categoryId = cell.getAttribute("data-category-id");
      cell.addEventListener("click", () => {
        if (categoryId) {
          handlers.onSelectCategory(categoryId);
        } else {
          handlers.onAddCategory();
        }
      });
    }
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

// -- form (screen 06b, docs/ui/screens/06b-category-form.md) ----------------
// One form surface for both create and rename/recolour — own draft/
// controller/chrome/presentation/mount, parallel to 06a's above but a
// distinct screen reached by navigating away from it (main.ts).

export interface CategoryFormDraft {
  /** `null` = create mode (POST); set = edit mode (PATCH this id). */
  id: Uuid | null;
  name: string;
  colorSlot: number | null;
}

export function emptyCategoryFormDraft(): CategoryFormDraft {
  return { id: null, name: "", colorSlot: null };
}

export function categoryFormDraftFromRow(row: Pick<CategoryRow, "id" | "name" | "colorSlot">): CategoryFormDraft {
  return { id: row.id, name: row.name, colorSlot: row.colorSlot };
}

/** Trimmed-name comparison so trailing/leading whitespace alone never counts
 * as a change (docs/ui/screens/06b-category-form.md's dirty-check rule). */
export function isCategoryFormDirty(draft: CategoryFormDraft, original: CategoryFormDraft): boolean {
  return draft.name.trim() !== original.name.trim() || draft.colorSlot !== original.colorSlot;
}

/** The inline name error — never a popup, per the AC. `null` while the
 * trimmed name is non-empty. */
export function categoryNameError(name: string): string | null {
  return name.trim() === "" ? "Give this category a name." : null;
}

/** Non-blocking duplicate-name warning, scoped to active categories only
 * (2026-08-05, HUMAN) — archived categories are out of the user's
 * forward-looking view and don't trigger it. Excludes `ownId` so editing a
 * category without touching its name never warns against itself. */
export function categoryDuplicateWarning(
  name: string,
  ownId: Uuid | null,
  activeSiblings: { id: Uuid; name: string }[],
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const match = activeSiblings.some((s) => s.id !== ownId && s.name.trim().toLowerCase() === lower);
  return match ? `Another category is already named "${trimmed}".` : null;
}

/** MainButton's enabled rule: dirty alone, per the spec — a blank name stays
 * *tappable* (not silently disabled); `submit()` below is what actually
 * blocks it and surfaces the inline error, so the rejection is never a
 * disabled-but-unexplained button. */
export function categoryFormMainButtonEnabled(draft: CategoryFormDraft, original: CategoryFormDraft): boolean {
  return isCategoryFormDirty(draft, original);
}

export interface CategoryFormApi {
  createCategory(data: { name: string; color_slot: number | null }): Promise<CategoryResponse>;
  updateCategory(id: Uuid, data: { name?: string; color_slot?: number | null }): Promise<CategoryResponse>;
}

export type CategoryFormOutcome =
  | { status: "success"; category: CategoryResponse }
  | { status: "blocked"; reason: "invalid" | "submitting" }
  | { status: "error"; message: string };

function categoryFormErrorMessage(err: unknown): string {
  if (err instanceof ForbiddenError) {
    return "You have read-only access to this account.";
  }
  if (err instanceof ApiError) {
    return err.message;
  }
  return "Couldn't save this category.";
}

export interface CategoryFormController {
  getDraft(): CategoryFormDraft;
  setName(value: string): void;
  setColorSlot(slot: number): void;
  submit(): Promise<CategoryFormOutcome>;
}

/** Owns the in-progress draft and the double-submit guard — same shape as
 * `add-expense.ts`'s controller (D118/D123): `submitting` flips synchronously
 * before the first `await`, so a real double-tap's second call is rejected
 * before either resolves, and only the first reaches the API. */
export function createCategoryFormController(
  api: CategoryFormApi,
  original: CategoryFormDraft,
): CategoryFormController {
  let draft = { ...original };
  let submitting = false;

  return {
    getDraft: () => draft,
    setName(value) {
      draft = { ...draft, name: value };
    },
    setColorSlot(slot) {
      draft = { ...draft, colorSlot: slot };
    },
    async submit(): Promise<CategoryFormOutcome> {
      if (submitting) {
        return { status: "blocked", reason: "submitting" };
      }
      if (!isCategoryFormDirty(draft, original) || categoryNameError(draft.name) !== null) {
        return { status: "blocked", reason: "invalid" };
      }
      submitting = true;
      try {
        const name = draft.name.trim();
        const category = draft.id
          ? await api.updateCategory(draft.id, { name, color_slot: draft.colorSlot })
          : await api.createCategory({ name, color_slot: draft.colorSlot });
        return { status: "success", category };
      } catch (err) {
        return { status: "error", message: categoryFormErrorMessage(err) };
      } finally {
        submitting = false;
      }
    },
  };
}

// -- form chrome --------------------------------------------------------

export function applyCategoryFormChrome(draft: CategoryFormDraft, original: CategoryFormDraft): void {
  mainButton.show("Save");
  mainButton.setEnabled(categoryFormMainButtonEnabled(draft, original));
}

/** BackButton on a dirty draft confirms before discarding — Telegram's own
 * popup, never a custom modal (webapp/CLAUDE.md), same shape as
 * `add-expense.ts::wireBackButton`. */
export function wireCategoryFormBackButton(
  getDraft: () => CategoryFormDraft,
  original: CategoryFormDraft,
  onClose: () => void,
): void {
  setBackButtonHandler(() => {
    void (async () => {
      if (!isCategoryFormDirty(getDraft(), original)) {
        onClose();
        return;
      }
      const discard = await confirmDiscard("Discard changes to this category?");
      if (discard) {
        onClose();
      }
    })();
  });
}

// -- form presentation --------------------------------------------------

const CHECK_SVG =
  '<svg width="10" height="8" viewBox="0 0 10 8" aria-hidden="true" focusable="false">' +
  '<path d="M1 4l2.5 2.5L9 1" stroke="currentColor" stroke-width="1.6" fill="none" ' +
  'stroke-linecap="round" stroke-linejoin="round" /></svg>';

function renderSwatchCell(slot: number, draft: CategoryFormDraft, usedSlots: Set<number>): string {
  const selected = draft.colorSlot === slot;
  const inUse = usedSlots.has(slot);
  const name = categorySlotName(slot);
  const ariaLabel = inUse ? `${name}, in use` : name;
  return `<button type="button" class="cat-swatch-cell" data-testid="cat-swatch" data-slot="${slot}" role="radio" aria-checked="${selected}" aria-label="${escapeHtml(ariaLabel)}">
    <span class="cat-swatch" style="background:var(--category-slot-${slot})" aria-hidden="true">${selected ? `<span class="cat-swatch-check">${CHECK_SVG}</span>` : ""}</span>
    <span class="cat-swatch-name" aria-hidden="true">${escapeHtml(name)}</span>
    <span class="cat-swatch-inuse" aria-hidden="true">${inUse ? "In use" : ""}</span>
  </button>`;
}

function renderNameField(draft: CategoryFormDraft, message: { text: string; kind: "error" | "warning" } | null): string {
  return `<div>
    <div class="cat-form-field">
      <label class="cat-form-label" for="cat-name-input">Name</label>
      <input id="cat-name-input" class="cat-form-input" type="text" data-testid="cat-name-input" placeholder="Category name" value="${escapeHtml(draft.name)}" />
    </div>
    <p class="cat-form-message${message ? ` cat-form-message--${message.kind}` : ""}" data-testid="cat-form-message" aria-live="polite">${message ? escapeHtml(message.text) : ""}</p>
  </div>`;
}

export interface CategoryFormViewState {
  draft: CategoryFormDraft;
  /** Active categories only, excluding this one — the duplicate-name check's
   * scope (2026-08-05, HUMAN). */
  activeSiblings: { id: Uuid; name: string }[];
  /** Raw explicit `color_slot`s from any *other* category, active or
   * archived — an archived category still shows its colour in the archived
   * row list, so its slot still reads as "taken" here. Never includes a
   * position-fallback slot (only an explicit choice counts as "taken").
   * `[inferred]`, not one of the confirmed open questions. */
  usedSlots: Set<number>;
  /** Only after the Name field has been blurred, or a blocked Save attempt —
   * never shown immediately on open (docs/ui/screens/06b-category-form.md). */
  nameInteracted: boolean;
  submitError?: string | null;
}

export function renderCategoryForm(state: CategoryFormViewState): string {
  const { draft } = state;
  const error = categoryNameError(draft.name);
  const warning = error ? null : categoryDuplicateWarning(draft.name, draft.id, state.activeSiblings);
  const message = !state.nameInteracted
    ? null
    : error
      ? { text: error, kind: "error" as const }
      : warning
        ? { text: warning, kind: "warning" as const }
        : null;

  const swatches = Array.from({ length: 12 }, (_, i) => renderSwatchCell(i + 1, draft, state.usedSlots)).join("");

  return `<div class="cat-form" data-testid="cat-form">
    ${renderNameField(draft, message)}
    <div class="cat-form-section">
      <p class="cat-form-label">Colour</p>
      <div class="cat-swatch-grid" role="radiogroup" aria-label="Colour" data-testid="cat-swatch-grid">${swatches}</div>
    </div>
    ${state.submitError ? `<p class="submit-error" data-testid="cat-form-submit-error">${escapeHtml(state.submitError)}</p>` : ""}
  </div>`;
}

// -- form mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface CategoryFormHandlers {
  onClose: () => void;
  onSaved: () => void;
}

export function mountCategoryForm(
  root: HTMLElement,
  api: CategoryFormApi,
  original: CategoryFormDraft,
  activeSiblings: { id: Uuid; name: string }[],
  usedSlots: Set<number>,
  handlers: CategoryFormHandlers,
): void {
  if (typeof document === "undefined") {
    return;
  }

  const controller = createCategoryFormController(api, original);
  let nameInteracted = false;
  let submitError: string | null = null;

  const render = (): void => {
    root.innerHTML = renderCategoryForm({
      draft: controller.getDraft(),
      activeSiblings,
      usedSlots,
      nameInteracted,
      submitError,
    });
    wire();
    applyCategoryFormChrome(controller.getDraft(), original);
  };

  function wire(): void {
    const input = root.querySelector<HTMLInputElement>('[data-testid="cat-name-input"]');
    input?.addEventListener("input", () => {
      controller.setName(input.value);
      applyCategoryFormChrome(controller.getDraft(), original);
      // Live-update the message once the field has already been interacted
      // with, without a full re-render (which would steal focus).
      if (nameInteracted) {
        rerenderMessage();
      }
    });
    input?.addEventListener("blur", () => {
      if (!nameInteracted) {
        nameInteracted = true;
        rerenderMessage();
      }
    });

    root.querySelectorAll<HTMLElement>('[data-testid="cat-swatch"]').forEach((el) => {
      el.addEventListener("click", () => {
        const slot = Number(el.getAttribute("data-slot"));
        controller.setColorSlot(slot);
        render();
      });
    });

    // Arrow-key navigation within the 12-swatch grid, wrapping by row — same
    // `nextGridFocusIndex` primitive 06a's grid uses (GRID_COLUMNS applies
    // here too: both grids are 4 columns).
    const swatchGrid = root.querySelector<HTMLElement>('[data-testid="cat-swatch-grid"]');
    const swatches = swatchGrid ? Array.from(swatchGrid.querySelectorAll<HTMLElement>(".cat-swatch-cell")) : [];
    swatchGrid?.addEventListener("keydown", (e) => {
      const from = swatches.indexOf(document.activeElement as HTMLElement);
      if (from === -1) {
        return;
      }
      const nextIndex = nextGridFocusIndex(swatches.length, from, e.key);
      if (nextIndex === from) {
        return;
      }
      e.preventDefault();
      swatches[nextIndex]?.focus();
    });
  }

  function rerenderMessage(): void {
    const draft = controller.getDraft();
    const error = categoryNameError(draft.name);
    const warning = error ? null : categoryDuplicateWarning(draft.name, draft.id, activeSiblings);
    const message = error ?? warning;
    const el = root.querySelector<HTMLElement>('[data-testid="cat-form-message"]');
    if (!el) {
      return;
    }
    el.textContent = message ?? "";
    el.className = `cat-form-message${message ? ` cat-form-message--${error ? "error" : "warning"}` : ""}`;
  }

  wireCategoryFormBackButton(controller.getDraft, original, handlers.onClose);

  mainButton.onClick(() => {
    void (async () => {
      const outcome = await controller.submit();
      if (outcome.status === "success") {
        haptics.notification("success");
        handlers.onSaved();
      } else if (outcome.status === "error") {
        submitError = outcome.message;
        render();
      } else if (outcome.status === "blocked" && outcome.reason === "invalid") {
        nameInteracted = true;
        rerenderMessage();
      }
      // "submitting" is the double-submit guard itself firing — the request
      // is already in flight; no UI change needed.
    })();
  });

  render();
  root.querySelector<HTMLInputElement>('[data-testid="cat-name-input"]')?.focus();
}
