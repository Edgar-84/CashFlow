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
  // U3.6 (add-expense.ts). `addExpense.submitLabel` is looked up raw (no
  // `t()` vars) and filled by the screen's own non-escaping `fillTemplate` —
  // it composes the MainButton label, native Telegram chrome, not innerHTML,
  // so `t()`'s auto-escaping of the interpolated category name would show
  // literal HTML entities instead of the name (same reasoning as home.ts's
  // `budgetAlertMessage`).
  "addExpense.amountError": "Enter an amount greater than 0.",
  "addExpense.chooseCategory": "Choose a category",
  "addExpense.enterAmount": "Enter an amount",
  "addExpense.submitLabel": "Add {amount} {currency} to {category}",
  "addExpense.saveChanges": "Save changes",
  "addExpense.error.editForbidden": "You don't have permission to edit this expense.",
  "addExpense.error.forbidden": "You don't have permission to add expenses.",
  "addExpense.error.staleExpense": "That expense no longer exists.",
  "addExpense.error.staleCategory": "That category no longer exists.",
  "addExpense.error.categoryArchived": "That category was archived. Choose another.",
  "addExpense.error.fallback": "Something went wrong. Please try again.",
  "addExpense.discardExpense": "Discard this expense?",
  "addExpense.discardChanges": "Discard changes?",
  "addExpense.account": "Account",
  "addExpense.datePill.today": "today",
  "addExpense.datePill.yesterday": "yesterday",
  "addExpense.datePill.twoDaysAgo": "two days ago",
  "addExpense.dateRadiogroup": "Date",
  "addExpense.chooseDate": "Choose a date",
  "addExpense.tags": "Tags",
  "addExpense.addTag": "+ Add tag",
  "addExpense.comment": "Comment",
  "addExpense.categories": "Categories",
  "addExpense.empty": "Add a category first — every expense needs one.",
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
  "addExpense.amountError": "Введите сумму больше 0.",
  "addExpense.chooseCategory": "Выберите категорию",
  "addExpense.enterAmount": "Введите сумму",
  "addExpense.submitLabel": "Добавить {amount} {currency} в {category}",
  "addExpense.saveChanges": "Сохранить изменения",
  "addExpense.error.editForbidden": "У вас нет прав на редактирование этого расхода.",
  "addExpense.error.forbidden": "У вас нет прав на добавление расходов.",
  "addExpense.error.staleExpense": "Этот расход больше не существует.",
  "addExpense.error.staleCategory": "Эта категория больше не существует.",
  "addExpense.error.categoryArchived": "Эта категория архивирована. Выберите другую.",
  "addExpense.error.fallback": "Что-то пошло не так. Попробуйте ещё раз.",
  "addExpense.discardExpense": "Отменить этот расход?",
  "addExpense.discardChanges": "Отменить изменения?",
  "addExpense.account": "Аккаунт",
  "addExpense.datePill.today": "сегодня",
  "addExpense.datePill.yesterday": "вчера",
  "addExpense.datePill.twoDaysAgo": "позавчера",
  "addExpense.dateRadiogroup": "Дата",
  "addExpense.chooseDate": "Выбрать дату",
  "addExpense.tags": "Теги",
  "addExpense.addTag": "+ Добавить тег",
  "addExpense.comment": "Комментарий",
  "addExpense.categories": "Категории",
  "addExpense.empty": "Сначала добавьте категорию — она нужна для каждого расхода.",
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
  "addExpense.amountError": "Введіть суму більше 0.",
  "addExpense.chooseCategory": "Виберіть категорію",
  "addExpense.enterAmount": "Введіть суму",
  "addExpense.submitLabel": "Додати {amount} {currency} до {category}",
  "addExpense.saveChanges": "Зберегти зміни",
  "addExpense.error.editForbidden": "У вас немає прав на редагування цієї витрати.",
  "addExpense.error.forbidden": "У вас немає прав на додавання витрат.",
  "addExpense.error.staleExpense": "Ця витрата більше не існує.",
  "addExpense.error.staleCategory": "Ця категорія більше не існує.",
  "addExpense.error.categoryArchived": "Цю категорію архівовано. Виберіть іншу.",
  "addExpense.error.fallback": "Щось пішло не так. Спробуйте ще раз.",
  "addExpense.discardExpense": "Скасувати цю витрату?",
  "addExpense.discardChanges": "Скасувати зміни?",
  "addExpense.account": "Акаунт",
  "addExpense.datePill.today": "сьогодні",
  "addExpense.datePill.yesterday": "вчора",
  "addExpense.datePill.twoDaysAgo": "позавчора",
  "addExpense.dateRadiogroup": "Дата",
  "addExpense.chooseDate": "Обрати дату",
  "addExpense.tags": "Теги",
  "addExpense.addTag": "+ Додати тег",
  "addExpense.comment": "Коментар",
  "addExpense.categories": "Категорії",
  "addExpense.empty": "Спочатку додайте категорію — вона потрібна для кожної витрати.",
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
