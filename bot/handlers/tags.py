"""Tag management: list, add, rename, delete (U4.4b, mechanical mirror of
bot/handlers/categories.py, plan Decision log D43).

Add/rename are single-field ("enter a name") forms, so each uses one FSM
state to capture the text reply rather than a multi-step flow. Rename/delete
reuse `tags_keyboard`/`TagCallback` from bot/keyboards.py to let the user pick
a target tag by name instead of typing a UUID.

Unlike categories, `_error_message()` has no 409 "still in use" case: tag
deletion is `ON DELETE CASCADE` (not `RESTRICT`) and tag names have no
per-account unique constraint (services/tag_service.py, D19), so the backend
never returns 409 for tag create/delete.
"""

import logging
from typing import Protocol
from uuid import UUID

import httpx
from aiogram import Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from bot.keyboards import TagCallback, tags_keyboard
from bot.states import TagManage
from models.tag import TagCreate, TagResponse, TagUpdate

logger = logging.getLogger(__name__)


class TagBackendClient(Protocol):
    """Structural subset of bot/client.py's BackendClient this module calls —
    lets tests pass a fake without depending on the concrete httpx-backed class."""

    async def list_tags(self) -> list[TagResponse]: ...
    async def create_tag(self, data: TagCreate) -> TagResponse: ...
    async def update_tag(self, tag_id: UUID, data: TagUpdate) -> TagResponse: ...
    async def delete_tag(self, tag_id: UUID) -> None: ...


_BACKEND_UNREACHABLE = "Couldn't reach the backend. Please try again in a moment."


def _error_message(exc: httpx.HTTPStatusError) -> str:
    if exc.response.status_code == 403:
        return "You don't have permission to do that."
    return "Something went wrong. Please try again."


async def cmd_list_tags(message: Message, client: TagBackendClient) -> None:
    try:
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch tags")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    if not tags:
        await message.answer("No tags yet.")
        return
    lines = ["Tags:"] + [f"- {tag.name}" for tag in tags]
    await message.answer("\n".join(lines))


async def cmd_add_tag(message: Message, state: FSMContext) -> None:
    await state.set_state(TagManage.add_name)
    await message.answer("Enter the new tag's name:")


async def on_add_tag_name_entered(
    message: Message, state: FSMContext, client: TagBackendClient
) -> None:
    name = (message.text or "").strip()
    if not name:
        await message.answer("Name can't be empty. Try again:")
        return
    try:
        tag = await client.create_tag(TagCreate(name=name))
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to create tag")
        await state.clear()
        await message.answer(_error_message(exc))
        return
    except httpx.HTTPError:
        logger.exception("Failed to create tag")
        await state.clear()
        await message.answer(_BACKEND_UNREACHABLE)
        return
    await state.clear()
    await message.answer(f"Tag added: {tag.name}")


async def cmd_rename_tag(message: Message, state: FSMContext, client: TagBackendClient) -> None:
    try:
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch tags")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    if not tags:
        await message.answer("No tags to rename yet.")
        return
    await state.set_state(TagManage.rename_select)
    await message.answer("Which tag do you want to rename?", reply_markup=tags_keyboard(tags))


async def on_rename_tag_selected(
    callback: CallbackQuery, callback_data: TagCallback, state: FSMContext
) -> None:
    await state.update_data(rename_target_id=str(callback_data.tag_id))
    await state.set_state(TagManage.rename_name)
    await callback.answer()
    if isinstance(callback.message, Message):
        await callback.message.edit_text("Enter the new name:")


async def on_rename_tag_name_entered(
    message: Message, state: FSMContext, client: TagBackendClient
) -> None:
    name = (message.text or "").strip()
    if not name:
        await message.answer("Name can't be empty. Try again:")
        return
    data = await state.get_data()
    tag_id = UUID(data["rename_target_id"])
    try:
        tag = await client.update_tag(tag_id, TagUpdate(name=name))
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to rename tag")
        await state.clear()
        await message.answer(_error_message(exc))
        return
    except httpx.HTTPError:
        logger.exception("Failed to rename tag")
        await state.clear()
        await message.answer(_BACKEND_UNREACHABLE)
        return
    await state.clear()
    await message.answer(f"Tag renamed to: {tag.name}")


async def cmd_delete_tag(message: Message, state: FSMContext, client: TagBackendClient) -> None:
    try:
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch tags")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    if not tags:
        await message.answer("No tags to delete yet.")
        return
    await state.set_state(TagManage.delete_select)
    await message.answer("Which tag do you want to delete?", reply_markup=tags_keyboard(tags))


async def on_delete_tag_selected(
    callback: CallbackQuery,
    callback_data: TagCallback,
    state: FSMContext,
    client: TagBackendClient,
) -> None:
    await callback.answer()
    try:
        await client.delete_tag(callback_data.tag_id)
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to delete tag")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(_error_message(exc))
        return
    except httpx.HTTPError:
        logger.exception("Failed to delete tag")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(_BACKEND_UNREACHABLE)
        return
    await state.clear()
    if isinstance(callback.message, Message):
        await callback.message.edit_text("Tag deleted.")


async def on_cancel_command(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Cancelled.")


def create_router() -> Router:
    router = Router(name="tags")
    router.message.register(cmd_list_tags, Command("tags"))
    router.message.register(cmd_add_tag, Command("addtag"))
    router.message.register(cmd_rename_tag, Command("renametag"))
    router.message.register(cmd_delete_tag, Command("deletetag"))
    # /cancel must be registered before the catch-all per-state text handlers
    # below (on_*_name_entered) — same registration-order requirement as
    # bot/handlers/categories.py (plan Decision log D39/D40).
    router.message.register(on_cancel_command, StateFilter(TagManage), Command("cancel"))
    router.message.register(on_add_tag_name_entered, TagManage.add_name)
    router.callback_query.register(
        on_rename_tag_selected, TagManage.rename_select, TagCallback.filter()
    )
    router.message.register(on_rename_tag_name_entered, TagManage.rename_name)
    router.callback_query.register(
        on_delete_tag_selected, TagManage.delete_select, TagCallback.filter()
    )
    return router
