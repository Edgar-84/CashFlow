"""Unit tests for bot/handlers/expenses.py — FSM add-expense flow
(tests/CLAUDE.md: "Bot handlers are tested by mocking BackendClient — never a
live backend", U4.3 AC).

Hermetic: a FakeBackendClient stands in for bot/client.py's BackendClient (no
real backend HTTP); handlers are called directly with mock Message/
CallbackQuery objects (no real Telegram network) and a real FSMContext over
aiogram's MemoryStorage, so state transitions are exercised for real rather
than asserted against a mock.

A second group of tests dispatches through a real `Dispatcher` +
`create_router()` (Telegram network still mocked via `Message.answer`
patched to an `AsyncMock`) — these exist specifically to catch
router-registration-order bugs (e.g. a catch-all per-state text handler
shadowing `/cancel`) that calling handler functions directly cannot see.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import httpx
import pytest
from aiogram import Bot, Dispatcher
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.base import StorageKey
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Chat, Message, Update
from aiogram.types import User as TelegramUser

from bot.handlers import expenses as h
from bot.keyboards import CategoryCallback, TagCallback
from bot.states import AddExpense
from models.category import CategoryResponse
from models.expense import ExpenseCreate, ExpenseResponse
from models.tag import TagResponse


def make_state() -> FSMContext:
    return FSMContext(storage=MemoryStorage(), key=StorageKey(bot_id=1, chat_id=1, user_id=1))


def make_category(name: str = "Groceries") -> CategoryResponse:
    return CategoryResponse(id=uuid4(), account_id=uuid4(), created_at=datetime.now(UTC), name=name)


def make_tag(name: str = "urgent") -> TagResponse:
    return TagResponse(id=uuid4(), account_id=uuid4(), created_at=datetime.now(UTC), name=name)


def make_expense(**overrides: object) -> ExpenseResponse:
    defaults: dict[str, object] = {
        "id": uuid4(),
        "user_id": uuid4(),
        "account_id": uuid4(),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
        "amount": 1250,
        "comment": None,
        "category_id": uuid4(),
        "tags": [],
    }
    defaults.update(overrides)
    return ExpenseResponse.model_validate(defaults)


class FakeBackendClient:
    def __init__(
        self,
        categories: list[CategoryResponse] | None = None,
        tags: list[TagResponse] | None = None,
        expenses: list[ExpenseResponse] | None = None,
    ) -> None:
        self.categories = categories if categories is not None else [make_category()]
        self.tags = tags if tags is not None else [make_tag()]
        self.expenses = expenses if expenses is not None else []
        self.created: list[ExpenseCreate] = []

    async def list_categories(self) -> list[CategoryResponse]:
        return self.categories

    async def list_tags(self) -> list[TagResponse]:
        return self.tags

    async def create_expense(self, data: ExpenseCreate) -> ExpenseResponse:
        self.created.append(data)
        return make_expense(amount=data.amount, comment=data.comment, category_id=data.category_id)

    async def list_expenses(self) -> list[ExpenseResponse]:
        return self.expenses


class FailingBackendClient(FakeBackendClient):
    async def create_expense(self, data: ExpenseCreate) -> ExpenseResponse:
        request = httpx.Request("POST", "http://test/expenses")
        response = httpx.Response(500, request=request)
        raise httpx.HTTPStatusError("boom", request=request, response=response)


def make_message(text: str | None = None) -> Mock:
    message = Mock(spec=Message)
    message.text = text
    message.answer = AsyncMock()
    message.edit_text = AsyncMock()
    message.edit_reply_markup = AsyncMock()
    return message


def make_callback(message: Mock | None = None) -> Mock:
    callback = Mock()
    callback.message = message or make_message()
    callback.answer = AsyncMock()
    return callback


# -- parse_amount_to_minor_units --------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("12.50", 1250),
        ("12,50", 1250),
        ("1 234,56", 123456),
        ("1234", 123400),
        (" 12.5 ", 1250),
        ("0.01", 1),
        ("1\xa0234.00", 123400),
    ],
)
def test_parse_amount_to_minor_units_valid(text: str, expected: int) -> None:
    assert h.parse_amount_to_minor_units(text) == expected


@pytest.mark.parametrize("text", ["abc", "-5", "0", "1.2.3", "", "   "])
def test_parse_amount_to_minor_units_invalid(text: str) -> None:
    with pytest.raises(ValueError):
        h.parse_amount_to_minor_units(text)


# -- happy path walkthrough --------------------------------------------------


async def test_happy_path_full_flow_creates_expense() -> None:
    category = make_category("Groceries")
    tag = make_tag("urgent")
    client = FakeBackendClient(categories=[category], tags=[tag])
    state = make_state()

    add_message = make_message("/add")
    await h.cmd_add_expense(add_message, state, client)
    assert await state.get_state() == AddExpense.category.state
    add_message.answer.assert_awaited_once()

    category_callback = make_callback()
    await h.on_category_chosen(category_callback, CategoryCallback(category_id=category.id), state)
    assert await state.get_state() == AddExpense.amount.state
    category_callback.message.edit_text.assert_awaited_once()

    amount_message = make_message("12.50")
    await h.on_amount_entered(amount_message, state)
    assert await state.get_state() == AddExpense.comment.state
    assert (await state.get_data())["amount"] == 1250

    comment_message = make_message("lunch with friends")
    await h.on_comment_entered(comment_message, state, client)
    assert await state.get_state() == AddExpense.tags.state
    assert (await state.get_data())["comment"] == "lunch with friends"

    tag_callback = make_callback()
    await h.on_tag_toggled(tag_callback, TagCallback(tag_id=tag.id), state)
    assert (await state.get_data())["selected_tag_ids"] == [str(tag.id)]
    tag_callback.message.edit_reply_markup.assert_awaited_once()
    redrawn_markup = tag_callback.message.edit_reply_markup.await_args.kwargs["reply_markup"]
    redrawn_texts = [button.text for row in redrawn_markup.inline_keyboard for button in row]
    assert any(text.startswith("✅") and "urgent" in text for text in redrawn_texts), redrawn_texts

    done_callback = make_callback()
    await h.on_tags_done(done_callback, state)
    assert await state.get_state() == AddExpense.confirm.state
    summary = done_callback.message.edit_text.await_args.args[0]
    assert "Groceries" in summary
    assert "12.50" in summary
    assert "urgent" in summary

    confirm_callback = make_callback()
    await h.on_confirm(confirm_callback, state, client)

    assert await state.get_state() is None
    assert len(client.created) == 1
    created = client.created[0]
    assert created.amount == 1250
    assert created.category_id == category.id
    assert created.tag_ids == [tag.id]
    assert created.comment == "lunch with friends"
    confirm_callback.message.edit_text.assert_awaited_once()


async def test_no_categories_never_starts_flow() -> None:
    client = FakeBackendClient(categories=[])
    state = make_state()
    message = make_message("/add")

    await h.cmd_add_expense(message, state, client)

    assert await state.get_state() is None
    message.answer.assert_awaited_once()


async def test_no_tags_skips_tag_step_straight_to_confirm() -> None:
    category = make_category()
    client = FakeBackendClient(categories=[category], tags=[])
    state = make_state()
    await state.set_state(AddExpense.category)
    await state.update_data(categories=[category])
    await h.on_category_chosen(make_callback(), CategoryCallback(category_id=category.id), state)
    await h.on_amount_entered(make_message("10"), state)

    await h.on_comment_skipped(make_message("/skip"), state, client)

    assert await state.get_state() == AddExpense.confirm.state


async def test_invalid_amount_reprompts_and_stays_in_amount_state() -> None:
    state = make_state()
    await state.set_state(AddExpense.amount)

    message = make_message("not a number")
    await h.on_amount_entered(message, state)

    assert await state.get_state() == AddExpense.amount.state
    message.answer.assert_awaited_once()
    assert "amount" not in await state.get_data()


async def test_cancel_command_clears_state_mid_flow() -> None:
    state = make_state()
    await state.set_state(AddExpense.amount)
    await state.update_data(amount=999)

    message = make_message("/cancel")
    await h.on_cancel_command(message, state)

    assert await state.get_state() is None
    assert await state.get_data() == {}
    message.answer.assert_awaited_once()


async def test_cancel_callback_clears_state_from_confirm() -> None:
    state = make_state()
    await state.set_state(AddExpense.confirm)
    await state.update_data(amount=999)

    callback = make_callback()
    await h.on_cancel_callback(callback, state)

    assert await state.get_state() is None
    callback.message.edit_text.assert_awaited_once()


async def test_create_expense_failure_clears_state_and_shows_friendly_message() -> None:
    category = make_category()
    client = FailingBackendClient(categories=[category])
    state = make_state()
    await state.set_state(AddExpense.confirm)
    await state.update_data(
        category_id=str(category.id),
        category_name=category.name,
        amount=1000,
        comment=None,
        selected_tag_ids=[],
    )

    callback = make_callback()
    await h.on_confirm(callback, state, client)

    assert await state.get_state() is None
    callback.message.edit_text.assert_awaited_once()
    assert "went wrong" in callback.message.edit_text.await_args.args[0].lower()


async def test_add_expense_backend_error_shows_friendly_message() -> None:
    class FailingListClient(FakeBackendClient):
        async def list_categories(self) -> list[CategoryResponse]:
            request = httpx.Request("GET", "http://test/categories")
            raise httpx.ConnectError("boom", request=request)

    state = make_state()
    message = make_message("/add")

    await h.cmd_add_expense(message, state, FailingListClient())

    assert await state.get_state() is None
    message.answer.assert_awaited_once()
    assert "couldn't reach" in message.answer.await_args.args[0].lower()


async def test_prompt_tags_backend_error_shows_friendly_message_and_keeps_state() -> None:
    class FailingTagsClient(FakeBackendClient):
        async def list_tags(self) -> list[TagResponse]:
            request = httpx.Request("GET", "http://test/tags")
            raise httpx.ConnectError("boom", request=request)

    state = make_state()
    await state.set_state(AddExpense.comment)

    await h.on_comment_skipped(make_message("/skip"), state, FailingTagsClient())

    assert await state.get_state() == AddExpense.comment.state


# -- list view ----------------------------------------------------------


async def test_list_expenses_renders_non_empty_list() -> None:
    expense = make_expense(amount=1250, comment=None, created_at=datetime(2026, 7, 18, tzinfo=UTC))
    client = FakeBackendClient(expenses=[expense])
    message = make_message("/expenses")

    await h.cmd_list_expenses(message, client)

    message.answer.assert_awaited_once()
    text = message.answer.await_args.args[0]
    assert "12.50" in text
    assert "2026-07-18" in text


async def test_list_expenses_renders_empty_list() -> None:
    client = FakeBackendClient(expenses=[])
    message = make_message("/expenses")

    await h.cmd_list_expenses(message, client)

    message.answer.assert_awaited_once_with("No expenses yet.")


async def test_list_expenses_shows_comment_when_present() -> None:
    with_comment = make_expense(amount=500, comment="lunch")
    without_comment = make_expense(amount=1000, comment=None)
    client = FakeBackendClient(expenses=[with_comment, without_comment])
    message = make_message("/expenses")

    await h.cmd_list_expenses(message, client)

    text = message.answer.await_args.args[0]
    assert "lunch" in text
    assert "12.50" not in text  # sanity: not the add-expense summary format
    assert "5.00" in text
    assert "10.00" in text


async def test_list_expenses_backend_error_shows_friendly_message() -> None:
    class FailingListExpensesClient(FakeBackendClient):
        async def list_expenses(self) -> list[ExpenseResponse]:
            request = httpx.Request("GET", "http://test/expenses")
            raise httpx.ConnectError("boom", request=request)

    message = make_message("/expenses")

    await h.cmd_list_expenses(message, FailingListExpensesClient())

    message.answer.assert_awaited_once()
    assert "couldn't reach" in message.answer.await_args.args[0].lower()


async def test_list_expenses_truncates_long_list_and_long_comments() -> None:
    many = [make_expense() for _ in range(h._MAX_EXPENSES_SHOWN + 5)]
    long_comment = make_expense(comment="x" * 500)
    client = FakeBackendClient(expenses=[*many, long_comment])
    message = make_message("/expenses")

    await h.cmd_list_expenses(message, client)

    text = message.answer.await_args.args[0]
    assert len(text) < 4096
    assert "and 6 more not shown" in text
    assert "x" * 500 not in text


# -- real-dispatch regression tests: catch router-registration-order bugs ---


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


async def test_cancel_command_reaches_cancel_handler_not_amount_catchall() -> None:
    dp = make_router_dispatcher()
    bot = Bot(token="42:TEST-token")
    tg_id = 555
    context = dp.fsm.resolve_context(bot, chat_id=tg_id, user_id=tg_id)
    assert context is not None
    await context.set_state(AddExpense.amount)

    with patch.object(Message, "answer", new=AsyncMock()) as mocked_answer:
        await dp.feed_update(bot, make_text_update(1, tg_id, "/cancel"), client=FakeBackendClient())

    assert await context.get_state() is None
    mocked_answer.assert_awaited_once_with("Cancelled.")


async def test_cancel_command_reaches_cancel_handler_not_comment_catchall() -> None:
    dp = make_router_dispatcher()
    bot = Bot(token="42:TEST-token")
    tg_id = 555
    context = dp.fsm.resolve_context(bot, chat_id=tg_id, user_id=tg_id)
    assert context is not None
    await context.set_state(AddExpense.comment)
    await context.update_data(amount=1000)

    with patch.object(Message, "answer", new=AsyncMock()) as mocked_answer:
        await dp.feed_update(bot, make_text_update(1, tg_id, "/cancel"), client=FakeBackendClient())

    assert await context.get_state() is None
    mocked_answer.assert_awaited_once_with("Cancelled.")


async def test_expenses_command_reaches_list_handler_not_amount_catchall() -> None:
    dp = make_router_dispatcher()
    bot = Bot(token="42:TEST-token")
    tg_id = 555
    context = dp.fsm.resolve_context(bot, chat_id=tg_id, user_id=tg_id)
    assert context is not None
    await context.set_state(AddExpense.amount)

    with patch.object(Message, "answer", new=AsyncMock()) as mocked_answer:
        await dp.feed_update(
            bot, make_text_update(1, tg_id, "/expenses"), client=FakeBackendClient()
        )

    mocked_answer.assert_awaited_once_with("No expenses yet.")
