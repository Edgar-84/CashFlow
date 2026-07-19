"""Current-month statistics rendering (U4.5): read-only `/statistics` view —
period total plus breakdowns by category and by tag, from
GET /statistics/by-period, /by-category, /by-tag (models.statistics). No FSM,
no input — a single command handler.
"""

import logging
from decimal import Decimal
from typing import Protocol

import httpx
from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

from models.category import CategoryResponse
from models.statistics import CategoryTotal, PeriodTotal, TagTotal
from models.tag import TagResponse

logger = logging.getLogger(__name__)


class StatisticsBackendClient(Protocol):
    """Structural subset of bot/client.py's BackendClient this module calls —
    lets tests pass a fake without depending on the concrete httpx-backed class."""

    async def statistics_by_period(self) -> PeriodTotal: ...
    async def statistics_by_category(self) -> list[CategoryTotal]: ...
    async def statistics_by_tag(self) -> list[TagTotal]: ...
    async def list_categories(self) -> list[CategoryResponse]: ...
    async def list_tags(self) -> list[TagResponse]: ...


_BACKEND_UNREACHABLE = "Couldn't reach the backend. Please try again in a moment."


def _format_amount(minor_units: int) -> str:
    return f"{Decimal(minor_units) / 100:.2f}"


def _format_breakdown(items: list[tuple[str, int]]) -> list[str]:
    ordered = sorted(items, key=lambda pair: pair[1], reverse=True)
    return [f"- {name}: {_format_amount(total)}" for name, total in ordered]


async def cmd_statistics(message: Message, client: StatisticsBackendClient) -> None:
    try:
        period = await client.statistics_by_period()
        by_category = await client.statistics_by_category()
        by_tag = await client.statistics_by_tag()
        categories = await client.list_categories()
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch statistics")
        await message.answer(_BACKEND_UNREACHABLE)
        return

    lines = [
        f"Statistics for {period.start:%Y-%m-%d} – {period.end:%Y-%m-%d}",
        f"Total: {_format_amount(period.total)}",
    ]

    if by_category:
        category_names = {category.id: category.name for category in categories}
        lines.append("")
        lines.append("By category:")
        lines.extend(
            _format_breakdown(
                [
                    (category_names.get(item.category_id, "Unknown"), item.total)
                    for item in by_category
                ]
            )
        )

    if by_tag:
        tag_names = {tag.id: tag.name for tag in tags}
        lines.append("")
        lines.append("By tag:")
        lines.extend(
            _format_breakdown(
                [(tag_names.get(item.tag_id, "Unknown"), item.total) for item in by_tag]
            )
        )

    await message.answer("\n".join(lines))


def create_router() -> Router:
    router = Router(name="statistics")
    router.message.register(cmd_statistics, Command("statistics"))
    return router
