/** Period selection — pure, no DOM, no I/O. `toQuery`/`describe`/`monthGrid`
 * treat every `Date` as local wall-clock and every `YYYY-MM-DD` string as a
 * plain calendar date: **no function here converts a date to a UTC instant**
 * (no `Date.UTC`, no `toISOString`, no `new Date("YYYY-MM-DD")` — the latter
 * parses as UTC midnight per the JS spec, the same class of bug as D120).
 * The backend resolves the actual period bounds in `family_tz`; this module
 * only picks a selector and renders a label.
 */

export type PeriodUnit = "day" | "week" | "month" | "year" | "custom";

export interface PeriodValue {
  unit: PeriodUnit;
  offset: number; // <= 0 always; ignored when unit === "custom"
  start?: string; // YYYY-MM-DD, custom only
  end?: string; // YYYY-MM-DD, inclusive, custom only
}

export interface PeriodQuery {
  period: PeriodUnit;
  offset?: number;
  start_date?: string;
  end_date?: string;
}

export interface MonthGridDay {
  date: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
}

// Mirrors services/period.py's MAX_RANGE_DAYS — the backend is the source of
// truth; this is a client-side hint so a doomed custom range never round-trips.
export const MAX_RANGE_DAYS = 366;

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

export function toQuery(value: PeriodValue): PeriodQuery {
  if (value.unit === "custom") {
    return { period: "custom", start_date: value.start, end_date: value.end };
  }
  return { period: value.unit, offset: value.offset };
}

export function describe(value: PeriodValue, now: Date): string {
  switch (value.unit) {
    case "day":
      return describeDay(now, value.offset);
    case "week":
      return describeWeek(now, value.offset);
    case "month":
      return describeMonth(now, value.offset);
    case "year":
      return describeYear(now, value.offset);
    case "custom":
      return formatRange(parseDateString(value.start!), parseDateString(value.end!));
  }
}

export function monthGrid(year: number, month: number): MonthGridDay[][] {
  const first = new Date(year, month - 1, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // Monday = 0 .. Sunday = 6
  let cursor = addDays(first, -firstWeekday);

  const weeks: MonthGridDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: MonthGridDay[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        date: toDateString(cursor),
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month - 1 && cursor.getFullYear() === year,
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function clampOffset(n: number): number {
  return Math.min(n, 0);
}

export function isValidRange(start: string, end: string): boolean {
  const s = parseDateString(start);
  const e = parseDateString(end);
  if (e.getTime() < s.getTime()) {
    return false;
  }
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  return days <= MAX_RANGE_DAYS;
}

function describeDay(now: Date, offset: number): string {
  const d = addDays(now, offset);
  const monthDay = `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
  if (d.getFullYear() !== now.getFullYear()) {
    return `${monthDay}, ${d.getFullYear()}`;
  }
  if (offset === 0) {
    return `Today, ${monthDay}`;
  }
  if (offset === -1) {
    return `Yesterday, ${monthDay}`;
  }
  return monthDay;
}

function describeWeek(now: Date, offset: number): string {
  if (offset === 0) {
    return "This week";
  }
  const start = addDays(mondayOf(now), offset * 7);
  const end = addDays(start, 6);
  return formatRange(start, end);
}

function describeMonth(now: Date, offset: number): string {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  if (d.getFullYear() === now.getFullYear()) {
    return MONTH_NAMES[d.getMonth()];
  }
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function describeYear(now: Date, offset: number): string {
  return String(now.getFullYear() + offset);
}

function formatRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getDate()} – ${end.getDate()} ${MONTH_ABBR[start.getMonth()]}`;
  }
  if (sameYear) {
    return `${start.getDate()} ${MONTH_ABBR[start.getMonth()]} – ${end.getDate()} ${MONTH_ABBR[end.getMonth()]}`;
  }
  return `${start.getDate()} ${MONTH_ABBR[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()} ${MONTH_ABBR[end.getMonth()]} ${end.getFullYear()}`;
}

function mondayOf(d: Date): Date {
  const weekday = (d.getDay() + 6) % 7; // Monday = 0 .. Sunday = 6
  return addDays(d, -weekday);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateString(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
