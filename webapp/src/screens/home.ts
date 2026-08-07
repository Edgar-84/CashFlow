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
  MAX_RANGE_DAYS,
  toQuery,
  type PeriodQuery,
  type PeriodUnit,
  type PeriodValue,
} from "../lib/period";
import { haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import {
  mount as mountDateRangePicker,
  type DateRangePickerValue,
} from "../components/date-range-picker";
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

// docs/ui/screens/01-home.md's Copy table: `mb.add` and `add.aria` are both
// this string — MainButton's label and the yellow Add button's accessible
// name must never drift apart, since both fire the same handler (D318).
const ADD_EXPENSE_LABEL = "Add expense";

// U1.6/design-system.md: stroke thickened 26 -> 30px, radius trimmed to keep
// the outer edge (radius + strokeWidth/2) unchanged at 89 of the 200-unit
// viewBox — the ring gets thicker inward, the donut's outer diameter doesn't.
const DONUT_RADIUS = 74;
const DONUT_STROKE = 30;
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

export interface HomeRankedRow {
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
  rows: HomeRankedRow[];
  overBudget: HomeOverBudgetRow[];
  tiles: readonly HomeTile[];
  period: PeriodValue;
}

export type HomeState =
  | { status: "loading"; period: PeriodValue }
  | { status: "error"; message: string; period: PeriodValue }
  | { status: "forbidden"; tiles: readonly HomeTile[] }
  | { status: "empty"; tiles: readonly HomeTile[]; period: PeriodValue; currency: Currency }
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
  const colorBySlot = new Map(assignCategoryColors(input.categories).map((c) => [c.id, c.slot]));
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

  // docs/ui/screens/01-home.md: "all categories with a non-zero total,
  // ranked descending" — every one of them, not a top-N legend (the old
  // <=1-row suppression is gone too; a single category still renders its
  // one row).
  const rows: HomeRankedRow[] = [...input.categoryTotals]
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total)
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
    rows,
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
      ? { status: "empty", tiles: data.tiles, period, currency: data.currency }
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

/** The date-range picker's initial draft when opened from Home — the
 * previously applied custom range if one is in force ("Reopened" in the
 * component doc's States table), otherwise empty ("Choose a start date").
 * Pure so `mount`'s DOM-only picker wiring stays the file's one untested
 * seam, same as every other screen. */
export function pickerValueForPeriod(period: PeriodValue): DateRangePickerValue {
  return period.unit === "custom" ? { start: period.start, end: period.end } : {};
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
  mainButton.show(ADD_EXPENSE_LABEL);
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

// docs/ui/screens/01-home.md region 2d + D318: the in-card yellow Add
// button, `--accent`'s one declared use in the app. Absent from the
// loading skeleton and the read-only (403) markup entirely — those two
// states are exactly where `applyHomeChrome` also hides MainButton, so the
// two Add affordances stay in lockstep without extra wiring here. The `+`
// is design-system.md's Iconography table entry for this icon verbatim:
// inline SVG, 24px box, two 2.5px `currentColor` strokes (not text) —
// `currentColor` resolves to `.add-btn`'s own `color: var(--accent-ink)`.
// `aria-hidden` + `focusable="false"` since the button's own `aria-label`
// already carries the accessible name.
function renderAddButton(): string {
  return `<button type="button" class="add-btn" data-testid="add-button" aria-label="${escapeHtml(ADD_EXPENSE_LABEL)}"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg></button>`;
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
    <div class="ranked-rows-skeleton"><div class="card"></div><div class="card"></div><div class="card"></div></div>
    ${renderTiles(HOME_TILES)}
  </div>`;
}

function renderError(message: string, period: PeriodValue, now: Date): string {
  return `<div class="home-error" data-testid="error">
    <div class="card chart-card">
      ${renderPeriodControl(period, now, false)}
      <p>${escapeHtml(message)}</p>
      <button type="button" data-action="retry">Try again</button>
      ${renderAddButton()}
    </div>
  </div>`;
}

// docs/ui/screens/01-home.md's Copy table (D405): one sentence per unit,
// deictic rather than period-named ("this day", not "August 3") — the empty
// ring sits directly under a label that already names the period, so naming
// it twice 100px apart is noise. Supersedes the eight offset-branching V3
// strings ("Nothing today"/"Nothing in August"/...).
const EMPTY_COPY: Record<PeriodUnit, string> = {
  day: "There were no expenses on this day.",
  week: "There were no expenses in this week.",
  month: "There were no expenses in this month.",
  year: "There were no expenses in this year.",
  custom: "There were no expenses in this period.",
};

function describeEmptyPeriod(period: PeriodValue): string {
  return EMPTY_COPY[period.unit];
}

// docs/ui/screens/01-home.md's Empty state (D405): the same 200px box and
// 30px stroke as a populated donut (renderDonut) so switching into an empty
// period moves nothing below it — one unbroken `--separator` arc (no
// stroke-dasharray, so no segment gaps) and the formatted zero total in
// `--ink-secondary` rather than `--ink`.
function renderEmptyDonut(currency: Currency): string {
  return `<div class="donut-wrap">
    <svg class="donut" viewBox="0 0 200 200" role="img" data-testid="donut">
      <circle cx="100" cy="100" r="${DONUT_RADIUS}" stroke="var(--separator)" stroke-width="${DONUT_STROKE}" fill="none" />
    </svg>
    <div class="donut-c">
      <div class="amt amt-zero">${escapeHtml(formatAmount(0))} ${escapeHtml(currency)}</div>
    </div>
  </div>`;
}

function renderEmpty(tiles: readonly HomeTile[], period: PeriodValue, currency: Currency, now: Date): string {
  return `<div class="home-empty" data-testid="empty">
    <div class="card chart-card">
      ${renderPeriodControl(period, now, false)}
      ${renderEmptyDonut(currency)}
      <p class="empty-copy">${escapeHtml(describeEmptyPeriod(period))}</p>
      ${renderAddButton()}
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
        `stroke="${seg.colorVar}" stroke-width="${DONUT_STROKE}" fill="none" ` +
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

// docs/ui/screens/01-home.md region 4: every non-zero category, ranked
// descending, one card each — the old top-3/suppress-at-<=1 "legend" rule is
// gone (Single category state: "the ranked rows are the data now, not a
// legend"). Column order is swatch · name · share% · amount, matching the
// reference ("Дом 58% zł2,948").
function renderRankedRows(rows: HomeRankedRow[]): string {
  if (rows.length === 0) {
    return "";
  }
  const items = rows
    .map(
      (row) =>
        `<div class="card row" data-testid="ranked-row" data-category-id="${row.categoryId}" ` +
        `role="button" tabindex="0" aria-label="${escapeHtml(row.label)}, ${Math.round(row.sharePct)}%, ${escapeHtml(formatAmount(row.minor))}">` +
        `<span class="swatch" style="background:${row.colorVar}"></span>` +
        `<span class="nm">${escapeHtml(row.label)}</span>` +
        `<span class="pct">${Math.round(row.sharePct)}%</span>` +
        `<span class="val">${escapeHtml(formatAmount(row.minor))}</span>` +
        `</div>`,
    )
    .join("");
  return `<div class="ranked-rows" data-testid="ranked-rows">${items}</div>`;
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
      ${renderAddButton()}
    </div>
    ${renderOverBudgetStrip(data.overBudget, data.currency)}
    ${renderRankedRows(data.rows)}
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
      return renderEmpty(state.tiles, state.period, state.currency, now);
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
  onApplyCustomRange: (range: { start: string; end: string }) => void; // date-range picker's Apply — host sets the period and refetches; Cancel/BackButton close the picker without calling this
  onAddExpense: () => void; // yellow Add button — same target as MainButton (D318)
}

// Mirrors lib/period.ts's private toDateString — that module's own header
// comment already establishes the convention (each pure module owns its own
// rather than sharing), which components/date-range-picker.ts also follows.
// Only needed here for the picker's `maxDate`: `now` (already device-local,
// D327) turned into a plain calendar-date string.
function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The picker overlays Home as a plain child of `root`, not a separate DOM
// root — `.drp-root` is `position: fixed`, so nesting doesn't affect its
// layout, and it means any later `mount()` call that replaces
// `root.innerHTML` (a screen navigation via MainButton while the picker is
// open, e.g.) tears the picker down for free, with no explicit lifecycle to
// get wrong.
function openPicker(
  root: HTMLElement,
  period: PeriodValue,
  now: Date,
  onApply: (range: { start: string; end: string }) => void,
): void {
  const pickerRoot = document.createElement("div");
  root.appendChild(pickerRoot);

  // BackButton closes the picker, not the screen (this unit's AC) — Home's
  // BackButton is otherwise always null (applyHomeChrome, root screen), so
  // restoring to null on close is exactly Home's normal state, not a
  // saved-and-restored previous handler.
  const close = (): void => {
    pickerRoot.remove();
    setBackButtonHandler(null);
  };
  setBackButtonHandler(close);

  const renderPicker = (value: DateRangePickerValue): void => {
    mountDateRangePicker(pickerRoot, {
      mode: "range",
      value,
      maxDate: toDateString(now),
      maxRangeDays: MAX_RANGE_DAYS,
      onChange: renderPicker,
      onApply: (range) => {
        close();
        onApply(range);
      },
      onCancel: close,
    });
  };
  renderPicker(pickerValueForPeriod(period));
}

export function mount(root: HTMLElement, state: HomeState, handlers: HomeHandlers, now: Date): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderHome(state, now);

  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);

  // docs/ui/screens/01-home.md's Telegram section: "impact('medium') on the
  // yellow Add button — the heaviest action on the screen", distinct from
  // every other tap here, which is `selection`.
  root.querySelector('[data-testid="add-button"]')?.addEventListener("click", () => {
    haptics.impact("medium");
    handlers.onAddExpense();
  });

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

    // Ranked row tap "same target as its donut segment" (docs/ui/screens/01-home.md)
    // — every row carries a real categoryId (the rows never fold), unlike the
    // donut's nullable "Other" slot. `role="button"`/`tabindex="0"` (render
    // side) need a manual Enter/Space handler — unlike a native <button>,
    // a div doesn't activate on keydown by itself (design-system.md's
    // Accessibility rule: visible focus + reachability on every interactive
    // element; the Focus order in docs/ui/screens/01-home.md lists rows).
    root.querySelectorAll<HTMLElement>('[data-testid="ranked-row"]').forEach((el, index) => {
      const activate = () => {
        const row = state.rows[index];
        if (row) {
          haptics.selection();
          handlers.onSegmentTap({ categoryId: row.categoryId, label: row.label });
        }
      };
      el.addEventListener("click", activate);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
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
        onOpenPicker: () => openPicker(root, state.period, now, handlers.onApplyCustomRange),
      });
    }
  }
}
