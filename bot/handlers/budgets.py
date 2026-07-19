"""Budget plan progress rendering (U4.5): read-only `/budgets` view listing
each budget plan for the account with a progress bar, built from
GET /budgets and GET /budgets/{id}/progress (models.budget_plan). No FSM —
budget-plan CRUD is API-only in V1 (the AC only calls for rendering; see plan
Decision log D45), this module only renders.
"""

import logging
from decimal import Decimal
from typing import Protocol
from uuid import UUID

import httpx
from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

from models.budget_plan import BudgetPlanResponse, BudgetProgress
from models.category import CategoryResponse

logger = logging.getLogger(__name__)


class BudgetBackendClient(Protocol):
    """Structural subset of bot/client.py's BackendClient this module calls —
    lets tests pass a fake without depending on the concrete httpx-backed class."""

    async def list_budget_plans(self) -> list[BudgetPlanResponse]: ...
    async def get_budget_plan_progress(self, budget_plan_id: UUID) -> BudgetProgress: ...
    async def list_categories(self) -> list[CategoryResponse]: ...


_BACKEND_UNREACHABLE = "Couldn't reach the backend. Please try again in a moment."
_BAR_WIDTH = 10


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


def create_router() -> Router:
    router = Router(name="budgets")
    router.message.register(cmd_list_budgets, Command("budgets"))
    return router
