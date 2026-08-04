import { describe, expect, it } from "vitest";
import { assignCategoryColors, categorySlotCssVar, OTHER_COLOR_VAR } from "../src/lib/category-colors";

function category(id: string, created_at: string) {
  return { id, created_at };
}

describe("assignCategoryColors", () => {
  it("assigns fixed slots 1..6 in created_at ASC order", () => {
    const categories = [
      category("c", "2026-01-03T00:00:00Z"),
      category("a", "2026-01-01T00:00:00Z"),
      category("b", "2026-01-02T00:00:00Z"),
    ];

    expect(assignCategoryColors(categories)).toEqual([
      { id: "a", slot: 1 },
      { id: "b", slot: 2 },
      { id: "c", slot: 3 },
    ]);
  });

  it("assigns slots up to 12 by default, not just 6", () => {
    const categories = Array.from({ length: 14 }, (_, i) =>
      category(`cat-${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );

    const result = assignCategoryColors(categories);

    expect(result.slice(0, 12).map((c) => c.slot)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(result.slice(12).map((c) => c.slot)).toEqual([null, null]);
  });

  it("gives categories past an explicit slot count a null slot", () => {
    const categories = Array.from({ length: 8 }, (_, i) =>
      category(`cat-${i}`, `2026-01-0${i + 1}T00:00:00Z`),
    );

    const result = assignCategoryColors(categories, 6);

    expect(result.slice(0, 6).map((c) => c.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.slice(6).map((c) => c.slot)).toEqual([null, null]);
  });

  it("is stable across two renders with a category appended", () => {
    const first = [category("a", "2026-01-01T00:00:00Z"), category("b", "2026-01-02T00:00:00Z")];
    const firstResult = assignCategoryColors(first);

    const second = [...first, category("c", "2026-01-03T00:00:00Z")];
    const secondResult = assignCategoryColors(second);

    expect(secondResult.find((c) => c.id === "a")).toEqual(firstResult.find((c) => c.id === "a"));
    expect(secondResult.find((c) => c.id === "b")).toEqual(firstResult.find((c) => c.id === "b"));
    expect(secondResult.find((c) => c.id === "c")).toEqual({ id: "c", slot: 3 });
  });
});

describe("categorySlotCssVar", () => {
  it("maps a slot to its CSS custom property", () => {
    expect(categorySlotCssVar(1)).toBe("var(--category-slot-1)");
    expect(categorySlotCssVar(6)).toBe("var(--category-slot-6)");
    expect(categorySlotCssVar(12)).toBe("var(--category-slot-12)");
  });

  it("maps null to the neutral Other colour", () => {
    expect(categorySlotCssVar(null)).toBe(OTHER_COLOR_VAR);
  });
});
