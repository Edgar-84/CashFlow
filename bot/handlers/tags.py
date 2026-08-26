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
from bot.keyboards import TagCallback, tags_keyboard
from bot.states import TagManage
from models.enums import Language
from models.tag import TagCreate, TagResponse, TagUpdate

logger = logging.getLogger(__name__)


class TagBackendClient(Protocol):
    """Structural subset of bot/client.py's BackendClient this module calls —
    lets tests pass a fake without depending on the concrete httpx-backed class."""

    async def list_tags(self) -> list[TagResponse]: ...
    async def get_tag(self, tag_id: UUID) -> TagResponse: ...
    async def create_tag(self, data: TagCreate) -> TagResponse: ...
    async def update_tag(self, tag_id: UUID, data: TagUpdate) -> TagResponse: ...
    async def delete_tag(self, tag_id: UUID) -> None: ...


def _error_message(exc: httpx.HTTPStatusError, language: Language = Language.EN) -> str:
    if exc.response.status_code == 403:
        return t(language, "readonly")
    return t(language, "error.fallback")


async def _delete_confirmation_message(
    client: TagBackendClient, tag_id: UUID, language: Language = Language.EN
) -> str:
    # D302 mirrored for tags (U0.5): DELETE always returns 204, whether the
    # tag was archived (is_active=False, in use) or hard-deleted (gone) — GET
    # is the only way to tell them apart, and it needs no new endpoint
    # (models/tag.py already exposes is_active; services/tag_service.py's
    # get() never filters archived rows).
    try:
        tag = await client.get_tag(tag_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 404:
            logger.exception("Failed to confirm tag deletion outcome")
        return t(language, "tags.deleted")
    except httpx.HTTPError:
        logger.exception("Failed to confirm tag deletion outcome")
        return t(language, "tags.deleted")
    return t(language, "tags.deleted") if tag.is_active else t(language, "tags.archived")


async def cmd_list_tags(
    message: Message, client: TagBackendClient, language: Language = Language.EN
) -> None:
    try:
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch tags")
        await message.answer(t(language, "common.backendUnreachable"))
        return
    if not tags:
        await message.answer(t(language, "tags.empty"))
        return
    lines = [t(language, "tags.listTitle")] + [f"- {tag.name}" for tag in tags]
    await message.answer("\n".join(lines))


async def cmd_add_tag(
    message: Message, state: FSMContext, language: Language = Language.EN
) -> None:
    await state.set_state(TagManage.add_name)
    await message.answer(t(language, "tags.enterName"))


async def on_add_tag_name_entered(
    message: Message, state: FSMContext, client: TagBackendClient, language: Language = Language.EN
) -> None:
    name = (message.text or "").strip()
    if not name:
        await message.answer(t(language, "tags.nameEmpty"))
        return
    try:
        tag = await client.create_tag(TagCreate(name=name))
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to create tag")
        await state.clear()
        await message.answer(_error_message(exc, language))
        return
    except httpx.HTTPError:
        logger.exception("Failed to create tag")
        await state.clear()
        await message.answer(t(language, "common.backendUnreachable"))
        return
    await state.clear()
    await message.answer(t(language, "tags.added", name=tag.name))


async def cmd_rename_tag(
    message: Message, state: FSMContext, client: TagBackendClient, language: Language = Language.EN
) -> None:
    try:
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch tags")
        await message.answer(t(language, "common.backendUnreachable"))
        return
    if not tags:
        await message.answer(t(language, "tags.noneToRename"))
        return
    await state.set_state(TagManage.rename_select)
    await message.answer(
        t(language, "tags.pickToRename"), reply_markup=tags_keyboard(tags, language=language)
    )


async def on_rename_tag_selected(
    callback: CallbackQuery,
    callback_data: TagCallback,
    state: FSMContext,
    language: Language = Language.EN,
) -> None:
    await state.update_data(rename_target_id=str(callback_data.tag_id))
    await state.set_state(TagManage.rename_name)
    await callback.answer()
    if isinstance(callback.message, Message):
        await callback.message.edit_text(t(language, "tags.enterNewName"))


async def on_rename_tag_name_entered(
    message: Message, state: FSMContext, client: TagBackendClient, language: Language = Language.EN
) -> None:
    name = (message.text or "").strip()
    if not name:
        await message.answer(t(language, "tags.nameEmpty"))
        return
    data = await state.get_data()
    tag_id = UUID(data["rename_target_id"])
    try:
        tag = await client.update_tag(tag_id, TagUpdate(name=name))
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to rename tag")
        await state.clear()
        await message.answer(_error_message(exc, language))
        return
    except httpx.HTTPError:
        logger.exception("Failed to rename tag")
        await state.clear()
        await message.answer(t(language, "common.backendUnreachable"))
        return
    await state.clear()
    await message.answer(t(language, "tags.renamed", name=tag.name))


async def cmd_delete_tag(
    message: Message, state: FSMContext, client: TagBackendClient, language: Language = Language.EN
) -> None:
    try:
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch tags")
        await message.answer(t(language, "common.backendUnreachable"))
        return
    if not tags:
        await message.answer(t(language, "tags.noneToDelete"))
        return
    await state.set_state(TagManage.delete_select)
    await message.answer(
        t(language, "tags.pickToDelete"), reply_markup=tags_keyboard(tags, language=language)
    )


async def on_delete_tag_selected(
    callback: CallbackQuery,
    callback_data: TagCallback,
    state: FSMContext,
    client: TagBackendClient,
    language: Language = Language.EN,
) -> None:
    await callback.answer()
    try:
        await client.delete_tag(callback_data.tag_id)
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to delete tag")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(_error_message(exc, language))
        return
    except httpx.HTTPError:
        logger.exception("Failed to delete tag")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(t(language, "common.backendUnreachable"))
        return
    await state.clear()
    text = await _delete_confirmation_message(client, callback_data.tag_id, language)
    if isinstance(callback.message, Message):
        await callback.message.edit_text(text)


async def on_cancel_command(
    message: Message, state: FSMContext, language: Language = Language.EN
) -> None:
    await state.clear()
    await message.answer(t(language, "common.cancelled"))


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
