import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount } from "../src/lib/money";

describe("parseAmount", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12,50", 1250],
    ["1 234,56", 123456],
    ["0", null],
    ["-1", null],
    ["abc", null],
    ["1.234", 123], // three decimals: rounds half up, matches the bot's Decimal(ROUND_HALF_UP)
    ["1.005", 101], // half-cent boundary: 1.005 * 100 === 100.49999999999999 as an IEEE 754 float
    ["1.995", 200], // half-cent boundary with a carry into the whole part
  ])("parseAmount(%s) -> %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it("rejects more than one decimal separator", () => {
    expect(parseAmount("1.234.56")).toBeNull();
    expect(parseAmount("1,234,56")).toBeNull();
  });

  it("treats a space/nbsp thousands separator the same", () => {
    expect(parseAmount("1 234,56")).toBe(123456);
  });
});

describe("formatAmount", () => {
  it("round-trips through parseAmount", () => {
    for (const minor of [1200, 1250, 123456, 1, 99]) {
      expect(parseAmount(formatAmount(minor))).toBe(minor);
    }
  });

  it("pads single-digit cents", () => {
    expect(formatAmount(1205)).toBe("12.05");
  });
});
