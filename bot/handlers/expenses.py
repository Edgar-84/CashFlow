"""Expense-creation FSM (bot/CLAUDE.md canonical flow):
category -> amount -> [comment] -> [tags] -> confirm.
Also hosts the `/expenses` list view (U4.3b, plan Decision log D39) — a
plain command handler, no FSM state involved.

FSM state stores fetched CategoryResponse/TagResponse objects directly (not
just ids) so a callback (category pick, tag toggle) can look up display
names/redraw a keyboard without an extra API round trip. Safe today because
`Dispatcher()` (bot/bot.py) uses aiogram's default MemoryStorage, which keeps
state data as plain in-process objects with no serialization (see
`aiogram.fsm.storage.memory.MemoryStorage`) — revisit if V1 ever moves to a
persistent storage backend (e.g. Redis), which would require JSON-safe data.

Handlers are plain module-level functions (directly unit-testable, see
tests/test_bot_handlers_expenses.py) registered onto a *fresh* Router by
`create_router()` rather than a module-level `Router()` singleton — aiogram
routers can only ever be attached to one parent Dispatcher, and `create_router`
must be callable more than once (bot.py's `create_dispatcher` is called once
per test in tests/test_bot_bot.py).
"""

import logging
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Protocol
from uuid import UUID

import httpx
from aiogram import F, Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from bot.keyboards import (
    CANCEL_CALLBACK,
    CONFIRM_CALLBACK,
    TAGS_DONE_CALLBACK,
    CategoryCallback,
    TagCallback,
    categories_keyboard,
    confirm_keyboard,
    tags_keyboard,
)
from bot.states import AddExpense
from models.category import CategoryResponse
from models.expense import ExpenseCreate, ExpenseResponse
from models.tag import TagResponse

logger = logging.getLogger(__name__)


class ExpenseBackendClient(Protocol):
    """Structural subset of bot/client.py's BackendClient this module calls —
    lets tests pass a fake without depending on the concrete httpx-backed class."""

    async def list_categories(self) -> list[CategoryResponse]: ...
    async def list_tags(self) -> list[TagResponse]: ...
    async def create_expense(self, data: ExpenseCreate) -> ExpenseResponse: ...
    async def list_expenses(self) -> list[ExpenseResponse]: ...


def parse_amount_to_minor_units(text: str) -> int:
    """Parse user-entered amount text to minor units (kopecks/cents).

    Accepts "12.50", "12,50", "1 234,56" (space/nbsp thousands separator).
    Raises ValueError for anything non-numeric or non-positive.
    """
    cleaned = "".join(text.strip().replace("\xa0", " ").split())
    cleaned = cleaned.replace(",", ".")
    if cleaned.count(".") > 1:
        raise ValueError("Invalid amount")
    try:
        value = Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError("Invalid amount") from exc
    if value <= 0:
        raise ValueError("Amount must be positive")
    return int((value * 100).to_integral_value(rounding=ROUND_HALF_UP))


def _format_amount(minor_units: int) -> str:
    return f"{Decimal(minor_units) / 100:.2f}"


async def _confirm_summary(state: FSMContext) -> str:
    data = await state.get_data()
    lines = [
        "Confirm this expense:",
        f"Category: {data['category_name']}",
        f"Amount: {_format_amount(data['amount'])}",
    ]
    if data.get("comment"):
        lines.append(f"Comment: {data['comment']}")
    selected_ids = set(data.get("selected_tag_ids", []))
    if selected_ids:
        tags: list[TagResponse] = data.get("tags", [])
        names = [tag.name for tag in tags if str(tag.id) in selected_ids]
        lines.append(f"Tags: {', '.join(names)}")
    return "\n".join(lines)


async def cmd_add_expense(
    message: Message, state: FSMContext, client: ExpenseBackendClient
) -> None:
    try:
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch categories")
        await message.answer("Couldn't reach the backend. Please try again in a moment.")
        return
    if not categories:
        await message.answer("No categories found. Ask an admin to add one first.")
        return
    await state.set_state(AddExpense.category)
    await state.update_data(categories=categories)
    await message.answer("Choose a category:", reply_markup=categories_keyboard(categories))


async def on_category_chosen(
    callback: CallbackQuery, callback_data: CategoryCallback, state: FSMContext
) -> None:
    data = await state.get_data()
    categories: list[CategoryResponse] = data.get("categories", [])
    category = next((c for c in categories if c.id == callback_data.category_id), None)
    if category is None:
        await callback.answer("Unknown category, please pick again.", show_alert=True)
        return
    await state.update_data(category_id=str(category.id), category_name=category.name)
    await state.set_state(AddExpense.amount)
    await callback.answer()
    if isinstance(callback.message, Message):
        await callback.message.edit_text("Enter the amount (e.g. 12.50 or 12,50):")


async def on_amount_entered(message: Message, state: FSMContext) -> None:
    try:
        amount = parse_amount_to_minor_units(message.text or "")
    except ValueError:
        await message.answer("That doesn't look like a valid amount. Try again (e.g. 12.50):")
        return
    await state.update_data(amount=amount)
    await state.set_state(AddExpense.comment)
    await message.answer("Add a comment, or send /skip:")


async def on_comment_skipped(
    message: Message, state: FSMContext, client: ExpenseBackendClient
) -> None:
    await state.update_data(comment=None)
    await _prompt_tags_or_confirm(message, state, client)


async def on_comment_entered(
    message: Message, state: FSMContext, client: ExpenseBackendClient
) -> None:
    await state.update_data(comment=message.text)
    await _prompt_tags_or_confirm(message, state, client)


async def _prompt_tags_or_confirm(
    message: Message, state: FSMContext, client: ExpenseBackendClient
) -> None:
    try:
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch tags")
        await message.answer("Couldn't reach the backend. Please try again in a moment.")
        return
    if not tags:
        await state.set_state(AddExpense.confirm)
        await message.answer(await _confirm_summary(state), reply_markup=confirm_keyboard())
        return
    await state.update_data(tags=tags, selected_tag_ids=[])
    await state.set_state(AddExpense.tags)
    await message.answer(
        "Pick tags (tap Done when finished):", reply_markup=tags_keyboard(tags, set())
    )


async def on_tag_toggled(
    callback: CallbackQuery, callback_data: TagCallback, state: FSMContext
) -> None:
    data = await state.get_data()
    tags: list[TagResponse] = data.get("tags", [])
    selected = set(data.get("selected_tag_ids", []))
    tag_id = str(callback_data.tag_id)
    if tag_id in selected:
        selected.discard(tag_id)
    else:
        selected.add(tag_id)
    await state.update_data(selected_tag_ids=list(selected))
    await callback.answer()
    if isinstance(callback.message, Message):
        await callback.message.edit_reply_markup(reply_markup=tags_keyboard(tags, selected))


async def on_tags_done(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(AddExpense.confirm)
    await callback.answer()
    if isinstance(callback.message, Message):
        await callback.message.edit_text(
            await _confirm_summary(state), reply_markup=confirm_keyboard()
        )


async def on_confirm(
    callback: CallbackQuery, state: FSMContext, client: ExpenseBackendClient
) -> None:
    data = await state.get_data()
    expense_create = ExpenseCreate(
        amount=data["amount"],
        comment=data.get("comment"),
        category_id=UUID(data["category_id"]),
        tag_ids=[UUID(tid) for tid in data.get("selected_tag_ids", [])],
    )
    await callback.answer()
    try:
        expense = await client.create_expense(expense_create)
    except httpx.HTTPError:
        logger.exception("Failed to create expense")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(
                "Something went wrong saving the expense. Please try again with /add."
            )
        return
    await state.clear()
    if isinstance(callback.message, Message):
        await callback.message.edit_text(f"Expense saved: {_format_amount(expense.amount)}")


async def on_cancel_callback(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.answer("Cancelled")
    if isinstance(callback.message, Message):
        await callback.message.edit_text("Cancelled.")


async def on_cancel_command(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Cancelled.")


# Bounds the rendered message well under Telegram's 4096-char message limit
# (D39 follow-up review: an unbounded list could otherwise raise
# TelegramBadRequest, surfacing as a raw error instead of a friendly message).
_MAX_EXPENSES_SHOWN = 30
_MAX_COMMENT_CHARS = 100


def _format_expenses_list(expenses: list[ExpenseResponse]) -> str:
    lines = ["Your expenses:"]
    shown = expenses[:_MAX_EXPENSES_SHOWN]
    for expense in shown:
        line = f"{expense.created_at:%Y-%m-%d} — {_format_amount(expense.amount)}"
        if expense.comment:
            comment = expense.comment
            if len(comment) > _MAX_COMMENT_CHARS:
                comment = comment[:_MAX_COMMENT_CHARS] + "…"
            line += f" ({comment})"
        lines.append(line)
    remaining = len(expenses) - len(shown)
    if remaining > 0:
        lines.append(f"...and {remaining} more not shown.")
    return "\n".join(lines)


async def cmd_list_expenses(message: Message, client: ExpenseBackendClient) -> None:
    try:
        expenses = await client.list_expenses()
    except httpx.HTTPError:
        logger.exception("Failed to fetch expenses")
        await message.answer("Couldn't reach the backend. Please try again in a moment.")
        return
    if not expenses:
        await message.answer("No expenses yet.")
        return
    await message.answer(_format_expenses_list(expenses))


def create_router() -> Router:
    router = Router(name="expenses")
    router.message.register(cmd_add_expense, Command("add"))
    router.message.register(cmd_list_expenses, Command("expenses"))
    # /cancel must be registered before the catch-all per-state text handlers
    # below (on_amount_entered, on_comment_entered) — aiogram dispatches to the
    # first handler whose filters match in registration order, and those two
    # handlers have no command exclusion, so a later-registered /cancel handler
    # would never be reached while in the amount/comment states.
    router.message.register(on_cancel_command, StateFilter(AddExpense), Command("cancel"))
    router.callback_query.register(
        on_category_chosen, AddExpense.category, CategoryCallback.filter()
    )
    router.message.register(on_amount_entered, AddExpense.amount)
    router.message.register(on_comment_skipped, AddExpense.comment, Command("skip"))
    router.message.register(on_comment_entered, AddExpense.comment)
    router.callback_query.register(on_tag_toggled, AddExpense.tags, TagCallback.filter())
    router.callback_query.register(on_tags_done, AddExpense.tags, F.data == TAGS_DONE_CALLBACK)
    router.callback_query.register(on_confirm, AddExpense.confirm, F.data == CONFIRM_CALLBACK)
    router.callback_query.register(
        on_cancel_callback, StateFilter(AddExpense), F.data == CANCEL_CALLBACK
    )
    return router
