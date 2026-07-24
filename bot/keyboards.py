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


def confirm_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="✅ Confirm", callback_data=CONFIRM_CALLBACK)
    builder.button(text="❌ Cancel", callback_data=CANCEL_CALLBACK)
    builder.adjust(2)
    return builder.as_markup()
