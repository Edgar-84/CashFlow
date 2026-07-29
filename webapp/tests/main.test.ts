import { describe, expect, it } from "vitest";
import { placeholderText } from "../src/main";

describe("placeholderText", () => {
  it("returns the placeholder shell text", () => {
    expect(placeholderText()).toBe("CashFlow");
  });
});
