/** Screen 05 — Statistics (docs/design/mini-app-ux.md §4). "Home's donut plus
 * ranked bars underneath, so switching screens never re-teaches the picture."
 * The ranked-bar list *is* this screen's legend (a fuller one than Home's
 * top-three) — there is no separate legend component.
 *
 * Layers, same split as every other screen:
 *  - data: `loadStatistics`/`buildStatisticsData` — fetches `GET /users/me`,
 *    `/categories`, `/tags`, `/statistics/by-period|by-category|by-tag` for
 *    one `months_back` preset (U0.4) and turns them into a `StatisticsState`.
 *    Never throws, same never-throws/cache-fallback contract as every other
 *    screen's loader. Both groupings' bars are computed in the same call, so
 *    the grouping toggle never needs a second fetch.
 *  - presentation: `renderStatistics`/`renderReady` (pure, HTML strings) and
 *    `mount` (thin DOM glue, the one part with no meaningful unit test — same
 *    accepted gap as every other screen's `mount`). `mount` re-renders on a
 *    grouping-toggle tap by swapping `state.grouping` and calling `render()`
 *    again directly — no handler call, no API call (AC: "grouping toggle
 *    re-renders without refetching the period").
 *
 * The donut always reflects the category breakdown (same D206 colour slots
 * as Home) regardless of grouping — there is no `categories.color`-style slot
 * contract for tags, so a "by tag" donut has no fixed palette to draw from.
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
import { segments as donutSegments } from "../lib/donut";
import { formatAmount } from "../lib/money";
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

export interface PeriodPreset {
  monthsBack: number;
  label: string;
}

// Labels mirror bot/keyboards.py's statistics period buttons exactly — same
// three presets, same copy.
export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  { monthsBack: 0, label: "This month" },
  { monthsBack: 1, label: "Last month" },
  { monthsBack: 2, label: "Last 3 months" },
];

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
  monthsBack: number;
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
  monthsBack: number;
  grouping: Grouping;
}): StatisticsData {
  const orderedCategories = [...input.categories].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const colorBySlot = new Map(assignCategoryColors(orderedCategories).map((c) => [c.id, c.slot]));
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
    monthsBack: input.monthsBack,
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
  statisticsByPeriod(opts?: { months_back?: number }): Promise<PeriodTotal>;
  statisticsByCategory(opts?: { months_back?: number }): Promise<CategoryTotal[]>;
  statisticsByTag(opts?: { months_back?: number }): Promise<TagTotal[]>;
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
  | { status: "loading"; monthsBack: number; grouping: Grouping }
  | { status: "error"; message: string; monthsBack: number; grouping: Grouping }
  | { status: "forbidden" }
  | { status: "empty"; monthsBack: number; grouping: Grouping }
  | ({ status: "ready" } & StatisticsData)
  | ({ status: "offline"; lastSyncedAt: string } & StatisticsData);

/** Never throws — every failure resolves to a `StatisticsState` the caller
 * can render directly. Fetches both groupings' totals in one call (AC: the
 * grouping toggle must never trigger a second fetch). */
export async function loadStatistics(
  api: StatisticsApi,
  cache: StatisticsCache,
  monthsBack: number,
  grouping: Grouping,
): Promise<StatisticsState> {
  try {
    const [me, categories, tags, periodTotal, categoryTotals, tagTotals] = await Promise.all([
      api.getMe(),
      api.listCategories(),
      api.listTags(),
      api.statisticsByPeriod({ months_back: monthsBack }),
      api.statisticsByCategory({ months_back: monthsBack }),
      api.statisticsByTag({ months_back: monthsBack }),
    ]);
    const data = buildStatisticsData({
      categories,
      tags,
      categoryTotals,
      tagTotals,
      periodTotal,
      currency: me.currency,
      monthsBack,
      grouping,
    });
    cache.set({ data, syncedAt: new Date().toISOString() });
    return periodTotal.total === 0 ? { status: "empty", monthsBack, grouping } : { status: "ready", ...data };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { status: "forbidden" };
    }
    const cached = cache.get();
    if (cached) {
      return { status: "offline", lastSyncedAt: cached.syncedAt, ...cached.data };
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { status: "error", message, monthsBack, grouping };
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

function renderPresetChips(monthsBack: number): string {
  const items = PERIOD_PRESETS.map(
    (p) =>
      `<button type="button" class="chip${p.monthsBack === monthsBack ? " active" : ""}" data-testid="preset" data-preset="${p.monthsBack}">${escapeHtml(p.label)}</button>`,
  ).join("");
  return `<div class="chip-row" data-testid="period-presets">${items}</div>`;
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

function renderReady(data: StatisticsData, lastSyncedAt: string | undefined): string {
  const bars = data.grouping === "category" ? data.categoryBars : data.tagBars;
  return `<div class="statistics-ready" data-testid="ready">
    ${renderOfflineBanner(lastSyncedAt)}
    ${renderPresetChips(data.monthsBack)}
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

function renderError(message: string, monthsBack: number): string {
  return `<div class="statistics-error" data-testid="error">
    ${renderPresetChips(monthsBack)}
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">Try again</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="statistics-readonly" data-testid="forbidden">
    <p>You don't have permission to view statistics.</p>
  </div>`;
}

function renderEmpty(monthsBack: number, grouping: Grouping): string {
  return `<div class="statistics-empty" data-testid="empty">
    ${renderPresetChips(monthsBack)}
    ${renderGroupingToggle(grouping)}
    <p>No expenses in this period.</p>
  </div>`;
}

export function renderStatistics(state: StatisticsState): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "error":
      return renderError(state.message, state.monthsBack);
    case "forbidden":
      return renderForbidden();
    case "empty":
      return renderEmpty(state.monthsBack, state.grouping);
    case "ready":
      return renderReady(state, undefined);
    case "offline":
      return renderReady(state, state.lastSyncedAt);
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface StatisticsHandlers {
  onRetry: () => void;
  onBack: () => void;
  onPresetChange: (monthsBack: number) => void;
  onBarTap: (categoryId: Uuid) => void;
}

export function mount(root: HTMLElement, state: StatisticsState, handlers: StatisticsHandlers): void {
  if (typeof document === "undefined") {
    return;
  }

  function render(current: StatisticsState): void {
    if (!root) {
      return;
    }
    root.innerHTML = renderStatistics(current);

    root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);
    root.querySelectorAll<HTMLElement>("[data-preset]").forEach((el) => {
      el.addEventListener("click", () => {
        haptics.selection();
        handlers.onPresetChange(Number(el.dataset.preset));
      });
    });

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
