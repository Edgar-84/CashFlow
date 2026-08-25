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
  // U3.5 (home.ts + side-menu.ts). `mb.add`/`add.aria` carry the identical
  // string on purpose (D318: MainButton label and the yellow Add button's
  // accessible name fire the same handler and must never say different
  // things) — enforced across all three languages by
  // tests/i18n.test.ts, not by sharing one constant.
  "mb.add": "Add expense",
  "add.aria": "Add expense",
  "menu.aria": "Menu",
  "menu.title": "Menu",
  "empty.day": "There were no expenses on this day.",
  "empty.week": "There were no expenses in this week.",
  "empty.month": "There were no expenses in this month.",
  "empty.year": "There were no expenses in this year.",
  "empty.custom": "There were no expenses in this period.",
  "item.addExpense": "Add expense",
  "item.expenses": "Expenses",
  "item.budgets": "Budgets",
  "item.statistics": "Statistics",
  "item.categories": "Categories",
  "item.tags": "Tags",
  "item.settings": "Settings",
  "footer.synced": "Synced {date} {time}",
  // Composed with a raw, non-escaping substitution (home.ts's own
  // `fillTemplate`), never `t()`'s vars — `budgetAlertMessage` is reused
  // verbatim by `main.ts`'s Telegram toast (D609), which must never see HTML
  // entities.
  "alert.over": "{category} is over budget by {amount} {currency}",
  "alert.warn": "{category} is at {pct}% — {spent} of {limit} {currency}",
  "chart.other": "Other",
  "category.unknown": "Unknown",
  "error.fallback": "Something went wrong.",
} as const;

export type Catalogue = Record<keyof typeof en, string>;

const ru: Catalogue = {
  readonly: "У вас доступ только для чтения к этому аккаунту.",
  "error.retry": "Повторить",
  "offline.banner": "Офлайн — данные по состоянию на {time}",
  "mb.add": "Добавить расход",
  "add.aria": "Добавить расход",
  "menu.aria": "Меню",
  "menu.title": "Меню",
  "empty.day": "В этот день расходов не было.",
  "empty.week": "На этой неделе расходов не было.",
  "empty.month": "В этом месяце расходов не было.",
  "empty.year": "В этом году расходов не было.",
  "empty.custom": "За этот период расходов не было.",
  "item.addExpense": "Добавить расход",
  "item.expenses": "Расходы",
  "item.budgets": "Бюджеты",
  "item.statistics": "Статистика",
  "item.categories": "Категории",
  "item.tags": "Теги",
  "item.settings": "Настройки",
  "footer.synced": "Синхронизировано {date} {time}",
  "alert.over": "{category}: превышен бюджет на {amount} {currency}",
  "alert.warn": "{category}: использовано {pct}% — {spent} из {limit} {currency}",
  "chart.other": "Другое",
  "category.unknown": "Неизвестно",
  "error.fallback": "Что-то пошло не так.",
};

const uk: Catalogue = {
  readonly: "У вас є доступ лише для перегляду цього акаунта.",
  "error.retry": "Повторити",
  "offline.banner": "Офлайн — дані станом на {time}",
  "mb.add": "Додати витрату",
  "add.aria": "Додати витрату",
  "menu.aria": "Меню",
  "menu.title": "Меню",
  "empty.day": "Цього дня витрат не було.",
  "empty.week": "Цього тижня витрат не було.",
  "empty.month": "Цього місяця витрат не було.",
  "empty.year": "Цього року витрат не було.",
  "empty.custom": "За цей період витрат не було.",
  "item.addExpense": "Додати витрату",
  "item.expenses": "Витрати",
  "item.budgets": "Бюджети",
  "item.statistics": "Статистика",
  "item.categories": "Категорії",
  "item.tags": "Теги",
  "item.settings": "Налаштування",
  "footer.synced": "Синхронізовано {date} {time}",
  "alert.over": "{category}: перевищено бюджет на {amount} {currency}",
  "alert.warn": "{category}: використано {pct}% — {spent} з {limit} {currency}",
  "chart.other": "Інше",
  "category.unknown": "Невідомо",
  "error.fallback": "Щось пішло не так.",
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
