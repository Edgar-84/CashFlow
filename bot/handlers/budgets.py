"""Budget plan progress rendering + CRUD (U4.5 read-only rendering; U2.2 adds
the `BudgetManage` FSM for add/update/delete, superseding MVP D45's
API-only-for-V1 scope now that plan Decision log D45 in
docs/plans/family-features-v1_1.md schedules it as requirement #8).

`/budgets` (unchanged from U4.5): lists each budget plan with a progress bar,
built from GET /budgets and GET /budgets/{id}/progress.

Add/update/delete mirror bot/handlers/categories.py's add/rename/delete shape,
with two differences: budgets have no name to rename, so "update" replaces
"rename" and edits amount/notify_threshold instead (each step individually
skippable via /skip to keep the current value); and picking an existing plan
reuses `budgets_keyboard`/`BudgetCallback` (keyed on budget_plan_id, not
category_id, since one category maps to at most one plan but the keyboard
still needs to carry the plan's id to PATCH/DELETE the right row).
"""

import logging
from decimal import Decimal
from typing import Protocol
from uuid import UUID

import httpx
from aiogram import Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from bot.handlers.expenses import parse_amount_to_minor_units
from bot.keyboards import BudgetCallback, CategoryCallback, budgets_keyboard, categories_keyboard
from bot.states import BudgetManage
from models.budget_plan import (
    BudgetPlanCreate,
    BudgetPlanResponse,
    BudgetPlanUpdate,
    BudgetProgress,
)
from models.category import CategoryResponse

logger = logging.getLogger(__name__)


class BudgetBackendClient(Protocol):
    """Structural subset of bot/client.py's BackendClient this module calls —
    lets tests pass a fake without depending on the concrete httpx-backed class."""

    async def list_budget_plans(self) -> list[BudgetPlanResponse]: ...
    async def get_budget_plan_progress(self, budget_plan_id: UUID) -> BudgetProgress: ...
    async def list_categories(self) -> list[CategoryResponse]: ...
    async def create_budget_plan(self, data: BudgetPlanCreate) -> BudgetPlanResponse: ...
    async def update_budget_plan(
        self, budget_plan_id: UUID, data: BudgetPlanUpdate
    ) -> BudgetPlanResponse: ...
    async def delete_budget_plan(self, budget_plan_id: UUID) -> None: ...


_BACKEND_UNREACHABLE = "Couldn't reach the backend. Please try again in a moment."
_BAR_WIDTH = 10
_DEFAULT_NOTIFY_THRESHOLD = 80


def _error_message(exc: httpx.HTTPStatusError) -> str:
    if exc.response.status_code == 403:
        return "You don't have permission to do that."
    if exc.response.status_code == 409:
        return "A budget plan already exists for this category and period."
    return "Something went wrong. Please try again."


def _parse_notify_threshold(text: str) -> int:
    try:
        value = int(text.strip())
    except ValueError as exc:
        raise ValueError("Invalid threshold") from exc
    if not 0 <= value <= 100:
        raise ValueError("Threshold must be between 0 and 100") from None
    return value


def _format_amount(minor_units: int) -> str:
    return f"{Decimal(minor_units) / 100:.2f}"


def _render_progress_bar(fill_pct: float | None) -> str:
    if fill_pct is None:
        return "[no limit set]"
    filled = min(_BAR_WIDTH, max(0, round(_BAR_WIDTH * fill_pct / 100)))
    bar = "█" * filled + "░" * (_BAR_WIDTH - filled)
    return f"[{bar}] {fill_pct:.0f}%"


def _format_budget_block(category_name: str, progress: BudgetProgress) -> str:
    lines = [
        f"{category_name}: {_format_amount(progress.spent)} / {_format_amount(progress.amount)}",
        _render_progress_bar(progress.fill_pct),
    ]
    if progress.is_exceeded:
        lines.append("⚠️ Budget exceeded!")
    elif progress.is_over_threshold:
        lines.append("⚠️ Approaching limit")
    return "\n".join(lines)


async def cmd_list_budgets(message: Message, client: BudgetBackendClient) -> None:
    try:
        plans = await client.list_budget_plans()
    except httpx.HTTPError:
        logger.exception("Failed to fetch budget plans")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    if not plans:
        await message.answer("No budget plans yet.")
        return
    try:
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch categories")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    category_names = {category.id: category.name for category in categories}

    blocks = []
    for plan in plans:
        name = category_names.get(plan.category_id, "Unknown")
        try:
            progress = await client.get_budget_plan_progress(plan.id)
        except httpx.HTTPError:
            logger.exception("Failed to fetch budget progress for %s", plan.id)
            blocks.append(f"{name}: couldn't load progress.")
            continue
        blocks.append(_format_budget_block(name, progress))
    await message.answer("Budgets:\n\n" + "\n\n".join(blocks))


# -- add --------------------------------------------------------------------


async def cmd_add_budget(message: Message, state: FSMContext, client: BudgetBackendClient) -> None:
    try:
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch categories")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    if not categories:
        await message.answer("No categories to set a budget for yet.")
        return
    await state.set_state(BudgetManage.add_category)
    await state.update_data(categories=categories)
    await message.answer(
        "Which category do you want to set a budget for?",
        reply_markup=categories_keyboard(categories),
    )


async def on_add_budget_category_selected(
    callback: CallbackQuery, callback_data: CategoryCallback, state: FSMContext
) -> None:
    data = await state.get_data()
    categories: list[CategoryResponse] = data.get("categories", [])
    category = next((c for c in categories if c.id == callback_data.category_id), None)
    if category is None:
        await callback.answer("Unknown category, please pick again.", show_alert=True)
        return
    await state.update_data(category_id=str(category.id), category_name=category.name)
    await state.set_state(BudgetManage.add_amount)
    await callback.answer()
    if isinstance(callback.message, Message):
        await callback.message.edit_text(
            f"Enter the monthly limit for {category.name} (e.g. 100.00):"
        )


async def on_add_budget_amount_entered(message: Message, state: FSMContext) -> None:
    try:
        amount = parse_amount_to_minor_units(message.text or "")
    except ValueError:
        await message.answer("That doesn't look like a valid amount. Try again (e.g. 100.00):")
        return
    await state.update_data(amount=amount)
    await state.set_state(BudgetManage.add_threshold)
    await message.answer(
        f"Alert threshold percent 0-100 (default {_DEFAULT_NOTIFY_THRESHOLD}), or /skip:"
    )


async def on_add_budget_threshold_skipped(
    message: Message, state: FSMContext, client: BudgetBackendClient
) -> None:
    await _finish_add_budget(message, state, client, _DEFAULT_NOTIFY_THRESHOLD)


async def on_add_budget_threshold_entered(
    message: Message, state: FSMContext, client: BudgetBackendClient
) -> None:
    try:
        threshold = _parse_notify_threshold(message.text or "")
    except ValueError:
        await message.answer("Enter a whole number 0-100, or /skip:")
        return
    await _finish_add_budget(message, state, client, threshold)


async def _finish_add_budget(
    message: Message, state: FSMContext, client: BudgetBackendClient, notify_threshold: int
) -> None:
    data = await state.get_data()
    try:
        plan = await client.create_budget_plan(
            BudgetPlanCreate(
                category_id=UUID(data["category_id"]),
                amount=data["amount"],
                notify_threshold=notify_threshold,
            )
        )
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to create budget plan")
        await state.clear()
        await message.answer(_error_message(exc))
        return
    except httpx.HTTPError:
        logger.exception("Failed to create budget plan")
        await state.clear()
        await message.answer(_BACKEND_UNREACHABLE)
        return
    await state.clear()
    category_name = data.get("category_name", "the category")
    await message.answer(
        f"Budget set: {category_name} — {_format_amount(plan.amount)} / month, "
        f"alert at {plan.notify_threshold}%."
    )


# -- update -------------------------------------------------------------


async def _fetch_plans_and_category_names(
    client: BudgetBackendClient,
) -> tuple[list[BudgetPlanResponse], dict[UUID, str]]:
    """Shared by update/delete's list-and-pick step. httpx.HTTPError propagates
    to the caller's own try/except (same friendly-message handling as every
    other backend call in this module)."""
    plans = await client.list_budget_plans()
    categories = await client.list_categories()
    category_names = {category.id: category.name for category in categories}
    return plans, category_names


async def cmd_update_budget(
    message: Message, state: FSMContext, client: BudgetBackendClient
) -> None:
    try:
        plans, category_names = await _fetch_plans_and_category_names(client)
    except httpx.HTTPError:
        logger.exception("Failed to fetch budget plans")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    if not plans:
        await message.answer("No budget plans to update yet.")
        return
    await state.set_state(BudgetManage.update_select)
    await state.update_data(plans=plans, category_names=category_names)
    await message.answer(
        "Which budget do you want to update?", reply_markup=budgets_keyboard(plans, category_names)
    )


async def on_update_budget_selected(
    callback: CallbackQuery, callback_data: BudgetCallback, state: FSMContext
) -> None:
    data = await state.get_data()
    plans: list[BudgetPlanResponse] = data.get("plans", [])
    plan = next((p for p in plans if p.id == callback_data.budget_plan_id), None)
    if plan is None:
        await callback.answer("Unknown budget plan, please pick again.", show_alert=True)
        return
    category_names: dict[UUID, str] = data.get("category_names", {})
    category_name = category_names.get(plan.category_id, "Unknown")
    await state.update_data(update_target_id=str(plan.id), category_name=category_name)
    await state.set_state(BudgetManage.update_amount)
    await callback.answer()
    if isinstance(callback.message, Message):
        await callback.message.edit_text(
            f"Enter the new monthly limit for {category_name} "
            f"(currently {_format_amount(plan.amount)}), or /skip to keep it:"
        )


async def on_update_budget_amount_skipped(message: Message, state: FSMContext) -> None:
    await _prompt_update_threshold(message, state)


async def on_update_budget_amount_entered(message: Message, state: FSMContext) -> None:
    try:
        amount = parse_amount_to_minor_units(message.text or "")
    except ValueError:
        await message.answer("That doesn't look like a valid amount. Try again, or /skip:")
        return
    await state.update_data(new_amount=amount)
    await _prompt_update_threshold(message, state)


async def _prompt_update_threshold(message: Message, state: FSMContext) -> None:
    await state.set_state(BudgetManage.update_threshold)
    await message.answer("New alert threshold percent 0-100, or /skip to keep it:")


async def on_update_budget_threshold_skipped(
    message: Message, state: FSMContext, client: BudgetBackendClient
) -> None:
    await _finish_update_budget(message, state, client)


async def on_update_budget_threshold_entered(
    message: Message, state: FSMContext, client: BudgetBackendClient
) -> None:
    try:
        threshold = _parse_notify_threshold(message.text or "")
    except ValueError:
        await message.answer("Enter a whole number 0-100, or /skip:")
        return
    await state.update_data(new_threshold=threshold)
    await _finish_update_budget(message, state, client)


async def _finish_update_budget(
    message: Message, state: FSMContext, client: BudgetBackendClient
) -> None:
    data = await state.get_data()
    kwargs: dict[str, int] = {}
    if "new_amount" in data:
        kwargs["amount"] = data["new_amount"]
    if "new_threshold" in data:
        kwargs["notify_threshold"] = data["new_threshold"]
    if not kwargs:
        await state.clear()
        await message.answer("Nothing changed.")
        return
    plan_id = UUID(data["update_target_id"])
    try:
        plan = await client.update_budget_plan(plan_id, BudgetPlanUpdate.model_validate(kwargs))
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to update budget plan")
        await state.clear()
        await message.answer(_error_message(exc))
        return
    except httpx.HTTPError:
        logger.exception("Failed to update budget plan")
        await state.clear()
        await message.answer(_BACKEND_UNREACHABLE)
        return
    await state.clear()
    category_name = data.get("category_name", "the category")
    await message.answer(
        f"Budget updated: {category_name} — {_format_amount(plan.amount)} / month, "
        f"alert at {plan.notify_threshold}%."
    )


# -- delete -------------------------------------------------------------


async def cmd_delete_budget(
    message: Message, state: FSMContext, client: BudgetBackendClient
) -> None:
    try:
        plans, category_names = await _fetch_plans_and_category_names(client)
    except httpx.HTTPError:
        logger.exception("Failed to fetch budget plans")
        await message.answer(_BACKEND_UNREACHABLE)
        return
    if not plans:
        await message.answer("No budget plans to delete yet.")
        return
    await state.set_state(BudgetManage.delete_select)
    await state.update_data(category_names=category_names)
    await message.answer(
        "Which budget do you want to delete?", reply_markup=budgets_keyboard(plans, category_names)
    )


async def on_delete_budget_selected(
    callback: CallbackQuery,
    callback_data: BudgetCallback,
    state: FSMContext,
    client: BudgetBackendClient,
) -> None:
    await callback.answer()
    try:
        await client.delete_budget_plan(callback_data.budget_plan_id)
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to delete budget plan")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(_error_message(exc))
        return
    except httpx.HTTPError:
        logger.exception("Failed to delete budget plan")
        await state.clear()
        if isinstance(callback.message, Message):
            await callback.message.edit_text(_BACKEND_UNREACHABLE)
        return
    await state.clear()
    if isinstance(callback.message, Message):
        await callback.message.edit_text("Budget deleted.")


async def on_cancel_command(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Cancelled.")


def create_router() -> Router:
    router = Router(name="budgets")
    router.message.register(cmd_list_budgets, Command("budgets"))
    router.message.register(cmd_add_budget, Command("addbudget"))
    router.message.register(cmd_update_budget, Command("updatebudget"))
    router.message.register(cmd_delete_budget, Command("deletebudget"))
    # /cancel must be registered before the catch-all per-state text handlers
    # below — same registration-order requirement as bot/handlers/expenses.py
    # and bot/handlers/categories.py (plan Decision log D39/D40).
    router.message.register(on_cancel_command, StateFilter(BudgetManage), Command("cancel"))
    router.callback_query.register(
        on_add_budget_category_selected, BudgetManage.add_category, CategoryCallback.filter()
    )
    router.message.register(on_add_budget_amount_entered, BudgetManage.add_amount)
    router.message.register(
        on_add_budget_threshold_skipped, BudgetManage.add_threshold, Command("skip")
    )
    router.message.register(on_add_budget_threshold_entered, BudgetManage.add_threshold)
    router.callback_query.register(
        on_update_budget_selected, BudgetManage.update_select, BudgetCallback.filter()
    )
    router.message.register(
        on_update_budget_amount_skipped, BudgetManage.update_amount, Command("skip")
    )
    router.message.register(on_update_budget_amount_entered, BudgetManage.update_amount)
    router.message.register(
        on_update_budget_threshold_skipped, BudgetManage.update_threshold, Command("skip")
    )
    router.message.register(on_update_budget_threshold_entered, BudgetManage.update_threshold)
    router.callback_query.register(
        on_delete_budget_selected, BudgetManage.delete_select, BudgetCallback.filter()
    )
    return router
