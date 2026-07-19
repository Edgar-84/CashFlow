"""Unit tests for bot/handlers/tags.py — list/add/rename/delete flows
(tests/CLAUDE.md: "Bot handlers are tested by mocking BackendClient — never a
live backend", U4.4b AC — mechanical mirror of test_bot_handlers_categories.py).

Hermetic: a FakeTagBackendClient stands in for bot/client.py's BackendClient
(no real backend HTTP); handlers are called directly with mock
Message/CallbackQuery objects (no real Telegram network) and a real
FSMContext over aiogram's MemoryStorage.

A second group of tests dispatches through a real `Dispatcher` +
`create_router()` (Telegram network still mocked via `Message.answer`
patched to an `AsyncMock`) to catch router-registration-order bugs (D39/D40
precedent: /cancel must not be shadowed by a catch-all per-state text
handler).

Unlike categories, there is no 409-conflict-on-delete test: tag deletion is
`ON DELETE CASCADE`, not `RESTRICT` (services/tag_service.py, D19), so the
backend never returns 409 for tags.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import httpx
from aiogram import Bot, Dispatcher
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.base import StorageKey
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Chat, Message, Update
from aiogram.types import User as TelegramUser

from bot.handlers import tags as h
from bot.keyboards import TagCallback
from bot.states import TagManage
from models.tag import TagCreate, TagResponse, TagUpdate


def make_state() -> FSMContext:
    return FSMContext(storage=MemoryStorage(), key=StorageKey(bot_id=1, chat_id=1, user_id=1))


def make_tag(name: str = "Recurring") -> TagResponse:
    return TagResponse(id=uuid4(), account_id=uuid4(), created_at=datetime.now(UTC), name=name)


class FakeTagBackendClient:
    def __init__(self, tags: list[TagResponse] | None = None) -> None:
        self.tags = tags if tags is not None else [make_tag()]
        self.created: list[TagCreate] = []
        self.updated: list[tuple[object, TagUpdate]] = []
        self.deleted: list[object] = []

    async def list_tags(self) -> list[TagResponse]:
        return self.tags

    async def create_tag(self, data: TagCreate) -> TagResponse:
        self.created.append(data)
        return make_tag(data.name)

    async def update_tag(self, tag_id: object, data: TagUpdate) -> TagResponse:
        self.updated.append((tag_id, data))
        assert data.name is not None
        return make_tag(data.name)

    async def delete_tag(self, tag_id: object) -> None:
        self.deleted.append(tag_id)


def _status_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://test/tags")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


class ForbiddenCreateClient(FakeTagBackendClient):
    async def create_tag(self, data: TagCreate) -> TagResponse:
        raise _status_error(403)


class ForbiddenUpdateClient(FakeTagBackendClient):
    async def update_tag(self, tag_id: object, data: TagUpdate) -> TagResponse:
        raise _status_error(403)


class ForbiddenDeleteClient(FakeTagBackendClient):
    async def delete_tag(self, tag_id: object) -> None:
        raise _status_error(403)


class UnreachableListClient(FakeTagBackendClient):
    async def list_tags(self) -> list[TagResponse]:
        request = httpx.Request("GET", "http://test/tags")
        raise httpx.ConnectError("boom", request=request)


def make_message(text: str | None = None) -> Mock:
    message = Mock(spec=Message)
    message.text = text
    message.answer = AsyncMock()
    message.edit_text = AsyncMock()
    return message


def make_callback(message: Mock | None = None) -> Mock:
    callback = Mock()
    callback.message = message or make_message()
    callback.answer = AsyncMock()
    return callback


# -- list ---------------------------------------------------------------


async def test_list_tags_renders_non_empty_list() -> None:
    client = FakeTagBackendClient(tags=[make_tag("Recurring")])
    message = make_message("/tags")

    await h.cmd_list_tags(message, client)

    text = message.answer.await_args.args[0]
    assert "Recurring" in text


async def test_list_tags_renders_empty_list() -> None:
    client = FakeTagBackendClient(tags=[])
    message = make_message("/tags")

    await h.cmd_list_tags(message, client)

    message.answer.assert_awaited_once_with("No tags yet.")


async def test_list_tags_backend_error_shows_friendly_message() -> None:
    message = make_message("/tags")

    await h.cmd_list_tags(message, UnreachableListClient())

    assert "couldn't reach" in message.answer.await_args.args[0].lower()


# -- add ------------------------------------------------------------------


async def test_add_tag_happy_path() -> None:
    client = FakeTagBackendClient()
    state = make_state()

    await h.cmd_add_tag(make_message("/addtag"), state)
    assert await state.get_state() == TagManage.add_name.state

    await h.on_add_tag_name_entered(make_message("Urgent"), state, client)

    assert await state.get_state() is None
    assert client.created == [TagCreate(name="Urgent")]


async def test_add_tag_empty_name_reprompts() -> None:
    client = FakeTagBackendClient()
    state = make_state()
    await state.set_state(TagManage.add_name)

    await h.on_add_tag_name_entered(make_message("   "), state, client)

    assert await state.get_state() == TagManage.add_name.state
    assert client.created == []


async def test_add_tag_permission_denied_shows_friendly_message() -> None:
    state = make_state()
    await state.set_state(TagManage.add_name)
    message = make_message("Urgent")

    await h.on_add_tag_name_entered(message, state, ForbiddenCreateClient())

    assert await state.get_state() is None
    assert "permission" in message.answer.await_args.args[0].lower()


async def test_add_tag_backend_error_shows_friendly_message() -> None:
    class FailingCreateClient(FakeTagBackendClient):
        async def create_tag(self, data: TagCreate) -> TagResponse:
            request = httpx.Request("POST", "http://test/tags")
            raise httpx.ConnectError("boom", request=request)

    state = make_state()
    await state.set_state(TagManage.add_name)
    message = make_message("Urgent")

    await h.on_add_tag_name_entered(message, state, FailingCreateClient())

    assert await state.get_state() is None
    assert "couldn't reach" in message.answer.await_args.args[0].lower()


# -- rename -----------------------------------------------------------------


async def test_rename_tag_happy_path() -> None:
    tag = make_tag("Recurring")
    client = FakeTagBackendClient(tags=[tag])
    state = make_state()

    await h.cmd_rename_tag(make_message("/renametag"), state, client)
    assert await state.get_state() == TagManage.rename_select.state

    select_callback = make_callback()
    await h.on_rename_tag_selected(select_callback, TagCallback(tag_id=tag.id), state)
    assert await state.get_state() == TagManage.rename_name.state
    assert (await state.get_data())["rename_target_id"] == str(tag.id)

    await h.on_rename_tag_name_entered(make_message("Subscriptions"), state, client)

    assert await state.get_state() is None
    assert client.updated == [(tag.id, TagUpdate(name="Subscriptions"))]


async def test_rename_tag_no_tags() -> None:
    client = FakeTagBackendClient(tags=[])
    state = make_state()
    message = make_message("/renametag")

    await h.cmd_rename_tag(message, state, client)

    assert await state.get_state() is None
    message.answer.assert_awaited_once_with("No tags to rename yet.")


async def test_rename_tag_permission_denied_shows_friendly_message() -> None:
    tag = make_tag()
    state = make_state()
    await state.set_state(TagManage.rename_name)
    await state.update_data(rename_target_id=str(tag.id))
    message = make_message("Subscriptions")

    await h.on_rename_tag_name_entered(message, state, ForbiddenUpdateClient())

    assert await state.get_state() is None
    assert "permission" in message.answer.await_args.args[0].lower()


# -- delete -----------------------------------------------------------------


async def test_delete_tag_happy_path() -> None:
    tag = make_tag("Recurring")
    client = FakeTagBackendClient(tags=[tag])
    state = make_state()

    await h.cmd_delete_tag(make_message("/deletetag"), state, client)
    assert await state.get_state() == TagManage.delete_select.state

    callback = make_callback()
    await h.on_delete_tag_selected(callback, TagCallback(tag_id=tag.id), state, client)

    assert await state.get_state() is None
    assert client.deleted == [tag.id]
    callback.message.edit_text.assert_awaited_once_with("Tag deleted.")


async def test_delete_tag_no_tags() -> None:
    client = FakeTagBackendClient(tags=[])
    state = make_state()
    message = make_message("/deletetag")

    await h.cmd_delete_tag(message, state, client)

    assert await state.get_state() is None
    message.answer.assert_awaited_once_with("No tags to delete yet.")


async def test_delete_tag_permission_denied_shows_friendly_message() -> None:
    tag = make_tag()
    state = make_state()
    await state.set_state(TagManage.delete_select)
    callback = make_callback()

    await h.on_delete_tag_selected(
        callback, TagCallback(tag_id=tag.id), state, ForbiddenDeleteClient()
    )

    assert await state.get_state() is None
    text = callback.message.edit_text.await_args.args[0]
    assert "permission" in text.lower()


# -- cancel -------------------------------------------------------------


async def test_cancel_command_clears_state() -> None:
    state = make_state()
    await state.set_state(TagManage.add_name)

    message = make_message("/cancel")
    await h.on_cancel_command(message, state)

    assert await state.get_state() is None
    message.answer.assert_awaited_once_with("Cancelled.")


# -- real-dispatch regression test: catch router-registration-order bugs ----


def make_router_dispatcher() -> Dispatcher:
    dp = Dispatcher(storage=MemoryStorage())
    dp.include_router(h.create_router())
    return dp


def make_text_update(update_id: int, tg_id: int, text: str) -> Update:
    message = Message(
        message_id=update_id,
        date=datetime.now(UTC),
        chat=Chat(id=tg_id, type="private"),
        from_user=TelegramUser(id=tg_id, is_bot=False, first_name="Test"),
        text=text,
    )
    return Update(update_id=update_id, message=message)


async def test_cancel_command_reaches_cancel_handler_not_add_name_catchall() -> None:
    dp = make_router_dispatcher()
    bot = Bot(token="42:TEST-token")
    tg_id = 555
    context = dp.fsm.resolve_context(bot, chat_id=tg_id, user_id=tg_id)
    assert context is not None
    await context.set_state(TagManage.add_name)

    with patch.object(Message, "answer", new=AsyncMock()) as mocked_answer:
        await dp.feed_update(
            bot, make_text_update(1, tg_id, "/cancel"), client=FakeTagBackendClient()
        )

    assert await context.get_state() is None
    mocked_answer.assert_awaited_once_with("Cancelled.")
