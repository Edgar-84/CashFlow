import { afterEach, describe, expect, it } from "vitest";
import { renderPeriodSelector, type PeriodSelectorProps } from "../src/components/period-selector";
import { setLanguage, t } from "../src/lib/i18n";
import type { PeriodUnit, PeriodValue } from "../src/lib/period";

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

  it("with unit: custom, the reserved spacer and jump cell are absent too — no next/previous/present", () => {
    const html = renderPeriodSelector(props({ unit: "custom", offset: 0, start: "2026-07-09", end: "2026-07-17" }));
    expect(html).not.toContain("period-spacer");
    expect(html).not.toContain("period-jump-cell");
    expect(html).not.toContain('data-testid="period-jump"');
  });

  it("the label and the Period tab are both tappable elements distinct from the unit tabs", () => {
    const html = renderPeriodSelector(props({ unit: "day", offset: 0 }));
    expect(html).toContain('data-testid="period-label"');
    expect(html).toContain('data-unit="custom"');
  });
});

describe("renderPeriodSelector — jump to present (reserved cell)", () => {
  it("at offset 0, no jump control is visible but its 44px cell still renders", () => {
    const html = renderPeriodSelector(props({ unit: "month", offset: 0 }));
    expect(html).not.toContain('data-testid="period-jump"');
    expect(html).toContain("period-jump-cell");
  });

  it("at offset -1, a jump control renders immediately to the right of the next arrow", () => {
    const html = renderPeriodSelector(props({ unit: "month", offset: -1 }));
    const nextIdx = html.indexOf('data-testid="period-arrow-next"');
    const jumpIdx = html.indexOf('data-testid="period-jump"');
    expect(nextIdx).toBeGreaterThan(-1);
    expect(jumpIdx).toBeGreaterThan(nextIdx);
  });

  it("the reserved left spacer and the arrow/label/jump-cell structure appear identically at offset 0 and offset -1", () => {
    const at0 = renderPeriodSelector(props({ unit: "month", offset: 0 }));
    const atMinus1 = renderPeriodSelector(props({ unit: "month", offset: -1 }));
    for (const html of [at0, atMinus1]) {
      expect((html.match(/period-spacer/g) ?? []).length).toBe(1);
      expect((html.match(/period-jump-cell/g) ?? []).length).toBe(1);
      expect((html.match(/data-testid="period-arrow-(prev|next)"/g) ?? []).length).toBe(2);
    }
  });

  it("the jump control's accessible name names the unit, per tab", () => {
    const cases: Array<[PeriodUnit, string]> = [
      ["day", "Back to today"],
      ["week", "Back to this week"],
      ["month", "Back to this month"],
      ["year", "Back to this year"],
    ];
    for (const [unit, label] of cases) {
      const html = renderPeriodSelector(props({ unit, offset: -1 }));
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it("the jump control renders via the same --ink-only .period-arrow styling, never --accent", () => {
    const html = renderPeriodSelector(props({ unit: "year", offset: -1 }));
    expect(html).toContain('class="period-arrow period-jump"');
    expect(html).not.toContain("--accent");
  });
});

describe("renderPeriodSelector — disabled (offline)", () => {
  it("disables every tab and arrow and marks the container disabled", () => {
    const html = renderPeriodSelector(props({ unit: "month", offset: -1 }, { disabled: true }));
    expect(html).toMatch(/class="period-selector disabled"/);
    expect((html.match(/ disabled/g) ?? []).length).toBe(1 + 5 + 2 + 1 + 1); // container + 5 tabs + 2 arrows + label + jump (offset -1 renders it)
  });

  it("omitting disabled behaves as not disabled", () => {
    const html = renderPeriodSelector(props({ unit: "month", offset: -1 }));
    expect(html).not.toContain("disabled");
  });
});

// -- i18n (U3.10) --------------------------------------------------------

describe("renders in Russian", () => {
  afterEach(() => setLanguage("en"));

  it("translates the tabs, the label aria-name, the arrows and the jump control", () => {
    setLanguage("ru");
    const html = renderPeriodSelector(props({ unit: "month", offset: -1 }));
    for (const key of [
      "periodSelector.tab.day",
      "periodSelector.tab.week",
      "periodSelector.tab.month",
      "periodSelector.tab.year",
      "periodSelector.tab.custom",
    ] as const) {
      expect(html).toContain(t(key));
    }
    expect(html).toContain(`aria-label="${t("periodSelector.aria.label")}"`);
    expect(html).toContain(t("periodSelector.aria.prev").replace("{unit}", t("periodSelector.unit.month")));
    expect(html).toContain(t("periodSelector.aria.next").replace("{unit}", t("periodSelector.unit.month")));
    expect(html).toContain(`aria-label="${t("periodSelector.aria.jump.month")}"`);
  });
});
