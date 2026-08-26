"""Bot-side translation runtime (U3.12, D700s contracts) — mirrors
`webapp/src/lib/i18n.ts`'s shape, adapted to the bot's per-update, per-caller
nature: there is no single "current language" module state here, since one
process serves every account's tg_ids concurrently. Callers pass the
caller's resolved `Language` (injected into handler data by
`bot/middlewares.py::AllowlistMiddleware`, D707) into every `t()` call.

EN catalogue only — RU and UK ship in U3.15; until then every `Language`
falls back to the EN catalogue rather than raising on an account already set
to one of them server-side. Handler string extraction: `bot/keyboards.py` +
`bot/handlers/common.py` + `bot/handlers/expenses.py` in U3.13, the
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

_catalogues: Final[dict[Language, Catalogue]] = {
    Language.EN: _en,
    Language.RU: _en,
    Language.UK: _en,
}


class _LeaveUnmatched(dict[str, object]):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def t(language: Language, key: str, **variables: str | int) -> str:
    """Looks up `key` in `language`'s catalogue (falling back to EN, per the
    module doc above) and fills in `{var}` placeholders. Telegram messages in
    this bot are sent with no `parse_mode` (plain text, checked bot-wide) —
    unlike the webapp's `t()`, no HTML-escaping is applied here. A
    placeholder with no matching var is left untouched rather than silently
    dropped, same as the webapp's version."""
    template = _catalogues[language][key]
    if not variables:
        return template
    return template.format_map(_LeaveUnmatched(variables))
