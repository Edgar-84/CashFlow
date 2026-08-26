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
  // U3.7 (expenses.ts + expense-detail.ts). "Unknown"/"Try again"/the offline
  // banner/the generic fallback message are U3.5's global keys, reused as-is
  // per that unit's own gotcha note.
  "expenses.unknownCategory": "this category",
  "expenses.forbidden": "You don't have permission to view expenses.",
  "expenses.filter.both": "{category} · {period}",
  "expenses.empty.both": "Nothing in {period} for {category}.",
  "expenses.empty.categoryOnly": "Nothing here yet for {category}.",
  "expenses.empty.periodOnly": "Nothing in {period}.",
  "expenses.empty.unfiltered": "No expenses yet.",
  "expenses.loadMore": "Load more",
  "expenses.endOfList": "You've reached the end.",
  "detail.action.edit": "Edit",
  "detail.action.delete": "Delete expense",
  "detail.confirm.message": "Are you sure you want to delete this expense?",
  "detail.err.forbidden": "You don't have permission to do that.",
  "detail.err.delete": "Couldn't delete that expense.",
  "detail.forbidden": "You don't have permission to view this expense.",
  "detail.notFound": "That expense no longer exists.",
  // U3.8 (budgets.ts + budget-form.ts). "Try again"/the offline banner/the
  // generic fallback message are U3.5's global keys, reused as-is per that
  // unit's own gotcha note.
  "budgets.unknownCategory": "Unknown category",
  "budgets.mainButtonLabel": "Set budget for {category}",
  "budgets.status.noLimit": "No limit set",
  "budgets.status.over": "⚠ Over by {amount} {currency}",
  "budgets.status.warn": "⚠ Approaching limit",
  "budgets.status.ok": "On track",
  "budgets.empty.noBudgets": "No budgets yet — set one below.",
  "budgets.invite.cta": "Set a budget",
  "budgets.forbidden": "You don't have permission to view budgets.",
  "budgets.empty.noCategories": "Add a category first — every budget needs one.",
  "budgetForm.amountError": "Enter an amount greater than 0.",
  "budgetForm.thresholdError": "Enter a whole number 0-100.",
  "budgetForm.err.forbidden": "You don't have permission to do that.",
  "budgetForm.err.gone": "That category no longer exists.",
  "budgetForm.err.planGone": "That budget plan no longer exists.",
  "budgetForm.err.duplicate": "A budget plan already exists for this category and period.",
  "budgetForm.err.fallback": "Something went wrong. Please try again.",
  "budgetForm.spent": "Spent {spent} of {limit} {currency} this month",
  "budgetForm.delete": "Delete budget",
  "budgetForm.amountLabel": "Monthly limit",
  "budgetForm.thresholdLabel": "Warn me at",
  "budgetForm.save": "Save",
  "budgetForm.cancel": "Cancel",
  "budgetForm.discardChanges": "Discard changes?",
  "budgetForm.confirmDelete": "Delete this budget plan?",
  // U3.9 (categories.ts + tags.ts). "Try again"/the offline banner/the
  // read-only message/the generic fallback message are U3.5's/U3.6's global
  // keys, reused as-is per that unit's own gotcha note.
  "categories.addCategory": "Add category",
  "categories.empty": "No categories yet",
  "categories.archivedHeader": "Archived ({count})",
  "categories.archivedExplain":
    "Archived categories keep their history in reports, but you can't pick them for new expenses.",
  "categories.hideTrigger": "Hide category",
  "categories.deleteTrigger": "Delete category",
  "categories.delete.expenseCountOne": "1 expense keeps it for reports.",
  "categories.delete.expenseCountMany": "{count} expenses keep it for reports.",
  "categories.delete.confirmHide": "Hide {name}? {phrase}",
  "categories.delete.confirmDelete": "Delete {name}?",
  "categories.delete.lastActiveWarning":
    " This is your only category — new expenses will have nowhere to go.",
  "categories.delete.failureHide": "Couldn't hide {name}.",
  "categories.delete.failureDelete": "Couldn't delete {name}.",
  "categoryForm.nameLabel": "Name",
  "categoryForm.namePlaceholder": "Category name",
  "categoryForm.colourLabel": "Colour",
  "categoryForm.nameError": "Give this category a name.",
  "categoryForm.duplicateWarning": 'Another category is already named "{name}".',
  "categoryForm.saveError.fallback": "Couldn't save this category.",
  "categoryForm.save": "Save",
  "categoryForm.discardChanges": "Discard changes to this category?",
  "tags.addTag": "Add tag",
  "tags.empty":
    "Tags cut across categories — add #vacation to a café, a flight and a hotel, and see it as one thing.",
  "tags.archivedHeader": "Archived ({count})",
  "tags.archivedExplain": "Archived tags keep their history in reports, but you can't pick them for new expenses.",
  "tags.hideTrigger": "Hide tag",
  "tags.deleteTrigger": "Delete tag",
  "tags.delete.expenseCountOne": "1 expense keeps it tagged.",
  "tags.delete.expenseCountMany": "{count} expenses keep it tagged.",
  "tags.delete.confirmHide": "Hide {name}? {phrase}",
  "tags.delete.confirmDelete": "Delete {name}?",
  "tags.delete.failureHide": "Couldn't hide {name}.",
  "tags.delete.failureDelete": "Couldn't delete {name}.",
  "tagForm.nameLabel": "Name",
  "tagForm.namePlaceholder": "Tag name",
  "tagForm.nameError": "Give this tag a name.",
  "tagForm.saveError.fallback": "Couldn't save this tag.",
  "tagForm.save": "Save",
  "tagForm.discardChanges": "Discard changes to this tag?",
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
  "expenses.unknownCategory": "этой категории",
  "expenses.forbidden": "У вас нет прав на просмотр расходов.",
  "expenses.filter.both": "{category} · {period}",
  "expenses.empty.both": "За {period} для категории {category} ничего нет.",
  "expenses.empty.categoryOnly": "Пока ничего нет для категории {category}.",
  "expenses.empty.periodOnly": "За {period} ничего нет.",
  "expenses.empty.unfiltered": "Расходов пока нет.",
  "expenses.loadMore": "Загрузить ещё",
  "expenses.endOfList": "Вы дошли до конца списка.",
  "detail.action.edit": "Изменить",
  "detail.action.delete": "Удалить расход",
  "detail.confirm.message": "Вы уверены, что хотите удалить этот расход?",
  "detail.err.forbidden": "У вас нет прав на это действие.",
  "detail.err.delete": "Не удалось удалить этот расход.",
  "detail.forbidden": "У вас нет прав на просмотр этого расхода.",
  "detail.notFound": "Этот расход больше не существует.",
  "budgets.unknownCategory": "Неизвестная категория",
  "budgets.mainButtonLabel": "Установить бюджет для {category}",
  "budgets.status.noLimit": "Лимит не задан",
  "budgets.status.over": "⚠ Превышение на {amount} {currency}",
  "budgets.status.warn": "⚠ Приближается к лимиту",
  "budgets.status.ok": "В пределах нормы",
  "budgets.empty.noBudgets": "Бюджетов пока нет — задайте один ниже.",
  "budgets.invite.cta": "Задать бюджет",
  "budgets.forbidden": "У вас нет прав на просмотр бюджетов.",
  "budgets.empty.noCategories": "Сначала добавьте категорию — она нужна для каждого бюджета.",
  "budgetForm.amountError": "Введите сумму больше 0.",
  "budgetForm.thresholdError": "Введите целое число от 0 до 100.",
  "budgetForm.err.forbidden": "У вас нет прав на это действие.",
  "budgetForm.err.gone": "Эта категория больше не существует.",
  "budgetForm.err.planGone": "Этот бюджет больше не существует.",
  "budgetForm.err.duplicate": "Бюджет для этой категории и периода уже существует.",
  "budgetForm.err.fallback": "Что-то пошло не так. Попробуйте ещё раз.",
  "budgetForm.spent": "Потрачено {spent} из {limit} {currency} в этом месяце",
  "budgetForm.delete": "Удалить бюджет",
  "budgetForm.amountLabel": "Лимит на месяц",
  "budgetForm.thresholdLabel": "Предупреждать при",
  "budgetForm.save": "Сохранить",
  "budgetForm.cancel": "Отмена",
  "budgetForm.discardChanges": "Отменить изменения?",
  "budgetForm.confirmDelete": "Удалить этот бюджет?",
  "categories.addCategory": "Добавить категорию",
  "categories.empty": "Категорий пока нет",
  "categories.archivedHeader": "Архив ({count})",
  "categories.archivedExplain":
    "Архивные категории сохраняют историю в отчётах, но их нельзя выбрать для новых расходов.",
  "categories.hideTrigger": "Скрыть категорию",
  "categories.deleteTrigger": "Удалить категорию",
  "categories.delete.expenseCountOne": "1 расход сохраняет её для отчётов.",
  "categories.delete.expenseCountMany": "{count} расходов сохраняют её для отчётов.",
  "categories.delete.confirmHide": "Скрыть {name}? {phrase}",
  "categories.delete.confirmDelete": "Удалить {name}?",
  "categories.delete.lastActiveWarning":
    " Это ваша единственная категория — новым расходам будет некуда деваться.",
  "categories.delete.failureHide": "Не удалось скрыть {name}.",
  "categories.delete.failureDelete": "Не удалось удалить {name}.",
  "categoryForm.nameLabel": "Название",
  "categoryForm.namePlaceholder": "Название категории",
  "categoryForm.colourLabel": "Цвет",
  "categoryForm.nameError": "Дайте этой категории название.",
  "categoryForm.duplicateWarning": 'Категория с названием "{name}" уже существует.',
  "categoryForm.saveError.fallback": "Не удалось сохранить эту категорию.",
  "categoryForm.save": "Сохранить",
  "categoryForm.discardChanges": "Отменить изменения в этой категории?",
  "tags.addTag": "Добавить тег",
  "tags.empty":
    "Теги объединяют расходы из разных категорий — добавьте #отпуск к кафе, перелёту и отелю и увидите их как одно целое.",
  "tags.archivedHeader": "Архив ({count})",
  "tags.archivedExplain": "Архивные теги сохраняют историю в отчётах, но их нельзя выбрать для новых расходов.",
  "tags.hideTrigger": "Скрыть тег",
  "tags.deleteTrigger": "Удалить тег",
  "tags.delete.expenseCountOne": "1 расход помечен этим тегом.",
  "tags.delete.expenseCountMany": "{count} расходов помечены этим тегом.",
  "tags.delete.confirmHide": "Скрыть {name}? {phrase}",
  "tags.delete.confirmDelete": "Удалить {name}?",
  "tags.delete.failureHide": "Не удалось скрыть {name}.",
  "tags.delete.failureDelete": "Не удалось удалить {name}.",
  "tagForm.nameLabel": "Название",
  "tagForm.namePlaceholder": "Название тега",
  "tagForm.nameError": "Дайте этому тегу название.",
  "tagForm.saveError.fallback": "Не удалось сохранить этот тег.",
  "tagForm.save": "Сохранить",
  "tagForm.discardChanges": "Отменить изменения в этом теге?",
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
  "expenses.unknownCategory": "цієї категорії",
  "expenses.forbidden": "У вас немає прав на перегляд витрат.",
  "expenses.filter.both": "{category} · {period}",
  "expenses.empty.both": "За {period} для категорії {category} нічого немає.",
  "expenses.empty.categoryOnly": "Поки що нічого немає для категорії {category}.",
  "expenses.empty.periodOnly": "За {period} нічого немає.",
  "expenses.empty.unfiltered": "Витрат поки немає.",
  "expenses.loadMore": "Завантажити ще",
  "expenses.endOfList": "Ви дійшли до кінця списку.",
  "detail.action.edit": "Змінити",
  "detail.action.delete": "Видалити витрату",
  "detail.confirm.message": "Ви впевнені, що хочете видалити цю витрату?",
  "detail.err.forbidden": "У вас немає прав на цю дію.",
  "detail.err.delete": "Не вдалося видалити цю витрату.",
  "detail.forbidden": "У вас немає прав на перегляд цієї витрати.",
  "detail.notFound": "Ця витрата більше не існує.",
  "budgets.unknownCategory": "Невідома категорія",
  "budgets.mainButtonLabel": "Встановити бюджет для {category}",
  "budgets.status.noLimit": "Ліміт не встановлено",
  "budgets.status.over": "⚠ Перевищення на {amount} {currency}",
  "budgets.status.warn": "⚠ Наближається до ліміту",
  "budgets.status.ok": "У межах норми",
  "budgets.empty.noBudgets": "Бюджетів поки немає — встановіть один нижче.",
  "budgets.invite.cta": "Встановити бюджет",
  "budgets.forbidden": "У вас немає прав на перегляд бюджетів.",
  "budgets.empty.noCategories": "Спочатку додайте категорію — вона потрібна для кожного бюджету.",
  "budgetForm.amountError": "Введіть суму більше 0.",
  "budgetForm.thresholdError": "Введіть ціле число від 0 до 100.",
  "budgetForm.err.forbidden": "У вас немає прав на цю дію.",
  "budgetForm.err.gone": "Ця категорія більше не існує.",
  "budgetForm.err.planGone": "Цей бюджет більше не існує.",
  "budgetForm.err.duplicate": "Бюджет для цієї категорії та періоду вже існує.",
  "budgetForm.err.fallback": "Щось пішло не так. Спробуйте ще раз.",
  "budgetForm.spent": "Витрачено {spent} з {limit} {currency} цього місяця",
  "budgetForm.delete": "Видалити бюджет",
  "budgetForm.amountLabel": "Ліміт на місяць",
  "budgetForm.thresholdLabel": "Попереджати при",
  "budgetForm.save": "Зберегти",
  "budgetForm.cancel": "Скасувати",
  "budgetForm.discardChanges": "Скасувати зміни?",
  "budgetForm.confirmDelete": "Видалити цей бюджет?",
  "categories.addCategory": "Додати категорію",
  "categories.empty": "Категорій поки немає",
  "categories.archivedHeader": "Архів ({count})",
  "categories.archivedExplain":
    "Архівні категорії зберігають історію у звітах, але їх не можна вибрати для нових витрат.",
  "categories.hideTrigger": "Приховати категорію",
  "categories.deleteTrigger": "Видалити категорію",
  "categories.delete.expenseCountOne": "1 витрата зберігає її для звітів.",
  "categories.delete.expenseCountMany": "{count} витрат зберігають її для звітів.",
  "categories.delete.confirmHide": "Приховати {name}? {phrase}",
  "categories.delete.confirmDelete": "Видалити {name}?",
  "categories.delete.lastActiveWarning":
    " Це ваша єдина категорія — новим витратам буде нікуди подітися.",
  "categories.delete.failureHide": "Не вдалося приховати {name}.",
  "categories.delete.failureDelete": "Не вдалося видалити {name}.",
  "categoryForm.nameLabel": "Назва",
  "categoryForm.namePlaceholder": "Назва категорії",
  "categoryForm.colourLabel": "Колір",
  "categoryForm.nameError": "Дайте цій категорії назву.",
  "categoryForm.duplicateWarning": 'Категорія з назвою "{name}" вже існує.',
  "categoryForm.saveError.fallback": "Не вдалося зберегти цю категорію.",
  "categoryForm.save": "Зберегти",
  "categoryForm.discardChanges": "Скасувати зміни в цій категорії?",
  "tags.addTag": "Додати тег",
  "tags.empty":
    "Теги об'єднують витрати з різних категорій — додайте #відпустка до кафе, перельоту й готелю та побачите їх як одне ціле.",
  "tags.archivedHeader": "Архів ({count})",
  "tags.archivedExplain": "Архівні теги зберігають історію у звітах, але їх не можна вибрати для нових витрат.",
  "tags.hideTrigger": "Приховати тег",
  "tags.deleteTrigger": "Видалити тег",
  "tags.delete.expenseCountOne": "1 витрата позначена цим тегом.",
  "tags.delete.expenseCountMany": "{count} витрат позначені цим тегом.",
  "tags.delete.confirmHide": "Приховати {name}? {phrase}",
  "tags.delete.confirmDelete": "Видалити {name}?",
  "tags.delete.failureHide": "Не вдалося приховати {name}.",
  "tags.delete.failureDelete": "Не вдалося видалити {name}.",
  "tagForm.nameLabel": "Назва",
  "tagForm.namePlaceholder": "Назва тегу",
  "tagForm.nameError": "Дайте цьому тегу назву.",
  "tagForm.saveError.fallback": "Не вдалося зберегти цей тег.",
  "tagForm.save": "Зберегти",
  "tagForm.discardChanges": "Скасувати зміни в цьому тегу?",
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
