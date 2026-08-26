"""InlineKeyboardMarkup builders — pure functions, no I/O (bot/CLAUDE.md).

The callback-data wire formats below are what handler filters (U4.3+) match
on: CallbackData factories for buttons carrying an id (aiogram packs UUIDs
as dashless hex, e.g. "category:<uuid.hex>"), plain string constants for
static buttons. Locked in by tests/test_bot_keyboards.py.

Button captions go through `bot/i18n.py::t()` (U3.13) — every builder that
renders one takes a `language: Language`. It defaults to `Language.EN` so
the handful of call sites in modules U3.14 still owns (`categories.py`,
`tags.py`, `budgets.py`, `statistics.py`) keep compiling and rendering
exactly as before without this unit reaching into their files; `expenses.py`
(also U3.13) always passes the caller's real resolved language explicitly.
The default is only a call-site convenience for those not-yet-updated
callers — every literal that actually lives in *this* file (including
`statistics_keyboard`'s preset/drilldown labels) is translated now, since
this unit owns the whole file regardless of who calls into it.
"""

from uuid import UUID

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from bot.i18n import t
from models.budget_plan import BudgetPlanResponse
from models.category import CategoryResponse
from models.enums import Language
from models.tag import TagResponse


class CategoryCallback(CallbackData, prefix="category"):
    category_id: UUID


class TagCallback(CallbackData, prefix="tag"):
    tag_id: UUID


class BudgetCallback(CallbackData, prefix="budget"):
    budget_plan_id: UUID


class ExpenseCallback(CallbackData, prefix="expense"):
    expense_id: UUID


TAGS_DONE_CALLBACK = "tags:done"
CONFIRM_CALLBACK = "expense:confirm"
CANCEL_CALLBACK = "expense:cancel"

EDIT_FIELD_AMOUNT_CALLBACK = "editfield:amount"
EDIT_FIELD_CATEGORY_CALLBACK = "editfield:category"
EDIT_FIELD_COMMENT_CALLBACK = "editfield:comment"
EDIT_FIELD_TAGS_CALLBACK = "editfield:tags"

STATISTICS_PERIOD_THIS_MONTH_CALLBACK = "statperiod:this_month"
STATISTICS_PERIOD_LAST_MONTH_CALLBACK = "statperiod:last_month"
STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK = "statperiod:last_3_months"
STATISTICS_BY_CATEGORY_CALLBACK = "statistics:by_category"
STATISTICS_BY_TAG_CALLBACK = "statistics:by_tag"
STATISTICS_CHART_CALLBACK = "statistics:chart"

# (callback_data, i18n key) pairs — labels are resolved per-call via t()
# inside statistics_keyboard, not baked in at import time, since the language
# isn't known until then.
_STATISTICS_PERIOD_PRESET_KEYS = [
    (STATISTICS_PERIOD_THIS_MONTH_CALLBACK, "kb.statistics.thisMonth"),
    (STATISTICS_PERIOD_LAST_MONTH_CALLBACK, "kb.statistics.lastMonth"),
    (STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK, "kb.statistics.last3Months"),
]

SELECTED_PREFIX = "✅ "


def categories_keyboard(categories: list[CategoryResponse]) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for category in categories:
        builder.button(text=category.name, callback_data=CategoryCallback(category_id=category.id))
    builder.adjust(2)
    return builder.as_markup()


def tags_keyboard(
    tags: list[TagResponse],
    selected: set[UUID] | None = None,
    language: Language = Language.EN,
) -> InlineKeyboardMarkup:
    """Multi-select: tapping a tag toggles it; "Done" proceeds with the selection."""
    selected = selected or set()
    builder = InlineKeyboardBuilder()
    for tag in tags:
        text = f"{SELECTED_PREFIX}{tag.name}" if tag.id in selected else tag.name
        builder.button(text=text, callback_data=TagCallback(tag_id=tag.id))
    builder.adjust(2)
    builder.row(
        InlineKeyboardButton(text=t(language, "kb.tagsDone"), callback_data=TAGS_DONE_CALLBACK)
    )
    return builder.as_markup()


def budgets_keyboard(
    plans: list[BudgetPlanResponse],
    category_names: dict[UUID, str],
    language: Language = Language.EN,
) -> InlineKeyboardMarkup:
    """Select an existing budget plan by its category's name (U2.2) — mirrors
    categories_keyboard/CategoryCallback's generic id-carrying-selector shape,
    but keyed on budget_plan_id since a plan, not a category, is the target."""
    builder = InlineKeyboardBuilder()
    for plan in plans:
        name = category_names.get(plan.category_id, t(language, "common.unknown"))
        builder.button(text=name, callback_data=BudgetCallback(budget_plan_id=plan.id))
    builder.adjust(2)
    return builder.as_markup()


def expenses_keyboard(items: list[tuple[UUID, str]]) -> InlineKeyboardMarkup:
    """Recent-expense picker (U2.1) — labeled by the caller-formatted
    "date amount" string since expenses have no name to display (unlike
    categories_keyboard/budgets_keyboard, which show entities with a name).
    One button per row: labels are longer than a category/tag name and
    Telegram truncates wide multi-column rows unpredictably."""
    builder = InlineKeyboardBuilder()
    for expense_id, label in items:
        builder.button(text=label, callback_data=ExpenseCallback(expense_id=expense_id))
    builder.adjust(1)
    return builder.as_markup()


def edit_field_keyboard(language: Language = Language.EN) -> InlineKeyboardMarkup:
    """Field picker for the expense-edit flow (U2.1b) — plain string
    callback-data (no id to carry), unlike expenses_keyboard/CategoryCallback."""
    builder = InlineKeyboardBuilder()
    builder.button(
        text=t(language, "kb.editField.amount"), callback_data=EDIT_FIELD_AMOUNT_CALLBACK
    )
    builder.button(
        text=t(language, "kb.editField.category"), callback_data=EDIT_FIELD_CATEGORY_CALLBACK
    )
    builder.button(
        text=t(language, "kb.editField.comment"), callback_data=EDIT_FIELD_COMMENT_CALLBACK
    )
    builder.button(text=t(language, "kb.editField.tags"), callback_data=EDIT_FIELD_TAGS_CALLBACK)
    builder.adjust(2)
    return builder.as_markup()


def statistics_keyboard(
    active_preset_callback: str, language: Language = Language.EN
) -> InlineKeyboardMarkup:
    """Period-preset row (active one marked) + drill-down entry points (U2.3).
    Presets are plain string callback-data (fixed set, like TAGS_DONE_CALLBACK)
    rather than a CallbackData factory since there's no id to carry."""
    builder = InlineKeyboardBuilder()
    for callback_data, key in _STATISTICS_PERIOD_PRESET_KEYS:
        label = t(language, key)
        text = f"{SELECTED_PREFIX}{label}" if callback_data == active_preset_callback else label
        builder.button(text=text, callback_data=callback_data)
    builder.adjust(3)
    builder.row(
        InlineKeyboardButton(
            text=t(language, "kb.statistics.byCategory"),
            callback_data=STATISTICS_BY_CATEGORY_CALLBACK,
        ),
        InlineKeyboardButton(
            text=t(language, "kb.statistics.byTag"), callback_data=STATISTICS_BY_TAG_CALLBACK
        ),
    )
    builder.row(
        InlineKeyboardButton(
            text=t(language, "kb.statistics.chart"), callback_data=STATISTICS_CHART_CALLBACK
        )
    )
    return builder.as_markup()


def confirm_keyboard(language: Language = Language.EN) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text=t(language, "kb.confirm"), callback_data=CONFIRM_CALLBACK)
    builder.button(text=t(language, "kb.cancel"), callback_data=CANCEL_CALLBACK)
    builder.adjust(2)
    return builder.as_markup()
