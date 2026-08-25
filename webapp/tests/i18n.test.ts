import { afterEach, describe, expect, it } from "vitest";
import { catalogues, setLanguage, t } from "../src/lib/i18n";

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

  it("renders real RU content, not an EN fallback", () => {
    setLanguage("ru");
    expect(t("readonly")).toBe("У вас доступ только для чтения к этому аккаунту.");
    expect(t("error.retry")).toBe("Повторить");
  });

  it("renders real UK content, not an EN fallback", () => {
    setLanguage("uk");
    expect(t("readonly")).toBe("У вас є доступ лише для перегляду цього акаунта.");
    expect(t("error.retry")).toBe("Повторити");
  });

  it("rejects an unknown key at compile time, never at runtime", () => {
    // @ts-expect-error — "nonexistent.key" is not in Catalogue; a typo here
    // must fail `pnpm typecheck`, not silently render "undefined".
    t("nonexistent.key");
  });
});

describe("catalogues", () => {
  const langs = Object.keys(catalogues) as (keyof typeof catalogues)[];
  const enKeys = Object.keys(catalogues.en).sort();

  it.each(langs)("%s has exactly EN's key set — no missing or extra key", (lang) => {
    expect(Object.keys(catalogues[lang]).sort()).toEqual(enKeys);
  });

  it.each(langs)("%s contains no markup in any string", (lang) => {
    for (const value of Object.values(catalogues[lang])) {
      expect(value).not.toMatch(/[<>]/);
    }
  });
});
