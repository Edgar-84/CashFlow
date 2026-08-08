import { describe, expect, it } from "vitest";
import { barSegments, segments, type CategoryTotal } from "../src/lib/donut";

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

describe("barSegments", () => {
  it("keeps slot order fixed and matches input order", () => {
    const result = barSegments(totals(100, 200, 300), { gapPct: 1, minPct: 0 });
    expect(result.map((s) => s.slot)).toEqual([0, 1, 2]);
  });

  it("widths are proportional to amount and sum to the available width (100 minus reserved gaps)", () => {
    const result = barSegments(totals(100, 200, 300, 400), { gapPct: 1, minPct: 0 });
    const available = 100 - 1 * (result.length - 1);
    const widthSum = result.reduce((sum, s) => sum + s.widthPct, 0);
    expect(widthSum).toBeCloseTo(available, 6);

    const widths = result.map((s) => s.widthPct);
    expect(widths.indexOf(Math.max(...widths))).toBe(3); // the 400 category is widest
  });

  it("single category takes the full available width", () => {
    const result = barSegments(totals(500), { gapPct: 2, minPct: 3 });
    expect(result).toHaveLength(1);
    expect(result[0].widthPct).toBeCloseTo(100, 6);
  });

  it("zero-total draws segments at 0 width, never clamped up", () => {
    const result = barSegments(totals(0, 0, 0), { gapPct: 1, minPct: 10 });
    expect(result.every((s) => s.widthPct === 0)).toBe(true);
  });

  it("returns nothing for an empty input", () => {
    expect(barSegments([], { gapPct: 1, minPct: 3 })).toEqual([]);
  });

  it("folds more than six categories into a trailing Other segment, same boundary as the donut", () => {
    const many = totals(100, 100, 100, 100, 100, 100, 500, 300);
    const result = barSegments(many, { gapPct: 1, minPct: 0 });

    expect(result).toHaveLength(7);
    expect(result.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const grandTotal = many.reduce((sum, t) => sum + t.minor, 0);
    const available = 100 - 1 * 6;
    const otherShare = (500 + 300) / grandTotal;
    expect(result[6].widthPct).toBeCloseTo(otherShare * available, 6);
  });

  it("clamps a segment under minPct up to it, taking the surplus off the largest segment only", () => {
    // Shares before clamping: 0.1%, 0.1%, 99.8% of a 100%-wide bar.
    const result = barSegments(totals(1, 1, 998), { gapPct: 0, minPct: 5 });
    expect(result[0].widthPct).toBeCloseTo(5, 6);
    expect(result[1].widthPct).toBeCloseTo(5, 6);
    expect(result[2].widthPct).toBeCloseTo(90, 6); // 99.8 - (2 * 4.9 overage)
  });

  it("never pushes the total past the available width, even with several tiny segments", () => {
    const result = barSegments(totals(1, 1, 1, 1, 996), { gapPct: 0, minPct: 5 });
    const total = result.reduce((sum, s) => sum + s.widthPct, 0);
    expect(total).toBeLessThanOrEqual(100 + 1e-6);
    expect(total).toBeCloseTo(100, 6);
  });

  it("cascades to the next-largest segment when the single largest can't absorb the whole overage alone", () => {
    // 2 tiny (0.5% raw each, clamped to 5%) + 8 medium (12.375% raw each,
    // unclamped) = 109% before correction, 9% overage. The single largest
    // medium's own room (12.375 - 5 = 7.375) is less than the 9% overage, so
    // it alone cannot absorb it — the fix has to reach a second segment
    // without ever dropping below minPct or exceeding `available`.
    const result = barSegments(totals(4, 4, 99, 99, 99, 99, 99, 99, 99, 99), {
      gapPct: 0,
      minPct: 5,
      maxSlots: 10, // no fold — this shape needs all 10 slots to reproduce
    });
    expect(result).toHaveLength(10);

    const total = result.reduce((sum, s) => sum + s.widthPct, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(total).toBeLessThanOrEqual(100 + 1e-6);

    // Both tiny segments floor at minPct.
    expect(result[0].widthPct).toBeCloseTo(5, 6);
    expect(result[1].widthPct).toBeCloseTo(5, 6);
    // The first medium (largest, taken first) floors out too.
    expect(result[2].widthPct).toBeCloseTo(5, 6);
    // The second medium absorbs only the remaining overage, not all of it.
    expect(result[3].widthPct).toBeCloseTo(10.75, 6);
    // The rest of the mediums are untouched — the surplus stops once absorbed.
    for (let i = 4; i < 10; i++) {
      expect(result[i].widthPct).toBeCloseTo(12.375, 6);
    }
  });
});
