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
`statistics.py`, `bot/charts.py`) in U3.14.
"""

from typing import Final

from models.enums import Language

Catalogue = dict[str, str]

_en: Final[Catalogue] = {
    "readonly": "You don't have permission to do that.",
    "error.tryAgain": "Try again.",
    # Shared across handler modules regardless of which unit extracted them
    # (e.g. bot/keyboards.py::budgets_keyboard's category-name fallback,
    # bot/handlers/expenses.py's category-name fallback) — one word, one key.
    "common.unknown": "Unknown",
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
