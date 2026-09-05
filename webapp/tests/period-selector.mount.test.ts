// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type PeriodSelectorProps } from "../src/components/period-selector";
import { haptics } from "../src/lib/telegram";
import type { PeriodValue } from "../src/lib/period";

// mount()'s click wiring is otherwise an accepted, not-unit-tested gap (see
// period-selector.test.ts) — this file exists only to pin down one thing the
// Restricted variant (V8, U3.2) depends on: a native `disabled` tab must not
// fire its host callback on tap. jsdom (like a real browser) never dispatches
// a click event for `.click()` on a disabled button, so this doubles as proof
// the render-level `disabled` attribute is sufficient — no extra JS guard
// needed in the handler itself.

const NOW = new Date(2026, 7, 4);

function props(value: PeriodValue, overrides: Partial<PeriodSelectorProps> = {}): PeriodSelectorProps {
  return {
    value,
    now: NOW,
    onUnitChange: vi.fn(),
    onOffsetChange: vi.fn(),
    onOpenPicker: vi.fn(),
    ...overrides,
  };
}

describe("mount — restricted tabs (V8, U3.2)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tapping a restricted tab is a no-op: no onUnitChange call, no haptic", () => {
    const onUnitChange = vi.fn();
    const selectionSpy = vi.spyOn(haptics, "selection");
    const root = document.createElement("div");
    mount(root, props({ unit: "month", offset: 0 }, { allowedUnits: ["month"], onUnitChange }));

    const yearTab = root.querySelector<HTMLButtonElement>('[data-testid="period-tab-year"]');
    expect(yearTab).not.toBeNull();
    expect(yearTab?.disabled).toBe(true);

    yearTab?.click();
    expect(onUnitChange).not.toHaveBeenCalled();
    expect(selectionSpy).not.toHaveBeenCalled();
  });

  it("tapping the still-allowed tab fires onUnitChange as usual", () => {
    const onUnitChange = vi.fn();
    const root = document.createElement("div");
    mount(root, props({ unit: "day", offset: 0 }, { allowedUnits: ["month"], onUnitChange }));

    const monthTab = root.querySelector<HTMLButtonElement>('[data-testid="period-tab-month"]');
    expect(monthTab?.disabled).toBe(false);

    monthTab?.click();
    expect(onUnitChange).toHaveBeenCalledWith("month");
  });
});
