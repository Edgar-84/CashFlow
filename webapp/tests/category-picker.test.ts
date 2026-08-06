import { describe, expect, it } from "vitest";
import {
  nextGridFocusIndex,
  renderCategoryPicker,
  type CategoryPickerItem,
  type CategoryPickerProps,
} from "../src/components/category-picker";

const NOOP = (): void => {};

function item(id: string, name: string, colorVar: string): CategoryPickerItem {
  return { id, name, colorVar };
}

/** Extracts a single cell's full opening `<button ...>` tag, so attribute
 * order elsewhere in the template can change without breaking assertions
 * about one attribute's value. */
function cellTag(html: string, categoryId: string): string {
  const marker = `data-category-id="${categoryId}"`;
  const markerIndex = html.indexOf(marker);
  const start = html.lastIndexOf("<button", markerIndex);
  const end = html.indexOf(">", markerIndex);
  return html.slice(start, end + 1);
}

function props(overrides: Partial<CategoryPickerProps> = {}): CategoryPickerProps {
  return {
    items: [
      item("cat-1", "Groceries", "var(--category-slot-1)"),
      item("cat-2", "Transport", "var(--category-slot-2)"),
    ],
    selectedId: null,
    onSelect: NOOP,
    onMore: NOOP,
    ...overrides,
  };
}

// vitest.config's `environment: "node"` means `document` is undefined here,
// same as every other component's `mount` — this suite covers
// `renderCategoryPicker` and the pure `nextGridFocusIndex` helper only.

describe("renderCategoryPicker — grid", () => {
  it("renders one 64px circle per item, each with its name centred underneath", () => {
    const html = renderCategoryPicker(props());
    expect((html.match(/data-testid="cp-cell"/g) ?? []).length).toBe(2);
    expect(html).toContain(">Groceries<");
    expect(html).toContain(">Transport<");
  });

  it("no category circle contains any child markup — no glyph, letter, emoji or image", () => {
    const html = renderCategoryPicker(props());
    // Each category swatch is a self-closing span: <span class="cp-swatch" .../>
    const swatchSpans = html.match(/<span class="cp-swatch"[^>]*><\/span>/g) ?? [];
    expect(swatchSpans.length).toBe(2);
  });

  it("fills each circle from its item's colorVar, and two categories sharing a slot render identically without error", () => {
    const html = renderCategoryPicker(
      props({
        items: [
          item("cat-1", "Coffee", "var(--category-slot-3)"),
          item("cat-2", "Snacks", "var(--category-slot-3)"),
        ],
      }),
    );
    expect((html.match(/background:var\(--category-slot-3\)/g) ?? []).length).toBe(2);
  });

  it("never renders a hardcoded hex colour — every fill is a caller-supplied token", () => {
    const html = renderCategoryPicker(props());
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe("renderCategoryPicker — selection", () => {
  it("marks exactly the selected item's cell as selected, radio-checked, the rest unchecked", () => {
    const html = renderCategoryPicker(props({ selectedId: "cat-2" }));
    expect((html.match(/ selected/g) ?? []).length).toBe(1);
    expect(cellTag(html, "cat-2")).toContain('aria-checked="true"');
    expect(cellTag(html, "cat-1")).toContain('aria-checked="false"');
  });

  it("selects no cell when selectedId is null", () => {
    const html = renderCategoryPicker(props({ selectedId: null }));
    expect(html).not.toContain(" selected");
    expect((html.match(/aria-checked="false"/g) ?? []).length).toBe(2);
  });

  it("exposes the grid as a radiogroup with radio cells", () => {
    const html = renderCategoryPicker(props());
    expect(html).toContain('role="radiogroup"');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(2);
  });
});

describe("renderCategoryPicker — More cell", () => {
  it("always renders More last, outside the radiogroup, never as a radio", () => {
    const html = renderCategoryPicker(props());
    const lastCategoryIndex = html.lastIndexOf('data-testid="cp-cell"');
    const moreIndex = html.indexOf('data-testid="cp-more"');
    expect(moreIndex).toBeGreaterThan(lastCategoryIndex);
    const moreButtonStart = html.lastIndexOf("<button", moreIndex);
    const moreButtonTag = html.slice(moreButtonStart, moreIndex);
    expect(moreButtonTag).not.toContain('role="radio"');
    expect(html).toContain('aria-label="Manage categories"');
  });

  it("with an empty items array, only the More cell renders, above the empty copy", () => {
    const html = renderCategoryPicker(props({ items: [] }));
    expect(html).not.toContain('data-testid="cp-cell"');
    expect(html).toContain('data-testid="cp-more"');
    expect(html).toContain("Create your first category to add an expense.");
    const moreIndex = html.indexOf('data-testid="cp-more"');
    const emptyIndex = html.indexOf("Create your first category");
    expect(moreIndex).toBeLessThan(emptyIndex);
  });
});

describe("renderCategoryPicker — long names", () => {
  it("renders a 30-character category name in full (CSS handles the wrap/ellipsis, JS never truncates)", () => {
    const longName = "A".repeat(30);
    const html = renderCategoryPicker(props({ items: [item("cat-1", longName, "var(--category-slot-1)")] }));
    expect(html).toContain(longName);
  });
});

describe("renderCategoryPicker — disabled", () => {
  it("suppresses every cell and hides More", () => {
    const html = renderCategoryPicker(props({ disabled: true }));
    expect(html).not.toContain('data-testid="cp-more"');
    expect((html.match(/<button[^>]* disabled[^>]*>/g) ?? []).length).toBe(2);
    expect(html).toContain("cp-disabled");
  });

  it("omitting disabled behaves as not disabled", () => {
    const html = renderCategoryPicker(props());
    expect(html).not.toContain("disabled");
    expect(html).toContain('data-testid="cp-more"');
  });
});

// -- nextGridFocusIndex -------------------------------------------------------

describe("nextGridFocusIndex", () => {
  it("moves right/left by one, wrapping at the ends of the whole cell list", () => {
    expect(nextGridFocusIndex(7, 0, "ArrowRight")).toBe(1);
    expect(nextGridFocusIndex(7, 6, "ArrowRight")).toBe(0);
    expect(nextGridFocusIndex(7, 0, "ArrowLeft")).toBe(6);
  });

  it("moves down/up by a full row (4 columns) and wraps at the top/bottom", () => {
    expect(nextGridFocusIndex(8, 0, "ArrowDown")).toBe(4);
    expect(nextGridFocusIndex(8, 4, "ArrowUp")).toBe(0);
    expect(nextGridFocusIndex(8, 6, "ArrowDown")).toBe(2);
    expect(nextGridFocusIndex(8, 1, "ArrowUp")).toBe(5);
  });

  it("stays in range for a ragged last row instead of going out of bounds", () => {
    const next = nextGridFocusIndex(7, 3, "ArrowDown");
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(7);
  });

  it("returns the same index for an unhandled key, and for an empty grid", () => {
    expect(nextGridFocusIndex(5, 2, "Tab")).toBe(2);
    expect(nextGridFocusIndex(0, 0, "ArrowRight")).toBe(0);
  });
});
