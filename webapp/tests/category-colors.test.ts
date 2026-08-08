import { describe, expect, it } from "vitest";
import {
  assignCategoryColors,
  categorySlotCssVar,
  categorySlotName,
  OTHER_COLOR_VAR,
  PALETTE_SLOT_COUNT,
  QUICK_SLOTS,
} from "../src/lib/category-colors";

function category(id: string, created_at: string, color_slot: number | null = null) {
  return { id, created_at, color_slot };
}

describe("assignCategoryColors", () => {
  it("renders an explicit slot regardless of position", () => {
    const categories = [
      category("a", "2026-01-01T00:00:00Z", null),
      category("b", "2026-01-02T00:00:00Z", 4),
    ];

    expect(assignCategoryColors(categories).find((c) => c.id === "b")).toEqual({ id: "b", slot: 4 });
  });

  it("renders a slot from the picker-only 7-12 range", () => {
    const categories = [category("a", "2026-01-01T00:00:00Z", 11)];

    expect(assignCategoryColors(categories)).toEqual([{ id: "a", slot: 11 }]);
  });

  it("falls back to a stable position-derived colour capped at slot 6 for a null slot", () => {
    const categories = Array.from({ length: 8 }, (_, i) =>
      category(`cat-${i}`, `2026-01-0${i + 1}T00:00:00Z`, null),
    );

    const result = assignCategoryColors(categories);

    expect(result.slice(0, 6).map((c) => c.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.slice(6).map((c) => c.slot)).toEqual([null, null]);
  });

  it("caps the fallback at slot 6 even with 40 categories and the full 72-slot palette available", () => {
    const categories = Array.from({ length: 40 }, (_, i) =>
      category(`cat-${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`, null),
    );

    const result = assignCategoryColors(categories);

    expect(result.slice(0, 6).map((c) => c.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.slice(6).every((c) => c.slot === null)).toBe(true);
  });

  it("does not shift a later category's colour when an earlier category is deleted", () => {
    const withEarlier = [
      category("a", "2026-01-01T00:00:00Z", 2),
      category("b", "2026-01-02T00:00:00Z", 5),
    ];
    const withoutEarlier = [category("b", "2026-01-02T00:00:00Z", 5)];

    expect(assignCategoryColors(withEarlier).find((c) => c.id === "b")).toEqual({ id: "b", slot: 5 });
    expect(assignCategoryColors(withoutEarlier).find((c) => c.id === "b")).toEqual({ id: "b", slot: 5 });
  });

  it("lets two categories share a slot and both render it", () => {
    const categories = [
      category("a", "2026-01-01T00:00:00Z", 3),
      category("b", "2026-01-02T00:00:00Z", 3),
    ];

    expect(assignCategoryColors(categories).map((c) => c.slot)).toEqual([3, 3]);
  });

  it("treats a missing color_slot the same as a null one", () => {
    const categories = [{ id: "a", created_at: "2026-01-01T00:00:00Z" }];

    expect(assignCategoryColors(categories)).toEqual([{ id: "a", slot: 1 }]);
  });

  it("agrees on every colour regardless of the caller's input order — Home and Statistics fetch independently and must not diverge", () => {
    const explicitAndFallback = [
      category("a", "2026-01-01T00:00:00Z", null),
      category("b", "2026-01-02T00:00:00Z", 9),
      category("c", "2026-01-03T00:00:00Z", null),
    ];
    const reversed = [...explicitAndFallback].reverse();

    const byId = (result: ReturnType<typeof assignCategoryColors>) =>
      new Map(result.map((c) => [c.id, c.slot]));

    expect(byId(assignCategoryColors(explicitAndFallback))).toEqual(byId(assignCategoryColors(reversed)));
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

  it("maps a ramp slot to its CSS custom property", () => {
    expect(categorySlotCssVar(72)).toBe("var(--category-slot-72)");
  });
});

describe("categorySlotName", () => {
  it("names all twelve slots, matching design-system.md's Category palette table", () => {
    expect(categorySlotName(1)).toBe("Blue");
    expect(categorySlotName(6)).toBe("Green");
    expect(categorySlotName(7)).toBe("Teal");
    expect(categorySlotName(12)).toBe("Magenta");
  });

  it("names the ramp positionally, matching design-system.md's ramp table", () => {
    expect(categorySlotName(13)).toBe("Olive 1");
    expect(categorySlotName(18)).toBe("Olive 6");
    expect(categorySlotName(72)).toBe("Slate 6");
  });

  it("falls back to a generic label past the closed 72-slot set", () => {
    expect(categorySlotName(73)).toBe("Slot 73");
  });
});

describe("PALETTE_SLOT_COUNT", () => {
  it("is 72", () => {
    expect(PALETTE_SLOT_COUNT).toBe(72);
  });
});

describe("QUICK_SLOTS", () => {
  it("is the named set's first seven slots", () => {
    expect(QUICK_SLOTS).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
