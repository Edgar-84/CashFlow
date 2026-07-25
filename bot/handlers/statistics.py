"""Statistics rendering: `/statistics` (U4.5) plus the period-picker +
drill-down buttons (U2.3, requirement #6) — period presets (this month
default / last month / last 3 months) and "by category…"/"by tag…" pickers
that re-render the by-period total filtered to the chosen category/tag.

"This month" sends no `start`/`end` at all, so the backend applies its
family-tz-correct default (`services/period.py::month_bounds`, D107/D114);
the other two presets need explicit bounds, computed here in UTC calendar
months — the bot has no access to `family_tz`-aware month arithmetic without
importing `services/` (forbidden, bot/CLAUDE.md: zero business logic, pure
HTTP client); this unit's Contracts are U0.2/U1.2's params, unchanged. This
is an accepted, documented tradeoff (plan Decision log D120): for a non-UTC
`family_tz`, "last month"/"last 3 months" can be off by up to the UTC offset
right at a month boundary versus the family-tz-correct "this month" default.


Callback-driven, no text-entry states, so there's nothing to "lose" by
abandoning a `Statistics.category`/`Statistics.tag` picker mid-pick — other
commands' handlers aren't state-filtered and keep working normally regardless.
`/cancel` is still wired up (unlike the expense flows, it can't discard
anything) purely so it does something recognizable rather than being
silently swallowed: it re-renders the last period view.

`/chart` (plus the "📊 Chart" button, U2.4) reuses the same preset/bounds
machinery to render a text category-breakdown (`bot/charts.py`) instead of
the plain totals list — no image, no new dependency (plan Decision log D121
supersedes the original matplotlib-PNG plan, D101).
"""

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from decimal import Decimal
from typing import Protocol
from uuid import UUID

import httpx
from aiogram import F, Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from bot.charts import render_category_breakdown
from bot.keyboards import (
    STATISTICS_BY_CATEGORY_CALLBACK,
    STATISTICS_BY_TAG_CALLBACK,
    STATISTICS_CHART_CALLBACK,
    STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK,
    STATISTICS_PERIOD_LAST_MONTH_CALLBACK,
    STATISTICS_PERIOD_THIS_MONTH_CALLBACK,
    CategoryCallback,
    TagCallback,
    categories_keyboard,
    statistics_keyboard,
    tags_keyboard,
)
from bot.states import Statistics
from models.category import CategoryResponse
from models.statistics import CategoryTotal, PeriodTotal, TagTotal
from models.tag import TagResponse

logger = logging.getLogger(__name__)


class StatisticsBackendClient(Protocol):
    """Structural subset of bot/client.py's BackendClient this module calls —
    lets tests pass a fake without depending on the concrete httpx-backed class."""

    async def statistics_by_period(
        self,
        start: datetime | None = None,
        end: datetime | None = None,
        category_id: UUID | None = None,
        tag_id: UUID | None = None,
    ) -> PeriodTotal: ...
    async def statistics_by_category(
        self, start: datetime | None = None, end: datetime | None = None
    ) -> list[CategoryTotal]: ...
    async def statistics_by_tag(
        self, start: datetime | None = None, end: datetime | None = None
    ) -> list[TagTotal]: ...
    async def list_categories(self) -> list[CategoryResponse]: ...
    async def list_tags(self) -> list[TagResponse]: ...


_BACKEND_UNREACHABLE = "Couldn't reach the backend. Please try again in a moment."
_EMPTY_PERIOD = "No expenses in this period."
_NOTHING_TO_CHART = "Nothing to chart in this period."
_DEFAULT_PRESET = STATISTICS_PERIOD_THIS_MONTH_CALLBACK

_PRESET_CALLBACKS = {
    STATISTICS_PERIOD_THIS_MONTH_CALLBACK,
    STATISTICS_PERIOD_LAST_MONTH_CALLBACK,
    STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK,
}


def _format_amount(minor_units: int) -> str:
    return f"{Decimal(minor_units) / 100:.2f}"


def _format_breakdown(items: list[tuple[str, int]]) -> list[str]:
    ordered = sorted(items, key=lambda pair: pair[1], reverse=True)
    return [f"- {name}: {_format_amount(total)}" for name, total in ordered]


def preset_bounds(preset: str, now: datetime | None = None) -> tuple[datetime, datetime] | None:
    """UTC calendar-month bounds for a period preset callback, or None for
    "this month" (meaning: send no params, let the backend default apply)."""
    if preset == STATISTICS_PERIOD_THIS_MONTH_CALLBACK:
        return None
    now = now or datetime.now(UTC)
    start_of_this_month = datetime(now.year, now.month, 1, tzinfo=UTC)
    if preset == STATISTICS_PERIOD_LAST_MONTH_CALLBACK:
        months_back = 1
    elif preset == STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK:
        months_back = 3
    else:
        raise ValueError(f"Unknown period preset: {preset}")
    total_months = start_of_this_month.year * 12 + (start_of_this_month.month - 1) - months_back
    year, month = divmod(total_months, 12)
    start = start_of_this_month.replace(year=year, month=month + 1)
    return start, start_of_this_month


def _period_lines(period: PeriodTotal, *, label: str | None = None) -> list[str]:
    heading = f"Statistics for {label}, " if label else "Statistics for "
    lines = [
        f"{heading}{period.start:%Y-%m-%d} – {period.end:%Y-%m-%d}",
        f"Total: {_format_amount(period.total)}",
    ]
    if period.total == 0:
        lines.append(_EMPTY_PERIOD)
    return lines


async def _render_full_view(
    reply: Callable[..., Awaitable[object]],
    state: FSMContext,
    client: StatisticsBackendClient,
    preset: str,
) -> None:
    """Fetch + render the period total plus category/tag breakdown for
    `preset`, then leave the FSM in `Statistics.view` with `preset` recorded
    so a later drill-down knows which bounds to reuse."""
    bounds = preset_bounds(preset)
    start, end = bounds if bounds else (None, None)
    try:
        period = await client.statistics_by_period(start=start, end=end)
        by_category = await client.statistics_by_category(start=start, end=end)
        by_tag = await client.statistics_by_tag(start=start, end=end)
        categories = await client.list_categories()
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch statistics")
        await reply(_BACKEND_UNREACHABLE)
        return

    lines = _period_lines(period)

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

    await state.set_state(Statistics.view)
    await state.update_data(preset=preset)
    await reply("\n".join(lines), reply_markup=statistics_keyboard(preset))


async def _render_chart(
    reply: Callable[..., Awaitable[object]],
    state: FSMContext,
    client: StatisticsBackendClient,
    preset: str,
) -> None:
    """Fetch the by-category breakdown for `preset` (same bounds computation
    as `_render_full_view`, U2.3) and render it via
    `bot/charts.py::render_category_breakdown` — reuses the period-picker
    keyboard so the period can still be switched from the chart view."""
    bounds = preset_bounds(preset)
    start, end = bounds if bounds else (None, None)
    try:
        by_category = await client.statistics_by_category(start=start, end=end)
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch statistics")
        await reply(_BACKEND_UNREACHABLE)
        return

    await state.set_state(Statistics.view)
    await state.update_data(preset=preset)

    if not by_category or sum(item.total for item in by_category) == 0:
        await reply(_NOTHING_TO_CHART, reply_markup=statistics_keyboard(preset))
        return

    category_names = {category.id: category.name for category in categories}
    totals = [(category_names.get(item.category_id, "Unknown"), item.total) for item in by_category]
    text = render_category_breakdown(totals)
    await reply(text, reply_markup=statistics_keyboard(preset))


async def cmd_statistics(
    message: Message, state: FSMContext, client: StatisticsBackendClient
) -> None:
    await _render_full_view(message.answer, state, client, _DEFAULT_PRESET)


async def cmd_chart(message: Message, state: FSMContext, client: StatisticsBackendClient) -> None:
    preset = (await state.get_data()).get("preset", _DEFAULT_PRESET)
    await _render_chart(message.answer, state, client, preset)


async def on_chart_clicked(
    callback: CallbackQuery, state: FSMContext, client: StatisticsBackendClient
) -> None:
    await callback.answer()
    if not isinstance(callback.message, Message):
        return
    preset = (await state.get_data()).get("preset", _DEFAULT_PRESET)
    await _render_chart(callback.message.edit_text, state, client, preset)


async def on_period_selected(
    callback: CallbackQuery, state: FSMContext, client: StatisticsBackendClient
) -> None:
    preset = callback.data
    await callback.answer()
    if preset not in _PRESET_CALLBACKS or not isinstance(callback.message, Message):
        return
    await _render_full_view(callback.message.edit_text, state, client, preset)


async def on_by_category_clicked(
    callback: CallbackQuery, state: FSMContext, client: StatisticsBackendClient
) -> None:
    await callback.answer()
    if not isinstance(callback.message, Message):
        return
    try:
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch categories")
        await callback.message.edit_text(_BACKEND_UNREACHABLE)
        return
    if not categories:
        preset = (await state.get_data()).get("preset", _DEFAULT_PRESET)
        await callback.message.edit_text(
            "No categories found.", reply_markup=statistics_keyboard(preset)
        )
        return
    await state.set_state(Statistics.category)
    await callback.message.edit_text(
        "Choose a category:", reply_markup=categories_keyboard(categories)
    )


async def on_by_tag_clicked(
    callback: CallbackQuery, state: FSMContext, client: StatisticsBackendClient
) -> None:
    await callback.answer()
    if not isinstance(callback.message, Message):
        return
    try:
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch tags")
        await callback.message.edit_text(_BACKEND_UNREACHABLE)
        return
    if not tags:
        preset = (await state.get_data()).get("preset", _DEFAULT_PRESET)
        await callback.message.edit_text("No tags found.", reply_markup=statistics_keyboard(preset))
        return
    await state.set_state(Statistics.tag)
    await callback.message.edit_text("Choose a tag:", reply_markup=tags_keyboard(tags))


async def on_category_drilldown(
    callback: CallbackQuery,
    callback_data: CategoryCallback,
    state: FSMContext,
    client: StatisticsBackendClient,
) -> None:
    await callback.answer()
    if not isinstance(callback.message, Message):
        return
    data = await state.get_data()
    preset = data.get("preset", _DEFAULT_PRESET)
    bounds = preset_bounds(preset)
    start, end = bounds if bounds else (None, None)
    try:
        period = await client.statistics_by_period(
            start=start, end=end, category_id=callback_data.category_id
        )
        categories = await client.list_categories()
    except httpx.HTTPError:
        logger.exception("Failed to fetch statistics")
        await callback.message.edit_text(_BACKEND_UNREACHABLE)
        return
    name = next(
        (category.name for category in categories if category.id == callback_data.category_id),
        "Unknown",
    )
    await state.set_state(Statistics.view)
    await state.update_data(preset=preset)
    await callback.message.edit_text(
        "\n".join(_period_lines(period, label=name)), reply_markup=statistics_keyboard(preset)
    )


async def on_tag_drilldown(
    callback: CallbackQuery,
    callback_data: TagCallback,
    state: FSMContext,
    client: StatisticsBackendClient,
) -> None:
    await callback.answer()
    if not isinstance(callback.message, Message):
        return
    data = await state.get_data()
    preset = data.get("preset", _DEFAULT_PRESET)
    bounds = preset_bounds(preset)
    start, end = bounds if bounds else (None, None)
    try:
        period = await client.statistics_by_period(
            start=start, end=end, tag_id=callback_data.tag_id
        )
        tags = await client.list_tags()
    except httpx.HTTPError:
        logger.exception("Failed to fetch statistics")
        await callback.message.edit_text(_BACKEND_UNREACHABLE)
        return
    name = next((tag.name for tag in tags if tag.id == callback_data.tag_id), "Unknown")
    await state.set_state(Statistics.view)
    await state.update_data(preset=preset)
    await callback.message.edit_text(
        "\n".join(_period_lines(period, label=name)), reply_markup=statistics_keyboard(preset)
    )


async def on_cancel_command(
    message: Message, state: FSMContext, client: StatisticsBackendClient
) -> None:
    preset = (await state.get_data()).get("preset", _DEFAULT_PRESET)
    await _render_full_view(message.answer, state, client, preset)


def create_router() -> Router:
    router = Router(name="statistics")
    router.message.register(cmd_statistics, Command("statistics"))
    router.message.register(cmd_chart, Command("chart"))
    router.message.register(on_cancel_command, StateFilter(Statistics), Command("cancel"))
    router.callback_query.register(
        on_period_selected, Statistics.view, F.data.in_(_PRESET_CALLBACKS)
    )
    router.callback_query.register(
        on_by_category_clicked, Statistics.view, F.data == STATISTICS_BY_CATEGORY_CALLBACK
    )
    router.callback_query.register(
        on_by_tag_clicked, Statistics.view, F.data == STATISTICS_BY_TAG_CALLBACK
    )
    router.callback_query.register(
        on_chart_clicked, Statistics.view, F.data == STATISTICS_CHART_CALLBACK
    )
    router.callback_query.register(
        on_category_drilldown, Statistics.category, CategoryCallback.filter()
    )
    router.callback_query.register(on_tag_drilldown, Statistics.tag, TagCallback.filter())
    return router
