"""InlineKeyboardMarkup builders — pure functions, no I/O (bot/CLAUDE.md).

The callback-data wire formats below are what handler filters (U4.3+) match
on: CallbackData factories for buttons carrying an id (aiogram packs UUIDs
as dashless hex, e.g. "category:<uuid.hex>"), plain string constants for
static buttons. Locked in by tests/test_bot_keyboards.py.
"""

from uuid import UUID

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from models.budget_plan import BudgetPlanResponse
from models.category import CategoryResponse
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

_STATISTICS_PERIOD_PRESETS = [
    (STATISTICS_PERIOD_THIS_MONTH_CALLBACK, "This month"),
    (STATISTICS_PERIOD_LAST_MONTH_CALLBACK, "Last month"),
    (STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK, "Last 3 months"),
]

SELECTED_PREFIX = "✅ "


def categories_keyboard(categories: list[CategoryResponse]) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for category in categories:
        builder.button(text=category.name, callback_data=CategoryCallback(category_id=category.id))
    builder.adjust(2)
    return builder.as_markup()


def tags_keyboard(
    tags: list[TagResponse], selected: set[UUID] | None = None
) -> InlineKeyboardMarkup:
    """Multi-select: tapping a tag toggles it; "Done" proceeds with the selection."""
    selected = selected or set()
    builder = InlineKeyboardBuilder()
    for tag in tags:
        text = f"{SELECTED_PREFIX}{tag.name}" if tag.id in selected else tag.name
        builder.button(text=text, callback_data=TagCallback(tag_id=tag.id))
    builder.adjust(2)
    builder.row(InlineKeyboardButton(text="Done", callback_data=TAGS_DONE_CALLBACK))
    return builder.as_markup()


def budgets_keyboard(
    plans: list[BudgetPlanResponse], category_names: dict[UUID, str]
) -> InlineKeyboardMarkup:
    """Select an existing budget plan by its category's name (U2.2) — mirrors
    categories_keyboard/CategoryCallback's generic id-carrying-selector shape,
    but keyed on budget_plan_id since a plan, not a category, is the target."""
    builder = InlineKeyboardBuilder()
    for plan in plans:
        name = category_names.get(plan.category_id, "Unknown")
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


def edit_field_keyboard() -> InlineKeyboardMarkup:
    """Field picker for the expense-edit flow (U2.1b) — plain string
    callback-data (no id to carry), unlike expenses_keyboard/CategoryCallback."""
    builder = InlineKeyboardBuilder()
    builder.button(text="Amount", callback_data=EDIT_FIELD_AMOUNT_CALLBACK)
    builder.button(text="Category", callback_data=EDIT_FIELD_CATEGORY_CALLBACK)
    builder.button(text="Comment", callback_data=EDIT_FIELD_COMMENT_CALLBACK)
    builder.button(text="Tags", callback_data=EDIT_FIELD_TAGS_CALLBACK)
    builder.adjust(2)
    return builder.as_markup()


def statistics_keyboard(active_preset_callback: str) -> InlineKeyboardMarkup:
    """Period-preset row (active one marked) + drill-down entry points (U2.3).
    Presets are plain string callback-data (fixed set, like TAGS_DONE_CALLBACK)
    rather than a CallbackData factory since there's no id to carry."""
    builder = InlineKeyboardBuilder()
    for callback_data, label in _STATISTICS_PERIOD_PRESETS:
        text = f"{SELECTED_PREFIX}{label}" if callback_data == active_preset_callback else label
        builder.button(text=text, callback_data=callback_data)
    builder.adjust(3)
    builder.row(
        InlineKeyboardButton(text="By category…", callback_data=STATISTICS_BY_CATEGORY_CALLBACK),
        InlineKeyboardButton(text="By tag…", callback_data=STATISTICS_BY_TAG_CALLBACK),
    )
    builder.row(InlineKeyboardButton(text="📊 Chart", callback_data=STATISTICS_CHART_CALLBACK))
    return builder.as_markup()


def confirm_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="✅ Confirm", callback_data=CONFIRM_CALLBACK)
    builder.button(text="❌ Cancel", callback_data=CANCEL_CALLBACK)
    builder.adjust(2)
    return builder.as_markup()
