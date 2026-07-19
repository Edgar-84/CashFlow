"""Unit tests for bot/handlers/budgets.py — read-only `/budgets` progress
rendering (tests/CLAUDE.md: "Bot handlers are tested by mocking BackendClient
— never a live backend", U4.5 AC: "rendering tests on fixed API responses
(progress bars, totals formatted from minor units)").

Hermetic: a FakeBudgetBackendClient stands in for bot/client.py's
BackendClient (no real backend HTTP); handlers are called directly with mock
Message objects (no real Telegram network).
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import httpx
from aiogram.types import Message

from bot.handlers import budgets as h
from models.budget_plan import BudgetPlanResponse, BudgetProgress
from models.category import CategoryResponse


def make_category(name: str = "Groceries", category_id: UUID | None = None) -> CategoryResponse:
    return CategoryResponse(
        id=category_id or uuid4(), account_id=uuid4(), created_at=datetime.now(UTC), name=name
    )


def make_plan(category_id: UUID, plan_id: UUID | None = None) -> BudgetPlanResponse:
    return BudgetPlanResponse(
        id=plan_id or uuid4(),
        account_id=uuid4(),
        category_id=category_id,
        amount=10000,
        period="monthly",
        notify_threshold=80,
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

    async def list_budget_plans(self) -> list[BudgetPlanResponse]:
        return self.plans

    async def list_categories(self) -> list[CategoryResponse]:
        return self.categories

    async def get_budget_plan_progress(self, budget_plan_id: UUID) -> BudgetProgress:
        return self.progress_by_plan_id[budget_plan_id]


def make_message() -> Mock:
    message = Mock(spec=Message)
    message.answer = AsyncMock()
    return message


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
