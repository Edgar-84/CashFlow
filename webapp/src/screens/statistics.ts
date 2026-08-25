/** Screen 05 — Statistics (docs/design/mini-app-ux.md §4). "Home's donut plus
 * ranked bars underneath, so switching screens never re-teaches the picture."
 * The ranked-bar list *is* this screen's legend (a fuller one than Home's
 * top-three) — there is no separate legend component.
 *
 * Layers, same split as every other screen:
 *  - data: `loadStatistics`/`buildStatisticsData` — fetches `GET /users/me`,
 *    `/categories`, `/tags`, `/statistics/by-period|by-category|by-tag` for
 *    one `PeriodValue` (V7, D704 — replaces the old `months_back` presets)
 *    and turns them into a `StatisticsState`. Never throws, same
 *    never-throws/cache-fallback contract as every other screen's loader.
 *    Both groupings' bars are computed in the same call, so the grouping
 *    toggle never needs a second fetch.
 *  - presentation: `renderStatistics`/`renderReady` (pure, HTML strings) and
 *    `mount` (thin DOM glue, the one part with no meaningful unit test — same
 *    accepted gap as every other screen's `mount`). `mount` re-renders on a
 *    grouping-toggle tap by swapping `state.grouping` and calling `render()`
 *    again directly — no handler call, no API call (AC: "grouping toggle
 *    re-renders without refetching the period").
 *
 * The donut always reflects the category breakdown (same server-authoritative
 * `color_slot` colours as Home, D301/U2.0) regardless of grouping — tags have
 * no colour column, so a "by tag" donut has no fixed palette to draw from.
 * Only the ranked-bar list below switches between `categoryBars`/`tagBars`.
 *
 * Bar width is relative to the leader (the top row), not to the period
 * total — "bars sorted descending with the leader at full width" (AC) is a
 * ranked-bar chart, not a share-of-total chart like the donut.
 *
 * Bar tap drill-down (design doc §5's `S -->|bar tap| EF`) is wired only for
 * category bars — `GET /expenses` has no tag filter (Contracts, U2.3's own
 * scope note), so a tag bar tap is tappable-but-no-op, same "no target
 * screen/contract yet" precedent U2.1 set for its own tiles.
 */

import { assignCategoryColors, categorySlotCssVar, OTHER_COLOR_VAR } from "../lib/category-colors";
import { mount as mountDateRangePicker, type DateRangePickerValue } from "../components/date-range-picker";
import { mount as mountPeriodSelector, renderPeriodSelector } from "../components/period-selector";
import { segments as donutSegments } from "../lib/donut";
import { formatAmount } from "../lib/money";
import { MAX_RANGE_DAYS, toQuery, type PeriodQuery, type PeriodUnit, type PeriodValue } from "../lib/period";
import { haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ForbiddenError } from "../api/client";
import type {
  CategoryResponse,
  CategoryTotal,
  Currency,
  PeriodTotal,
  TagResponse,
  TagTotal,
  Uuid,
} from "../api/types";

const DONUT_RADIUS = 76;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
// Mirrors home.ts's own MAX_DONUT_SLOTS (not shared — each screen passes it
// explicitly to lib/donut.ts's segments() so the fold-boundary math can't
// silently drift between screens).
const MAX_DONUT_SLOTS = 6;

export type Grouping = "category" | "tag";

export interface StatisticsSegment {
  categoryId: Uuid | null;
  label: string;
  colorVar: string;
  dash: number;
  gap: number;
  offset: number;
}

export interface StatisticsBar {
  id: Uuid;
  label: string;
  /** `null` for tag rows — no fixed-slot colour contract exists for tags. */
  colorVar: string | null;
  minor: number;
  /** Relative to the leader (100 for the top row), not the period total. */
  widthPct: number;
}

export interface StatisticsData {
  totalMinor: number;
  currency: Currency;
  period: PeriodValue;
  grouping: Grouping;
  segments: StatisticsSegment[];
  categoryBars: StatisticsBar[];
  tagBars: StatisticsBar[];
}

function rankedBars(rows: { id: Uuid; label: string; colorVar: string | null; minor: number }[]): StatisticsBar[] {
  const positive = rows.filter((r) => r.minor > 0).sort((a, b) => b.minor - a.minor);
  const leader = positive[0]?.minor ?? 0;
  return positive.map((r) => ({
    ...r,
    widthPct: leader > 0 ? (r.minor / leader) * 100 : 0,
  }));
}

export function buildStatisticsData(input: {
  categories: CategoryResponse[];
  tags: TagResponse[];
  categoryTotals: CategoryTotal[];
  tagTotals: TagTotal[];
  periodTotal: PeriodTotal;
  currency: Currency;
  period: PeriodValue;
  grouping: Grouping;
}): StatisticsData {
  const orderedCategories = [...input.categories].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const colorBySlot = new Map(assignCategoryColors(input.categories).map((c) => [c.id, c.slot]));
  const catTotalById = new Map(input.categoryTotals.map((t) => [t.category_id, t.total]));
  const catNameById = new Map(input.categories.map((c) => [c.id, c.name]));
  const tagNameById = new Map(input.tags.map((t) => [t.id, t.name]));

  const donutInput = orderedCategories.map((c) => ({ id: c.id, label: c.name, minor: catTotalById.get(c.id) ?? 0 }));
  const rawSegments = donutSegments(donutInput, { circumference: DONUT_CIRCUMFERENCE, maxSlots: MAX_DONUT_SLOTS });
  // Only the first `realCount` slots map 1:1 onto orderedCategories — a
  // folded run has one extra trailing "Other" slot (lib/donut.ts), same
  // shape home.ts::buildHomeData already handles.
  const realCount = Math.min(orderedCategories.length, MAX_DONUT_SLOTS);
  const segments: StatisticsSegment[] = rawSegments.map((seg, index) => {
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

  const categoryBars = rankedBars(
    input.categoryTotals.map((t) => {
      const slot = colorBySlot.get(t.category_id) ?? null;
      return {
        id: t.category_id,
        label: catNameById.get(t.category_id) ?? "Unknown category",
        colorVar: slot !== null ? categorySlotCssVar(slot) : OTHER_COLOR_VAR,
        minor: t.total,
      };
    }),
  );
  const tagBars = rankedBars(
    input.tagTotals.map((t) => ({
      id: t.tag_id,
      label: tagNameById.get(t.tag_id) ?? "Unknown tag",
      colorVar: null,
      minor: t.total,
    })),
  );

  return {
    totalMinor: input.periodTotal.total,
    currency: input.currency,
    period: input.period,
    grouping: input.grouping,
    segments,
    categoryBars,
    tagBars,
  };
}

export interface StatisticsApi {
  getMe(): Promise<{ currency: Currency }>;
  listCategories(): Promise<CategoryResponse[]>;
  listTags(): Promise<TagResponse[]>;
  statisticsByPeriod(query: PeriodQuery): Promise<PeriodTotal>;
  statisticsByCategory(query: PeriodQuery): Promise<CategoryTotal[]>;
  statisticsByTag(query: PeriodQuery): Promise<TagTotal[]>;
}

export interface StatisticsSnapshot {
  data: StatisticsData;
  syncedAt: string;
}

export interface StatisticsCache {
  get(): StatisticsSnapshot | null;
  set(snapshot: StatisticsSnapshot): void;
}

export function createMemoryCache(): StatisticsCache {
  let snapshot: StatisticsSnapshot | null = null;
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
    },
  };
}

export type StatisticsState =
  | { status: "loading"; period: PeriodValue; grouping: Grouping }
  | { status: "error"; message: string; period: PeriodValue; grouping: Grouping }
  | { status: "forbidden" }
  | { status: "empty"; period: PeriodValue; grouping: Grouping }
  | ({ status: "ready" } & StatisticsData)
  | ({ status: "offline"; lastSyncedAt: string } & StatisticsData);

/** Never throws — every failure resolves to a `StatisticsState` the caller
 * can render directly. Fetches both groupings' totals in one call (AC: the
 * grouping toggle must never trigger a second fetch). Passes the period arm
 * of `StatisticsQuery` straight through — it never computes bounds
 * (D120/D300). */
export async function loadStatistics(
  api: StatisticsApi,
  cache: StatisticsCache,
  period: PeriodValue,
  grouping: Grouping,
): Promise<StatisticsState> {
  try {
    const query = toQuery(period);
    const [me, categories, tags, periodTotal, categoryTotals, tagTotals] = await Promise.all([
      api.getMe(),
      api.listCategories(),
      api.listTags(),
      api.statisticsByPeriod(query),
      api.statisticsByCategory(query),
      api.statisticsByTag(query),
    ]);
    const data = buildStatisticsData({
      categories,
      tags,
      categoryTotals,
      tagTotals,
      periodTotal,
      currency: me.currency,
      period,
      grouping,
    });
    cache.set({ data, syncedAt: new Date().toISOString() });
    return periodTotal.total === 0 ? { status: "empty", period, grouping } : { status: "ready", ...data };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { status: "forbidden" };
    }
    const cached = cache.get();
    if (cached) {
      return { status: "offline", lastSyncedAt: cached.syncedAt, ...cached.data };
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { status: "error", message, period, grouping };
  }
}

// -- chrome ------------------------------------------------------------------

/** No MainButton is named for this screen (design doc §4's "Telegram" note
 * lists only the preset haptic and BackButton), so it's always hidden — same
 * choice `expenses.ts::applyExpensesChrome` made for its own screen. */
export function applyStatisticsChrome(onBack: () => void): void {
  setBackButtonHandler(onBack);
  mainButton.hide();
}

// -- presentation --------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// No-op stand-ins for the callbacks `PeriodSelectorProps` requires — the pure
// render never invokes them, only `mount` (below) wires the real handlers.
// Same shape as `home.ts`'s own `noop` (`PeriodUnit`/`number`/`void` params
// are all assignable from a bare `() => {}`).
const noop = () => {};

// Regions 2a/2b (`../components/period-selector.md`). Unlike Home, this
// screen keeps the control bare on the page background — no `.card`/
// `.chart-card` wrapper (05-statistics.md's Layout table, region 2) — and
// never disables it while offline (the screen doc's Edge cases: "the period
// control is not frozen", a pre-existing gap this delta doesn't fix).
function renderPeriodControl(period: PeriodValue, now: Date): string {
  return `<div class="period-selector-slot">${renderPeriodSelector({
    value: period,
    now,
    disabled: false,
    onUnitChange: noop,
    onOffsetChange: noop,
    onOpenPicker: noop,
  })}</div>`;
}

function renderGroupingToggle(grouping: Grouping): string {
  return `<div class="chip-row" data-testid="grouping-toggle">
    <button type="button" class="chip${grouping === "category" ? " active" : ""}" data-testid="grouping-category" data-grouping="category">By category</button>
    <button type="button" class="chip${grouping === "tag" ? " active" : ""}" data-testid="grouping-tag" data-grouping="tag">By tag</button>
  </div>`;
}

function renderDonut(data: StatisticsData): string {
  const arcs = data.segments
    .map(
      (seg) =>
        `<circle cx="100" cy="100" r="${DONUT_RADIUS}" stroke="${seg.colorVar}" stroke-width="26" fill="none" ` +
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

/** The ranked-bar list doubles as this screen's legend (file header) —
 * hidden entirely for a single row (AC: "single category renders without a
 * legend"), screen 05's own rule and untouched by U1.6, which replaced
 * Home's equivalent single-row suppression with an unconditional ranked
 * list (`home.ts::renderRankedRows`) — the two screens' legend/list rules
 * no longer match on purpose (D316: screen 05 is out of scope for that
 * work). Zero rows (e.g. no tagged expenses this period while the category
 * total is non-zero) gets its own note rather than blank space. */
function renderBars(bars: StatisticsBar[], grouping: Grouping): string {
  if (bars.length === 0) {
    const noun = grouping === "category" ? "categorised" : "tagged";
    return `<p class="stats-bars-empty" data-testid="bars-empty">No ${noun} expenses in this period.</p>`;
  }
  if (bars.length === 1) {
    return "";
  }
  const rows = bars
    .map(
      (bar) =>
        `<div class="stats-bar-row" data-testid="stats-bar" data-id="${bar.id}">
          <div class="stats-bar-head">
            ${bar.colorVar ? `<span class="dot" style="background:${bar.colorVar}"></span>` : ""}
            <span class="nm">${escapeHtml(bar.label)}</span>
            <span class="val">${escapeHtml(formatAmount(bar.minor))}</span>
          </div>
          <div class="stats-bar-track">
            <div class="stats-bar-fill" style="width:${bar.widthPct}%${bar.colorVar ? `;background:${bar.colorVar}` : ""}"></div>
          </div>
        </div>`,
    )
    .join("");
  return `<div class="card" data-testid="stats-bars">${rows}</div>`;
}

function renderOfflineBanner(lastSyncedAt: string | undefined): string {
  if (!lastSyncedAt) {
    return "";
  }
  return `<div class="offline-banner" data-testid="offline">Offline — showing data from ${escapeHtml(lastSyncedAt)}</div>`;
}

function renderReady(data: StatisticsData, lastSyncedAt: string | undefined, now: Date): string {
  const bars = data.grouping === "category" ? data.categoryBars : data.tagBars;
  return `<div class="statistics-ready" data-testid="ready">
    ${renderOfflineBanner(lastSyncedAt)}
    ${renderPeriodControl(data.period, now)}
    ${renderDonut(data)}
    ${renderGroupingToggle(data.grouping)}
    ${renderBars(bars, data.grouping)}
  </div>`;
}

function renderSkeleton(): string {
  return `<div class="statistics-skeleton" data-testid="loading">
    <div class="chips-skeleton"></div>
    <div class="donut-skeleton"></div>
    <div class="chips-skeleton"></div>
    <div class="stats-bar-skeleton"></div>
    <div class="stats-bar-skeleton"></div>
    <div class="stats-bar-skeleton"></div>
  </div>`;
}

function renderError(message: string, period: PeriodValue, now: Date): string {
  return `<div class="statistics-error" data-testid="error">
    ${renderPeriodControl(period, now)}
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">Try again</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="statistics-readonly" data-testid="forbidden">
    <p>You don't have permission to view statistics.</p>
  </div>`;
}

function renderEmpty(grouping: Grouping, period: PeriodValue, now: Date): string {
  return `<div class="statistics-empty" data-testid="empty">
    ${renderPeriodControl(period, now)}
    ${renderGroupingToggle(grouping)}
    <p>No expenses in this period.</p>
  </div>`;
}

export function renderStatistics(state: StatisticsState, now: Date): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "error":
      return renderError(state.message, state.period, now);
    case "forbidden":
      return renderForbidden();
    case "empty":
      return renderEmpty(state.grouping, state.period, now);
    case "ready":
      return renderReady(state, undefined, now);
    case "offline":
      return renderReady(state, state.lastSyncedAt, now);
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface StatisticsHandlers {
  onRetry: () => void;
  onBack: () => void;
  onBarTap: (categoryId: Uuid) => void;
  onUnitChange: (unit: PeriodUnit) => void; // host resets offset to 0
  onOffsetChange: (offset: number) => void; // host clamps at 0
  onApplyCustomRange: (range: { start: string; end: string }) => void; // date-range picker's Apply — host sets the period and refetches; Cancel/BackButton close the picker without calling this
}

/** The date-range picker's initial draft when opened from Statistics — the
 * previously applied custom range if one is in force ("Reopened" in the
 * component doc's States table), otherwise empty ("Choose a start date").
 * Pure, mirrors `home.ts`'s own copy of this function exactly (each screen
 * keeps its own rather than sharing, this module's header comment's
 * convention). */
export function pickerValueForPeriod(period: PeriodValue): DateRangePickerValue {
  return period.unit === "custom" ? { start: period.start, end: period.end } : {};
}

// Mirrors home.ts's own private toDateString — only needed here for the
// picker's `maxDate` (today, device-local, turned into a plain calendar-date
// string). Same "each pure module owns its own" convention as that file's
// header comment states.
function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The picker overlays this screen as a plain child of `root`, not a separate
// DOM root — same shape as home.ts::openPicker, which this mirrors. Any later
// `render()` call that replaces `root.innerHTML` tears the picker down for
// free, with no explicit lifecycle to get wrong.
function openPicker(
  root: HTMLElement,
  period: PeriodValue,
  now: Date,
  onBack: () => void,
  onApply: (range: { start: string; end: string }) => void,
): void {
  const pickerRoot = document.createElement("div");
  root.appendChild(pickerRoot);

  // BackButton closes the picker, not the screen (05-statistics.md's
  // Telegram section: "While the date-range picker is open it closes the
  // picker instead") — restoring the screen's own onBack (navigate to Home)
  // afterwards, unlike Home's own openPicker, whose BackButton is otherwise
  // always null (root screen) so it restores to null instead.
  const close = (): void => {
    pickerRoot.remove();
    setBackButtonHandler(onBack);
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

export function mount(root: HTMLElement, state: StatisticsState, handlers: StatisticsHandlers, now: Date): void {
  if (typeof document === "undefined") {
    return;
  }

  function render(current: StatisticsState): void {
    if (!root) {
      return;
    }
    root.innerHTML = renderStatistics(current, now);

    root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);

    if (
      current.status === "ready" ||
      current.status === "offline" ||
      current.status === "empty" ||
      current.status === "error"
    ) {
      const slot = root.querySelector<HTMLElement>(".period-selector-slot");
      if (slot) {
        mountPeriodSelector(slot, {
          value: current.period,
          now,
          disabled: false,
          onUnitChange: handlers.onUnitChange,
          onOffsetChange: handlers.onOffsetChange,
          onOpenPicker: () => openPicker(root, current.period, now, handlers.onBack, handlers.onApplyCustomRange),
        });
      }
    }

    if (current.status !== "ready" && current.status !== "offline") {
      return;
    }

    // Grouping toggle: pure local re-render, no handler/API call — AC's
    // "re-renders without refetching the period".
    root.querySelectorAll<HTMLElement>("[data-grouping]").forEach((el) => {
      el.addEventListener("click", () => {
        const next = el.dataset.grouping as Grouping;
        if (next === current.grouping) {
          return;
        }
        haptics.selection();
        render({ ...current, grouping: next });
      });
    });

    if (current.grouping === "category") {
      root.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
        el.addEventListener("click", () => {
          haptics.selection();
          handlers.onBarTap(el.dataset.id as Uuid);
        });
      });
    }
    // Tag bars have no drill-down target yet (file header) — tappable-but-
    // no-op is deferred to `renderBars`' cursor styling only.
  }

  render(state);
}
