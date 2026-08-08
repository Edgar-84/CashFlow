import { describe, expect, it } from "vitest";
import { renderColorQuickRow, renderColorSheet, type ColorPickerProps } from "../src/components/color-picker";
import { PALETTE_SLOT_COUNT } from "../src/lib/category-colors";

const NOOP = (): void => {};

function props(overrides: Partial<ColorPickerProps> = {}): ColorPickerProps {
  return {
    selectedSlot: null,
    onSelect: NOOP,
    onMore: NOOP,
    ...overrides,
  };
}

// vitest.config's `environment: "node"` means `document` is undefined here,
// same as every other component's `mount` — this suite covers
// `renderColorQuickRow` and `renderColorSheet` only.

describe("renderColorQuickRow — default row", () => {
  it("renders exactly 8 controls: 7 circles in slot order 1-7 then the +", () => {
    const html = renderColorQuickRow(props());
    expect((html.match(/data-testid="clp-circle"/g) ?? []).length).toBe(7);
    expect(html).toContain('data-testid="clp-more"');
    const slots = [...html.matchAll(/data-slot="(\d+)"/g)].map((m) => Number(m[1]));
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const moreIndex = html.indexOf('data-testid="clp-more"');
    const lastCircleIndex = html.lastIndexOf('data-testid="clp-circle"');
    expect(moreIndex).toBeGreaterThan(lastCircleIndex);
  });

  it("no circle renders a visible name or caption — the aria-label is the only text carrier", () => {
    const html = renderColorQuickRow(props());
    // Each circle is a self-closing button with no text child (only an
    // optional badge <span> when selected, which carries no visible text).
    expect(html).not.toContain(">Blue<");
    expect(html).not.toContain("In use");
  });

  it("fills every circle from tokens.css via categorySlotCssVar, never a literal hex", () => {
    const html = renderColorQuickRow(props());
    expect(html).toContain("background:var(--category-slot-1)");
    expect(html).toContain("background:var(--category-slot-7)");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("exposes the circles as a radiogroup of radios, the + outside it", () => {
    const html = renderColorQuickRow(props());
    expect(html).toContain('role="radiogroup"');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(7);
  });
});

describe("renderColorQuickRow — selection", () => {
  it("marks exactly the selected slot checked, with its name doubled into the aria-label", () => {
    const html = renderColorQuickRow(props({ selectedSlot: 3 }));
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="Aqua, selected"');
    expect(html).toContain('aria-label="Blue"');
  });

  it("selects nothing when selectedSlot is null", () => {
    const html = renderColorQuickRow(props({ selectedSlot: null }));
    expect(html).not.toContain('aria-checked="true"');
  });

  it("custom quickSlots renders in the given order instead of the default 1-7", () => {
    const html = renderColorQuickRow(props({ quickSlots: [10, 20, 30] }));
    const slots = [...html.matchAll(/data-slot="(\d+)"/g)].map((m) => Number(m[1]));
    expect(slots).toEqual([10, 20, 30]);
  });
});

describe("renderColorQuickRow — overflow circle", () => {
  it("adds an 8th, selected circle before the + when selectedSlot is 8-72", () => {
    const html = renderColorQuickRow(props({ selectedSlot: 40 }));
    expect((html.match(/data-testid="clp-circle"/g) ?? []).length).toBe(8);
    const slots = [...html.matchAll(/data-slot="(\d+)"/g)].map((m) => Number(m[1]));
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7, 40]);
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    const moreIndex = html.indexOf('data-testid="clp-more"');
    const overflowIndex = html.lastIndexOf('data-slot="40"');
    expect(overflowIndex).toBeLessThan(moreIndex);
  });

  it("does not add an overflow circle when selectedSlot is one of 1-7", () => {
    const html = renderColorQuickRow(props({ selectedSlot: 5 }));
    expect((html.match(/data-testid="clp-circle"/g) ?? []).length).toBe(7);
  });
});

describe("renderColorQuickRow — disabled (read-only viewer)", () => {
  it("renders at 50% opacity, every circle disabled, and omits the + entirely", () => {
    const html = renderColorQuickRow(props({ disabled: true, selectedSlot: 2 }));
    expect(html).toContain("clp-disabled");
    expect(html).not.toContain('data-testid="clp-more"');
    expect((html.match(/<button[^>]* disabled[^>]*>/g) ?? []).length).toBe(7);
  });

  it("omitting disabled behaves as not disabled", () => {
    const html = renderColorQuickRow(props());
    expect(html).not.toContain("disabled");
    expect(html).toContain('data-testid="clp-more"');
  });

  it("still shows the overflow circle, disabled, for a read-only viewer whose category is 8-72", () => {
    const html = renderColorQuickRow(props({ disabled: true, selectedSlot: 40 }));
    expect((html.match(/data-testid="clp-circle"/g) ?? []).length).toBe(8);
    expect((html.match(/<button[^>]* disabled[^>]*>/g) ?? []).length).toBe(8);
    expect(html).toContain('data-slot="40"');
    expect(html).not.toContain('data-testid="clp-more"');
  });
});

describe("renderColorSheet", () => {
  it("renders all 72 slots in slot order, in a 6-column grid", () => {
    const html = renderColorSheet(null);
    expect((html.match(/data-testid="clp-circle"/g) ?? []).length).toBe(PALETTE_SLOT_COUNT);
    const slots = [...html.matchAll(/data-slot="(\d+)"/g)].map((m) => Number(m[1]));
    expect(slots).toEqual(Array.from({ length: 72 }, (_, i) => i + 1));
    expect(html).toContain("clp-grid");
  });

  it("marks exactly the selected slot checked, elsewhere in the ramp too", () => {
    const html = renderColorSheet(45);
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    expect(html).toContain('data-slot="45"');
  });

  it("selects nothing when selectedSlot is null", () => {
    const html = renderColorSheet(null);
    expect(html).not.toContain('aria-checked="true"');
  });

  it("names every circle from design-system.md's slot names, named set and ramp alike", () => {
    const html = renderColorSheet(null);
    expect(html).toContain('aria-label="Blue"'); // slot 1
    expect(html).toContain('aria-label="Magenta"'); // slot 12
    expect(html).toContain('aria-label="Olive 3"'); // slot 15
    expect(html).toContain('aria-label="Slate 6"'); // slot 72
  });

  it("reuses the date-range picker's scrim/sheet shell, not a new one", () => {
    const html = renderColorSheet(null);
    expect(html).toContain('class="drp-root"');
    expect(html).toContain('class="drp-scrim"');
    expect(html).toContain('class="drp-sheet"');
    expect(html).toContain('class="drp-title"');
    expect(html).toContain(">Colour<");
  });

  it("exposes the grid as a radiogroup of radios", () => {
    const html = renderColorSheet(null);
    expect(html).toContain('role="radiogroup"');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(PALETTE_SLOT_COUNT);
  });

  it("never renders a hardcoded hex colour — every fill is a token", () => {
    const html = renderColorSheet(30);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
