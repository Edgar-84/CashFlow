/** Screen 01 — Home (docs/design/mini-app-ux.md §4). The donut answers
 * "where did it go?" before a number is read; six tiles are the whole app.
 *
 * Split in three layers, each independently testable:
 *  - data: `loadHome`/`buildHomeData` — orchestrates the ApiClient calls and
 *    turns their responses into a `HomeState`. Pure aside from the awaited
 *    network calls.
 *  - interaction: `segmentTapTarget`, `applyHomeChrome` — pure functions
 *    screens/tests can call directly, no DOM involved.
 *  - presentation: `renderHome` (pure, returns an HTML string) and `mount`
 *    (the thin DOM-writing glue, the one part with no meaningful unit test —
 *    same accepted gap as `lib/telegram.ts::applyTheme`, guarded by a
 *    `typeof document` check).
 */

import { assignCategoryColors, categorySlotCssVar, OTHER_COLOR_VAR } from "../lib/category-colors";
import { segments as donutSegments } from "../lib/donut";
import { formatAmount } from "../lib/money";
import {
  describe as describePeriod,
  toQuery,
  type PeriodQuery,
  type PeriodUnit,
  type PeriodValue,
} from "../lib/period";
import { haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { mount as mountPeriodSelector, renderPeriodSelector } from "../components/period-selector";
import { ForbiddenError } from "../api/client";
import type {
  BudgetPlanResponse,
  BudgetProgress,
  CategoryResponse,
  CategoryTotal,
  Currency,
  PeriodTotal,
  Uuid,
} from "../api/types";

const DONUT_RADIUS = 76;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
// Mirrors lib/donut.ts's own DEFAULT_MAX_SLOTS (not exported there) — passed
// explicitly to segments() below so this module's fold-boundary math can't
// silently drift from the geometry module's.
const MAX_DONUT_SLOTS = 6;

export interface HomeTile {
  id: "add-expense" | "expenses" | "budgets" | "statistics" | "categories" | "tags";
  label: string;
}

export const HOME_TILES: readonly HomeTile[] = [
  { id: "add-expense", label: "Add expense" },
  { id: "expenses", label: "Expenses" },
  { id: "budgets", label: "Budgets" },
  { id: "statistics", label: "Statistics" },
  { id: "categories", label: "Categories" },
  { id: "tags", label: "Tags" },
];

export interface HomeSegment {
  categoryId: Uuid | null;
  label: string;
  colorVar: string;
  dash: number;
  gap: number;
  offset: number;
}

export interface HomeLegendRow {
  categoryId: Uuid;
  label: string;
  colorVar: string;
  minor: number;
  sharePct: number;
}

export interface HomeOverBudgetRow {
  categoryId: Uuid;
  label: string;
  overMinor: number;
}

export interface HomeData {
  totalMinor: number;
  currency: Currency;
  segments: HomeSegment[];
  legend: HomeLegendRow[];
  overBudget: HomeOverBudgetRow[];
  tiles: readonly HomeTile[];
  period: PeriodValue;
}

export type HomeState =
  | { status: "loading"; period: PeriodValue }
  | { status: "error"; message: string; period: PeriodValue }
  | { status: "forbidden"; tiles: readonly HomeTile[] }
  | { status: "empty"; tiles: readonly HomeTile[]; period: PeriodValue }
  | ({ status: "ready" } & HomeData)
  | ({ status: "offline"; lastSyncedAt: string } & HomeData);

// -- data ------------------------------------------------------------------

export function buildHomeData(input: {
  categories: CategoryResponse[];
  categoryTotals: CategoryTotal[];
  periodTotal: PeriodTotal;
  currency: Currency;
  budgetProgress: BudgetProgress[];
  period: PeriodValue;
}): HomeData {
  const orderedCategories = [...input.categories].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const colorBySlot = new Map(
    assignCategoryColors(orderedCategories).map((c) => [c.id, c.slot]),
  );
  const totalsById = new Map(input.categoryTotals.map((t) => [t.category_id, t.total]));
  const nameById = new Map(input.categories.map((c) => [c.id, c.name]));

  const donutInput = orderedCategories.map((c) => ({
    id: c.id,
    label: c.name,
    minor: totalsById.get(c.id) ?? 0,
  }));
  const rawSegments = donutSegments(donutInput, {
    circumference: DONUT_CIRCUMFERENCE,
    maxSlots: MAX_DONUT_SLOTS,
  });
  // donutSegments() folds anything past maxSlots into one trailing "Other"
  // row (lib/donut.ts) — only the first `realCount` output slots map 1:1
  // onto `orderedCategories`; a folded run has one extra slot with no
  // single category behind it.
  const realCount = Math.min(orderedCategories.length, MAX_DONUT_SLOTS);
  const segments: HomeSegment[] = rawSegments.map((seg, index) => {
    const category = index < realCount ? orderedCategories[index] : undefined;
    const slot = category ? (colorBySlot.get(category.id) ?? null) : null;
    return {
      categoryId: category ? category.id : null,
      label: category ? category.name : "Other",
      colorVar: category ? categorySlotCssVar(slot) : OTHER_COLOR_VAR,
      dash: seg.dash,
      gap: seg.gap,
      offset: seg.offset,
    };
  });

  const legend: HomeLegendRow[] = [...input.categoryTotals]
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
    .map((t) => {
      const slot = colorBySlot.get(t.category_id) ?? null;
      return {
        categoryId: t.category_id,
        label: nameById.get(t.category_id) ?? "Unknown",
        colorVar: slot !== null ? categorySlotCssVar(slot) : OTHER_COLOR_VAR,
        minor: t.total,
        sharePct: input.periodTotal.total > 0 ? (t.total / input.periodTotal.total) * 100 : 0,
      };
    });

  // D310, extended by docs/ui/screens/01-home.md: the strip states a monthly
  // fact, so it is shown only when the screen's own period is that same
  // span — Month at offset 0. Budget progress is always month-scoped, so
  // it's still fetched regardless of the tab in force; only its visibility
  // is gated here.
  const isMonthToDate = input.period.unit === "month" && input.period.offset === 0;
  const overBudget: HomeOverBudgetRow[] = isMonthToDate
    ? input.budgetProgress
        .filter((p) => p.is_exceeded)
        .map((p) => ({
          categoryId: p.category_id,
          label: nameById.get(p.category_id) ?? "Unknown",
          overMinor: p.spent - p.amount,
        }))
    : [];

  return {
    totalMinor: input.periodTotal.total,
    currency: input.currency,
    segments,
    legend,
    overBudget,
    tiles: HOME_TILES,
    period: input.period,
  };
}

export interface HomeApi {
  getMe(): Promise<{ currency: Currency }>;
  listCategories(): Promise<CategoryResponse[]>;
  statisticsByCategory(query: PeriodQuery): Promise<CategoryTotal[]>;
  statisticsByPeriod(query: PeriodQuery): Promise<PeriodTotal>;
  listBudgetPlans(): Promise<BudgetPlanResponse[]>;
  getBudgetPlanProgress(id: Uuid): Promise<BudgetProgress>;
}

export interface HomeSnapshot {
  data: HomeData;
  syncedAt: string;
}

export interface HomeCache {
  get(): HomeSnapshot | null;
  set(snapshot: HomeSnapshot): void;
}

export function createMemoryCache(): HomeCache {
  let snapshot: HomeSnapshot | null = null;
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
    },
  };
}

/** Loads and shapes Home's data for the given period. Never throws — every
 * failure resolves to a `HomeState` the caller can render directly. */
export async function loadHome(api: HomeApi, cache: HomeCache, period: PeriodValue): Promise<HomeState> {
  try {
    const query = toQuery(period);
    const [me, categories, categoryTotals, periodTotal, budgetPlans] = await Promise.all([
      api.getMe(),
      api.listCategories(),
      api.statisticsByCategory(query),
      api.statisticsByPeriod(query),
      api.listBudgetPlans(),
    ]);
    const budgetProgress = await Promise.all(
      budgetPlans.map((plan) => api.getBudgetPlanProgress(plan.id)),
    );
    const data = buildHomeData({
      categories,
      categoryTotals,
      periodTotal,
      currency: me.currency,
      budgetProgress,
      period,
    });
    cache.set({ data, syncedAt: new Date().toISOString() });
    return periodTotal.total === 0
      ? { status: "empty", tiles: data.tiles, period }
      : { status: "ready", ...data };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { status: "forbidden", tiles: HOME_TILES };
    }
    const cached = cache.get();
    if (cached) {
      // Offline freezes the control at the cached period, not the one just
      // requested — `cached.data.period` is whatever last loaded
      // successfully (component doc's Disabled state).
      return { status: "offline", lastSyncedAt: cached.syncedAt, ...cached.data };
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { status: "error", message, period };
  }
}

export interface HomeController {
  /** Resolves `null` when a newer `load` has started since this call — the
   * caller must discard it rather than render (AC: a stale in-flight
   * response is discarded, last tap wins). Ordered by call, not by
   * resolution, so an out-of-order response can never win. */
  load(period: PeriodValue): Promise<HomeState | null>;
}

export function createHomeController(api: HomeApi, cache: HomeCache): HomeController {
  let requestId = 0;
  return {
    async load(period) {
      const id = ++requestId;
      const state = await loadHome(api, cache, period);
      return id === requestId ? state : null;
    },
  };
}

// -- interaction -------------------------------------------------------------

/** Pure resolution of "which category did the tap on donut slot `index`
 * mean" — the actual navigation (once a filtered expense list exists, U2.3)
 * is the caller's job. `null` categoryId means the folded "Other" slot. */
export function segmentTapTarget(
  data: Pick<HomeData, "segments">,
  index: number,
): { categoryId: Uuid | null; label: string } | null {
  const segment = data.segments[index];
  return segment ? { categoryId: segment.categoryId, label: segment.label } : null;
}

/** Telegram chrome for Home: MainButton = Add expense (hidden while loading
 * or for a read-only/forbidden viewer — root CLAUDE.md's PermissionChecker
 * denies the write, so the button must not promise one); BackButton hidden,
 * this is the root screen. `onAddExpense` wires the MainButton tap to
 * navigation (U2.2) — optional so callers/tests that don't care about
 * navigation can omit it without wiring a handler. */
export function applyHomeChrome(state: HomeState, onAddExpense?: () => void): void {
  setBackButtonHandler(null);
  if (state.status === "loading" || state.status === "forbidden") {
    mainButton.hide();
    return;
  }
  mainButton.show("Add expense");
  mainButton.setEnabled(true);
  if (onAddExpense) {
    mainButton.onClick(onAddExpense);
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

function renderTiles(tiles: readonly HomeTile[], opts: { readOnly: boolean } = { readOnly: false }): string {
  const items = tiles
    .map((tile) => {
      const disabled = opts.readOnly && tile.id === "add-expense";
      return `<button type="button" class="tile" data-tile="${tile.id}"${disabled ? " disabled" : ""}>${escapeHtml(tile.label)}</button>`;
    })
    .join("");
  return `<div class="tiles" data-testid="tiles">${items}</div>`;
}

// No-op stand-ins for the callbacks `PeriodSelectorProps` requires — the pure
// render never invokes them, only `mount` (below) wires the real handlers.
// `PeriodUnit`/`number`/`void` params are all assignable from a bare `() =>
// {}` (extra caller-side args are simply unused), so one stub covers all
// three.
const noop = () => {};

function renderPeriodControl(period: PeriodValue, now: Date, disabled: boolean): string {
  return `<div class="period-selector-slot">${renderPeriodSelector({
    value: period,
    now,
    disabled,
    onUnitChange: noop,
    onOffsetChange: noop,
    onOpenPicker: noop,
  })}</div>`;
}

function renderSkeleton(period: PeriodValue, now: Date): string {
  return `<div class="home-skeleton" data-testid="loading">
    <div class="card chart-card">
      ${renderPeriodControl(period, now, false)}
      <div class="donut-skeleton"></div>
    </div>
    <div class="legend-skeleton"></div>
    ${renderTiles(HOME_TILES)}
  </div>`;
}

function renderError(message: string, period: PeriodValue, now: Date): string {
  return `<div class="home-error" data-testid="error">
    <div class="card chart-card">
      ${renderPeriodControl(period, now, false)}
      <p>${escapeHtml(message)}</p>
      <button type="button" data-action="retry">Try again</button>
    </div>
  </div>`;
}

// docs/ui/screens/01-home.md's Copy table — the empty state names the period
// in force ("Nothing today"/"Nothing in August"), never a generic "no data".
// Reuses `lib/period.ts::describe`'s already-tested label for every case that
// isn't one of the two most-common, explicitly-worded day offsets.
function describeEmptyPeriod(period: PeriodValue, now: Date): string {
  if (period.unit === "day" && period.offset === 0) {
    return "Nothing today";
  }
  if (period.unit === "day" && period.offset === -1) {
    return "Nothing yesterday";
  }
  if (period.unit === "week" && period.offset === 0) {
    return "Nothing this week";
  }
  if (period.unit === "week") {
    return "Nothing that week";
  }
  const label = describePeriod(period, now);
  switch (period.unit) {
    case "day":
      return `Nothing on ${label}`;
    case "month":
    case "year":
      return `Nothing in ${label}`;
    case "custom":
      return `Nothing from ${label}`;
  }
}

function renderEmpty(tiles: readonly HomeTile[], period: PeriodValue, now: Date): string {
  return `<div class="home-empty" data-testid="empty">
    <div class="card chart-card">
      ${renderPeriodControl(period, now, false)}
      <p>${escapeHtml(describeEmptyPeriod(period, now))}</p>
    </div>
    ${renderTiles(tiles)}
  </div>`;
}

function renderReadOnly(tiles: readonly HomeTile[]): string {
  return `<div class="home-readonly" data-testid="forbidden">
    <p>You have read-only access to this account.</p>
    ${renderTiles(tiles, { readOnly: true })}
  </div>`;
}

function renderDonut(data: HomeData): string {
  const arcs = data.segments
    .map(
      (seg) =>
        `<circle data-category-id="${seg.categoryId ?? "other"}" cx="100" cy="100" r="${DONUT_RADIUS}" ` +
        `stroke="${seg.colorVar}" stroke-width="26" fill="none" ` +
        `stroke-dasharray="${seg.dash} ${DONUT_CIRCUMFERENCE - seg.dash}" stroke-dashoffset="${-seg.offset}" />`,
    )
    .join("");
  return `<div class="donut-wrap">
    <svg class="donut" viewBox="0 0 200 200" role="img" data-testid="donut">
      <g transform="rotate(-90 100 100)">${arcs}</g>
    </svg>
    <div class="donut-c">
      <div class="amt">${escapeHtml(formatAmount(data.totalMinor))} ${escapeHtml(data.currency)}</div>
    </div>
  </div>`;
}

function renderLegend(legend: HomeLegendRow[]): string {
  // Design doc §4: "single category (donut renders, no legend needed)".
  if (legend.length <= 1) {
    return "";
  }
  const rows = legend
    .map(
      (row) =>
        `<div class="row"><span class="dot" style="background:${row.colorVar}"></span>` +
        `<span class="nm">${escapeHtml(row.label)}</span>` +
        `<span class="val">${escapeHtml(formatAmount(row.minor))}</span>` +
        `<span class="pct">${Math.round(row.sharePct)}%</span></div>`,
    )
    .join("");
  return `<div class="card" data-testid="legend">${rows}</div>`;
}

function renderOverBudgetStrip(overBudget: HomeOverBudgetRow[], currency: Currency): string {
  if (overBudget.length === 0) {
    return "";
  }
  const first = overBudget[0];
  return `<div class="strip" data-testid="over-budget">
    <b>${escapeHtml(first.label)}</b> is over budget by ${escapeHtml(formatAmount(first.overMinor))} ${escapeHtml(currency)}
  </div>`;
}

function renderOfflineBanner(lastSyncedAt: string | undefined): string {
  if (!lastSyncedAt) {
    return "";
  }
  return `<div class="offline-banner" data-testid="offline">Offline — showing data from ${escapeHtml(lastSyncedAt)}</div>`;
}

function renderReady(data: HomeData, lastSyncedAt: string | undefined, now: Date, disabled: boolean): string {
  return `<div class="home-ready" data-testid="ready">
    ${renderOfflineBanner(lastSyncedAt)}
    <div class="card chart-card">
      ${renderPeriodControl(data.period, now, disabled)}
      ${renderDonut(data)}
    </div>
    ${renderLegend(data.legend)}
    ${renderOverBudgetStrip(data.overBudget, data.currency)}
    ${renderTiles(data.tiles)}
  </div>`;
}

export function renderHome(state: HomeState, now: Date): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton(state.period, now);
    case "error":
      return renderError(state.message, state.period, now);
    case "forbidden":
      return renderReadOnly(state.tiles);
    case "empty":
      return renderEmpty(state.tiles, state.period, now);
    case "ready":
      return renderReady(state, undefined, now, false);
    case "offline":
      // Offline freezes the control at the cached period (webapp/CLAUDE.md's
      // offline state + the component doc's Disabled variant) — `disabled`
      // here both dims the control and short-circuits its taps.
      return renderReady(state, state.lastSyncedAt, now, true);
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as lib/telegram.ts::applyTheme) --------------------------

export interface HomeHandlers {
  onRetry: () => void;
  onTileTap: (tile: HomeTile["id"]) => void;
  onSegmentTap: (target: { categoryId: Uuid | null; label: string }) => void;
  onUnitChange: (unit: PeriodUnit) => void; // host resets offset to 0
  onOffsetChange: (offset: number) => void; // host clamps at 0
  onOpenPicker: () => void; // "Period" tab / label tap — U1.8 wires the picker
}

export function mount(root: HTMLElement, state: HomeState, handlers: HomeHandlers, now: Date): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderHome(state, now);

  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);

  root.querySelectorAll<HTMLElement>("[data-tile]").forEach((el) => {
    el.addEventListener("click", () => {
      haptics.selection();
      handlers.onTileTap(el.dataset.tile as HomeTile["id"]);
    });
  });

  if (state.status === "ready" || state.status === "offline") {
    root.querySelectorAll<SVGCircleElement>("circle[data-category-id]").forEach((el, index) => {
      el.addEventListener("click", () => {
        const target = segmentTapTarget(state, index);
        if (target) {
          haptics.selection();
          handlers.onSegmentTap(target);
        }
      });
    });
  }

  if (state.status !== "forbidden") {
    const slot = root.querySelector<HTMLElement>(".period-selector-slot");
    if (slot) {
      mountPeriodSelector(slot, {
        value: state.period,
        now,
        disabled: state.status === "offline",
        onUnitChange: handlers.onUnitChange,
        onOffsetChange: handlers.onOffsetChange,
        onOpenPicker: handlers.onOpenPicker,
      });
    }
  }
}
