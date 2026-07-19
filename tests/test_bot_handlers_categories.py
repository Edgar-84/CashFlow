"""Unit tests for bot/handlers/categories.py — list/add/rename/delete flows
(tests/CLAUDE.md: "Bot handlers are tested by mocking BackendClient — never a
live backend", U4.4 AC).

Hermetic: a FakeCategoryBackendClient stands in for bot/client.py's
BackendClient (no real backend HTTP); handlers are called directly with mock
Message/CallbackQuery objects (no real Telegram network) and a real
FSMContext over aiogram's MemoryStorage.

A second group of tests dispatches through a real `Dispatcher` +
`create_router()` (Telegram network still mocked via `Message.answer`
patched to an `AsyncMock`) to catch router-registration-order bugs (D39/D40
precedent: /cancel must not be shadowed by a catch-all per-state text
handler).
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

from bot.handlers import categories as h
from bot.keyboards import CategoryCallback
from bot.states import CategoryManage
from models.category import CategoryCreate, CategoryResponse, CategoryUpdate


def make_state() -> FSMContext:
    return FSMContext(storage=MemoryStorage(), key=StorageKey(bot_id=1, chat_id=1, user_id=1))


def make_category(name: str = "Groceries") -> CategoryResponse:
    return CategoryResponse(id=uuid4(), account_id=uuid4(), created_at=datetime.now(UTC), name=name)


class FakeCategoryBackendClient:
    def __init__(self, categories: list[CategoryResponse] | None = None) -> None:
        self.categories = categories if categories is not None else [make_category()]
        self.created: list[CategoryCreate] = []
        self.updated: list[tuple[object, CategoryUpdate]] = []
        self.deleted: list[object] = []

    async def list_categories(self) -> list[CategoryResponse]:
        return self.categories

    async def create_category(self, data: CategoryCreate) -> CategoryResponse:
        self.created.append(data)
        return make_category(data.name)

    async def update_category(self, category_id: object, data: CategoryUpdate) -> CategoryResponse:
        self.updated.append((category_id, data))
        assert data.name is not None
        return make_category(data.name)

    async def delete_category(self, category_id: object) -> None:
        self.deleted.append(category_id)


def _status_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://test/categories")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


class ForbiddenCreateClient(FakeCategoryBackendClient):
    async def create_category(self, data: CategoryCreate) -> CategoryResponse:
        raise _status_error(403)


class ForbiddenUpdateClient(FakeCategoryBackendClient):
    async def update_category(self, category_id: object, data: CategoryUpdate) -> CategoryResponse:
        raise _status_error(403)


class ConflictDeleteClient(FakeCategoryBackendClient):
    async def delete_category(self, category_id: object) -> None:
        raise _status_error(409)


class UnreachableListClient(FakeCategoryBackendClient):
    async def list_categories(self) -> list[CategoryResponse]:
        request = httpx.Request("GET", "http://test/categories")
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


async def test_list_categories_renders_non_empty_list() -> None:
    client = FakeCategoryBackendClient(categories=[make_category("Groceries")])
    message = make_message("/categories")

    await h.cmd_list_categories(message, client)

    text = message.answer.await_args.args[0]
    assert "Groceries" in text


async def test_list_categories_renders_empty_list() -> None:
    client = FakeCategoryBackendClient(categories=[])
    message = make_message("/categories")

    await h.cmd_list_categories(message, client)

    message.answer.assert_awaited_once_with("No categories yet.")


async def test_list_categories_backend_error_shows_friendly_message() -> None:
    message = make_message("/categories")

    await h.cmd_list_categories(message, UnreachableListClient())

    assert "couldn't reach" in message.answer.await_args.args[0].lower()


# -- add ------------------------------------------------------------------


async def test_add_category_happy_path() -> None:
    client = FakeCategoryBackendClient()
    state = make_state()

    await h.cmd_add_category(make_message("/addcategory"), state)
    assert await state.get_state() == CategoryManage.add_name.state

    await h.on_add_category_name_entered(make_message("Utilities"), state, client)

    assert await state.get_state() is None
    assert client.created == [CategoryCreate(name="Utilities")]


async def test_add_category_empty_name_reprompts() -> None:
    client = FakeCategoryBackendClient()
    state = make_state()
    await state.set_state(CategoryManage.add_name)

    await h.on_add_category_name_entered(make_message("   "), state, client)

    assert await state.get_state() == CategoryManage.add_name.state
    assert client.created == []


async def test_add_category_permission_denied_shows_friendly_message() -> None:
    state = make_state()
    await state.set_state(CategoryManage.add_name)
    message = make_message("Utilities")

    await h.on_add_category_name_entered(message, state, ForbiddenCreateClient())

    assert await state.get_state() is None
    assert "permission" in message.answer.await_args.args[0].lower()


async def test_add_category_backend_error_shows_friendly_message() -> None:
    class FailingCreateClient(FakeCategoryBackendClient):
        async def create_category(self, data: CategoryCreate) -> CategoryResponse:
            request = httpx.Request("POST", "http://test/categories")
            raise httpx.ConnectError("boom", request=request)

    state = make_state()
    await state.set_state(CategoryManage.add_name)
    message = make_message("Utilities")

    await h.on_add_category_name_entered(message, state, FailingCreateClient())

    assert await state.get_state() is None
    assert "couldn't reach" in message.answer.await_args.args[0].lower()


# -- rename -----------------------------------------------------------------


async def test_rename_category_happy_path() -> None:
    category = make_category("Groceries")
    client = FakeCategoryBackendClient(categories=[category])
    state = make_state()

    await h.cmd_rename_category(make_message("/renamecategory"), state, client)
    assert await state.get_state() == CategoryManage.rename_select.state

    select_callback = make_callback()
    await h.on_rename_category_selected(
        select_callback, CategoryCallback(category_id=category.id), state
    )
    assert await state.get_state() == CategoryManage.rename_name.state
    assert (await state.get_data())["rename_target_id"] == str(category.id)

    await h.on_rename_category_name_entered(make_message("Food"), state, client)

    assert await state.get_state() is None
    assert client.updated == [(category.id, CategoryUpdate(name="Food"))]


async def test_rename_category_no_categories() -> None:
    client = FakeCategoryBackendClient(categories=[])
    state = make_state()
    message = make_message("/renamecategory")

    await h.cmd_rename_category(message, state, client)

    assert await state.get_state() is None
    message.answer.assert_awaited_once_with("No categories to rename yet.")


async def test_rename_category_permission_denied_shows_friendly_message() -> None:
    category = make_category()
    state = make_state()
    await state.set_state(CategoryManage.rename_name)
    await state.update_data(rename_target_id=str(category.id))
    message = make_message("Food")

    await h.on_rename_category_name_entered(message, state, ForbiddenUpdateClient())

    assert await state.get_state() is None
    assert "permission" in message.answer.await_args.args[0].lower()


# -- delete -----------------------------------------------------------------


async def test_delete_category_happy_path() -> None:
    category = make_category("Groceries")
    client = FakeCategoryBackendClient(categories=[category])
    state = make_state()

    await h.cmd_delete_category(make_message("/deletecategory"), state, client)
    assert await state.get_state() == CategoryManage.delete_select.state

    callback = make_callback()
    await h.on_delete_category_selected(
        callback, CategoryCallback(category_id=category.id), state, client
    )

    assert await state.get_state() is None
    assert client.deleted == [category.id]
    callback.message.edit_text.assert_awaited_once_with("Category deleted.")


async def test_delete_category_no_categories() -> None:
    client = FakeCategoryBackendClient(categories=[])
    state = make_state()
    message = make_message("/deletecategory")

    await h.cmd_delete_category(message, state, client)

    assert await state.get_state() is None
    message.answer.assert_awaited_once_with("No categories to delete yet.")


async def test_delete_category_conflict_shows_friendly_message() -> None:
    category = make_category()
    state = make_state()
    await state.set_state(CategoryManage.delete_select)
    callback = make_callback()

    await h.on_delete_category_selected(
        callback, CategoryCallback(category_id=category.id), state, ConflictDeleteClient()
    )

    assert await state.get_state() is None
    text = callback.message.edit_text.await_args.args[0]
    assert "still in use" in text.lower()


# -- cancel -------------------------------------------------------------


async def test_cancel_command_clears_state() -> None:
    state = make_state()
    await state.set_state(CategoryManage.add_name)

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
    await context.set_state(CategoryManage.add_name)

    with patch.object(Message, "answer", new=AsyncMock()) as mocked_answer:
        await dp.feed_update(
            bot, make_text_update(1, tg_id, "/cancel"), client=FakeCategoryBackendClient()
        )

    assert await context.get_state() is None
    mocked_answer.assert_awaited_once_with("Cancelled.")
