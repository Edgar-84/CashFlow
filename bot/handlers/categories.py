"""Category management: list, add, rename, delete (U4.4, plan Decision log
D41 — tags handlers split to U4.4b, mechanical mirror of this module).

Add/rename are single-field ("enter a name") forms, so each uses one FSM
state to capture the text reply rather than a multi-step flow. Rename/delete
reuse `categories_keyboard`/`CategoryCallback` from bot/keyboards.py (already
generic id-carrying selectors, not expense-specific) to let the user pick a
target category by name instead of typing a UUID.

Every user-visible string goes through `bot/i18n.py::t()` (U3.14). Every
handler and helper below takes a `language: Language`, defaulting to
`Language.EN` — aiogram injects the caller's real resolved language
(`AllowlistMiddleware`, D707) into every registered handler regardless of
that default, since dispatch matches by parameter name; the default only
matters for direct calls (tests, and this module's own handler-to-helper
calls, which always pass `language` through explicitly rather than relying
on it).
"""

import logging
from typing import Protocol
from uuid import UUID

import httpx
from aiogram import Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from bot.i18n import t
from bot.keyboards import CategoryCallback, categories_keyboard
from bot.states import CategoryManage
from models.category import CategoryCreate, CategoryResponse, CategoryUpdate
from models.enums import Language

logger = logging.getLogger(__name__)


class CategoryBackendClient(Protocol):
    """Structural subset of bot/client.py's BackendClient this module calls —
    lets tests pass a fake without depending on the concrete httpx-backed class."""

    async def list_categories(self) -> list[CategoryResponse]: ...
    async def get_category(self, category_id: UUID) -> CategoryResponse: ...
    async def create_category(self, data: CategoryCreate) -> CategoryResponse: ...
    async def update_category(
        self, category_id: UUID, data: CategoryUpdate
    ) -> CategoryResponse: ...
    async def delete_category(self, category_id: UUID) -> None: ...


def _error_message(exc: httpx.HTTPStatusError, language: Language = Language.EN) -> str:
    if exc.response.status_code == 403:
        return t(language, "readonly")
    if exc.response.status_code == 409:
        # D302 (U0.4): an in-use category is archived, not rejected — this
        # only fires on the repo's defensive race-condition branch
        # (services/category_service.py), where it stays true: something
        # started referencing the category between the usage check and the
        # delete call.
        return t(language, "categories.error.inUse")
    return t(language, "error.fallback")


async def _delete_confirmation_message(
    client: CategoryBackendClient, category_id: UUID, language: Language = Language.EN
) -> str:
    # D302: DELETE always returns 204, whether the category was archived
    # (is_active=False, in use) or hard-deleted (gone) — GET is the only way
    # to tell them apart, and it needs no new endpoint (models/category.py
    # already exposes is_active; services/category_service.py's get() never
    # filters archived rows).
    try:
        category = await client.get_category(category_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 404:
            logger.exception("Failed to confirm category deletion outcome")
        return t(language, "categories.deleted")
    except httpx.HTTPError:
        logger.exception("Failed to confirm category deletion outcome")
        return t(language, "categories.deleted")
    return (
        t(language, "categories.deleted")
        if category.is_active
        else t(language, "categories.archived")
    )


async def cmd_list_categories(
    message: Message, client: CategoryBackendClient, language: Language = Language.EN
) -> None:
    try:
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch categories")
        await message.answer(t(language, "common.backendUnreachable"))
        return
    if not categories:
        await message.answer(t(language, "categories.empty"))
        return
    lines = [t(language, "categories.listTitle")] + [
        f"- {category.name}" for category in categories
    ]
    await message.answer("\n".join(lines))


async def cmd_add_category(
    message: Message, state: FSMContext, language: Language = Language.EN
) -> None:
    await state.set_state(CategoryManage.add_name)
    await message.answer(t(language, "categories.enterName"))


async def on_add_category_name_entered(
    message: Message,
    state: FSMContext,
    client: CategoryBackendClient,
    language: Language = Language.EN,
) -> None:
    name = (message.text or "").strip()
    if not name:
        await message.answer(t(language, "categories.nameEmpty"))
        return
    try:
        category = await client.create_category(CategoryCreate(name=name))
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to create category")
        await state.clear()
        await message.answer(_error_message(exc, language))
        return
    except httpx.HTTPError:
        logger.exception("Failed to create category")
        await state.clear()
        await message.answer(t(language, "common.backendUnreachable"))
        return
    await state.clear()
    await message.answer(t(language, "categories.added", name=category.name))


async def cmd_rename_category(
    message: Message,
    state: FSMContext,
    client: CategoryBackendClient,
    language: Language = Language.EN,
) -> None:
    try:
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch categories")
        await message.answer(t(language, "common.backendUnreachable"))
        return
    if not categories:
        await message.answer(t(language, "categories.noneToRename"))
        return
    await state.set_state(CategoryManage.rename_select)
    await message.answer(
        t(language, "categories.pickToRename"), reply_markup=categories_keyboard(categories)
    )


async def on_rename_category_selected(
    callback: CallbackQuery,
    callback_data: CategoryCallback,
    state: FSMContext,
    language: Language = Language.EN,
) -> None:
    await state.update_data(rename_target_id=str(callback_data.category_id))
    await state.set_state(CategoryManage.rename_name)
    await callback.answer()
    if isinstance(callback.message, Message):
        await callback.message.edit_text(t(language, "categories.enterNewName"))


async def on_rename_category_name_entered(
    message: Message,
    state: FSMContext,
    client: CategoryBackendClient,
    language: Language = Language.EN,
) -> None:
    name = (message.text or "").strip()
    if not name:
        await message.answer(t(language, "categories.nameEmpty"))
        return
    data = await state.get_data()
    category_id = UUID(data["rename_target_id"])
    try:
        category = await client.update_category(category_id, CategoryUpdate(name=name))
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to rename category")
        await state.clear()
        await message.answer(_error_message(exc, language))
        return
    except httpx.HTTPError:
        logger.exception("Failed to rename category")
        await state.clear()
        await message.answer(t(language, "common.backendUnreachable"))
        return
    await state.clear()
    await message.answer(t(language, "categories.renamed", name=category.name))


async def cmd_delete_category(
    message: Message,
    state: FSMContext,
    client: CategoryBackendClient,
    language: Language = Language.EN,
) -> None:
    try:
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch categories")
        await message.answer(t(language, "common.backendUnreachable"))
        return
    if not categories:
        await message.answer(t(language, "categories.noneToDelete"))
        return
    await state.set_state(CategoryManage.delete_select)
    await message.answer(
        t(language, "categories.pickToDelete"), reply_markup=categories_keyboard(categories)
    )


async def on_delete_category_selected(
    callback: CallbackQuery,
    callback_data: CategoryCallback,
    state: FSMContext,
    client: CategoryBackendClient,
    language: Language = Language.EN,
) -> None:
    await callback.answer()
    try:
        await client.delete_category(callback_data.category_id)
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to delete category")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(_error_message(exc, language))
        return
    except httpx.HTTPError:
        logger.exception("Failed to delete category")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(t(language, "common.backendUnreachable"))
        return
    await state.clear()
    text = await _delete_confirmation_message(client, callback_data.category_id, language)
    if isinstance(callback.message, Message):
        await callback.message.edit_text(text)


async def on_cancel_command(
    message: Message, state: FSMContext, language: Language = Language.EN
) -> None:
    await state.clear()
    await message.answer(t(language, "common.cancelled"))


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
