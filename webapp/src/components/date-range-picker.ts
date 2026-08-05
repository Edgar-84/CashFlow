/** Component: Date range picker (docs/ui/components/date-range-picker.md). The
 * calendar sheet (D303) — a bottom sheet over a scrim, hand-rolled month
 * grid, no dependency. Pure render + thin mount, same shape as
 * `period-selector.ts`. `maxDate` doubles as "today" (it is always the
 * caller's today in `family_tz`) so the module never calls `new Date()`; the
 * host derives it once and passes it in, same reasoning as `period-selector`'s
 * `now` prop (D327). Every `Date` here is local wall-clock and every
 * `YYYY-MM-DD` string a plain calendar date — no `Date.UTC`, no
 * `toISOString`, no `new Date("YYYY-MM-DD")` (D120's bug class).
 */

import { monthGrid, type MonthGridDay } from "../lib/period";
import { haptics } from "../lib/telegram";

export type DateRangePickerMode = "range" | "single";

export interface DateRangePickerValue {
  start?: string; // YYYY-MM-DD
  end?: string; // YYYY-MM-DD, inclusive
}

export interface DateRangePickerProps {
  mode: DateRangePickerMode;
  value: DateRangePickerValue;
  maxDate: string; // YYYY-MM-DD, today in family_tz — never computed here
  maxRangeDays: number;
  onChange(next: DateRangePickerValue): void;
  onApply(range: { start: string; end: string }): void;
  onCancel(): void;
}

type QuickRangeKind = "week7" | "days30" | "month";

// The initial window rendered eagerly; scrolling near the top (mount) and
// the year list both extend further back on demand — "no fixed window" per
// the component doc's Resolved section, without pre-rendering years of DOM
// no one has scrolled to yet.
const INITIAL_MONTHS_BACK = 11; // 12 months total including the current one
const LAZY_LOAD_BATCH = 6;
// Not in the component doc (which only says "the month heading opens a year
// list", no bound) — an explicit, documented judgment call so the list is
// finite. See plan Decision log D3xx.
const YEAR_LIST_YEARS_BACK = 30;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));
const WEEKDAY_HEADER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// -- pure date-string helpers (mirrors lib/period.ts's private ones; each
//    pure module in this codebase owns its own rather than sharing) --------

function parseDateString(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}

function monthsBetween(a: { year: number; month: number }, b: { year: number; month: number }): number {
  return (b.year * 12 + (b.month - 1)) - (a.year * 12 + (a.month - 1));
}

// -- pure selection / range logic (unit-testable, no DOM) -------------------

/** First tap sets the start and clears any end; a second tap before the
 * start re-anchors instead of reversing; any tap once a full range (or none)
 * is already chosen starts fresh. */
export function nextRangeSelection(current: DateRangePickerValue, tapped: string): DateRangePickerValue {
  if (!current.start || current.end) {
    return { start: tapped, end: undefined };
  }
  if (tapped < current.start) {
    return { start: tapped, end: undefined };
  }
  return { start: current.start, end: tapped };
}

function spanDays(start: string, end: string): number {
  const s = parseDateString(start);
  const e = parseDateString(end);
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
}

/** `lib/period.ts`'s `isValidRange` hardcodes its own `MAX_RANGE_DAYS` — not
 * usable here, since this component's `maxRangeDays` is caller-supplied
 * (component doc's Inputs section). */
export function isRangeValid(start: string, end: string, maxRangeDays: number): boolean {
  return spanDays(start, end) >= 1 && spanDays(start, end) <= maxRangeDays;
}

export function quickRange(kind: QuickRangeKind, maxDate: string): DateRangePickerValue {
  const max = parseDateString(maxDate);
  switch (kind) {
    case "week7":
      return { start: toDateString(addDays(max, -6)), end: maxDate };
    case "days30":
      return { start: toDateString(addDays(max, -29)), end: maxDate };
    case "month": {
      const y = max.getFullYear();
      const m = String(max.getMonth() + 1).padStart(2, "0");
      return { start: `${y}-${m}-01`, end: maxDate };
    }
  }
}

function formatDate(d: Date, includeYear: boolean): string {
  const base = `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
  return includeYear ? `${base} ${d.getFullYear()}` : base;
}

function formatSummary(value: DateRangePickerValue): string {
  if (!value.start) {
    return "Choose a start date";
  }
  if (!value.end) {
    return `from ${formatDate(parseDateString(value.start), true)}`;
  }
  const start = parseDateString(value.start);
  const end = parseDateString(value.end);
  const sameYear = start.getFullYear() === end.getFullYear();
  return `from ${formatDate(start, !sameYear)} to ${formatDate(end, true)}`;
}

// -- HTML escaping (mirrors period-selector.ts) ------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// -- pure per-cell / per-month rendering -------------------------------------

function cellStatus(
  day: MonthGridDay,
  value: DateRangePickerValue,
  maxDate: string,
): "future" | "today" | "start" | "end" | "single" | "in-range" | "default" {
  if (day.date > maxDate) {
    return "future";
  }
  const isStart = day.date === value.start;
  const isEnd = day.date === value.end;
  if (isStart && isEnd) {
    return "single";
  }
  if (isStart) {
    return "start";
  }
  if (isEnd) {
    return "end";
  }
  if (value.start && value.end && day.date > value.start && day.date < value.end) {
    return "in-range";
  }
  if (day.date === maxDate) {
    return "today";
  }
  return "default";
}

function renderCell(day: MonthGridDay, value: DateRangePickerValue, maxDate: string): string {
  if (!day.inMonth) {
    return '<div class="drp-cell drp-cell-blank"></div>';
  }
  const status = cellStatus(day, value, maxDate);
  const d = parseDateString(day.date);
  const fullLabel = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  const todayClass = status !== "future" && day.date === maxDate ? " drp-cell-today" : "";
  if (status === "future") {
    return `<button type="button" class="drp-cell drp-cell-future${todayClass}" disabled aria-disabled="true" aria-label="${escapeHtml(fullLabel)}">${day.day}</button>`;
  }
  const statusClass = status === "default" || status === "today" ? "" : ` drp-cell-${status}`;
  return `<button type="button" class="drp-cell${statusClass}${todayClass}" data-date="${day.date}" aria-label="${escapeHtml(fullLabel)}" data-testid="drp-cell-${day.date}">${day.day}</button>`;
}

/** One month's heading + grid. Exported so `mount()` can build additional
 * months on demand (lazy back-scroll, year jumps) with the exact same markup
 * `renderDateRangePicker` uses for its initial window. */
export function renderMonthSection(
  year: number,
  month: number,
  value: DateRangePickerValue,
  maxDate: string,
): string {
  const weeks = monthGrid(year, month);
  const rows = weeks
    .map((week) => `<div class="drp-week">${week.map((day) => renderCell(day, value, maxDate)).join("")}</div>`)
    .join("");
  const name = `${MONTH_NAMES[month - 1]} ${year}`;
  return `<section class="drp-month" data-testid="drp-month-${year}-${String(month).padStart(2, "0")}">
    <button type="button" class="drp-month-name">${escapeHtml(name)}</button>
    <div class="drp-grid">${rows}</div>
  </section>`;
}

function renderWeekdayHeader(): string {
  return `<div class="drp-weekday-header">${WEEKDAY_HEADER.map((w) => `<div class="drp-weekday">${w}</div>`).join("")}</div>`;
}

function renderQuickChips(): string {
  const chips: Array<{ kind: QuickRangeKind; label: string }> = [
    { kind: "week7", label: "Last 7 days" },
    { kind: "days30", label: "Last 30 days" },
    { kind: "month", label: "This month" },
  ];
  return `<div class="drp-quick-chips">${chips
    .map((c) => `<button type="button" class="drp-quick-chip" data-quick="${c.kind}" data-testid="drp-quick-${c.kind}">${c.label}</button>`)
    .join("")}</div>`;
}

function renderYearList(maxDate: string): string {
  const currentYear = parseDateString(maxDate).getFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= currentYear - YEAR_LIST_YEARS_BACK; y--) {
    years.push(y);
  }
  return `<div class="drp-year-list" data-testid="drp-year-list">${years
    .map((y) => `<button type="button" class="drp-year" data-year="${y}" data-testid="drp-year-${y}">${y}</button>`)
    .join("")}</div>`;
}

function renderMonths(value: DateRangePickerValue, maxDate: string): string {
  const max = parseDateString(maxDate);
  const current = { year: max.getFullYear(), month: max.getMonth() + 1 };
  // Fixed, small window (D333) — a reopened value further back than this is
  // caught up by `mount()`'s batch-append, the same mechanism the year-list
  // jump uses, not by growing this pure function's output unboundedly.
  const sections: string[] = [];
  for (let i = 0; i <= INITIAL_MONTHS_BACK; i++) {
    const { year, month } = addMonths(current.year, current.month, -i);
    sections.push(renderMonthSection(year, month, value, maxDate));
  }
  return sections.join("");
}

// -- top-level pure render ----------------------------------------------------

export function renderDateRangePicker(props: DateRangePickerProps): string {
  const { mode, value, maxDate, maxRangeDays } = props;
  const isRange = mode === "range";
  const rangeTooLong = Boolean(value.start && value.end) && !isRangeValid(value.start!, value.end!, maxRangeDays);
  const applyDisabled = !isRange || !value.start || !value.end || rangeTooLong;

  const summary = rangeTooLong
    ? `Choose a range of up to ${maxRangeDays} days.`
    : formatSummary(value);

  return `<div class="drp-root" data-testid="drp-root">
    <div class="drp-scrim" data-testid="drp-scrim"></div>
    <div class="drp-sheet" role="dialog" aria-modal="true" aria-label="Select period" data-testid="drp-sheet">
      <div class="drp-title">${isRange ? "Select period" : "Select date"}</div>
      ${isRange ? `<div class="drp-summary${rangeTooLong ? " drp-summary-error" : ""}" data-testid="drp-summary">${escapeHtml(summary)}</div>` : ""}
      ${isRange ? renderQuickChips() : ""}
      ${renderWeekdayHeader()}
      <div class="drp-months" data-testid="drp-months">${renderMonths(value, maxDate)}</div>
      ${renderYearList(maxDate)}
      ${
        isRange
          ? `<div class="drp-footer" data-testid="drp-footer">
        <button type="button" class="drp-cancel" data-testid="drp-cancel">Cancel</button>
        <button type="button" class="drp-apply" data-testid="drp-apply"${applyDisabled ? " disabled" : ""}>Apply</button>
      </div>`
          : ""
      }
    </div>
  </div>`;
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every screen's and `period-selector`'s mount) ----------

export function mount(root: HTMLElement, props: DateRangePickerProps): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderDateRangePicker(props);

  const sheet = root.querySelector<HTMLElement>('[data-testid="drp-sheet"]');
  const monthsEl = root.querySelector<HTMLElement>('[data-testid="drp-months"]');
  const yearList = root.querySelector<HTMLElement>('[data-testid="drp-year-list"]');

  const close = (): void => {
    haptics.selection();
    props.onCancel();
  };

  root.querySelector('[data-testid="drp-scrim"]')?.addEventListener("click", close);
  root.querySelector('[data-testid="drp-cancel"]')?.addEventListener("click", close);

  root.querySelector('[data-testid="drp-apply"]')?.addEventListener("click", () => {
    if (!props.value.start || !props.value.end || !isRangeValid(props.value.start, props.value.end, props.maxRangeDays)) {
      return;
    }
    haptics.impact("medium");
    props.onApply({ start: props.value.start, end: props.value.end });
  });

  root.querySelectorAll<HTMLElement>("[data-quick]").forEach((el) => {
    el.addEventListener("click", () => {
      haptics.selection();
      props.onChange(quickRange(el.dataset.quick as QuickRangeKind, props.maxDate));
    });
  });

  // Delegated on `monthsEl`, not bound per-element: `prependMonth` (lazy
  // back-scroll load and the year-list jump, below) inserts further `.drp-cell`
  // and `.drp-month-name` elements after this point, and a one-shot
  // `querySelectorAll(...).forEach(...)` would never wire those up.
  monthsEl?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>("[data-date]");
    if (cell) {
      const date = cell.dataset.date!;
      haptics.selection();
      if (props.mode === "single") {
        props.onChange({ start: date, end: date });
        props.onApply({ start: date, end: date });
        return;
      }
      props.onChange(nextRangeSelection(props.value, date));
      return;
    }
    if (target.closest(".drp-month-name")) {
      haptics.selection();
      yearList?.classList.toggle("open");
    }
  });

  root.querySelectorAll<HTMLElement>("[data-year]").forEach((el) => {
    el.addEventListener("click", () => {
      haptics.selection();
      const targetYear = Number(el.dataset.year);
      if (!monthsEl) {
        return;
      }
      let oldest = oldestRenderedMonth(monthsEl);
      while (oldest && oldest.year > targetYear) {
        oldest = prependMonth(monthsEl, oldest, props);
      }
      yearList?.classList.remove("open");
      monthsEl.querySelector(`[data-testid^="drp-month-${targetYear}-"]`)?.scrollIntoView({ block: "start" });
    });
  });

  monthsEl?.addEventListener("scroll", () => {
    if (!monthsEl) {
      return;
    }
    // Months render current-first, oldest-last (renderMonths), so the oldest
    // rendered month sits at the *bottom* of the scroll container — extend
    // when the user nears that end, not the top.
    const nearOldestEnd = monthsEl.scrollHeight - monthsEl.scrollTop - monthsEl.clientHeight <= 100;
    if (!nearOldestEnd) {
      return;
    }
    let oldest = oldestRenderedMonth(monthsEl);
    for (let i = 0; i < LAZY_LOAD_BATCH && oldest; i++) {
      oldest = prependMonth(monthsEl, oldest, props);
    }
  });

  sheet?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    }
  });

  // Reopened with a range already applied (component doc's States table) —
  // extend the eager window down to cover it, the same batch-append the
  // year-list jump uses, rather than growing the pure render's default
  // window (D333: that stays a fixed, small, testable size).
  if (monthsEl && props.value.start) {
    const startMonth = { year: Number(props.value.start.slice(0, 4)), month: Number(props.value.start.slice(5, 7)) };
    let oldest = oldestRenderedMonth(monthsEl);
    while (oldest && monthsBetween(startMonth, oldest) > 0) {
      oldest = prependMonth(monthsEl, oldest, props);
    }
    monthsEl
      .querySelector<HTMLElement>(`[data-testid^="drp-month-${props.value.start.slice(0, 4)}-${props.value.start.slice(5, 7)}"]`)
      ?.scrollIntoView({ block: "start" });
  }
}

function oldestRenderedMonth(monthsEl: HTMLElement): { year: number; month: number } | null {
  const sections = monthsEl.querySelectorAll<HTMLElement>(".drp-month");
  const last = sections.item(sections.length - 1);
  const testid = last?.dataset.testid; // drp-month-YYYY-MM
  if (!testid) {
    return null;
  }
  const [, , year, month] = testid.split("-");
  return { year: Number(year), month: Number(month) };
}

function prependMonth(
  monthsEl: HTMLElement,
  oldest: { year: number; month: number },
  props: DateRangePickerProps,
): { year: number; month: number } {
  const prev = addMonths(oldest.year, oldest.month, -1);
  const html = renderMonthSection(prev.year, prev.month, props.value, props.maxDate);
  monthsEl.insertAdjacentHTML("beforeend", html);
  return prev;
}
