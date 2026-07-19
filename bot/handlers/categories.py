"""Category management: list, add, rename, delete (U4.4, plan Decision log
D41 — tags handlers split to U4.4b, mechanical mirror of this module).

Add/rename are single-field ("enter a name") forms, so each uses one FSM
state to capture the text reply rather than a multi-step flow. Rename/delete
reuse `categories_keyboard`/`CategoryCallback` from bot/keyboards.py (already
generic id-carrying selectors, not expense-specific) to let the user pick a
target category by name instead of typing a UUID.
"""

import logging
from typing import Protocol
from uuid import UUID

import httpx
from aiogram import Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from bot.keyboards import CategoryCallback, categories_keyboard
from bot.states import CategoryManage
from models.category import CategoryCreate, CategoryResponse, CategoryUpdate

logger = logging.getLogger(__name__)


class CategoryBackendClient(Protocol):
    """Structural subset of bot/client.py's BackendClient this module calls —
    lets tests pass a fake without depending on the concrete httpx-backed class."""

    async def list_categories(self) -> list[CategoryResponse]: ...
    async def create_category(self, data: CategoryCreate) -> CategoryResponse: ...
    async def update_category(
        self, category_id: UUID, data: CategoryUpdate
    ) -> CategoryResponse: ...
    async def delete_category(self, category_id: UUID) -> None: ...


_BACKEND_UNREACHABLE = "Couldn't reach the backend. Please try again in a moment."


def _error_message(exc: httpx.HTTPStatusError) -> str:
    if exc.response.status_code == 403:
        return "You don't have permission to do that."
    if exc.response.status_code == 409:
        return "This category is still in use by expenses or budget plans."
    return "Something went wrong. Please try again."


async def cmd_list_categories(message: Message, client: CategoryBackendClient) -> None:
    try:
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch categories")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    if not categories:
        await message.answer("No categories yet.")
        return
    lines = ["Categories:"] + [f"- {category.name}" for category in categories]
    await message.answer("\n".join(lines))


async def cmd_add_category(message: Message, state: FSMContext) -> None:
    await state.set_state(CategoryManage.add_name)
    await message.answer("Enter the new category's name:")


async def on_add_category_name_entered(
    message: Message, state: FSMContext, client: CategoryBackendClient
) -> None:
    name = (message.text or "").strip()
    if not name:
        await message.answer("Name can't be empty. Try again:")
        return
    try:
        category = await client.create_category(CategoryCreate(name=name))
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to create category")
        await state.clear()
        await message.answer(_error_message(exc))
        return
    except httpx.HTTPError:
        logger.exception("Failed to create category")
        await state.clear()
        await message.answer(_BACKEND_UNREACHABLE)
        return
    await state.clear()
    await message.answer(f"Category added: {category.name}")


async def cmd_rename_category(
    message: Message, state: FSMContext, client: CategoryBackendClient
) -> None:
    try:
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch categories")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    if not categories:
        await message.answer("No categories to rename yet.")
        return
    await state.set_state(CategoryManage.rename_select)
    await message.answer(
        "Which category do you want to rename?", reply_markup=categories_keyboard(categories)
    )


async def on_rename_category_selected(
    callback: CallbackQuery, callback_data: CategoryCallback, state: FSMContext
) -> None:
    await state.update_data(rename_target_id=str(callback_data.category_id))
    await state.set_state(CategoryManage.rename_name)
    await callback.answer()
    if isinstance(callback.message, Message):
        await callback.message.edit_text("Enter the new name:")


async def on_rename_category_name_entered(
    message: Message, state: FSMContext, client: CategoryBackendClient
) -> None:
    name = (message.text or "").strip()
    if not name:
        await message.answer("Name can't be empty. Try again:")
        return
    data = await state.get_data()
    category_id = UUID(data["rename_target_id"])
    try:
        category = await client.update_category(category_id, CategoryUpdate(name=name))
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to rename category")
        await state.clear()
        await message.answer(_error_message(exc))
        return
    except httpx.HTTPError:
        logger.exception("Failed to rename category")
        await state.clear()
        await message.answer(_BACKEND_UNREACHABLE)
        return
    await state.clear()
    await message.answer(f"Category renamed to: {category.name}")


async def cmd_delete_category(
    message: Message, state: FSMContext, client: CategoryBackendClient
) -> None:
    try:
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch categories")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    if not categories:
        await message.answer("No categories to delete yet.")
        return
    await state.set_state(CategoryManage.delete_select)
    await message.answer(
        "Which category do you want to delete?", reply_markup=categories_keyboard(categories)
    )


async def on_delete_category_selected(
    callback: CallbackQuery,
    callback_data: CategoryCallback,
    state: FSMContext,
    client: CategoryBackendClient,
) -> None:
    await callback.answer()
    try:
        await client.delete_category(callback_data.category_id)
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to delete category")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(_error_message(exc))
        return
    except httpx.HTTPError:
        logger.exception("Failed to delete category")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(_BACKEND_UNREACHABLE)
        return
    await state.clear()
    if isinstance(callback.message, Message):
        await callback.message.edit_text("Category deleted.")


async def on_cancel_command(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Cancelled.")


def create_router() -> Router:
    router = Router(name="categories")
    router.message.register(cmd_list_categories, Command("categories"))
    router.message.register(cmd_add_category, Command("addcategory"))
    router.message.register(cmd_rename_category, Command("renamecategory"))
    router.message.register(cmd_delete_category, Command("deletecategory"))
    # /cancel must be registered before the catch-all per-state text handlers
    # below (on_*_name_entered) — same registration-order requirement as
    # bot/handlers/expenses.py (plan Decision log D39/D40).
    router.message.register(on_cancel_command, StateFilter(CategoryManage), Command("cancel"))
    router.message.register(on_add_category_name_entered, CategoryManage.add_name)
    router.callback_query.register(
        on_rename_category_selected, CategoryManage.rename_select, CategoryCallback.filter()
    )
    router.message.register(on_rename_category_name_entered, CategoryManage.rename_name)
    router.callback_query.register(
        on_delete_category_selected, CategoryManage.delete_select, CategoryCallback.filter()
    )
    return router
