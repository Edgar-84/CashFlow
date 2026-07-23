"""Unit tests for bot/handlers/budgets.py — read-only `/budgets` progress
rendering (U4.5 AC: "rendering tests on fixed API responses (progress bars,
totals formatted from minor units)") plus the U2.2 `BudgetManage` add/update/
delete FSM (tests/CLAUDE.md: "Bot handlers are tested by mocking
BackendClient — never a live backend"; AC: "fake-client tests — add/update/
delete happy paths, duplicate -> 'already exists' message, permission-denied
message, invalid amount/threshold re-prompts, cancel; registration-order
test").

Hermetic: a FakeBudgetBackendClient stands in for bot/client.py's
BackendClient (no real backend HTTP); handlers are called directly with mock
Message/CallbackQuery objects (no real Telegram network) and a real
FSMContext over aiogram's MemoryStorage. A real-Dispatcher test guards the
same registration-order class of bug as test_bot_handlers_categories.py
(D39/D40 precedent).
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock, patch
from uuid import UUID, uuid4

import httpx
from aiogram import Bot, Dispatcher
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.base import StorageKey
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Chat, Message, Update
from aiogram.types import User as TelegramUser

from bot.handlers import budgets as h
from bot.keyboards import BudgetCallback, CategoryCallback
from bot.states import BudgetManage
from models.budget_plan import (
    BudgetPlanCreate,
    BudgetPlanResponse,
    BudgetPlanUpdate,
    BudgetProgress,
)
from models.category import CategoryResponse


def make_state() -> FSMContext:
    return FSMContext(storage=MemoryStorage(), key=StorageKey(bot_id=1, chat_id=1, user_id=1))


def make_category(name: str = "Groceries", category_id: UUID | None = None) -> CategoryResponse:
    return CategoryResponse(
        id=category_id or uuid4(), account_id=uuid4(), created_at=datetime.now(UTC), name=name
    )


def make_plan(
    category_id: UUID,
    plan_id: UUID | None = None,
    amount: int = 10000,
    notify_threshold: int = 80,
) -> BudgetPlanResponse:
    return BudgetPlanResponse(
        id=plan_id or uuid4(),
        account_id=uuid4(),
        category_id=category_id,
        amount=amount,
        period="monthly",
        notify_threshold=notify_threshold,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def make_progress(
    plan: BudgetPlanResponse,
    spent: int,
    fill_pct: float | None,
    is_over_threshold: bool = False,
    is_exceeded: bool = False,
) -> BudgetProgress:
    return BudgetProgress(
        budget_plan_id=plan.id,
        category_id=plan.category_id,
        amount=plan.amount,
        spent=spent,
        remaining=plan.amount - spent,
        fill_pct=fill_pct,
        notify_threshold=plan.notify_threshold,
        is_over_threshold=is_over_threshold,
        is_exceeded=is_exceeded,
    )


class FakeBudgetBackendClient:
    def __init__(
        self,
        plans: list[BudgetPlanResponse] | None = None,
        categories: list[CategoryResponse] | None = None,
        progress_by_plan_id: dict[UUID, BudgetProgress] | None = None,
    ) -> None:
        self.plans = plans if plans is not None else []
        self.categories = categories if categories is not None else []
        self.progress_by_plan_id = progress_by_plan_id or {}
        self.created: list[BudgetPlanCreate] = []
        self.updated: list[tuple[UUID, BudgetPlanUpdate]] = []
        self.deleted: list[UUID] = []

    async def list_budget_plans(self) -> list[BudgetPlanResponse]:
        return self.plans

    async def list_categories(self) -> list[CategoryResponse]:
        return self.categories

    async def get_budget_plan_progress(self, budget_plan_id: UUID) -> BudgetProgress:
        return self.progress_by_plan_id[budget_plan_id]

    async def create_budget_plan(self, data: BudgetPlanCreate) -> BudgetPlanResponse:
        self.created.append(data)
        return make_plan(
            data.category_id, notify_threshold=data.notify_threshold, amount=data.amount
        )

    async def update_budget_plan(
        self, budget_plan_id: UUID, data: BudgetPlanUpdate
    ) -> BudgetPlanResponse:
        self.updated.append((budget_plan_id, data))
        current = next(p for p in self.plans if p.id == budget_plan_id)
        return make_plan(
            current.category_id,
            plan_id=budget_plan_id,
            amount=data.amount if data.amount is not None else current.amount,
            notify_threshold=(
                data.notify_threshold
                if data.notify_threshold is not None
                else current.notify_threshold
            ),
        )

    async def delete_budget_plan(self, budget_plan_id: UUID) -> None:
        self.deleted.append(budget_plan_id)


def _status_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://test/budgets")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


class ForbiddenCreateClient(FakeBudgetBackendClient):
    async def create_budget_plan(self, data: BudgetPlanCreate) -> BudgetPlanResponse:
        raise _status_error(403)


class ConflictCreateClient(FakeBudgetBackendClient):
    async def create_budget_plan(self, data: BudgetPlanCreate) -> BudgetPlanResponse:
        raise _status_error(409)


class ForbiddenUpdateClient(FakeBudgetBackendClient):
    async def update_budget_plan(
        self, budget_plan_id: UUID, data: BudgetPlanUpdate
    ) -> BudgetPlanResponse:
        raise _status_error(403)


class ForbiddenDeleteClient(FakeBudgetBackendClient):
    async def delete_budget_plan(self, budget_plan_id: UUID) -> None:
        raise _status_error(403)


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


# -- progress bar rendering ------------------------------------------------


def test_render_progress_bar_at_zero() -> None:
    assert h._render_progress_bar(0.0) == "[░░░░░░░░░░] 0%"


def test_render_progress_bar_at_half() -> None:
    assert h._render_progress_bar(50.0) == "[█████░░░░░] 50%"


def test_render_progress_bar_over_100_caps_at_full_bar() -> None:
    bar = h._render_progress_bar(150.0)
    assert bar == "[██████████] 150%"


def test_render_progress_bar_none_shows_no_limit() -> None:
    assert h._render_progress_bar(None) == "[no limit set]"


# -- /budgets ---------------------------------------------------------------


async def test_list_budgets_renders_progress_and_amounts_from_minor_units() -> None:
    category = make_category("Groceries")
    plan = make_plan(category.id)
    progress = make_progress(plan, spent=4000, fill_pct=40.0)
    client = FakeBudgetBackendClient(
        plans=[plan], categories=[category], progress_by_plan_id={plan.id: progress}
    )
    message = make_message()

    await h.cmd_list_budgets(message, client)

    text = message.answer.await_args.args[0]
    assert "Groceries" in text
    assert "40.00 / 100.00" in text
    assert "[████░░░░░░] 40%" in text


async def test_list_budgets_flags_exceeded_budget() -> None:
    category = make_category("Rent")
    plan = make_plan(category.id)
    progress = make_progress(
        plan, spent=12000, fill_pct=120.0, is_over_threshold=True, is_exceeded=True
    )
    client = FakeBudgetBackendClient(
        plans=[plan], categories=[category], progress_by_plan_id={plan.id: progress}
    )
    message = make_message()

    await h.cmd_list_budgets(message, client)

    text = message.answer.await_args.args[0]
    assert "exceeded" in text.lower()


async def test_list_budgets_renders_empty_list() -> None:
    client = FakeBudgetBackendClient(plans=[])
    message = make_message()

    await h.cmd_list_budgets(message, client)

    message.answer.assert_awaited_once_with("No budget plans yet.")


async def test_list_budgets_backend_error_on_list_shows_friendly_message() -> None:
    class FailingListClient(FakeBudgetBackendClient):
        async def list_budget_plans(self) -> list[BudgetPlanResponse]:
            request = httpx.Request("GET", "http://test/budgets")
            raise httpx.ConnectError("boom", request=request)

    message = make_message()

    await h.cmd_list_budgets(message, FailingListClient())

    assert "couldn't reach" in message.answer.await_args.args[0].lower()


async def test_list_budgets_unknown_category_falls_back_to_placeholder() -> None:
    plan = make_plan(uuid4())
    progress = make_progress(plan, spent=0, fill_pct=0.0)
    client = FakeBudgetBackendClient(
        plans=[plan], categories=[], progress_by_plan_id={plan.id: progress}
    )
    message = make_message()

    await h.cmd_list_budgets(message, client)

    assert "Unknown" in message.answer.await_args.args[0]


async def test_list_budgets_progress_fetch_error_shows_inline_message_and_continues() -> None:
    category = make_category("Groceries")
    plan = make_plan(category.id)

    class FailingProgressClient(FakeBudgetBackendClient):
        async def get_budget_plan_progress(self, budget_plan_id: UUID) -> BudgetProgress:
            request = httpx.Request("GET", "http://test/budgets")
            raise httpx.ConnectError("boom", request=request)

    client = FailingProgressClient(plans=[plan], categories=[category])
    message = make_message()

    await h.cmd_list_budgets(message, client)

    text = message.answer.await_args.args[0]
    assert "Groceries" in text
    assert "couldn't load progress" in text


# -- add ----------------------------------------------------------------


async def test_add_budget_happy_path_with_explicit_threshold() -> None:
    category = make_category("Groceries")
    client = FakeBudgetBackendClient(categories=[category])
    state = make_state()

    await h.cmd_add_budget(make_message("/addbudget"), state, client)
    assert await state.get_state() == BudgetManage.add_category.state

    select_callback = make_callback()
    await h.on_add_budget_category_selected(
        select_callback, CategoryCallback(category_id=category.id), state
    )
    assert await state.get_state() == BudgetManage.add_amount.state

    await h.on_add_budget_amount_entered(make_message("100.00"), state)
    assert await state.get_state() == BudgetManage.add_threshold.state

    await h.on_add_budget_threshold_entered(make_message("70"), state, client)

    assert await state.get_state() is None
    assert client.created == [
        BudgetPlanCreate(category_id=category.id, amount=10000, notify_threshold=70)
    ]


async def test_add_budget_threshold_skip_uses_default() -> None:
    category = make_category("Groceries")
    client = FakeBudgetBackendClient(categories=[category])
    state = make_state()
    await state.set_state(BudgetManage.add_threshold)
    await state.update_data(category_id=str(category.id), category_name=category.name, amount=10000)

    await h.on_add_budget_threshold_skipped(make_message("/skip"), state, client)

    assert await state.get_state() is None
    assert client.created == [
        BudgetPlanCreate(category_id=category.id, amount=10000, notify_threshold=80)
    ]


async def test_add_budget_no_categories() -> None:
    client = FakeBudgetBackendClient(categories=[])
    state = make_state()
    message = make_message("/addbudget")

    await h.cmd_add_budget(message, state, client)

    assert await state.get_state() is None
    message.answer.assert_awaited_once_with("No categories to set a budget for yet.")


async def test_add_budget_invalid_amount_reprompts() -> None:
    category = make_category()
    state = make_state()
    await state.set_state(BudgetManage.add_amount)
    await state.update_data(category_id=str(category.id), category_name=category.name)

    await h.on_add_budget_amount_entered(make_message("not a number"), state)

    assert await state.get_state() == BudgetManage.add_amount.state


async def test_add_budget_invalid_threshold_reprompts() -> None:
    category = make_category()
    client = FakeBudgetBackendClient(categories=[category])
    state = make_state()
    await state.set_state(BudgetManage.add_threshold)
    await state.update_data(category_id=str(category.id), category_name=category.name, amount=10000)

    await h.on_add_budget_threshold_entered(make_message("150"), state, client)

    assert await state.get_state() == BudgetManage.add_threshold.state
    assert client.created == []


async def test_add_budget_duplicate_shows_friendly_message() -> None:
    category = make_category()
    state = make_state()
    await state.set_state(BudgetManage.add_threshold)
    await state.update_data(category_id=str(category.id), category_name=category.name, amount=10000)
    message = make_message("80")

    await h.on_add_budget_threshold_entered(message, state, ConflictCreateClient())

    assert await state.get_state() is None
    assert "already exists" in message.answer.await_args.args[0].lower()


async def test_add_budget_permission_denied_shows_friendly_message() -> None:
    category = make_category()
    state = make_state()
    await state.set_state(BudgetManage.add_threshold)
    await state.update_data(category_id=str(category.id), category_name=category.name, amount=10000)
    message = make_message("80")

    await h.on_add_budget_threshold_entered(message, state, ForbiddenCreateClient())

    assert await state.get_state() is None
    assert "permission" in message.answer.await_args.args[0].lower()


# -- update ---------------------------------------------------------------


async def test_update_budget_happy_path_amount_and_threshold() -> None:
    category = make_category("Groceries")
    plan = make_plan(category.id)
    client = FakeBudgetBackendClient(plans=[plan], categories=[category])
    state = make_state()

    await h.cmd_update_budget(make_message("/updatebudget"), state, client)
    assert await state.get_state() == BudgetManage.update_select.state

    select_callback = make_callback()
    await h.on_update_budget_selected(
        select_callback, BudgetCallback(budget_plan_id=plan.id), state
    )
    assert await state.get_state() == BudgetManage.update_amount.state

    await h.on_update_budget_amount_entered(make_message("150.00"), state)
    assert await state.get_state() == BudgetManage.update_threshold.state

    await h.on_update_budget_threshold_entered(make_message("60"), state, client)

    assert await state.get_state() is None
    assert client.updated == [(plan.id, BudgetPlanUpdate(amount=15000, notify_threshold=60))]


async def test_update_budget_skip_both_keeps_values_unchanged() -> None:
    category = make_category("Groceries")
    plan = make_plan(category.id)
    client = FakeBudgetBackendClient(plans=[plan], categories=[category])
    state = make_state()
    await state.set_state(BudgetManage.update_amount)
    await state.update_data(
        plans=[plan], category_names={category.id: category.name}, update_target_id=str(plan.id)
    )

    await h.on_update_budget_amount_skipped(make_message("/skip"), state)
    assert await state.get_state() == BudgetManage.update_threshold.state

    await h.on_update_budget_threshold_skipped(make_message("/skip"), state, client)

    assert await state.get_state() is None
    assert client.updated == []


async def test_update_budget_no_plans() -> None:
    client = FakeBudgetBackendClient(plans=[])
    state = make_state()
    message = make_message("/updatebudget")

    await h.cmd_update_budget(message, state, client)

    assert await state.get_state() is None
    message.answer.assert_awaited_once_with("No budget plans to update yet.")


async def test_update_budget_invalid_amount_reprompts() -> None:
    category = make_category()
    plan = make_plan(category.id)
    state = make_state()
    await state.set_state(BudgetManage.update_amount)
    await state.update_data(
        plans=[plan], category_names={category.id: category.name}, update_target_id=str(plan.id)
    )

    await h.on_update_budget_amount_entered(make_message("not a number"), state)

    assert await state.get_state() == BudgetManage.update_amount.state


async def test_update_budget_invalid_threshold_reprompts() -> None:
    category = make_category()
    plan = make_plan(category.id)
    client = FakeBudgetBackendClient(plans=[plan], categories=[category])
    state = make_state()
    await state.set_state(BudgetManage.update_threshold)
    await state.update_data(update_target_id=str(plan.id), category_name=category.name)

    await h.on_update_budget_threshold_entered(make_message("-5"), state, client)

    assert await state.get_state() == BudgetManage.update_threshold.state
    assert client.updated == []


async def test_update_budget_permission_denied_shows_friendly_message() -> None:
    category = make_category()
    plan = make_plan(category.id)
    state = make_state()
    await state.set_state(BudgetManage.update_threshold)
    await state.update_data(update_target_id=str(plan.id), category_name=category.name)
    message = make_message("50")

    await h.on_update_budget_threshold_entered(message, state, ForbiddenUpdateClient())

    assert await state.get_state() is None
    assert "permission" in message.answer.await_args.args[0].lower()


# -- delete -----------------------------------------------------------------


async def test_delete_budget_happy_path() -> None:
    category = make_category("Groceries")
    plan = make_plan(category.id)
    client = FakeBudgetBackendClient(plans=[plan], categories=[category])
    state = make_state()

    await h.cmd_delete_budget(make_message("/deletebudget"), state, client)
    assert await state.get_state() == BudgetManage.delete_select.state

    callback = make_callback()
    await h.on_delete_budget_selected(
        callback, BudgetCallback(budget_plan_id=plan.id), state, client
    )

    assert await state.get_state() is None
    assert client.deleted == [plan.id]
    callback.message.edit_text.assert_awaited_once_with("Budget deleted.")


async def test_delete_budget_no_plans() -> None:
    client = FakeBudgetBackendClient(plans=[])
    state = make_state()
    message = make_message("/deletebudget")

    await h.cmd_delete_budget(message, state, client)

    assert await state.get_state() is None
    message.answer.assert_awaited_once_with("No budget plans to delete yet.")


async def test_delete_budget_permission_denied_shows_friendly_message() -> None:
    plan = make_plan(uuid4())
    state = make_state()
    await state.set_state(BudgetManage.delete_select)
    callback = make_callback()

    await h.on_delete_budget_selected(
        callback, BudgetCallback(budget_plan_id=plan.id), state, ForbiddenDeleteClient()
    )

    assert await state.get_state() is None
    text = callback.message.edit_text.await_args.args[0]
    assert "permission" in text.lower()


# -- cancel -------------------------------------------------------------


async def test_cancel_command_clears_state() -> None:
    state = make_state()
    await state.set_state(BudgetManage.add_amount)

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


async def test_cancel_command_reaches_cancel_handler_not_add_amount_catchall() -> None:
    dp = make_router_dispatcher()
    bot = Bot(token="42:TEST-token")
    tg_id = 555
    context = dp.fsm.resolve_context(bot, chat_id=tg_id, user_id=tg_id)
    assert context is not None
    await context.set_state(BudgetManage.add_amount)

    with patch.object(Message, "answer", new=AsyncMock()) as mocked_answer:
        await dp.feed_update(
            bot, make_text_update(1, tg_id, "/cancel"), client=FakeBudgetBackendClient()
        )

    assert await context.get_state() is None
    mocked_answer.assert_awaited_once_with("Cancelled.")
