import { describe, expect, it } from "vitest";
import {
  clampOffset,
  describe as describePeriod,
  isValidRange,
  MAX_RANGE_DAYS,
  monthGrid,
  toQuery,
  type PeriodValue,
} from "../src/lib/period";

const NOW = new Date(2026, 7, 4); // Tuesday, August 4 2026

describe("toQuery", () => {
  it.each([
    { unit: "day", offset: 0 },
    { unit: "week", offset: -1 },
    { unit: "month", offset: 0 },
    { unit: "year", offset: -2 },
  ] satisfies PeriodValue[])(
    "$unit serializes period + offset and never a plan-file selector",
    (value) => {
      const query = toQuery(value);
      expect(query).toEqual({ period: value.unit, offset: value.offset });
      expect(query).not.toHaveProperty("start_date");
      expect(query).not.toHaveProperty("end_date");
      expect(query).not.toHaveProperty("months_back");
    },
  );

  it("custom serializes start_date/end_date and never offset", () => {
    const query = toQuery({ unit: "custom", offset: 0, start: "2026-07-09", end: "2026-07-17" });
    expect(query).toEqual({ period: "custom", start_date: "2026-07-09", end_date: "2026-07-17" });
    expect(query).not.toHaveProperty("offset");
    expect(query).not.toHaveProperty("months_back");
  });
});

describe("describe", () => {
  it.each([
    [{ unit: "day", offset: 0 }, "Today, August 4"],
    [{ unit: "day", offset: -1 }, "Yesterday, August 3"],
    [{ unit: "day", offset: -2 }, "August 2"],
    [{ unit: "day", offset: -365 }, "August 4, 2025"],
    [{ unit: "week", offset: 0 }, "This week"],
    [{ unit: "month", offset: 0 }, "August"],
    [{ unit: "month", offset: -1 }, "July"],
    [{ unit: "month", offset: -12 }, "August 2025"],
    [{ unit: "year", offset: 0 }, "2026"],
    [{ unit: "year", offset: -1 }, "2025"],
  ] satisfies [PeriodValue, string][])("%j -> %s", (value, label) => {
    expect(describePeriod(value, NOW)).toBe(label);
  });

  it("day, offset -1 crossing a year boundary: 'other year' wins over 'Yesterday'", () => {
    const now = new Date(2026, 0, 1); // January 1 2026
    expect(describePeriod({ unit: "day", offset: -1 }, now)).toBe("December 31, 2025");
  });

  it("week, same month: '2 – 8 Aug'", () => {
    const now = new Date(2027, 7, 12); // Thursday, August 12 2027
    expect(describePeriod({ unit: "week", offset: -1 }, now)).toBe("2 – 8 Aug");
  });

  it("week, spanning months: '28 Jul – 3 Aug'", () => {
    const now = new Date(2025, 7, 4); // Monday, August 4 2025
    expect(describePeriod({ unit: "week", offset: -1 }, now)).toBe("28 Jul – 3 Aug");
  });

  it("week, spanning years: '29 Dec 2025 – 4 Jan 2026'", () => {
    const now = new Date(2026, 0, 7); // Wednesday, January 7 2026
    expect(describePeriod({ unit: "week", offset: -1 }, now)).toBe("29 Dec 2025 – 4 Jan 2026");
  });

  it("custom: '9 – 17 Jul'", () => {
    const value: PeriodValue = { unit: "custom", offset: 0, start: "2026-07-09", end: "2026-07-17" };
    expect(describePeriod(value, NOW)).toBe("9 – 17 Jul");
  });
});

describe("monthGrid", () => {
  it("31-day month starting on a Sunday: 6x7, Monday-first, leading/trailing flagged", () => {
    // August 2027 starts on a Sunday and has 31 days.
    const grid = monthGrid(2027, 8);
    expect(grid).toHaveLength(6);
    grid.forEach((week) => expect(week).toHaveLength(7));

    // Monday-first: the first cell of week 0 is the Monday before Aug 1.
    expect(grid[0][0]).toEqual({ date: "2027-07-26", day: 26, inMonth: false });
    expect(grid[0][6]).toEqual({ date: "2027-08-01", day: 1, inMonth: true });
    expect(grid[5][1]).toEqual({ date: "2027-08-31", day: 31, inMonth: true });

    const allDays = grid.flat();
    expect(allDays.filter((d) => d.inMonth)).toHaveLength(31);
    expect(allDays[0].inMonth).toBe(false);
    expect(allDays[allDays.length - 1].inMonth).toBe(false);
  });

  it("February in a leap year: 6x7, 29 in-month days", () => {
    const grid = monthGrid(2028, 2); // 2028 is a leap year
    expect(grid).toHaveLength(6);
    grid.forEach((week) => expect(week).toHaveLength(7));

    const allDays = grid.flat();
    const inMonth = allDays.filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth[0]).toEqual({ date: "2028-02-01", day: 1, inMonth: true });
    expect(inMonth[inMonth.length - 1]).toEqual({ date: "2028-02-29", day: 29, inMonth: true });
  });
});

describe("clampOffset", () => {
  it.each([
    [5, 0],
    [1, 0],
    [0, 0],
    [-1, -1],
    [-30, -30],
  ])("clampOffset(%s) -> %s", (input, expected) => {
    expect(clampOffset(input)).toBe(expected);
  });

  it("never returns a positive number", () => {
    for (const n of [1, 2, 100, 9999]) {
      expect(clampOffset(n)).toBeLessThanOrEqual(0);
    }
  });
});

describe("isValidRange", () => {
  it("accepts a normal forward range", () => {
    expect(isValidRange("2026-07-09", "2026-07-17")).toBe(true);
  });

  it("accepts a single-day range", () => {
    expect(isValidRange("2026-07-09", "2026-07-09")).toBe(true);
  });

  it("rejects a reversed range", () => {
    expect(isValidRange("2026-07-17", "2026-07-09")).toBe(false);
  });

  it(`accepts exactly MAX_RANGE_DAYS (${MAX_RANGE_DAYS}) days`, () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 1 + MAX_RANGE_DAYS - 1);
    const toStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(isValidRange(toStr(start), toStr(end))).toBe(true);
  });

  it(`rejects a range one day over MAX_RANGE_DAYS (${MAX_RANGE_DAYS})`, () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 1 + MAX_RANGE_DAYS);
    const toStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(isValidRange(toStr(start), toStr(end))).toBe(false);
  });
});
