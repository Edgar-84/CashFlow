import { describe, expect, it } from "vitest";
import {
  nextRangeSelection,
  quickRange,
  renderDateRangePicker,
  renderMonthSection,
  type DateRangePickerProps,
  type DateRangePickerValue,
} from "../src/components/date-range-picker";

// Tuesday, August 4 2026 — matches period.test.ts / period-selector.test.ts's fixture.
const MAX_DATE = "2026-08-04";

const NOOP = (): void => {};

function props(overrides: Partial<DateRangePickerProps> = {}): DateRangePickerProps {
  return {
    mode: "range",
    value: {},
    maxDate: MAX_DATE,
    maxRangeDays: 366,
    onChange: NOOP,
    onApply: NOOP,
    onCancel: NOOP,
    ...overrides,
  };
}

// vitest.config's `environment: "node"` means `document` is undefined here,
// same as every screen's and `period-selector`'s `mount` — so this suite
// covers the pure render functions and pure selection/range logic only.
// `mount`'s DOM wiring (which callback fires for which tap, scrim/cancel/
// Apply/quick-chip/cell clicks, lazy month loading on scroll, the year-list
// jump, Escape-to-close, initial scroll-into-view) is the same accepted,
// code-reviewed-not-unit-tested gap every `mount` in this codebase carries.

describe("renderDateRangePicker — default state", () => {
  it("opens scrolled to the current month (rendered first) with today ringed", () => {
    const html = renderDateRangePicker(props());
    const monthsHtml = html.slice(html.indexOf('data-testid="drp-months"'));
    expect(monthsHtml.indexOf('data-testid="drp-month-2026-08"')).toBeLessThan(
      monthsHtml.indexOf('data-testid="drp-month-2026-07"'),
    );
    expect(html).toMatch(/class="drp-cell drp-cell-today" data-date="2026-08-04"/);
  });

  it("shows the 'choose a start date' summary and a disabled Apply with nothing selected", () => {
    const html = renderDateRangePicker(props());
    expect(html).toContain('data-testid="drp-summary">Choose a start date<');
    expect(html).toMatch(/class="drp-apply" data-testid="drp-apply" disabled>Apply/);
  });
});

describe("renderDateRangePicker — selection states", () => {
  it("start chosen: that cell is filled, the summary names it, Apply stays disabled", () => {
    const html = renderDateRangePicker(props({ value: { start: "2026-07-09" } }));
    expect(html).toContain('data-testid="drp-summary">from 9 Jul 2026<');
    expect(html).toMatch(/class="drp-cell drp-cell-start" data-date="2026-07-09"/);
    expect(html).toMatch(/data-testid="drp-apply" disabled/);
  });

  it("range chosen: span highlighted inclusively, summary shows both, Apply enabled", () => {
    const html = renderDateRangePicker(props({ value: { start: "2026-07-05", end: "2026-07-08" } }));
    expect(html).toContain('data-testid="drp-summary">from 5 Jul to 8 Jul 2026<');
    expect(html).toMatch(/class="drp-cell drp-cell-start" data-date="2026-07-05"/);
    expect(html).toMatch(/class="drp-cell drp-cell-in-range" data-date="2026-07-06"/);
    expect(html).toMatch(/class="drp-cell drp-cell-in-range" data-date="2026-07-07"/);
    expect(html).toMatch(/class="drp-cell drp-cell-end" data-date="2026-07-08"/);
    expect(html).not.toMatch(/data-testid="drp-apply" disabled/);
  });

  it("start === end renders as a single filled cell, not start+end", () => {
    const html = renderDateRangePicker(props({ value: { start: "2026-07-20", end: "2026-07-20" } }));
    expect(html).toMatch(/class="drp-cell drp-cell-single" data-date="2026-07-20"/);
    expect(html).not.toContain("drp-cell-start");
    expect(html).not.toContain("drp-cell-end");
  });

  it("a range spanning different years shows both years in the summary", () => {
    const html = renderDateRangePicker(props({ value: { start: "2025-12-30", end: "2026-01-02" } }));
    expect(html).toContain('data-testid="drp-summary">from 30 Dec 2025 to 2 Jan 2026<');
  });

  it("a selection several months in the past still renders inside the eager window", () => {
    const html = renderDateRangePicker(props({ value: { start: "2026-05-01", end: "2026-05-03" } }));
    expect(html).toContain('data-testid="drp-month-2026-05"');
    expect(html).toMatch(/class="drp-cell drp-cell-start" data-date="2026-05-01"/);
  });

  it("a selection years in the past does NOT grow the eager window (D333: mount's lazy load catches it up, not the pure render)", () => {
    const html = renderDateRangePicker(props({ value: { start: "2023-01-01", end: "2023-01-03" } }));
    expect(html).not.toContain("drp-month-2023-01");
    expect(html).not.toContain('data-date="2023-01-01"');
  });
});

describe("renderDateRangePicker — over-length range", () => {
  it("a span over 366 days is drawn but shows the reason and keeps Apply disabled", () => {
    const html = renderDateRangePicker(
      props({ value: { start: "2025-01-01", end: "2026-06-01" }, maxDate: "2026-06-01" }),
    );
    expect(html).toContain("Choose a range of up to 366 days.");
    expect(html).toContain('class="drp-summary drp-summary-error"');
    expect(html).toMatch(/data-testid="drp-apply" disabled/);
    // still drawn: some day strictly between the ends is in-range
    expect(html).toContain("drp-cell-in-range");
  });

  it("names the caller's maxRangeDays, not a hardcoded 366", () => {
    const html = renderDateRangePicker(
      props({ value: { start: "2026-01-01", end: "2026-03-01" }, maxRangeDays: 30 }),
    );
    expect(html).toContain("Choose a range of up to 30 days.");
  });
});

describe("renderDateRangePicker — future dates", () => {
  it("dates after maxDate are dimmed, disabled, and carry no data-date to tap", () => {
    const html = renderDateRangePicker(props());
    expect(html).toMatch(/class="drp-cell drp-cell-future" disabled aria-disabled="true" aria-label="5 August 2026">5</);
    expect(html).not.toMatch(/drp-cell-future"[^>]*data-date/);
  });

  it("maxDate itself is selectable, not future", () => {
    const html = renderDateRangePicker(props());
    expect(html).toMatch(/data-testid="drp-cell-2026-08-04"/);
  });
});

describe("renderDateRangePicker — single mode", () => {
  it("has no footer, no summary and no quick chips", () => {
    const html = renderDateRangePicker(props({ mode: "single", value: { start: "2026-08-01" } }));
    expect(html).not.toContain("drp-footer");
    expect(html).not.toContain("drp-summary");
    expect(html).not.toContain("drp-quick-chip");
    expect(html).toContain('data-testid="drp-cell-2026-08-01"');
  });

  it("title reads 'Select date', not 'Select period'", () => {
    const html = renderDateRangePicker(props({ mode: "single" }));
    expect(html).toContain('class="drp-title">Select date<');
  });
});

describe("renderDateRangePicker — range mode chrome", () => {
  it("has a title, quick chips and a footer", () => {
    const html = renderDateRangePicker(props());
    expect(html).toContain('class="drp-title">Select period<');
    expect(html).toContain('data-testid="drp-quick-week7"');
    expect(html).toContain('data-testid="drp-quick-days30"');
    expect(html).toContain('data-testid="drp-quick-month"');
    expect(html).toContain('data-testid="drp-footer"');
  });

  it("weekday header reads Monday through Sunday, in that order", () => {
    const html = renderDateRangePicker(props());
    const header = html.slice(html.indexOf('class="drp-weekday-header"'), html.indexOf('data-testid="drp-months"'));
    const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const indices = order.map((d) => header.indexOf(`>${d}<`));
    expect(indices.every((i) => i >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("never renders --accent or a category colour", () => {
    const html = renderDateRangePicker(props({ value: { start: "2026-08-05", end: "2026-08-08" } }));
    expect(html).not.toContain("--accent");
    expect(html).not.toContain("category-slot");
  });
});

describe("renderMonthSection — grid shape", () => {
  it("every month is 6 weeks regardless of its length, so scrolling never jumps", () => {
    const shortMonth = renderMonthSection(2026, 2, {}, MAX_DATE); // February
    const longMonth = renderMonthSection(2026, 1, {}, MAX_DATE); // January
    expect((shortMonth.match(/class="drp-week"/g) ?? []).length).toBe(6);
    expect((longMonth.match(/class="drp-week"/g) ?? []).length).toBe(6);
  });

  it("leading/trailing days from the other month render as blank, not tappable cells", () => {
    const html = renderMonthSection(2026, 8, {}, MAX_DATE); // August 2026 starts on a Saturday
    expect(html).toContain('class="drp-cell drp-cell-blank"');
    expect((html.match(/drp-cell-blank/g) ?? []).length).toBeGreaterThan(0);
  });

  it("weeks start Monday, matching resolve_period", () => {
    // August 1 2026 is a Saturday: Monday-start leaves Mon-Fri blank (other
    // month, not rendered per the component doc) before day 1 lands in the
    // Saturday column.
    const html = renderMonthSection(2026, 8, {}, MAX_DATE);
    const firstWeek = html.slice(html.indexOf('class="drp-grid"'), html.indexOf("2026-08-01"));
    expect((firstWeek.match(/drp-cell-blank/g) ?? []).length).toBe(5);
  });

  it("each cell's accessible name is its full date, never the bare number", () => {
    const html = renderMonthSection(2026, 8, {}, MAX_DATE);
    expect(html).toContain('aria-label="4 August 2026"');
    expect(html).toContain('data-testid="drp-cell-2026-08-04">4</button>');
  });

  it("month name is a tappable button naming the month and year", () => {
    const html = renderMonthSection(2026, 8, {}, MAX_DATE);
    expect(html).toMatch(/<button type="button" class="drp-month-name">August 2026<\/button>/);
  });
});

describe("nextRangeSelection — tap state machine", () => {
  it("the first tap from empty sets the start and leaves end unset", () => {
    expect(nextRangeSelection({}, "2026-08-05")).toEqual({ start: "2026-08-05", end: undefined });
  });

  it("a second tap after the start sets the end, span inclusive of both", () => {
    expect(nextRangeSelection({ start: "2026-08-05" }, "2026-08-10")).toEqual({
      start: "2026-08-05",
      end: "2026-08-10",
    });
  });

  it("a second tap on the same day as the start produces a single-day range", () => {
    expect(nextRangeSelection({ start: "2026-08-05" }, "2026-08-05")).toEqual({
      start: "2026-08-05",
      end: "2026-08-05",
    });
  });

  it("a second tap before the start re-anchors instead of producing a reversed range", () => {
    const next: DateRangePickerValue = nextRangeSelection({ start: "2026-08-10" }, "2026-08-05");
    expect(next).toEqual({ start: "2026-08-05", end: undefined });
  });

  it("a tap once a full range is already chosen starts fresh", () => {
    const next = nextRangeSelection({ start: "2026-08-01", end: "2026-08-10" }, "2026-08-15");
    expect(next).toEqual({ start: "2026-08-15", end: undefined });
  });
});

describe("quickRange", () => {
  it("Last 7 days spans maxDate and the six days before it, inclusive", () => {
    expect(quickRange("week7", MAX_DATE)).toEqual({ start: "2026-07-29", end: "2026-08-04" });
  });

  it("Last 30 days spans maxDate and the 29 days before it, inclusive", () => {
    expect(quickRange("days30", MAX_DATE)).toEqual({ start: "2026-07-06", end: "2026-08-04" });
  });

  it("This month spans the 1st of maxDate's month through maxDate", () => {
    expect(quickRange("month", MAX_DATE)).toEqual({ start: "2026-08-01", end: "2026-08-04" });
  });
});
