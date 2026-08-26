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
from uuid import UUID, uuid4

import httpx
import pytest
from aiogram import Bot, Dispatcher
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.base import StorageKey
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Chat, Message, Update
from aiogram.types import User as TelegramUser

from bot.handlers import expenses as h
from bot.i18n import t
from bot.keyboards import (
    EDIT_FIELD_AMOUNT_CALLBACK,
    EDIT_FIELD_CATEGORY_CALLBACK,
    EDIT_FIELD_COMMENT_CALLBACK,
    EDIT_FIELD_TAGS_CALLBACK,
    CategoryCallback,
    ExpenseCallback,
    TagCallback,
)
from bot.states import AddExpense, DeleteExpense, EditExpense
from models.category import CategoryResponse
from models.enums import Language
from models.expense import ExpenseCreate, ExpenseResponse, ExpenseUpdate
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
        self.deleted: list[UUID] = []
        self.updated: list[tuple[UUID, ExpenseUpdate]] = []

    async def list_categories(self) -> list[CategoryResponse]:
        return self.categories

    async def list_tags(self) -> list[TagResponse]:
        return self.tags

    async def create_expense(self, data: ExpenseCreate) -> ExpenseResponse:
        self.created.append(data)
        return make_expense(amount=data.amount, comment=data.comment, category_id=data.category_id)

    async def list_expenses(self) -> list[ExpenseResponse]:
        return self.expenses

    async def update_expense(self, expense_id: UUID, data: ExpenseUpdate) -> ExpenseResponse:
        self.updated.append((expense_id, data))
        existing = next(
            (e for e in self.expenses if e.id == expense_id), make_expense(id=expense_id)
        )
        update_fields = data.model_dump(exclude_unset=True)
        return existing.model_copy(update=update_fields)

    async def delete_expense(self, expense_id: UUID) -> None:
        self.deleted.append(expense_id)


class FailingBackendClient(FakeBackendClient):
    async def create_expense(self, data: ExpenseCreate) -> ExpenseResponse:
        request = httpx.Request("POST", "http://test/expenses")
        response = httpx.Response(500, request=request)
        raise httpx.HTTPStatusError("boom", request=request, response=response)


class FailingUpdateBackendClient(FakeBackendClient):
    def __init__(self, status_code: int, expenses: list[ExpenseResponse] | None = None) -> None:
        super().__init__(expenses=expenses)
        self._status_code = status_code

    async def update_expense(self, expense_id: UUID, data: ExpenseUpdate) -> ExpenseResponse:
        request = httpx.Request("PATCH", f"http://test/expenses/{expense_id}")
        response = httpx.Response(self._status_code, request=request)
        raise httpx.HTTPStatusError("boom", request=request, response=response)


class FailingDeleteBackendClient(FakeBackendClient):
    def __init__(self, status_code: int, expenses: list[ExpenseResponse] | None = None) -> None:
        super().__init__(expenses=expenses)
        self._status_code = status_code

    async def delete_expense(self, expense_id: UUID) -> None:
        request = httpx.Request("DELETE", f"http://test/expenses/{expense_id}")
        response = httpx.Response(self._status_code, request=request)
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


async def test_add_expense_confirm_double_tap_issues_single_api_call() -> None:
    category = make_category()
    client = FakeBackendClient(categories=[category])
    state = make_state()
    await state.set_state(AddExpense.confirm)
    await state.update_data(
        category_id=str(category.id),
        category_name=category.name,
        amount=1000,
        comment=None,
        selected_tag_ids=[],
    )

    first = make_callback()
    second = make_callback()
    await h.on_confirm(first, state, client)
    await h.on_confirm(second, state, client)

    assert len(client.created) == 1
    # Keyboard dropped before the create call (double-tap guard, mirrors
    # on_delete_expense_confirmed).
    first.message.edit_reply_markup.assert_awaited_once_with(reply_markup=None)
    second.message.edit_reply_markup.assert_not_awaited()
    second.message.edit_text.assert_not_awaited()


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
    category = make_category("Groceries")
    expense = make_expense(
        amount=1250,
        comment=None,
        category_id=category.id,
        user_name="Alice",
        created_at=datetime(2026, 7, 18, tzinfo=UTC),
    )
    client = FakeBackendClient(categories=[category], expenses=[expense])
    message = make_message("/expenses")

    await h.cmd_list_expenses(message, client)

    message.answer.assert_awaited_once()
    text = message.answer.await_args.args[0]
    assert "12.50" in text
    assert "2026-07-18" in text
    assert "Groceries" in text
    assert "Alice" in text


async def test_list_expenses_unknown_category_falls_back_to_placeholder() -> None:
    expense = make_expense(category_id=uuid4())
    client = FakeBackendClient(categories=[make_category()], expenses=[expense])
    message = make_message("/expenses")

    await h.cmd_list_expenses(message, client)

    assert "Unknown" in message.answer.await_args.args[0]


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


async def test_list_expenses_categories_backend_error_shows_friendly_message() -> None:
    class FailingCategoriesClient(FakeBackendClient):
        async def list_categories(self) -> list[CategoryResponse]:
            request = httpx.Request("GET", "http://test/categories")
            raise httpx.ConnectError("boom", request=request)

    client = FailingCategoriesClient(expenses=[make_expense()])
    message = make_message("/expenses")

    await h.cmd_list_expenses(message, client)

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


# -- delete flow: picker -> detail view -> delete-with-confirm --------------


async def test_delete_expense_picker_shows_recent_expenses() -> None:
    category = make_category("Groceries")
    old = make_expense(
        amount=100, category_id=category.id, created_at=datetime(2026, 1, 1, tzinfo=UTC)
    )
    recent = make_expense(
        amount=1250, category_id=category.id, created_at=datetime(2026, 7, 18, tzinfo=UTC)
    )
    client = FakeBackendClient(categories=[category], expenses=[old, recent])
    state = make_state()
    message = make_message("/deleteexpense")

    await h.cmd_delete_expense(message, state, client)

    assert await state.get_state() == DeleteExpense.select.state
    message.answer.assert_awaited_once()
    markup = message.answer.await_args.kwargs["reply_markup"]
    buttons = [button for row in markup.inline_keyboard for button in row]
    # Newest first, regardless of the order client.list_expenses() returned.
    assert buttons[0].callback_data == f"expense:{recent.id.hex}"
    assert buttons[1].callback_data == f"expense:{old.id.hex}"


async def test_delete_expense_picker_no_expenses() -> None:
    client = FakeBackendClient(expenses=[])
    state = make_state()
    message = make_message("/deleteexpense")

    await h.cmd_delete_expense(message, state, client)

    assert await state.get_state() is None
    message.answer.assert_awaited_once_with("No expenses to delete yet.")


async def test_delete_expense_picker_backend_error_shows_friendly_message() -> None:
    class FailingListExpensesClient(FakeBackendClient):
        async def list_expenses(self) -> list[ExpenseResponse]:
            request = httpx.Request("GET", "http://test/expenses")
            raise httpx.ConnectError("boom", request=request)

    state = make_state()
    message = make_message("/deleteexpense")

    await h.cmd_delete_expense(message, state, FailingListExpensesClient())

    assert await state.get_state() is None
    assert "couldn't reach" in message.answer.await_args.args[0].lower()


async def test_delete_expense_selected_shows_detail_view_with_confirm() -> None:
    category = make_category("Groceries")
    tag = make_tag("urgent")
    expense = make_expense(
        amount=1250,
        comment="lunch",
        category_id=category.id,
        user_name="Alice",
        tags=[tag],
    )
    client = FakeBackendClient(categories=[category], expenses=[expense])
    state = make_state()
    await h.cmd_delete_expense(make_message("/deleteexpense"), state, client)

    callback = make_callback()
    await h.on_delete_expense_selected(callback, ExpenseCallback(expense_id=expense.id), state)

    assert await state.get_state() == DeleteExpense.confirm.state
    callback.message.edit_text.assert_awaited_once()
    text = callback.message.edit_text.await_args.args[0]
    assert "Groceries" in text
    assert "12.50" in text
    assert "lunch" in text
    assert "Alice" in text
    assert "urgent" in text
    markup = callback.message.edit_text.await_args.kwargs["reply_markup"]
    assert [b.callback_data for b in markup.inline_keyboard[0]] == [
        "expense:confirm",
        "expense:cancel",
    ]


async def test_delete_expense_selected_unknown_id_reprompts() -> None:
    client = FakeBackendClient(expenses=[make_expense()])
    state = make_state()
    await h.cmd_delete_expense(make_message("/deleteexpense"), state, client)

    callback = make_callback()
    await h.on_delete_expense_selected(callback, ExpenseCallback(expense_id=uuid4()), state)

    assert await state.get_state() == DeleteExpense.select.state
    callback.answer.assert_awaited_once()
    assert callback.answer.await_args.kwargs.get("show_alert") is True


async def test_delete_expense_confirmed_happy_path() -> None:
    expense = make_expense()
    client = FakeBackendClient(expenses=[expense])
    state = make_state()
    await state.set_state(DeleteExpense.confirm)
    await state.update_data(delete_target_id=str(expense.id))

    callback = make_callback()
    await h.on_delete_expense_confirmed(callback, state, client)

    assert await state.get_state() is None
    assert client.deleted == [expense.id]
    # Keyboard dropped before the delete text is shown (double-tap guard).
    callback.message.edit_reply_markup.assert_awaited_once_with(reply_markup=None)
    callback.message.edit_text.assert_awaited_once_with("Expense deleted.")


@pytest.mark.parametrize(
    ("status_code", "expected_fragment"),
    [(403, "permission"), (404, "no longer exists")],
)
async def test_delete_expense_confirmed_error_shows_friendly_message(
    status_code: int, expected_fragment: str
) -> None:
    expense = make_expense()
    client = FailingDeleteBackendClient(status_code, expenses=[expense])
    state = make_state()
    await state.set_state(DeleteExpense.confirm)
    await state.update_data(delete_target_id=str(expense.id))

    callback = make_callback()
    await h.on_delete_expense_confirmed(callback, state, client)

    text = callback.message.edit_text.await_args.args[0]
    assert expected_fragment in text.lower()


async def test_delete_expense_double_tap_issues_single_api_call() -> None:
    expense = make_expense()
    client = FakeBackendClient(expenses=[expense])
    state = make_state()
    await state.set_state(DeleteExpense.confirm)
    await state.update_data(delete_target_id=str(expense.id))

    first = make_callback()
    second = make_callback()
    await h.on_delete_expense_confirmed(first, state, client)
    await h.on_delete_expense_confirmed(second, state, client)

    assert client.deleted == [expense.id]
    second.message.edit_reply_markup.assert_not_awaited()
    second.message.edit_text.assert_not_awaited()


async def test_delete_expense_cancelled_clears_state() -> None:
    state = make_state()
    await state.set_state(DeleteExpense.confirm)
    await state.update_data(delete_target_id=str(uuid4()))

    callback = make_callback()
    await h.on_delete_expense_cancelled(callback, state)

    assert await state.get_state() is None
    callback.message.edit_text.assert_awaited_once_with("Cancelled.")


# -- edit flow: picker -> detail view -> field -> new value -> update -------


async def test_edit_expense_picker_shows_recent_expenses() -> None:
    category = make_category("Groceries")
    old = make_expense(
        amount=100, category_id=category.id, created_at=datetime(2026, 1, 1, tzinfo=UTC)
    )
    recent = make_expense(
        amount=1250, category_id=category.id, created_at=datetime(2026, 7, 18, tzinfo=UTC)
    )
    client = FakeBackendClient(categories=[category], expenses=[old, recent])
    state = make_state()
    message = make_message("/editexpense")

    await h.cmd_edit_expense(message, state, client)

    assert await state.get_state() == EditExpense.select.state
    markup = message.answer.await_args.kwargs["reply_markup"]
    buttons = [button for row in markup.inline_keyboard for button in row]
    assert buttons[0].callback_data == f"expense:{recent.id.hex}"
    assert buttons[1].callback_data == f"expense:{old.id.hex}"


async def test_edit_expense_picker_no_expenses() -> None:
    client = FakeBackendClient(expenses=[])
    state = make_state()
    message = make_message("/editexpense")

    await h.cmd_edit_expense(message, state, client)

    assert await state.get_state() is None
    message.answer.assert_awaited_once_with("No expenses to edit yet.")


async def test_edit_expense_picker_backend_error_shows_friendly_message() -> None:
    class FailingListExpensesClient(FakeBackendClient):
        async def list_expenses(self) -> list[ExpenseResponse]:
            request = httpx.Request("GET", "http://test/expenses")
            raise httpx.ConnectError("boom", request=request)

    state = make_state()
    message = make_message("/editexpense")

    await h.cmd_edit_expense(message, state, FailingListExpensesClient())

    assert await state.get_state() is None
    assert "couldn't reach" in message.answer.await_args.args[0].lower()


async def test_edit_expense_selected_shows_detail_view_with_field_picker() -> None:
    category = make_category("Groceries")
    expense = make_expense(amount=1250, category_id=category.id)
    client = FakeBackendClient(categories=[category], expenses=[expense])
    state = make_state()
    await h.cmd_edit_expense(make_message("/editexpense"), state, client)

    callback = make_callback()
    await h.on_edit_expense_selected(callback, ExpenseCallback(expense_id=expense.id), state)

    assert await state.get_state() == EditExpense.field.state
    text = callback.message.edit_text.await_args.args[0]
    assert "Groceries" in text
    assert "12.50" in text
    markup = callback.message.edit_text.await_args.kwargs["reply_markup"]
    labels = [b.text for row in markup.inline_keyboard for b in row]
    assert labels == ["Amount", "Category", "Comment", "Tags"]


async def test_edit_expense_selected_unknown_id_reprompts() -> None:
    client = FakeBackendClient(expenses=[make_expense()])
    state = make_state()
    await h.cmd_edit_expense(make_message("/editexpense"), state, client)

    callback = make_callback()
    await h.on_edit_expense_selected(callback, ExpenseCallback(expense_id=uuid4()), state)

    assert await state.get_state() == EditExpense.select.state
    callback.answer.assert_awaited_once()
    assert callback.answer.await_args.kwargs.get("show_alert") is True


async def test_edit_amount_walkthrough_updates_expense() -> None:
    expense = make_expense(amount=1000)
    client = FakeBackendClient(expenses=[expense])
    state = make_state()
    await state.set_state(EditExpense.field)
    await state.update_data(edit_target_id=str(expense.id))

    field_callback = make_callback()
    field_callback.data = EDIT_FIELD_AMOUNT_CALLBACK
    await h.on_edit_field_chosen(field_callback, state, client)
    assert await state.get_state() == EditExpense.amount.state
    field_callback.message.edit_text.assert_awaited_once()

    amount_message = make_message("15.00")
    await h.on_edit_amount_entered(amount_message, state, client)

    assert await state.get_state() is None
    assert client.updated == [(expense.id, ExpenseUpdate(amount=1500))]
    assert "15.00" in amount_message.answer.await_args.args[0]


async def test_edit_amount_invalid_reprompts_and_stays_in_amount_state() -> None:
    expense = make_expense()
    client = FakeBackendClient(expenses=[expense])
    state = make_state()
    await state.set_state(EditExpense.amount)
    await state.update_data(edit_target_id=str(expense.id))

    message = make_message("not a number")
    await h.on_edit_amount_entered(message, state, client)

    assert await state.get_state() == EditExpense.amount.state
    assert client.updated == []


async def test_edit_comment_walkthrough_updates_expense() -> None:
    expense = make_expense(comment="old comment")
    client = FakeBackendClient(expenses=[expense])
    state = make_state()
    await state.set_state(EditExpense.field)
    await state.update_data(edit_target_id=str(expense.id))

    field_callback = make_callback()
    field_callback.data = EDIT_FIELD_COMMENT_CALLBACK
    await h.on_edit_field_chosen(field_callback, state, client)
    assert await state.get_state() == EditExpense.comment.state

    comment_message = make_message("new comment")
    await h.on_edit_comment_entered(comment_message, state, client)

    assert await state.get_state() is None
    assert client.updated == [(expense.id, ExpenseUpdate(comment="new comment"))]


async def test_edit_category_walkthrough_updates_expense() -> None:
    old_category = make_category("Groceries")
    new_category = make_category("Utilities")
    expense = make_expense(category_id=old_category.id)
    client = FakeBackendClient(categories=[old_category, new_category], expenses=[expense])
    state = make_state()
    await state.set_state(EditExpense.field)
    await state.update_data(edit_target_id=str(expense.id))

    field_callback = make_callback()
    field_callback.data = EDIT_FIELD_CATEGORY_CALLBACK
    await h.on_edit_field_chosen(field_callback, state, client)
    assert await state.get_state() == EditExpense.category.state

    category_callback = make_callback()
    await h.on_edit_category_chosen(
        category_callback, CategoryCallback(category_id=new_category.id), state, client
    )

    assert await state.get_state() is None
    assert client.updated == [(expense.id, ExpenseUpdate(category_id=new_category.id))]


async def test_edit_field_category_backend_error_shows_friendly_message() -> None:
    class FailingCategoriesClient(FakeBackendClient):
        async def list_categories(self) -> list[CategoryResponse]:
            request = httpx.Request("GET", "http://test/categories")
            raise httpx.ConnectError("boom", request=request)

    expense = make_expense()
    state = make_state()
    await state.set_state(EditExpense.field)
    await state.update_data(edit_target_id=str(expense.id))

    field_callback = make_callback()
    field_callback.data = EDIT_FIELD_CATEGORY_CALLBACK
    await h.on_edit_field_chosen(field_callback, state, FailingCategoriesClient(expenses=[expense]))

    assert "couldn't reach" in field_callback.message.edit_text.await_args.args[0].lower()


async def test_edit_field_tags_backend_error_shows_friendly_message() -> None:
    class FailingTagsClient(FakeBackendClient):
        async def list_tags(self) -> list[TagResponse]:
            request = httpx.Request("GET", "http://test/tags")
            raise httpx.ConnectError("boom", request=request)

    expense = make_expense()
    state = make_state()
    await state.set_state(EditExpense.field)
    await state.update_data(edit_target_id=str(expense.id))

    field_callback = make_callback()
    field_callback.data = EDIT_FIELD_TAGS_CALLBACK
    await h.on_edit_field_chosen(field_callback, state, FailingTagsClient(expenses=[expense]))

    assert "couldn't reach" in field_callback.message.edit_text.await_args.args[0].lower()


async def test_edit_tags_preselected_toggle_then_done_updates_expense() -> None:
    kept_tag = make_tag("urgent")
    new_tag = make_tag("home")
    expense = make_expense(tags=[kept_tag])
    client = FakeBackendClient(tags=[kept_tag, new_tag], expenses=[expense])
    state = make_state()
    await state.set_state(EditExpense.select)
    await state.update_data(expenses_by_id={str(expense.id): expense})
    await state.update_data(edit_target_id=str(expense.id))
    await state.set_state(EditExpense.field)

    field_callback = make_callback()
    field_callback.data = EDIT_FIELD_TAGS_CALLBACK
    await h.on_edit_field_chosen(field_callback, state, client)

    assert await state.get_state() == EditExpense.tags.state
    assert set((await state.get_data())["selected_tag_ids"]) == {str(kept_tag.id)}
    markup = field_callback.message.edit_text.await_args.kwargs["reply_markup"]
    texts = [b.text for row in markup.inline_keyboard for b in row]
    assert any(t.startswith("✅") and "urgent" in t for t in texts)

    toggle_callback = make_callback()
    await h.on_tag_toggled(toggle_callback, TagCallback(tag_id=new_tag.id), state)
    assert set((await state.get_data())["selected_tag_ids"]) == {str(kept_tag.id), str(new_tag.id)}

    done_callback = make_callback()
    await h.on_edit_tags_done(done_callback, state, client)

    assert await state.get_state() is None
    [(updated_id, update)] = client.updated
    assert updated_id == expense.id
    assert update.tag_ids is not None
    assert set(update.tag_ids) == {kept_tag.id, new_tag.id}


@pytest.mark.parametrize(
    ("status_code", "expected_fragment"),
    [(403, "permission"), (404, "no longer exists")],
)
async def test_edit_update_error_shows_friendly_message(
    status_code: int, expected_fragment: str
) -> None:
    expense = make_expense()
    client = FailingUpdateBackendClient(status_code, expenses=[expense])
    state = make_state()
    await state.set_state(EditExpense.amount)
    await state.update_data(edit_target_id=str(expense.id))

    message = make_message("15.00")
    await h.on_edit_amount_entered(message, state, client)

    text = message.answer.await_args.args[0]
    assert expected_fragment in text.lower()


async def test_edit_expense_cancel_mid_flow_clears_state() -> None:
    state = make_state()
    await state.set_state(EditExpense.field)
    await state.update_data(edit_target_id=str(uuid4()))

    message = make_message("/cancel")
    await h.on_cancel_command(message, state)

    assert await state.get_state() is None
    assert await state.get_data() == {}


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


async def test_deleteexpense_command_reaches_delete_handler_not_amount_catchall() -> None:
    dp = make_router_dispatcher()
    bot = Bot(token="42:TEST-token")
    tg_id = 555
    context = dp.fsm.resolve_context(bot, chat_id=tg_id, user_id=tg_id)
    assert context is not None
    await context.set_state(AddExpense.amount)

    with patch.object(Message, "answer", new=AsyncMock()) as mocked_answer:
        await dp.feed_update(
            bot, make_text_update(1, tg_id, "/deleteexpense"), client=FakeBackendClient()
        )

    mocked_answer.assert_awaited_once_with("No expenses to delete yet.")


async def test_cancel_command_reaches_cancel_handler_from_delete_select_state() -> None:
    dp = make_router_dispatcher()
    bot = Bot(token="42:TEST-token")
    tg_id = 555
    context = dp.fsm.resolve_context(bot, chat_id=tg_id, user_id=tg_id)
    assert context is not None
    await context.set_state(DeleteExpense.select)

    with patch.object(Message, "answer", new=AsyncMock()) as mocked_answer:
        await dp.feed_update(bot, make_text_update(1, tg_id, "/cancel"), client=FakeBackendClient())

    assert await context.get_state() is None
    mocked_answer.assert_awaited_once_with("Cancelled.")


# -- language threading (U3.13 AC: RU/UK render for an account set to them) -
# RU/UK alias the EN catalogue until U3.15 ships real translations
# (bot/i18n.py), so these assert the *mechanism* — the injected `language`
# reaches every t() call along the way — not that the rendered text differs
# from English yet.


async def test_add_expense_choose_category_uses_the_injected_language() -> None:
    message = make_message()
    state = make_state()
    client = FakeBackendClient()

    await h.cmd_add_expense(message, state, client, language=Language.RU)

    message.answer.assert_awaited_once()
    args, _ = message.answer.call_args
    assert args[0] == t(Language.RU, "expense.chooseCategory")


async def test_confirm_saves_and_renders_in_the_injected_language() -> None:
    category = make_category()
    client = FakeBackendClient(categories=[category], tags=[])
    state = make_state()
    await h.cmd_add_expense(make_message(), state, client, language=Language.RU)
    await h.on_category_chosen(
        make_callback(), CategoryCallback(category_id=category.id), state, language=Language.RU
    )
    await h.on_amount_entered(make_message("10"), state, language=Language.RU)
    confirm_callback = make_callback()
    await h.on_comment_skipped(make_message("/skip"), state, client, language=Language.RU)

    await h.on_confirm(confirm_callback, state, client, language=Language.RU)

    assert confirm_callback.message.edit_text.await_args.args[0] == t(
        Language.RU, "expense.saved", amount="10.00"
    )


async def test_delete_expense_confirmed_renders_in_the_injected_language() -> None:
    expense = make_expense()
    client = FakeBackendClient(expenses=[expense])
    state = make_state()
    await state.set_state(DeleteExpense.confirm)
    await state.update_data(delete_target_id=str(expense.id))
    callback = make_callback()

    await h.on_delete_expense_confirmed(callback, state, client, language=Language.RU)

    callback.message.edit_text.assert_awaited_once_with(t(Language.RU, "expense.deleted"))


async def test_error_message_maps_status_codes_in_the_injected_language() -> None:
    def make_error(status_code: int) -> httpx.HTTPStatusError:
        request = httpx.Request("DELETE", "http://test/expenses/1")
        return httpx.HTTPStatusError(
            "boom", request=request, response=httpx.Response(status_code, request=request)
        )

    assert h._error_message(make_error(403), Language.RU) == t(Language.RU, "readonly")
    assert h._error_message(make_error(404), Language.RU) == t(
        Language.RU, "expense.error.staleExpense"
    )
    assert h._error_message(make_error(500), Language.RU) == t(
        Language.RU, "expense.error.fallback"
    )


async def test_editexpense_command_reaches_edit_handler_not_amount_catchall() -> None:
    dp = make_router_dispatcher()
    bot = Bot(token="42:TEST-token")
    tg_id = 555
    context = dp.fsm.resolve_context(bot, chat_id=tg_id, user_id=tg_id)
    assert context is not None
    await context.set_state(AddExpense.amount)

    with patch.object(Message, "answer", new=AsyncMock()) as mocked_answer:
        await dp.feed_update(
            bot, make_text_update(1, tg_id, "/editexpense"), client=FakeBackendClient()
        )

    mocked_answer.assert_awaited_once_with("No expenses to edit yet.")


async def test_cancel_command_reaches_cancel_handler_from_edit_field_state() -> None:
    dp = make_router_dispatcher()
    bot = Bot(token="42:TEST-token")
    tg_id = 555
    context = dp.fsm.resolve_context(bot, chat_id=tg_id, user_id=tg_id)
    assert context is not None
    await context.set_state(EditExpense.field)

    with patch.object(Message, "answer", new=AsyncMock()) as mocked_answer:
        await dp.feed_update(bot, make_text_update(1, tg_id, "/cancel"), client=FakeBackendClient())

    assert await context.get_state() is None
    mocked_answer.assert_awaited_once_with("Cancelled.")
