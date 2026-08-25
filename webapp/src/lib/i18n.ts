/** Translation runtime (U3.3, D700s contracts). `setLanguage` is called from
 * three places: `main.ts::boot` seeds the default before any screen renders
 * (D709), `screens/home.ts::loadHome` reconciles it against the account's
 * real language off the same `GET /users/me` call Home's loader already
 * makes (D716 — never a second fetch), and the language-picker screen
 * (`09-language.md`, U3.11) calls it a third time straight off a successful
 * `PATCH` response.
 *
 * EN is the key registry (D702): `Catalogue` is keyed off `en`'s properties
 * but typed to plain `string` values, not `en`'s literal string values, so RU
 * and UK can carry different content under the same key set. A missing or
 * extra key on either is a TS excess/missing-property error at this file's
 * own `catalogues` assignment, and `tests/i18n.test.ts` asserts the same
 * thing at runtime. */

export type Lang = "en" | "ru" | "uk";

const en = {
  readonly: "You have read-only access to this account.",
  "error.retry": "Try again",
  "offline.banner": "Offline — showing data from {time}",
} as const;

export type Catalogue = Record<keyof typeof en, string>;

const ru: Catalogue = {
  readonly: "У вас доступ только для чтения к этому аккаунту.",
  "error.retry": "Повторить",
  "offline.banner": "Офлайн — данные по состоянию на {time}",
};

const uk: Catalogue = {
  readonly: "У вас є доступ лише для перегляду цього акаунта.",
  "error.retry": "Повторити",
  "offline.banner": "Офлайн — дані станом на {time}",
};

// Exported (not just module-private) so `tests/i18n.test.ts` can assert the
// three catalogues stay key-identical without hand-duplicating any of them.
// Frozen at both levels: a public export should not be mutable from outside.
export const catalogues: Record<Lang, Catalogue> = Object.freeze({
  en: Object.freeze(en),
  ru: Object.freeze(ru),
  uk: Object.freeze(uk),
});

let currentLang: Lang = "en";

export function setLanguage(lang: Lang): void {
  currentLang = lang;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Looks up `key` in the active language's catalogue and fills in `{var}`
 * placeholders. A string value is HTML-escaped before substitution — the
 * result of `t()` is always
 * safe to interpolate straight into a template literal's markup, the same
 * way every screen's own `escapeHtml` already treats untrusted API data. A
 * number is substituted as-is. A placeholder with no matching var is left
 * untouched rather than silently dropped. */
export function t(key: keyof Catalogue, vars?: Record<string, string | number>): string {
  const template = catalogues[currentLang][key];
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!(name in vars)) {
      return match;
    }
    const value = vars[name];
    return typeof value === "number" ? String(value) : escapeHtml(value);
  });
}
