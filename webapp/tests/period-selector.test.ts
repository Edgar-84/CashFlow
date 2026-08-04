import { describe, expect, it } from "vitest";
import { renderPeriodSelector, type PeriodSelectorProps } from "../src/components/period-selector";
import type { PeriodValue } from "../src/lib/period";

const NOW = new Date(2026, 7, 4); // Tuesday, August 4 2026 — matches period.test.ts's fixture

const NOOP = (): void => {};

function props(value: PeriodValue, overrides: Partial<PeriodSelectorProps> = {}): PeriodSelectorProps {
  return {
    value,
    now: NOW,
    onUnitChange: NOOP,
    onOffsetChange: NOOP,
    onOpenPicker: NOOP,
    ...overrides,
  };
}

// vitest.config's `environment: "node"` means `document` is undefined here,
// same as every screen's `mount` — so this suite covers `renderPeriodSelector`
// only. `mount`'s click wiring (which callback fires for which tap) is the
// same accepted, code-reviewed-not-unit-tested gap every screen's `mount`
// already carries; it gets its first live exercise when U1.5 wires this
// component into Home.

describe("renderPeriodSelector — tabs", () => {
  it("renders exactly five tabs reading Day, Week, Month, Year, Period, in that order", () => {
    const html = renderPeriodSelector(props({ unit: "month", offset: 0 }));
    const order = ["Day", "Week", "Month", "Year", "Period"];
    const indices = order.map((label) => html.indexOf(`>${label}<`));
    expect(indices.every((i) => i >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect((html.match(/role="tab"/g) ?? []).length).toBe(5);
  });

  it("marks only the active unit's tab as active/aria-selected, the rest inactive", () => {
    const html = renderPeriodSelector(props({ unit: "week", offset: 0 }));
    expect(html).toMatch(/class="period-tab active"[^>]*aria-selected="true"[^>]*data-unit="week"/);
    for (const unit of ["day", "month", "year", "custom"]) {
      expect(html).toMatch(new RegExp(`class="period-tab"[^>]*aria-selected="false"[^>]*data-unit="${unit}"`));
    }
    expect((html.match(/ active/g) ?? []).length).toBe(1);
  });

  it("never renders --accent or a category colour anywhere", () => {
    const html = renderPeriodSelector(props({ unit: "day", offset: -1 }));
    expect(html).not.toContain("--accent");
    expect(html).not.toContain("category-slot");
  });
});

describe("renderPeriodSelector — nav row", () => {
  it("at offset 0, the next arrow is present and aria-disabled", () => {
    const html = renderPeriodSelector(props({ unit: "month", offset: 0 }));
    expect(html).toContain('data-testid="period-arrow-next"');
    expect(html).toContain('aria-disabled="true" data-testid="period-arrow-next"');
  });

  it("at offset -1, both arrows are present with neither aria-disabled", () => {
    const html = renderPeriodSelector(props({ unit: "month", offset: -1 }));
    expect(html).toContain('data-testid="period-arrow-prev"');
    expect(html).toContain('data-testid="period-arrow-next"');
    expect(html).not.toContain("aria-disabled");
  });

  it("with unit: custom, both arrows are absent and the label shows the range", () => {
    const html = renderPeriodSelector(props({ unit: "custom", offset: 0, start: "2026-07-09", end: "2026-07-17" }));
    expect(html).not.toContain('data-testid="period-arrow-prev"');
    expect(html).not.toContain('data-testid="period-arrow-next"');
    expect(html).toContain("9 – 17 Jul");
  });

  it("the label and the Period tab are both tappable elements distinct from the unit tabs", () => {
    const html = renderPeriodSelector(props({ unit: "day", offset: 0 }));
    expect(html).toContain('data-testid="period-label"');
    expect(html).toContain('data-unit="custom"');
  });
});

describe("renderPeriodSelector — disabled (offline)", () => {
  it("disables every tab and arrow and marks the container disabled", () => {
    const html = renderPeriodSelector(props({ unit: "month", offset: -1 }, { disabled: true }));
    expect(html).toMatch(/class="period-selector disabled"/);
    expect((html.match(/ disabled/g) ?? []).length).toBe(1 + 5 + 2 + 1); // container + 5 tabs + 2 arrows + label
  });

  it("omitting disabled behaves as not disabled", () => {
    const html = renderPeriodSelector(props({ unit: "month", offset: -1 }));
    expect(html).not.toContain("disabled");
  });
});
