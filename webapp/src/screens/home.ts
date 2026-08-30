/** Screen 01 — Home (docs/design/mini-app-ux.md §4). The donut answers
 * "where did it go?" before a number is read; navigation lives behind the ☰
 * button (D409, `../components/side-menu.ts`) rather than a tile row (V4).
 *
 * Split in three layers, each independently testable:
 *  - data: `loadHome`/`buildHomeData` — orchestrates the ApiClient calls and
 *    turns their responses into a `HomeState`. Pure aside from the awaited
 *    network calls.
 *  - interaction: `applyHomeChrome` — pure functions screens/tests can call
 *    directly, no DOM involved.
 *  - presentation: `renderHome` (pure, returns an HTML string) and `mount`
 *    (the thin DOM-writing glue, the one part with no meaningful unit test —
 *    same accepted gap as `lib/telegram.ts::applyTheme`, guarded by a
 *    `typeof document` check).
 */

import { assignCategoryColors, categorySlotCssVar, OTHER_COLOR_VAR } from "../lib/category-colors";
import { barSegments as donutBarSegments, segments as donutSegments } from "../lib/donut";
import { formatAmount } from "../lib/money";
import {
  describe as describePeriod,
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
import { mount as mountSideMenu, type MenuItem, type SideMenuProps } from "../components/side-menu";
import { ForbiddenError } from "../api/client";
import type {
  BudgetPlanResponse,
  BudgetProgress,
  CategoryResponse,
  CategoryTotal,
  Currency,
  Language,
  PeriodTotal,
  Role,
  Uuid,
} from "../api/types";
import { setLanguage, t, type Catalogue } from "../lib/i18n";

// docs/ui/screens/01-home.md's Copy table: `mb.add` and `add.aria` are both
// this string in every language — MainButton's label and the yellow Add
// button's accessible name must never drift apart, since both fire the same
// handler (D318). Looked up via `t()` at each call site (never cached in a
// module constant) so a language change re-renders in the new language
// without a reload.

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

// design-system.md: "Collapsed stacked bar (01) | 10px tall, 999px radius,
// 2px segment gaps, 3px minimum segment". Unlike the donut's fixed 200-unit
// viewBox, the bar's width is responsive (`width: 100%` of the collapsed
// header), so there is no real pixel width to clamp against until the DOM
// actually lays it out — out of reach for this unit's pure render/geometry
// (no scroll wiring, no measurement). BAR_REFERENCE_WIDTH stands in for that:
// a plausible phone content width (~375px viewport, 12px padding each side
// inside `.collapsed-header`) used only to turn the design's literal "2px"/
// "3px" into the percentages `lib/donut.ts::barSegments` works in.
const BAR_REFERENCE_WIDTH = 351;
const BAR_GAP_PCT = (2 / BAR_REFERENCE_WIDTH) * 100;
const BAR_MIN_SEGMENT_PCT = (3 / BAR_REFERENCE_WIDTH) * 100;

export interface HomeSegment {
  categoryId: Uuid | null;
  label: string;
  colorVar: string;
  dash: number;
  gap: number;
  offset: number;
}

export interface HomeBarSegment {
  categoryId: Uuid | null;
  label: string;
  colorVar: string;
  widthPct: number;
}

export interface HomeRankedRow {
  categoryId: Uuid;
  label: string;
  colorVar: string;
  minor: number;
  sharePct: number;
}

// docs/plans/mini-app-v6.md's Contracts (D606) — the old exceeded-only filter
// and its "first row only" render are both gone; every alert of both kinds
// renders now (`docs/ui/screens/01-home.md`'s "Budget alert strip").
export type HomeBudgetAlertKind = "exceeded" | "approaching";

export interface HomeBudgetAlert {
  kind: HomeBudgetAlertKind;
  categoryId: Uuid;
  label: string;
  /** `BudgetProgress.fill_pct`, rounded at render only — never recomputed. */
  fillPct: number;
  spentMinor: number;
  limitMinor: number;
  /** `-remaining` from the API; only set on `kind: "exceeded"`. */
  overMinor: number | null;
}

export interface HomeData {
  totalMinor: number;
  currency: Currency;
  segments: HomeSegment[];
  /** Collapsed-header stacked bar (D414/U5.1) — same segments, order and
   * colours as `segments`, only the geometry differs (`barSegments` widths
   * vs `segments` dash/gap/offset). Computed alongside `segments` from the
   * same `donutInput`/fold so the two can never disagree. */
  bars: HomeBarSegment[];
  rows: HomeRankedRow[];
  /** Region 3 (D606): every exceeded alert first, then every approaching
   * one, each group in `rows`' ranked order. */
  budgetAlerts: HomeBudgetAlert[];
  period: PeriodValue;
  /** `UserMeResponse.today` (U3.3), `YYYY-MM-DD` in `family_tz` — the date
   * the Day tab hands to screen 02 is resolved from this, never the device
   * clock (D406 half two, `resolveDayDate` below). */
  today: string;
  /** `UserMeResponse.account_name` — the side menu's header (D409); the menu
   * never fetches its own copy of it (`../components/side-menu.md`). */
  accountName: string;
  /** `UserMeResponse.role === "system_admin"` (U4.10) — gates the side menu's
   * eighth row. Optional/defaulted rather than a new required field, so the
   * many existing `buildHomeData`/`HomeState` fixtures that don't care about
   * it stay unchanged. */
  isSystemAdmin?: boolean;
}

export type HomeState =
  | { status: "loading"; period: PeriodValue }
  | { status: "error"; message: string; period: PeriodValue }
  | { status: "forbidden" }
  | {
      status: "empty";
      period: PeriodValue;
      currency: Currency;
      today: string;
      accountName: string;
      isSystemAdmin?: boolean;
    }
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
  today: string;
  accountName: string;
  isSystemAdmin?: boolean;
}): HomeData {
  const colorBySlot = new Map(assignCategoryColors(input.categories).map((c) => [c.id, c.slot]));
  const nameById = new Map(input.categories.map((c) => [c.id, c.name]));

  // docs/ui/screens/01-home.md: "all categories with a non-zero total,
  // ranked descending" — every one of them, not a top-N legend (the old
  // <=1-row suppression is gone too; a single category still renders its
  // one row).
  const rows: HomeRankedRow[] = [...input.categoryTotals]
    .filter((ct) => ct.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((ct) => {
      const slot = colorBySlot.get(ct.category_id) ?? null;
      return {
        categoryId: ct.category_id,
        label: nameById.get(ct.category_id) ?? t("category.unknown"),
        colorVar: slot !== null ? categorySlotCssVar(slot) : OTHER_COLOR_VAR,
        minor: ct.total,
        sharePct: input.periodTotal.total > 0 ? (ct.total / input.periodTotal.total) * 100 : 0,
      };
    });

  // (D605) "The donut draws the same list region 4 does, in the same
  // order": the donut and the collapsed bar take their slices from `rows`
  // (the period's categories ranked by spend descending) rather than from
  // creation order, so a category with 0 spend never occupies a slice and a
  // top-six-by-spend category's colour is never hidden inside "Other".
  const donutInput = rows.map((r) => ({ id: r.categoryId, label: r.label, minor: r.minor }));
  const rawSegments = donutSegments(donutInput, {
    circumference: DONUT_CIRCUMFERENCE,
    maxSlots: MAX_DONUT_SLOTS,
  });
  // donutSegments() folds anything past maxSlots into one trailing "Other"
  // row (lib/donut.ts) — only the first `realCount` output slots map 1:1
  // onto `rows`; a folded run has one extra slot with no single category
  // behind it.
  const realCount = Math.min(rows.length, MAX_DONUT_SLOTS);
  const segments: HomeSegment[] = rawSegments.map((seg, index) => {
    const row = index < realCount ? rows[index] : undefined;
    return {
      categoryId: row ? row.categoryId : null,
      label: row ? row.label : t("chart.other"),
      colorVar: row ? row.colorVar : OTHER_COLOR_VAR,
      dash: seg.dash,
      gap: seg.gap,
      offset: seg.offset,
    };
  });

  // Collapsed stacked bar (D414/U5.1): same `donutInput`/`realCount` fold as
  // the donut above, so the two geometries can never list different
  // categories in a different order or colour.
  const rawBars = donutBarSegments(donutInput, {
    gapPct: BAR_GAP_PCT,
    minPct: BAR_MIN_SEGMENT_PCT,
    maxSlots: MAX_DONUT_SLOTS,
  });
  const bars: HomeBarSegment[] = rawBars.map((seg, index) => {
    const row = index < realCount ? rows[index] : undefined;
    return {
      categoryId: row ? row.categoryId : null,
      label: row ? row.label : t("chart.other"),
      colorVar: row ? row.colorVar : OTHER_COLOR_VAR,
      widthPct: seg.widthPct,
    };
  });

  // D310, extended by docs/ui/screens/01-home.md: the strip states a monthly
  // fact, so it is shown only when the screen's own period is that same
  // span — Month at offset 0. Budget progress is always month-scoped, so
  // it's still fetched regardless of the tab in force; only its visibility
  // is gated here.
  const isMonthToDate = input.period.unit === "month" && input.period.offset === 0;

  // D606: within each kind, lines follow the ranked-row order of their
  // category — the reader has just seen that order in the ring. A budget on
  // a category absent from `rows` (0 spend this period; unreachable for
  // `is_exceeded`, since spend is what exceeds it, but not for the ranking
  // itself) sorts after every ranked category rather than throwing.
  const rankIndex = new Map(rows.map((r, i) => [r.categoryId, i]));
  const byRank = (a: HomeBudgetAlert, b: HomeBudgetAlert): number =>
    (rankIndex.get(a.categoryId) ?? Infinity) - (rankIndex.get(b.categoryId) ?? Infinity);

  const exceededAlerts: HomeBudgetAlert[] = isMonthToDate
    ? input.budgetProgress
        .filter((p) => p.is_exceeded)
        .map((p) => ({
          kind: "exceeded" as const,
          categoryId: p.category_id,
          label: nameById.get(p.category_id) ?? t("category.unknown"),
          // `is_exceeded` is only ever true when `fill_pct` is not null
          // (services/budget_service.py), so this always resolves.
          fillPct: p.fill_pct ?? 0,
          spentMinor: p.spent,
          limitMinor: p.amount,
          overMinor: -p.remaining,
        }))
        .sort(byRank)
    : [];

  // `fill_pct !== null` guards the edge case docs/ui/screens/01-home.md
  // states explicitly: a plan with `amount <= 0` renders no approaching
  // line, never "null%" — `is_over_threshold` already implies this
  // server-side, but the check is cheap and keeps the rule visible here too.
  const approachingAlerts: HomeBudgetAlert[] = isMonthToDate
    ? input.budgetProgress
        .filter((p) => p.is_over_threshold && !p.is_exceeded && p.fill_pct !== null)
        .map((p) => ({
          kind: "approaching" as const,
          categoryId: p.category_id,
          label: nameById.get(p.category_id) ?? t("category.unknown"),
          fillPct: p.fill_pct as number,
          spentMinor: p.spent,
          limitMinor: p.amount,
          overMinor: null,
        }))
        .sort(byRank)
    : [];

  return {
    totalMinor: input.periodTotal.total,
    currency: input.currency,
    segments,
    bars,
    rows,
    budgetAlerts: [...exceededAlerts, ...approachingAlerts],
    period: input.period,
    today: input.today,
    accountName: input.accountName,
    isSystemAdmin: input.isSystemAdmin ?? false,
  };
}

export interface HomeApi {
  getMe(): Promise<{ currency: Currency; today: string; account_name: string; language: Language; role: Role }>;
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
    // Reconciles the boot-time default (`main.ts::boot`, D709) against the
    // account's real language, off the same GET /users/me call this loader
    // already makes — never a second fetch (D716). A side effect, not part
    // of `HomeData`: no screen consumes it yet, so it stays out of
    // `HomeState`'s shape rather than touching every exact-equality fixture
    // in home.test.ts for a field nothing renders.
    setLanguage(me.language);
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
      today: me.today,
      accountName: me.account_name,
      isSystemAdmin: me.role === "system_admin",
    });
    cache.set({ data, syncedAt: new Date().toISOString() });
    return periodTotal.total === 0
      ? {
          status: "empty",
          period,
          currency: data.currency,
          today: data.today,
          accountName: data.accountName,
          isSystemAdmin: data.isSystemAdmin,
        }
      : { status: "ready", ...data };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { status: "forbidden" };
    }
    const cached = cache.get();
    if (cached) {
      // Offline freezes the control at the cached period, not the one just
      // requested — `cached.data.period` is whatever last loaded
      // successfully (component doc's Disabled state).
      return { status: "offline", lastSyncedAt: cached.syncedAt, ...cached.data };
    }
    const message = err instanceof Error ? err.message : t("error.fallback");
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

/** The date-range picker's initial draft when opened from Home — the
 * previously applied custom range if one is in force ("Reopened" in the
 * component doc's States table), otherwise empty ("Choose a start date").
 * Pure so `mount`'s DOM-only picker wiring stays the file's one untested
 * seam, same as every other screen. */
export function pickerValueForPeriod(period: PeriodValue): DateRangePickerValue {
  return period.unit === "custom" ? { start: period.start, end: period.end } : {};
}

/** The Day tab's actual calendar date — `today` (`HomeData.today`,
 * `family_tz`-anchored, never the device clock) shifted by the tab's
 * `offset`. What screen 02 pre-selects when "add expense" fires from the Day
 * tab (docs/ui/screens/01-home.md, "The date Home hands to screen 02", D406
 * half two). Pure calendar-date math on the `today` string, same convention
 * `screens/add-expense.ts`'s own date helpers already follow — this module
 * keeps its own copy rather than importing theirs. */
export function resolveDayDate(today: string, offset: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const shifted = new Date(y, m - 1, d + offset);
  const yyyy = shifted.getFullYear();
  const mm = String(shifted.getMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Only the Day tab hands a date to screen 02 (D406 half two) — every other
 * tab, and any state with no resolved `today` yet (loading/error/forbidden),
 * returns `undefined` so screen 02 defaults to today, unchanged. */
function dayDateForHandoff(state: HomeState): string | undefined {
  if (state.status === "loading" || state.status === "forbidden" || state.status === "error") {
    return undefined;
  }
  return state.period.unit === "day" ? resolveDayDate(state.today, state.period.offset) : undefined;
}

/** Telegram chrome for Home: MainButton = Add expense (hidden while loading
 * or for a read-only/forbidden viewer — root CLAUDE.md's PermissionChecker
 * denies the write, so the button must not promise one); BackButton hidden,
 * this is the root screen. `onAddExpense` wires the MainButton tap to
 * navigation (U2.2), carrying the Day tab's resolved date (U2.5, D406 half
 * two) — optional so callers/tests that don't care about navigation can omit
 * it without wiring a handler. */
export function applyHomeChrome(state: HomeState, onAddExpense?: (date?: string) => void): void {
  setBackButtonHandler(null);
  if (state.status === "loading" || state.status === "forbidden") {
    mainButton.hide();
    return;
  }
  mainButton.show(t("mb.add"));
  mainButton.setEnabled(true);
  if (onAddExpense) {
    mainButton.onClick(() => onAddExpense(dayDateForHandoff(state)));
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
  return `<button type="button" class="add-btn" data-testid="add-button" aria-label="${escapeHtml(t("add.aria"))}"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg></button>`;
}

// docs/ui/components/side-menu.md's Sizing: 44×44, a 20px glyph, `--ink` with
// no fill — chrome, not a primary action, so `--accent` stays the yellow Add
// button's one use (D318). The glyph is off `menu-button.jpg`: three bars of
// equal length and square ends at ~2.5px stroke in the 20px box, drawn inline
// here — the module that renders the *button* (home.ts), not
// `components/side-menu.ts` itself, per that doc's Sizing section. `mount`
// wires its click to `openSideMenu` below.
function renderMenuButton(): string {
  return `<button type="button" class="menu-btn" data-testid="menu-button" aria-label="${escapeHtml(t("menu.aria"))}"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><line x1="2" y1="5" x2="18" y2="5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /><line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /><line x1="2" y1="15" x2="18" y2="15" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg></button>`;
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

// Neither the screen doc's States table nor this unit's AC puts a ☰ on
// `loading`/`error` (only empty/403/offline/ready name it) — `error`'s retry
// button is flush left in normal flow, exactly where an absolutely
// positioned ☰ would also sit, and unlike the yellow Add button (bottom-
// right, clear of it) an in-card ☰ there would overlap the button text.
function renderSkeleton(period: PeriodValue, now: Date): string {
  return `<div class="home-skeleton" data-testid="loading">
    <div class="card chart-card">
      ${renderPeriodControl(period, now, false)}
      <div class="donut-skeleton"></div>
    </div>
    <div class="ranked-rows-skeleton"><div class="card"></div><div class="card"></div><div class="card"></div></div>
  </div>`;
}

function renderError(message: string, period: PeriodValue, now: Date): string {
  return `<div class="home-error" data-testid="error">
    <div class="card chart-card">
      ${renderPeriodControl(period, now, false)}
      <p>${escapeHtml(message)}</p>
      <button type="button" data-action="retry">${t("error.retry")}</button>
      ${renderAddButton()}
    </div>
  </div>`;
}

// docs/ui/screens/01-home.md's Copy table (D405): one sentence per unit,
// deictic rather than period-named ("this day", not "August 3") — the empty
// ring sits directly under a label that already names the period, so naming
// it twice 100px apart is noise. Supersedes the eight offset-branching V3
// strings ("Nothing today"/"Nothing in August"/...).
const EMPTY_COPY_KEY: Record<PeriodUnit, keyof Catalogue> = {
  day: "empty.day",
  week: "empty.week",
  month: "empty.month",
  year: "empty.year",
  custom: "empty.custom",
};

function describeEmptyPeriod(period: PeriodValue): string {
  return t(EMPTY_COPY_KEY[period.unit]);
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

function renderEmpty(period: PeriodValue, currency: Currency, now: Date, collapsed: boolean): string {
  return `<div class="home-empty" data-testid="empty">
    ${
      collapsed
        ? renderCollapsedHeader(
            period,
            now,
            0,
            currency,
            renderCollapsedBar([], describeEmptyPeriod(period)),
          )
        : ""
    }
    <div class="card chart-card">
      ${renderPeriodControl(period, now, false)}
      ${renderEmptyDonut(currency)}
      <p class="empty-copy">${escapeHtml(describeEmptyPeriod(period))}</p>
      ${collapsed ? "" : renderMenuButton()}
      ${collapsed ? "" : renderAddButton()}
    </div>
    ${renderCollapseSentinel()}
  </div>`;
}

// No chart card here (D404/screen doc's 403 state pre-dates this unit and is
// unchanged by it) — the ☰ still has to be reachable, so it renders as a
// plain flex item rather than the card-anchored, absolutely positioned
// button the other states use (`.chart-card .menu-btn` in app.css).
function renderReadOnly(): string {
  return `<div class="home-readonly" data-testid="forbidden">
    ${renderMenuButton()}
    <p>${t("readonly")}</p>
  </div>`;
}

// Accessibility section: "The donut is role="img" with a label listing the
// top three categories and their shares." Shared with the collapsed bar
// below (D414/U5.1's own AC: the bar carries "the donut's label — real
// percentages, not clamped widths") so the two can only ever say the same
// thing. Only called where `rows` is non-empty (the "ready"/"offline"
// states) — an empty period's own label is `describeEmptyPeriod`'s sentence
// instead (renderEmpty below), matching the empty ring's rule.
function describeChartLabel(rows: HomeRankedRow[]): string {
  return rows
    .slice(0, 3)
    .map((row) => `${row.label} ${Math.round(row.sharePct)}%`)
    .join(", ");
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
    <svg class="donut" viewBox="0 0 200 200" role="img" aria-label="${escapeHtml(describeChartLabel(data.rows))}" data-testid="donut">
      <g transform="rotate(-90 100 100)">${arcs}</g>
    </svg>
    <div class="donut-c">
      <div class="amt">${escapeHtml(formatAmount(data.totalMinor))} ${escapeHtml(data.currency)}</div>
    </div>
  </div>`;
}

// docs/ui/design-system.md: "Collapsed stacked bar (01) | 10px tall, 999px
// radius, 2px segment gaps, 3px minimum segment." Display-only like the
// donut it stands in for (D404) — role="img", not focusable, no click
// wiring (`mount` below never queries `.collapsed-bar-seg`).
function renderCollapsedBar(bars: HomeBarSegment[], label: string): string {
  if (bars.length === 0) {
    // Mirrors renderEmptyDonut's unbroken ring (D405): one whole
    // `--separator` segment, no gaps, for an empty period.
    return `<div class="collapsed-bar" role="img" aria-label="${escapeHtml(label)}" data-testid="collapsed-bar">
      <span class="collapsed-bar-seg" style="flex:1 1 auto;background:var(--separator)"></span>
    </div>`;
  }
  const segs = bars
    .map(
      (seg) =>
        `<span class="collapsed-bar-seg" data-category-id="${seg.categoryId ?? "other"}" ` +
        `style="flex:0 0 ${seg.widthPct}%;background:${seg.colorVar}"></span>`,
    )
    .join("");
  return `<div class="collapsed-bar" role="img" aria-label="${escapeHtml(label)}" data-testid="collapsed-bar">${segs}</div>`;
}

// D414/U5.2: a 1px marker at the bottom edge of region 2c (the chart card) —
// screen doc's "the trigger is an IntersectionObserver on a 1px sentinel at
// the bottom edge of region 2c, not a scroll-position listener." Rendered
// unconditionally (both collapsed states) since it's the trigger itself, not
// a symptom of collapsing: `mount` below needs it present whichever way
// `collapsed` is already rendered, to detect the *next* crossing in either
// direction. Placed on iOS's rubber-band side of the boundary deliberately
// (screen doc's Edge cases: "well clear of the overscroll region, so the
// header does not flicker at the boundary").
function renderCollapseSentinel(): string {
  return `<div class="collapse-sentinel" data-testid="collapse-sentinel"></div>`;
}

// Region 6 (D414/U5.1): the fixed 68px summary the donut collapses into once
// scrolled past — a 44px row (☰ · label · total) over the 10px bar. Rendered
// purely from the explicit `collapsed` flag this unit's own AC calls for;
// the real scroll trigger (`IntersectionObserver`, the `position: fixed`
// appear/disappear transition) is U5.2. Reuses `renderMenuButton()`
// verbatim, so this is the only ☰ markup whenever `collapsed` is true — the
// chart card's own is suppressed in that case (renderReady/renderEmpty
// below) — and `mount`'s existing generic `[data-testid="menu-button"]`
// wiring finds and wires whichever one is present with no new code.
function renderCollapsedHeader(
  period: PeriodValue,
  now: Date,
  totalMinor: number,
  currency: Currency,
  bar: string,
): string {
  return `<div class="collapsed-header" data-testid="collapsed-header">
    <div class="collapsed-row">
      ${renderMenuButton()}
      <span class="collapsed-label" data-testid="collapsed-label">${escapeHtml(describePeriod(period, now))}</span>
      <span class="collapsed-total">${escapeHtml(formatAmount(totalMinor))} ${escapeHtml(currency)}</span>
    </div>
    ${bar}
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

// docs/ui/design-system.md's Iconography table: "triangle + bar + dot ...
// `--status-red` on an exceeded line, `currentColor` elsewhere" — drawn in
// `currentColor` throughout so `.alert-line--exceeded`/`--approaching`'s own
// text colour carries the state, exactly like `renderAddButton`'s `+` above.
// `aria-hidden` since each line's own text already names the state in words
// (Accessibility: "neither the state nor the identity depends on colour").
function renderWarningGlyph(): string {
  return `<svg class="alert-glyph" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M7 1.3 13 12.3H1L7 1.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none" /><line x1="7" y1="5.2" x2="7" y2="8.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /><circle cx="7" cy="10.4" r="0.9" fill="currentColor" /></svg>`;
}

// Fills `{var}` placeholders in a catalogue template with no escaping — the
// non-escaping counterpart to `t()`'s own vars mechanism. Only used by
// `budgetAlertMessage` below, whose "raw and unescaped" contract (see its own
// comment) `t()`'s auto-escaping would break.
function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

// docs/ui/screens/01-home.md's Copy table: `alert.over` (unchanged wording,
// so Home and screen 04 keep saying the same thing) and the new `alert.warn`,
// carrying the percentage, spent and limit `alert.over` doesn't. `overMinor`
// comes straight from `-remaining` (never `spent - amount`, D606); `fillPct`
// is rounded here and nowhere else. Exported, raw and unescaped, so
// `main.ts::budgetToastMessage` (D608/D609) composes the toast from this
// exact sentence — "one copy source, not two" (mini-app-v6 plan, U4.3's AC)
// — rather than a second copy of the wording that could drift from this one.
export function budgetAlertMessage(alert: HomeBudgetAlert, currency: Currency): string {
  return alert.kind === "exceeded"
    ? fillTemplate(t("alert.over"), {
        category: alert.label,
        amount: formatAmount(alert.overMinor ?? 0),
        currency,
      })
    : fillTemplate(t("alert.warn"), {
        category: alert.label,
        pct: Math.round(alert.fillPct),
        spent: formatAmount(alert.spentMinor),
        limit: formatAmount(alert.limitMinor),
        currency,
      });
}

function renderBudgetAlertLine(alert: HomeBudgetAlert, currency: Currency): string {
  const text = escapeHtml(budgetAlertMessage(alert, currency));
  return `<div class="alert-line alert-line--${alert.kind}" data-testid="budget-alert" data-category-id="${alert.categoryId}">${renderWarningGlyph()}<span>${text}</span></div>`;
}

// docs/ui/screens/01-home.md's region 3: one card, one line per alert —
// every exceeded alert first, then every approaching one (already ordered by
// `buildHomeData`). Absent entirely with no alerts (Edge cases: "region 3 is
// absent — not an empty card"), matching the old strip's empty-array return.
function renderBudgetAlertStrip(alerts: HomeBudgetAlert[], currency: Currency): string {
  if (alerts.length === 0) {
    return "";
  }
  const lines = alerts.map((alert) => renderBudgetAlertLine(alert, currency)).join("");
  return `<div class="card budget-alert-strip" data-testid="budget-alerts">${lines}</div>`;
}

function renderOfflineBanner(lastSyncedAt: string | undefined): string {
  if (!lastSyncedAt) {
    return "";
  }
  return `<div class="offline-banner" data-testid="offline">${t("offline.banner", { time: lastSyncedAt })}</div>`;
}

function renderReady(
  data: HomeData,
  lastSyncedAt: string | undefined,
  now: Date,
  disabled: boolean,
  collapsed: boolean,
): string {
  return `<div class="home-ready" data-testid="ready">
    ${
      collapsed
        ? renderCollapsedHeader(
            data.period,
            now,
            data.totalMinor,
            data.currency,
            renderCollapsedBar(data.bars, describeChartLabel(data.rows)),
          )
        : ""
    }
    ${renderOfflineBanner(lastSyncedAt)}
    <div class="card chart-card">
      ${renderPeriodControl(data.period, now, disabled)}
      ${renderDonut(data)}
      ${collapsed ? "" : renderMenuButton()}
      ${collapsed ? "" : renderAddButton()}
    </div>
    ${renderCollapseSentinel()}
    ${renderBudgetAlertStrip(data.budgetAlerts, data.currency)}
    ${renderRankedRows(data.rows)}
  </div>`;
}

// `collapsed` (D414/U5.1): whether the donut has scrolled above the
// viewport — a test can set it directly, since there is no scroll wiring
// yet (U5.2). Defaults to `false` so every existing caller/test renders
// exactly as before.
export function renderHome(state: HomeState, now: Date, collapsed = false): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton(state.period, now);
    case "error":
      return renderError(state.message, state.period, now);
    case "forbidden":
      return renderReadOnly();
    case "empty":
      return renderEmpty(state.period, state.currency, now, collapsed);
    case "ready":
      return renderReady(state, undefined, now, false, collapsed);
    case "offline":
      // Offline freezes the control at the cached period (webapp/CLAUDE.md's
      // offline state + the component doc's Disabled variant) — `disabled`
      // here both dims the control and short-circuits its taps.
      return renderReady(state, state.lastSyncedAt, now, true, collapsed);
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as lib/telegram.ts::applyTheme) --------------------------

export interface HomeHandlers {
  onRetry: () => void;
  // Ranked-row tap only (D404) — the donut itself is display-only and never
  // calls this. Rows never fold into an "Other" slot (buildHomeData), so
  // categoryId is always real, unlike the donut segment concept this
  // replaced.
  onRowTap: (target: { categoryId: Uuid; label: string }) => void;
  onUnitChange: (unit: PeriodUnit) => void; // host resets offset to 0
  onOffsetChange: (offset: number) => void; // host clamps at 0
  onApplyCustomRange: (range: { start: string; end: string }) => void; // date-range picker's Apply — host sets the period and refetches; Cancel/BackButton close the picker without calling this
  onAddExpense: (date?: string) => void; // yellow Add button — same target as MainButton (D318); carries the Day tab's resolved date (U2.5, D406 half two)
  onMenuSelect: (item: MenuItem) => void; // side menu row tap (D409) — host navigates; the menu is already closing by the time this fires
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

// `SideMenuProps.accountName`/`.currency` come from `HomeData` on the states
// that have loaded it; `loading`/`error`/`forbidden` have none yet, so the
// header renders without them (component doc: "the band renders without
// it") rather than this screen inventing placeholder copy. `readOnly` mirrors
// the forbidden state only — every other state's viewer can write.
function menuPropsFor(
  state: HomeState,
): Pick<SideMenuProps, "accountName" | "currency" | "lastSyncedAt" | "readOnly" | "isSystemAdmin"> {
  switch (state.status) {
    case "empty":
    case "ready":
      return {
        accountName: state.accountName,
        currency: state.currency,
        readOnly: false,
        isSystemAdmin: state.isSystemAdmin ?? false,
      };
    case "offline":
      return {
        accountName: state.accountName,
        currency: state.currency,
        lastSyncedAt: state.lastSyncedAt,
        readOnly: false,
        isSystemAdmin: state.isSystemAdmin ?? false,
      };
    case "forbidden":
      return { accountName: null, currency: null, readOnly: true, isSystemAdmin: false };
    case "loading":
    case "error":
      return { accountName: null, currency: null, readOnly: false, isSystemAdmin: false };
  }
}

// D419: `components/side-menu.ts`'s `renderSideMenu` implements only the
// entrance animation — this codebase re-renders by replacing `innerHTML`
// wholesale on every state change, so a closing transition needs the panel
// to outlive that replace. Same shape as `openPicker` above (a sibling child
// of `root`, torn down for free by the next full re-render), plus a
// hand-driven 160ms reverse transition (app.css's `side-menu-closing`
// classes) before the node is actually removed — skipped entirely under
// `prefers-reduced-motion` (screen doc's Accessibility section: "disables...
// the menu's slide").
function openSideMenu(root: HTMLElement, trigger: HTMLElement, state: HomeState, handlers: HomeHandlers): void {
  const menuRoot = document.createElement("div");
  root.appendChild(menuRoot);

  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    setBackButtonHandler(null);
    // Closing returns focus to the ☰ button (component doc's Accessibility
    // section) — harmless when a row tap is about to replace `root` wholesale
    // anyway, since that teardown makes this a no-op.
    trigger.focus();

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const panel = menuRoot.querySelector<HTMLElement>(".side-menu-panel");
    const scrim = menuRoot.querySelector<HTMLElement>(".side-menu-scrim");
    if (reduceMotion || !panel || !scrim) {
      menuRoot.remove();
      return;
    }
    panel.classList.add("side-menu-closing");
    scrim.classList.add("side-menu-closing");
    setTimeout(() => menuRoot.remove(), 160);
  };
  // BackButton closes the menu, never navigates away from Home (screen doc's
  // Telegram section: "the only BackButton behaviour on screen 01").
  setBackButtonHandler(close);

  mountSideMenu(menuRoot, {
    ...menuPropsFor(state),
    open: true,
    onClose: close,
    // `onSelect` never closes the menu itself (component doc's Inputs) — the
    // host closes it as part of navigating. `close()` runs first so a row tap
    // starts navigation immediately (component doc's Closing state), not
    // after any animation.
    onSelect: (item) => {
      close();
      handlers.onMenuSelect(item);
    },
  });
}

// D414/U5.2: the one `IntersectionObserver` driving the scroll collapse,
// module-level because Home has a single mount at a time (the shared `#app`
// root, `main.ts`) and every `mount` call — a period change, a retry, this
// very observer firing — needs to find and disconnect its predecessor rather
// than accumulate one per call.
let collapseObserver: IntersectionObserver | null = null;

function disconnectCollapseObserver(): void {
  collapseObserver?.disconnect();
  collapseObserver = null;
}

// Exported for `main.ts` to call when navigating away from Home to any other
// screen: the next screen's own `mount` replaces `#app`'s children wholesale,
// which detaches the sentinel but does not by itself stop the observer from
// still holding it — this unit's AC ("no listener leak across navigations")
// wants that deterministic, not left to next-visit cleanup.
export function unmountHome(): void {
  disconnectCollapseObserver();
}

export function mount(
  root: HTMLElement,
  state: HomeState,
  handlers: HomeHandlers,
  now: Date,
  collapsed = false,
): void {
  if (typeof document === "undefined") {
    return;
  }
  disconnectCollapseObserver();
  root.innerHTML = renderHome(state, now, collapsed);

  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);

  // docs/ui/screens/01-home.md's Telegram section: "impact('medium') on the
  // yellow Add button — the heaviest action on the screen", distinct from
  // every other tap here, which is `selection`.
  root.querySelector('[data-testid="add-button"]')?.addEventListener("click", () => {
    haptics.impact("medium");
    handlers.onAddExpense(dayDateForHandoff(state));
  });

  // docs/ui/screens/01-home.md's Telegram section: "impact('light') on the
  // menu button (V4)" — its own haptic weight, distinct from both the yellow
  // Add button's `medium` and every `selection` tap elsewhere on the screen.
  const menuBtn = root.querySelector<HTMLElement>('[data-testid="menu-button"]');
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      haptics.impact("light");
      openSideMenu(root, menuBtn, state, handlers);
    });
  }

  // The donut itself is display-only (D404) — no click wiring on its
  // `<circle>` elements: no navigation, no haptic, no state change. They are
  // bare SVG shapes with no `tabindex`/`role`, so they're already unfocusable
  // and carry no button semantics at the markup level (renderDonut).
  if (state.status === "ready" || state.status === "offline") {
    // `role="button"`/`tabindex="0"` (render side) need a manual Enter/Space
    // handler — unlike a native <button>, a div doesn't activate on keydown
    // by itself (design-system.md's Accessibility rule: visible focus +
    // reachability on every interactive element; the Focus order in
    // docs/ui/screens/01-home.md lists rows).
    root.querySelectorAll<HTMLElement>('[data-testid="ranked-row"]').forEach((el, index) => {
      const activate = () => {
        const row = state.rows[index];
        if (row) {
          haptics.selection();
          handlers.onRowTap({ categoryId: row.categoryId, label: row.label });
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

  // D414/U5.2: the scroll trigger itself. Only `renderReady`/`renderEmpty`
  // render a sentinel — loading/error/forbidden have nothing to collapse
  // into, so `querySelector` finds nothing there and this is a no-op, same
  // shape as the `menuBtn` guard above. `typeof IntersectionObserver` mirrors
  // the `typeof document` guard this function already opens with: absent
  // under Node (this branch is unreachable in `vitest`, so it stays outside
  // this unit's test coverage the same way `mount` itself already is), and
  // if a real but non-supporting environment ever lacks it, the header
  // simply never appears — indistinguishable from the "too few rows to
  // scroll" edge case the screen doc already specifies as correct.
  const sentinel = root.querySelector<HTMLElement>('[data-testid="collapse-sentinel"]');
  if (sentinel && typeof IntersectionObserver === "function") {
    collapseObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) {
        return;
      }
      // Region 2c starts in the viewport on every mount (the sentinel sits
      // right after it, near the top of the page), so the only way it stops
      // intersecting is by being scrolled past — never by scrolling up past
      // the top, which is exactly the Expanded/Collapsed trigger pair the
      // screen doc states. Re-mounting with the flipped value re-renders
      // `renderReady`/`renderEmpty` (the single source of truth for which
      // ☰ exists, D414/U5.1) and, via the `disconnectCollapseObserver()`
      // call at the top of `mount`, tears this observer down and replaces it
      // with one watching the freshly-rendered sentinel.
      const nextCollapsed = !entry.isIntersecting;
      if (nextCollapsed !== collapsed) {
        mount(root, state, handlers, now, nextCollapsed);
      }
    });
    collapseObserver.observe(sentinel);
  }
}
