import { afterEach, describe, expect, it } from "vitest";
import { setLanguage, t } from "../src/lib/i18n";

afterEach(() => {
  setLanguage("en");
});

describe("t", () => {
  it("returns the EN string for a plain key", () => {
    expect(t("error.retry")).toBe("Try again");
  });

  it("fills in a {var} placeholder", () => {
    expect(t("offline.banner", { time: "2:30 PM" })).toBe("Offline — showing data from 2:30 PM");
  });

  it("HTML-escapes an interpolated string, never injecting it as markup", () => {
    expect(t("offline.banner", { time: "<script>alert(1)</script>" })).toBe(
      "Offline — showing data from &lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("leaves a placeholder with no matching var untouched rather than dropping it", () => {
    expect(t("offline.banner", {})).toBe("Offline — showing data from {time}");
  });

  it("falls back to EN for ru/uk — no catalogue ships for either until U3.4", () => {
    setLanguage("ru");
    expect(t("readonly")).toBe("You have read-only access to this account.");
    setLanguage("uk");
    expect(t("readonly")).toBe("You have read-only access to this account.");
  });

  it("rejects an unknown key at compile time, never at runtime", () => {
    // @ts-expect-error — "nonexistent.key" is not in Catalogue; a typo here
    // must fail `pnpm typecheck`, not silently render "undefined".
    t("nonexistent.key");
  });
});
