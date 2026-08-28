"""Bot-side translation runtime (U3.12, D700s contracts) — mirrors
`webapp/src/lib/i18n.ts`'s shape, adapted to the bot's per-update, per-caller
nature: there is no single "current language" module state here, since one
process serves every account's tg_ids concurrently. Callers pass the
caller's resolved `Language` (injected into handler data by
`bot/middlewares.py::AllowlistMiddleware`, D707) into every `t()` call.

RU and UK ship real content as of U3.15 (D702: every catalogue stays
key-complete, no aliasing EN). Handler string extraction: `bot/keyboards.py`
+ `bot/handlers/common.py` + `bot/handlers/expenses.py` in U3.13, the
remaining handler modules (`categories.py`, `tags.py`, `budgets.py`,
`statistics.py`, `bot/charts.py`) in U3.14 — `bot/charts.py` turned out to
carry no user-visible literal at all (every line it renders is a formatted
number/bar built from caller-supplied data), so U3.14 added no keys for it.
"""

from typing import Final

from models.enums import Language

Catalogue = dict[str, str]

_en: Final[Catalogue] = {
    "readonly": "You don't have permission to do that.",
    # U4.6 — shown by AllowlistMiddleware when the users/me probe comes back
    # 403 (D713). Same title/body `docs/ui/screens/10-admin.md` gives the
    # cross-cutting suspended state, one message regardless of whether it was
    # the user or their whole account that got blocked (the probe's 403
    # detail distinguishes the two but the copy shown to the caller doesn't
    # need to).
    "common.suspended": (
        "This account has been suspended.\n\n"
        "Contact your family's account owner if you think this is a mistake."
    ),
    "error.tryAgain": "Try again.",
    # New in U3.14, alongside error.tryAgain — the generic catch-all fallback
    # message, identical wording to expense.error.fallback (U3.13) but kept
    # as its own global key rather than repointing that file's own copy at
    # it (out of this unit's file list; would be a drive-by).
    "error.fallback": "Something went wrong. Please try again.",
    # Shared across handler modules regardless of which unit extracted them
    # (e.g. bot/keyboards.py::budgets_keyboard's category-name fallback,
    # bot/handlers/expenses.py's category-name fallback) — one word, one key.
    "common.unknown": "Unknown",
    # New in U3.14 — identical wording already lives under expense.* (U3.13)
    # and kb.cancel/kb.confirm-adjacent strings, but those are scoped to
    # files this unit doesn't own; categories.py/tags.py/budgets.py all use
    # this exact pair verbatim, so it's genuinely shared within this unit.
    "common.backendUnreachable": "Couldn't reach the backend. Please try again in a moment.",
    "common.cancelled": "Cancelled.",
    # bot/handlers/common.py (U3.13)
    "common.welcome": (
        "Welcome to CashFlow! Track shared family expenses, budgets and "
        "statistics right from this chat.\n\nSend /help to see what you can do."
    ),
    "common.help": "\n\n".join(
        [
            "Expenses:\n"
            "/add — add an expense\n"
            "/expenses — list recent expenses\n"
            "/editexpense — edit an expense\n"
            "/deleteexpense — delete an expense",
            "Categories:\n"
            "/categories — list categories\n"
            "/addcategory — add a category\n"
            "/renamecategory — rename a category\n"
            "/deletecategory — delete a category",
            "Tags:\n"
            "/tags — list tags\n"
            "/addtag — add a tag\n"
            "/renametag — rename a tag\n"
            "/deletetag — delete a tag",
            "Budgets:\n"
            "/budgets — list budget plans\n"
            "/addbudget — add a budget plan\n"
            "/updatebudget — update a budget plan\n"
            "/deletebudget — delete a budget plan",
            "Statistics:\n"
            "/statistics — period statistics, drill down by category/tag\n"
            "/chart — category breakdown for the active period",
            "Anytime:\n/cancel — cancel the current action",
        ]
    ),
    # bot/keyboards.py (U3.13)
    "kb.tagsDone": "Done",
    "kb.editField.amount": "Amount",
    "kb.editField.category": "Category",
    "kb.editField.comment": "Comment",
    "kb.editField.tags": "Tags",
    "kb.confirm": "✅ Confirm",
    "kb.cancel": "❌ Cancel",
    "kb.statistics.thisMonth": "This month",
    "kb.statistics.lastMonth": "Last month",
    "kb.statistics.last3Months": "Last 3 months",
    "kb.statistics.byCategory": "By category…",
    "kb.statistics.byTag": "By tag…",
    "kb.statistics.chart": "📊 Chart",
    # bot/handlers/expenses.py (U3.13)
    "expense.backendUnreachable": "Couldn't reach the backend. Please try again in a moment.",
    "expense.noCategories": "No categories found. Ask an admin to add one first.",
    "expense.chooseCategory": "Choose a category:",
    "expense.unknownCategory": "Unknown category, please pick again.",
    "expense.enterAmount": "Enter the amount (e.g. 12.50 or 12,50):",
    "expense.invalidAmount": "That doesn't look like a valid amount. Try again (e.g. 12.50):",
    "expense.enterComment": "Add a comment, or send /skip:",
    "expense.pickTags": "Pick tags (tap Done when finished):",
    "expense.createFailed": "Something went wrong saving the expense. Please try again with /add.",
    "expense.saved": "Expense saved: {amount}",
    "expense.cancelledToast": "Cancelled",
    "expense.cancelled": "Cancelled.",
    "expense.error.staleExpense": "That expense no longer exists.",
    "expense.error.fallback": "Something went wrong. Please try again.",
    "expense.confirmTitle": "Confirm this expense:",
    "expense.field.category": "Category:",
    "expense.field.amount": "Amount:",
    "expense.field.comment": "Comment:",
    "expense.field.tags": "Tags:",
    "expense.field.date": "Date:",
    "expense.field.addedBy": "Added by:",
    "expense.listTitle": "Your expenses:",
    "expense.listItem.by": "by {name}",
    "expense.listMore": "...and {remaining} more not shown.",
    "expense.noExpenses": "No expenses yet.",
    "expense.noExpensesToDelete": "No expenses to delete yet.",
    "expense.pickToDelete": "Pick an expense to delete:",
    "expense.unknownExpense": "Unknown expense, please pick again.",
    "expense.deleteConfirmTitle": "Delete this expense?",
    "expense.deleted": "Expense deleted.",
    "expense.noExpensesToEdit": "No expenses to edit yet.",
    "expense.pickToEdit": "Pick an expense to edit:",
    "expense.editPromptTitle": "What do you want to edit?",
    "expense.editEnterAmount": "Enter the new amount (e.g. 12.50 or 12,50):",
    "expense.editEnterComment": "Enter the new comment:",
    "expense.editChooseCategory": "Choose a new category:",
    "expense.updated": "Expense updated: {amount}",
    # bot/handlers/categories.py (U3.14)
    "categories.deleted": "Category deleted.",
    "categories.archived": (
        "Category hidden — it's still attached to past expenses, so it no "
        "longer appears when adding new ones, but old expenses keep showing it."
    ),
    "categories.error.inUse": "This category is still in use by expenses or budget plans.",
    "categories.empty": "No categories yet.",
    "categories.listTitle": "Categories:",
    "categories.enterName": "Enter the new category's name:",
    "categories.nameEmpty": "Name can't be empty. Try again:",
    "categories.added": "Category added: {name}",
    "categories.noneToRename": "No categories to rename yet.",
    "categories.pickToRename": "Which category do you want to rename?",
    "categories.enterNewName": "Enter the new name:",
    "categories.renamed": "Category renamed to: {name}",
    "categories.noneToDelete": "No categories to delete yet.",
    "categories.pickToDelete": "Which category do you want to delete?",
    # bot/handlers/tags.py (U3.14) — mechanical mirror of categories.* above,
    # per the file's own docstring precedent (D43).
    "tags.deleted": "Tag deleted.",
    "tags.archived": (
        "Tag hidden — it's still attached to past expenses, so it no longer "
        "appears when adding new ones, but old expenses keep showing it."
    ),
    "tags.empty": "No tags yet.",
    "tags.listTitle": "Tags:",
    "tags.enterName": "Enter the new tag's name:",
    "tags.nameEmpty": "Name can't be empty. Try again:",
    "tags.added": "Tag added: {name}",
    "tags.noneToRename": "No tags to rename yet.",
    "tags.pickToRename": "Which tag do you want to rename?",
    "tags.enterNewName": "Enter the new name:",
    "tags.renamed": "Tag renamed to: {name}",
    "tags.noneToDelete": "No tags to delete yet.",
    "tags.pickToDelete": "Which tag do you want to delete?",
    # bot/handlers/budgets.py (U3.14)
    "budgets.error.duplicate": "A budget plan already exists for this category and period.",
    "budgets.noLimitSet": "[no limit set]",
    "budgets.exceeded": "⚠️ Budget exceeded!",
    "budgets.approachingLimit": "⚠️ Approaching limit",
    "budgets.empty": "No budget plans yet.",
    "budgets.progressLoadFailed": "{name}: couldn't load progress.",
    "budgets.listTitle": "Budgets:",
    "budgets.noCategories": "No categories to set a budget for yet.",
    "budgets.pickCategory": "Which category do you want to set a budget for?",
    "budgets.unknownCategory": "Unknown category, please pick again.",
    "budgets.enterLimit": "Enter the monthly limit for {category} (e.g. 100.00):",
    "budgets.invalidAmount": "That doesn't look like a valid amount. Try again (e.g. 100.00):",
    "budgets.thresholdPrompt": "Alert threshold percent 0-100 (default {default}), or /skip:",
    "budgets.thresholdInvalid": "Enter a whole number 0-100, or /skip:",
    "budgets.theCategoryFallback": "the category",
    "budgets.set": "Budget set: {category} — {amount} / month, alert at {threshold}%.",
    "budgets.noneToUpdate": "No budget plans to update yet.",
    "budgets.pickToUpdate": "Which budget do you want to update?",
    "budgets.unknownPlan": "Unknown budget plan, please pick again.",
    "budgets.enterNewLimit": (
        "Enter the new monthly limit for {category} (currently {current}), or /skip to keep it:"
    ),
    "budgets.invalidAmountSkip": "That doesn't look like a valid amount. Try again, or /skip:",
    "budgets.newThresholdPrompt": "New alert threshold percent 0-100, or /skip to keep it:",
    "budgets.nothingChanged": "Nothing changed.",
    "budgets.updated": "Budget updated: {category} — {amount} / month, alert at {threshold}%.",
    "budgets.noneToDelete": "No budget plans to delete yet.",
    "budgets.pickToDelete": "Which budget do you want to delete?",
    "budgets.deleted": "Budget deleted.",
    # bot/handlers/statistics.py (U3.14)
    "statistics.emptyPeriod": "No expenses in this period.",
    "statistics.nothingToChart": "Nothing to chart in this period.",
    "statistics.headingWithLabel": "Statistics for {label}, ",
    "statistics.headingPlain": "Statistics for ",
    "statistics.total": "Total: {amount}",
    "statistics.byCategoryHeading": "By category:",
    "statistics.byTagHeading": "By tag:",
    "statistics.noCategoriesFound": "No categories found.",
    "statistics.chooseCategory": "Choose a category:",
    "statistics.noTagsFound": "No tags found.",
    "statistics.chooseTag": "Choose a tag:",
}

_ru: Final[Catalogue] = {
    "readonly": "У вас нет прав на это действие.",
    "common.suspended": (
        "Этот аккаунт заблокирован.\n\n"
        "Если вы считаете, что это ошибка, обратитесь к владельцу вашего "
        "семейного аккаунта."
    ),
    "error.tryAgain": "Попробуйте ещё раз.",
    "error.fallback": "Что-то пошло не так. Попробуйте ещё раз.",
    "common.unknown": "Неизвестно",
    "common.backendUnreachable": (
        "Не удалось связаться с сервером. Попробуйте ещё раз через минуту."
    ),
    "common.cancelled": "Отменено.",
    "common.welcome": (
        "Добро пожаловать в CashFlow! Ведите общий семейный учёт расходов, "
        "бюджетов и статистики прямо в этом чате.\n\nОтправьте /help, чтобы "
        "увидеть, что умеет бот."
    ),
    "common.help": "\n\n".join(
        [
            "Расходы:\n"
            "/add — добавить расход\n"
            "/expenses — список последних расходов\n"
            "/editexpense — изменить расход\n"
            "/deleteexpense — удалить расход",
            "Категории:\n"
            "/categories — список категорий\n"
            "/addcategory — добавить категорию\n"
            "/renamecategory — переименовать категорию\n"
            "/deletecategory — удалить категорию",
            "Теги:\n"
            "/tags — список тегов\n"
            "/addtag — добавить тег\n"
            "/renametag — переименовать тег\n"
            "/deletetag — удалить тег",
            "Бюджеты:\n"
            "/budgets — список бюджетов\n"
            "/addbudget — добавить бюджет\n"
            "/updatebudget — изменить бюджет\n"
            "/deletebudget — удалить бюджет",
            "Статистика:\n"
            "/statistics — статистика за период с разбивкой по категориям/тегам\n"
            "/chart — диаграмма по категориям за текущий период",
            "В любой момент:\n/cancel — отменить текущее действие",
        ]
    ),
    "kb.tagsDone": "Готово",
    "kb.editField.amount": "Сумма",
    "kb.editField.category": "Категория",
    "kb.editField.comment": "Комментарий",
    "kb.editField.tags": "Теги",
    "kb.confirm": "✅ Подтвердить",
    "kb.cancel": "❌ Отмена",
    "kb.statistics.thisMonth": "Этот месяц",
    "kb.statistics.lastMonth": "Прошлый месяц",
    "kb.statistics.last3Months": "Последние 3 месяца",
    "kb.statistics.byCategory": "По категории…",
    "kb.statistics.byTag": "По тегу…",
    "kb.statistics.chart": "📊 Диаграмма",
    "expense.backendUnreachable": (
        "Не удалось связаться с сервером. Попробуйте ещё раз через минуту."
    ),
    "expense.noCategories": (
        "Категорий пока нет. Попросите администратора сначала добавить хотя бы одну."
    ),
    "expense.chooseCategory": "Выберите категорию:",
    "expense.unknownCategory": "Неизвестная категория, выберите ещё раз.",
    "expense.enterAmount": "Введите сумму (например, 12.50 или 12,50):",
    "expense.invalidAmount": "Это не похоже на сумму. Попробуйте ещё раз (например, 12.50):",
    "expense.enterComment": "Добавьте комментарий или отправьте /skip:",
    "expense.pickTags": "Выберите теги (нажмите «Готово», когда закончите):",
    "expense.createFailed": "Не удалось сохранить расход. Попробуйте ещё раз через /add.",
    "expense.saved": "Расход сохранён: {amount}",
    "expense.cancelledToast": "Отменено",
    "expense.cancelled": "Отменено.",
    "expense.error.staleExpense": "Этот расход больше не существует.",
    "expense.error.fallback": "Что-то пошло не так. Попробуйте ещё раз.",
    "expense.confirmTitle": "Подтвердите расход:",
    "expense.field.category": "Категория:",
    "expense.field.amount": "Сумма:",
    "expense.field.comment": "Комментарий:",
    "expense.field.tags": "Теги:",
    "expense.field.date": "Дата:",
    "expense.field.addedBy": "Добавил(а):",
    "expense.listTitle": "Ваши расходы:",
    "expense.listItem.by": "от {name}",
    "expense.listMore": "...и ещё {remaining} не показано.",
    "expense.noExpenses": "Расходов пока нет.",
    "expense.noExpensesToDelete": "Пока нет расходов для удаления.",
    "expense.pickToDelete": "Выберите расход для удаления:",
    "expense.unknownExpense": "Неизвестный расход, выберите ещё раз.",
    "expense.deleteConfirmTitle": "Удалить этот расход?",
    "expense.deleted": "Расход удалён.",
    "expense.noExpensesToEdit": "Пока нет расходов для изменения.",
    "expense.pickToEdit": "Выберите расход для изменения:",
    "expense.editPromptTitle": "Что вы хотите изменить?",
    "expense.editEnterAmount": "Введите новую сумму (например, 12.50 или 12,50):",
    "expense.editEnterComment": "Введите новый комментарий:",
    "expense.editChooseCategory": "Выберите новую категорию:",
    "expense.updated": "Расход обновлён: {amount}",
    "categories.deleted": "Категория удалена.",
    "categories.archived": (
        "Категория скрыта — она остаётся привязана к прошлым расходам, поэтому "
        "больше не появляется при добавлении новых, но старые расходы "
        "по-прежнему её показывают."
    ),
    "categories.error.inUse": "Эта категория всё ещё используется в расходах или бюджетах.",
    "categories.empty": "Категорий пока нет.",
    "categories.listTitle": "Категории:",
    "categories.enterName": "Введите название новой категории:",
    "categories.nameEmpty": "Название не может быть пустым. Попробуйте ещё раз:",
    "categories.added": "Категория добавлена: {name}",
    "categories.noneToRename": "Пока нет категорий для переименования.",
    "categories.pickToRename": "Какую категорию вы хотите переименовать?",
    "categories.enterNewName": "Введите новое название:",
    "categories.renamed": "Категория переименована в: {name}",
    "categories.noneToDelete": "Пока нет категорий для удаления.",
    "categories.pickToDelete": "Какую категорию вы хотите удалить?",
    "tags.deleted": "Тег удалён.",
    "tags.archived": (
        "Тег скрыт — он остаётся привязан к прошлым расходам, поэтому больше "
        "не появляется при добавлении новых, но старые расходы по-прежнему "
        "его показывают."
    ),
    "tags.empty": "Тегов пока нет.",
    "tags.listTitle": "Теги:",
    "tags.enterName": "Введите название нового тега:",
    "tags.nameEmpty": "Название не может быть пустым. Попробуйте ещё раз:",
    "tags.added": "Тег добавлен: {name}",
    "tags.noneToRename": "Пока нет тегов для переименования.",
    "tags.pickToRename": "Какой тег вы хотите переименовать?",
    "tags.enterNewName": "Введите новое название:",
    "tags.renamed": "Тег переименован в: {name}",
    "tags.noneToDelete": "Пока нет тегов для удаления.",
    "tags.pickToDelete": "Какой тег вы хотите удалить?",
    "budgets.error.duplicate": "Бюджет для этой категории и периода уже существует.",
    "budgets.noLimitSet": "[лимит не задан]",
    "budgets.exceeded": "⚠️ Бюджет превышен!",
    "budgets.approachingLimit": "⚠️ Приближается к лимиту",
    "budgets.empty": "Бюджетов пока нет.",
    "budgets.progressLoadFailed": "{name}: не удалось загрузить прогресс.",
    "budgets.listTitle": "Бюджеты:",
    "budgets.noCategories": "Пока нет категорий для установки бюджета.",
    "budgets.pickCategory": "Для какой категории вы хотите установить бюджет?",
    "budgets.unknownCategory": "Неизвестная категория, выберите ещё раз.",
    "budgets.enterLimit": "Введите месячный лимит для категории «{category}» (например, 100.00):",
    "budgets.invalidAmount": "Это не похоже на сумму. Попробуйте ещё раз (например, 100.00):",
    "budgets.thresholdPrompt": (
        "Порог оповещения в процентах 0-100 (по умолчанию {default}), или /skip:"
    ),
    "budgets.thresholdInvalid": "Введите целое число от 0 до 100, или /skip:",
    "budgets.theCategoryFallback": "категория",
    "budgets.set": "Бюджет установлен: {category} — {amount} / месяц, оповещение при {threshold}%.",
    "budgets.noneToUpdate": "Пока нет бюджетов для изменения.",
    "budgets.pickToUpdate": "Какой бюджет вы хотите изменить?",
    "budgets.unknownPlan": "Неизвестный бюджет, выберите ещё раз.",
    "budgets.enterNewLimit": (
        "Введите новый месячный лимит для категории «{category}» (сейчас {current}), "
        "или /skip, чтобы оставить как есть:"
    ),
    "budgets.invalidAmountSkip": "Это не похоже на сумму. Попробуйте ещё раз, или /skip:",
    "budgets.newThresholdPrompt": (
        "Новый порог оповещения в процентах 0-100, или /skip, чтобы оставить как есть:"
    ),
    "budgets.nothingChanged": "Ничего не изменилось.",
    "budgets.updated": (
        "Бюджет обновлён: {category} — {amount} / месяц, оповещение при {threshold}%."
    ),
    "budgets.noneToDelete": "Пока нет бюджетов для удаления.",
    "budgets.pickToDelete": "Какой бюджет вы хотите удалить?",
    "budgets.deleted": "Бюджет удалён.",
    "statistics.emptyPeriod": "За этот период расходов нет.",
    "statistics.nothingToChart": "Нечего показать на диаграмме за этот период.",
    "statistics.headingWithLabel": "Статистика за {label}, ",
    "statistics.headingPlain": "Статистика за ",
    "statistics.total": "Итого: {amount}",
    "statistics.byCategoryHeading": "По категориям:",
    "statistics.byTagHeading": "По тегам:",
    "statistics.noCategoriesFound": "Категории не найдены.",
    "statistics.chooseCategory": "Выберите категорию:",
    "statistics.noTagsFound": "Теги не найдены.",
    "statistics.chooseTag": "Выберите тег:",
}

_uk: Final[Catalogue] = {
    "readonly": "У вас немає прав на цю дію.",
    "common.suspended": (
        "Цей акаунт заблоковано.\n\n"
        "Якщо ви вважаєте, що це помилка, зверніться до власника вашого "
        "сімейного акаунта."
    ),
    "error.tryAgain": "Спробуйте ще раз.",
    "error.fallback": "Щось пішло не так. Спробуйте ще раз.",
    "common.unknown": "Невідомо",
    "common.backendUnreachable": "Не вдалося зв'язатися із сервером. Спробуйте ще раз за хвилину.",
    "common.cancelled": "Скасовано.",
    "common.welcome": (
        "Ласкаво просимо до CashFlow! Ведіть спільний облік сімейних витрат, "
        "бюджетів і статистики просто в цьому чаті.\n\nНадішліть /help, щоб "
        "побачити, що вміє бот."
    ),
    "common.help": "\n\n".join(
        [
            "Витрати:\n"
            "/add — додати витрату\n"
            "/expenses — список останніх витрат\n"
            "/editexpense — змінити витрату\n"
            "/deleteexpense — видалити витрату",
            "Категорії:\n"
            "/categories — список категорій\n"
            "/addcategory — додати категорію\n"
            "/renamecategory — перейменувати категорію\n"
            "/deletecategory — видалити категорію",
            "Теги:\n"
            "/tags — список тегів\n"
            "/addtag — додати тег\n"
            "/renametag — перейменувати тег\n"
            "/deletetag — видалити тег",
            "Бюджети:\n"
            "/budgets — список бюджетів\n"
            "/addbudget — додати бюджет\n"
            "/updatebudget — змінити бюджет\n"
            "/deletebudget — видалити бюджет",
            "Статистика:\n"
            "/statistics — статистика за період з розбивкою за категоріями/тегами\n"
            "/chart — діаграма за категоріями за поточний період",
            "У будь-який момент:\n/cancel — скасувати поточну дію",
        ]
    ),
    "kb.tagsDone": "Готово",
    "kb.editField.amount": "Сума",
    "kb.editField.category": "Категорія",
    "kb.editField.comment": "Коментар",
    "kb.editField.tags": "Теги",
    "kb.confirm": "✅ Підтвердити",
    "kb.cancel": "❌ Скасувати",
    "kb.statistics.thisMonth": "Цей місяць",
    "kb.statistics.lastMonth": "Минулий місяць",
    "kb.statistics.last3Months": "Останні 3 місяці",
    "kb.statistics.byCategory": "За категорією…",
    "kb.statistics.byTag": "За тегом…",
    "kb.statistics.chart": "📊 Діаграма",
    "expense.backendUnreachable": (
        "Не вдалося зв'язатися із сервером. Спробуйте ще раз за хвилину."
    ),
    "expense.noCategories": (
        "Категорій ще немає. Попросіть адміністратора спочатку додати хоча б одну."
    ),
    "expense.chooseCategory": "Виберіть категорію:",
    "expense.unknownCategory": "Невідома категорія, виберіть ще раз.",
    "expense.enterAmount": "Введіть суму (наприклад, 12.50 або 12,50):",
    "expense.invalidAmount": "Це не схоже на суму. Спробуйте ще раз (наприклад, 12.50):",
    "expense.enterComment": "Додайте коментар або надішліть /skip:",
    "expense.pickTags": "Виберіть теги (натисніть «Готово», коли закінчите):",
    "expense.createFailed": "Не вдалося зберегти витрату. Спробуйте ще раз через /add.",
    "expense.saved": "Витрату збережено: {amount}",
    "expense.cancelledToast": "Скасовано",
    "expense.cancelled": "Скасовано.",
    "expense.error.staleExpense": "Ця витрата більше не існує.",
    "expense.error.fallback": "Щось пішло не так. Спробуйте ще раз.",
    "expense.confirmTitle": "Підтвердьте витрату:",
    "expense.field.category": "Категорія:",
    "expense.field.amount": "Сума:",
    "expense.field.comment": "Коментар:",
    "expense.field.tags": "Теги:",
    "expense.field.date": "Дата:",
    "expense.field.addedBy": "Додав(ла):",
    "expense.listTitle": "Ваші витрати:",
    "expense.listItem.by": "від {name}",
    "expense.listMore": "...і ще {remaining} не показано.",
    "expense.noExpenses": "Витрат поки немає.",
    "expense.noExpensesToDelete": "Поки немає витрат для видалення.",
    "expense.pickToDelete": "Виберіть витрату для видалення:",
    "expense.unknownExpense": "Невідома витрата, виберіть ще раз.",
    "expense.deleteConfirmTitle": "Видалити цю витрату?",
    "expense.deleted": "Витрату видалено.",
    "expense.noExpensesToEdit": "Поки немає витрат для зміни.",
    "expense.pickToEdit": "Виберіть витрату для зміни:",
    "expense.editPromptTitle": "Що ви хочете змінити?",
    "expense.editEnterAmount": "Введіть нову суму (наприклад, 12.50 або 12,50):",
    "expense.editEnterComment": "Введіть новий коментар:",
    "expense.editChooseCategory": "Виберіть нову категорію:",
    "expense.updated": "Витрату оновлено: {amount}",
    "categories.deleted": "Категорію видалено.",
    "categories.archived": (
        "Категорію приховано — вона залишається прив'язаною до минулих "
        "витрат, тому більше не з'являється під час додавання нових, але "
        "старі витрати й далі її показують."
    ),
    "categories.error.inUse": "Ця категорія досі використовується у витратах або бюджетах.",
    "categories.empty": "Категорій поки немає.",
    "categories.listTitle": "Категорії:",
    "categories.enterName": "Введіть назву нової категорії:",
    "categories.nameEmpty": "Назва не може бути порожньою. Спробуйте ще раз:",
    "categories.added": "Категорію додано: {name}",
    "categories.noneToRename": "Поки немає категорій для перейменування.",
    "categories.pickToRename": "Яку категорію ви хочете перейменувати?",
    "categories.enterNewName": "Введіть нову назву:",
    "categories.renamed": "Категорію перейменовано на: {name}",
    "categories.noneToDelete": "Поки немає категорій для видалення.",
    "categories.pickToDelete": "Яку категорію ви хочете видалити?",
    "tags.deleted": "Тег видалено.",
    "tags.archived": (
        "Тег приховано — він залишається прив'язаним до минулих витрат, тому "
        "більше не з'являється під час додавання нових, але старі витрати й "
        "далі його показують."
    ),
    "tags.empty": "Тегів поки немає.",
    "tags.listTitle": "Теги:",
    "tags.enterName": "Введіть назву нового тега:",
    "tags.nameEmpty": "Назва не може бути порожньою. Спробуйте ще раз:",
    "tags.added": "Тег додано: {name}",
    "tags.noneToRename": "Поки немає тегів для перейменування.",
    "tags.pickToRename": "Який тег ви хочете перейменувати?",
    "tags.enterNewName": "Введіть нову назву:",
    "tags.renamed": "Тег перейменовано на: {name}",
    "tags.noneToDelete": "Поки немає тегів для видалення.",
    "tags.pickToDelete": "Який тег ви хочете видалити?",
    "budgets.error.duplicate": "Бюджет для цієї категорії та періоду вже існує.",
    "budgets.noLimitSet": "[ліміт не встановлено]",
    "budgets.exceeded": "⚠️ Бюджет перевищено!",
    "budgets.approachingLimit": "⚠️ Наближається до ліміту",
    "budgets.empty": "Бюджетів поки немає.",
    "budgets.progressLoadFailed": "{name}: не вдалося завантажити прогрес.",
    "budgets.listTitle": "Бюджети:",
    "budgets.noCategories": "Поки немає категорій для встановлення бюджету.",
    "budgets.pickCategory": "Для якої категорії ви хочете встановити бюджет?",
    "budgets.unknownCategory": "Невідома категорія, виберіть ще раз.",
    "budgets.enterLimit": "Введіть місячний ліміт для категорії «{category}» (наприклад, 100.00):",
    "budgets.invalidAmount": "Це не схоже на суму. Спробуйте ще раз (наприклад, 100.00):",
    "budgets.thresholdPrompt": (
        "Поріг оповіщення у відсотках 0-100 (за замовчуванням {default}), або /skip:"
    ),
    "budgets.thresholdInvalid": "Введіть ціле число від 0 до 100, або /skip:",
    "budgets.theCategoryFallback": "категорія",
    "budgets.set": (
        "Бюджет встановлено: {category} — {amount} / місяць, оповіщення при {threshold}%."
    ),
    "budgets.noneToUpdate": "Поки немає бюджетів для зміни.",
    "budgets.pickToUpdate": "Який бюджет ви хочете змінити?",
    "budgets.unknownPlan": "Невідомий бюджет, виберіть ще раз.",
    "budgets.enterNewLimit": (
        "Введіть новий місячний ліміт для категорії «{category}» (зараз {current}), "
        "або /skip, щоб залишити як є:"
    ),
    "budgets.invalidAmountSkip": "Це не схоже на суму. Спробуйте ще раз, або /skip:",
    "budgets.newThresholdPrompt": (
        "Новий поріг оповіщення у відсотках 0-100, або /skip, щоб залишити як є:"
    ),
    "budgets.nothingChanged": "Нічого не змінилося.",
    "budgets.updated": (
        "Бюджет оновлено: {category} — {amount} / місяць, оповіщення при {threshold}%."
    ),
    "budgets.noneToDelete": "Поки немає бюджетів для видалення.",
    "budgets.pickToDelete": "Який бюджет ви хочете видалити?",
    "budgets.deleted": "Бюджет видалено.",
    "statistics.emptyPeriod": "За цей період витрат немає.",
    "statistics.nothingToChart": "Немає чого показати на діаграмі за цей період.",
    "statistics.headingWithLabel": "Статистика за {label}, ",
    "statistics.headingPlain": "Статистика за ",
    "statistics.total": "Разом: {amount}",
    "statistics.byCategoryHeading": "За категоріями:",
    "statistics.byTagHeading": "За тегами:",
    "statistics.noCategoriesFound": "Категорії не знайдено.",
    "statistics.chooseCategory": "Виберіть категорію:",
    "statistics.noTagsFound": "Теги не знайдено.",
    "statistics.chooseTag": "Виберіть тег:",
}

_catalogues: Final[dict[Language, Catalogue]] = {
    Language.EN: _en,
    Language.RU: _ru,
    Language.UK: _uk,
}


class _LeaveUnmatched(dict[str, object]):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def t(language: Language, key: str, **variables: str | int) -> str:
    """Looks up `key` in `language`'s catalogue and fills in `{var}`
    placeholders. Telegram messages in this bot are sent with no
    `parse_mode` (plain text, checked bot-wide) — unlike the webapp's `t()`,
    no HTML-escaping is applied here. A placeholder with no matching var is
    left untouched rather than silently dropped, same as the webapp's
    version."""
    template = _catalogues[language][key]
    if not variables:
        return template
    return template.format_map(_LeaveUnmatched(variables))
