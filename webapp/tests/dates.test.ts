import { describe, expect, it } from "vitest";
import { formatDay } from "../src/lib/dates";

describe("formatDay", () => {
  it("renders in the given tz, not UTC", () => {
    // 23:30 UTC on the 28th is already the 29th in Belgrade (UTC+2).
    const iso = "2026-07-28T23:30:00Z";
    expect(formatDay(iso, "UTC")).toBe("Tue, Jul 28");
    expect(formatDay(iso, "Europe/Belgrade")).toBe("Wed, Jul 29");
  });

  it("renders the same instant differently in a negative offset", () => {
    // 01:30 UTC on the 1st is still the 31st in New York (UTC-4 in summer).
    const iso = "2026-08-01T01:30:00Z";
    expect(formatDay(iso, "UTC")).toBe("Sat, Aug 1");
    expect(formatDay(iso, "America/New_York")).toBe("Fri, Jul 31");
  });
});
