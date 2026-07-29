import { describe, expect, it } from "vitest";
import { segments, type CategoryTotal } from "../src/lib/donut";

const CIRCUMFERENCE = 200;

function totals(...minors: number[]): CategoryTotal[] {
  return minors.map((minor, i) => ({ id: `c${i}`, label: `Cat ${i}`, minor }));
}

describe("segments", () => {
  it("shares sum to the circumference minus gaps", () => {
    const result = segments(totals(100, 200, 300, 400), {
      circumference: CIRCUMFERENCE,
      gap: 2,
    });
    const dashSum = result.reduce((sum, s) => sum + s.dash, 0);
    expect(dashSum).toBeCloseTo(CIRCUMFERENCE - 2 * result.length, 6);
  });

  it("keeps slot order fixed and matches input order", () => {
    const result = segments(totals(100, 200, 300), { circumference: CIRCUMFERENCE });
    expect(result.map((s) => s.slot)).toEqual([0, 1, 2]);
  });

  it("single category takes the whole circle minus its own gap", () => {
    const result = segments(totals(500), { circumference: CIRCUMFERENCE, gap: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].offset).toBe(0);
    expect(result[0].dash).toBeCloseTo(CIRCUMFERENCE - 2, 6);
  });

  it("zero-total draws no arcs", () => {
    const result = segments(totals(0, 0, 0), { circumference: CIRCUMFERENCE });
    expect(result.every((s) => s.dash === 0)).toBe(true);
  });

  it("returns nothing for an empty input", () => {
    expect(segments([], { circumference: CIRCUMFERENCE })).toEqual([]);
  });

  it("folds more than six categories into a trailing Other segment", () => {
    // 7 categories, one per 100 minor units, plus a large 8th and 9th folded in.
    const many = totals(100, 100, 100, 100, 100, 100, 500, 300);
    const result = segments(many, { circumference: CIRCUMFERENCE, gap: 2 });

    expect(result).toHaveLength(7);
    expect(result.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const grandTotal = many.reduce((sum, t) => sum + t.minor, 0);
    const available = CIRCUMFERENCE - 2 * 7;
    const otherShare = (500 + 300) / grandTotal;
    expect(result[6].dash).toBeCloseTo(otherShare * available, 6);
  });

  it("offsets accumulate dash + gap across segments", () => {
    const result = segments(totals(100, 100), { circumference: CIRCUMFERENCE, gap: 2 });
    expect(result[1].offset).toBeCloseTo(result[0].dash + result[0].gap, 6);
  });
});
