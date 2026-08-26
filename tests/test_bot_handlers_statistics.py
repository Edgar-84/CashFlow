"""Unit tests for bot/handlers/statistics.py — `/statistics` rendering
(tests/CLAUDE.md: "Bot handlers are tested by mocking BackendClient — never a
live backend") plus the U2.3 period-picker + drill-down buttons: preset
switch re-renders with the right bounds sent, category/tag drill-down send
the right filter, empty-result message, callback-data formats locked.

Hermetic: a FakeStatisticsBackendClient stands in for bot/client.py's
BackendClient (no real backend HTTP); handlers are called directly with mock
Message/CallbackQuery objects (no real Telegram network); FSMContext uses
aiogram's in-memory storage directly (no Dispatcher needed).
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import httpx
import pytest
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Message as TelegramMessage

from bot.handlers import statistics as h
from bot.i18n import t
from bot.keyboards import (
    STATISTICS_BY_CATEGORY_CALLBACK,
    STATISTICS_BY_TAG_CALLBACK,
    STATISTICS_CHART_CALLBACK,
    STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK,
    STATISTICS_PERIOD_LAST_MONTH_CALLBACK,
    STATISTICS_PERIOD_THIS_MONTH_CALLBACK,
    CategoryCallback,
    TagCallback,
)
from bot.states import Statistics
from models.category import CategoryResponse
from models.enums import Language
from models.statistics import CategoryTotal, PeriodTotal, TagTotal
from models.tag import TagResponse


def make_category(name: str, category_id: UUID | None = None) -> CategoryResponse:
    return CategoryResponse(
        id=category_id or uuid4(), account_id=uuid4(), created_at=datetime.now(UTC), name=name
    )


def make_tag(name: str, tag_id: UUID | None = None) -> TagResponse:
    return TagResponse(
        id=tag_id or uuid4(), account_id=uuid4(), created_at=datetime.now(UTC), name=name
    )


class FakeStatisticsBackendClient:
    def __init__(
        self,
        period: PeriodTotal | None = None,
        by_category: list[CategoryTotal] | None = None,
        by_tag: list[TagTotal] | None = None,
        categories: list[CategoryResponse] | None = None,
        tags: list[TagResponse] | None = None,
    ) -> None:
        self.period = period or PeriodTotal(
            start=datetime(2026, 7, 1, tzinfo=UTC), end=datetime(2026, 7, 31, tzinfo=UTC), total=0
        )
        self.by_category = by_category if by_category is not None else []
        self.by_tag = by_tag if by_tag is not None else []
        self.categories = categories if categories is not None else []
        self.tags = tags if tags is not None else []
        self.by_period_calls: list[dict[str, object]] = []
        self.by_category_calls: list[dict[str, object]] = []

    async def statistics_by_period(
        self,
        start: datetime | None = None,
        end: datetime | None = None,
        category_id: UUID | None = None,
        tag_id: UUID | None = None,
    ) -> PeriodTotal:
        self.by_period_calls.append(
            {"start": start, "end": end, "category_id": category_id, "tag_id": tag_id}
        )
        return self.period

    async def statistics_by_category(
        self, start: datetime | None = None, end: datetime | None = None
    ) -> list[CategoryTotal]:
        self.by_category_calls.append({"start": start, "end": end})
        return self.by_category

    async def statistics_by_tag(
        self, start: datetime | None = None, end: datetime | None = None
    ) -> list[TagTotal]:
        return self.by_tag

    async def list_categories(self) -> list[CategoryResponse]:
        return self.categories

    async def list_tags(self) -> list[TagResponse]:
        return self.tags


def make_message() -> Mock:
    message = Mock(spec=TelegramMessage)
    message.answer = AsyncMock()
    message.edit_text = AsyncMock()
    return message


def make_state() -> FSMContext:
    storage = MemoryStorage()
    return FSMContext(storage=storage, key=Mock())


def make_callback(data: str, message: Mock) -> Mock:
    callback = Mock()
    callback.data = data
    callback.message = message
    callback.answer = AsyncMock()
    return callback


async def test_statistics_renders_period_total_from_minor_units() -> None:
    client = FakeStatisticsBackendClient(
        period=PeriodTotal(
            start=datetime(2026, 7, 1, tzinfo=UTC),
            end=datetime(2026, 7, 31, tzinfo=UTC),
            total=123456,
        )
    )
    message = make_message()

    await h.cmd_statistics(message, make_state(), client)

    text = message.answer.await_args.args[0]
    assert "Total: 1234.56" in text
    assert "2026-07-01" in text and "2026-07-31" in text


async def test_statistics_renders_category_breakdown_sorted_by_total_desc() -> None:
    groceries = make_category("Groceries")
    rent = make_category("Rent")
    client = FakeStatisticsBackendClient(
        by_category=[
            CategoryTotal(category_id=groceries.id, total=5000),
            CategoryTotal(category_id=rent.id, total=20000),
        ],
        categories=[groceries, rent],
    )
    message = make_message()

    await h.cmd_statistics(message, make_state(), client)

    text = message.answer.await_args.args[0]
    assert text.index("Rent") < text.index("Groceries")
    assert "Rent: 200.00" in text
    assert "Groceries: 50.00" in text


async def test_statistics_renders_tag_breakdown() -> None:
    urgent = make_tag("Urgent")
    client = FakeStatisticsBackendClient(
        by_tag=[TagTotal(tag_id=urgent.id, total=999)], tags=[urgent]
    )
    message = make_message()

    await h.cmd_statistics(message, make_state(), client)

    text = message.answer.await_args.args[0]
    assert "By tag:" in text
    assert "Urgent: 9.99" in text


async def test_statistics_omits_breakdown_sections_when_empty() -> None:
    client = FakeStatisticsBackendClient()
    message = make_message()

    await h.cmd_statistics(message, make_state(), client)

    text = message.answer.await_args.args[0]
    assert "By category:" not in text
    assert "By tag:" not in text


async def test_statistics_unknown_category_falls_back_to_placeholder() -> None:
    client = FakeStatisticsBackendClient(
        by_category=[CategoryTotal(category_id=uuid4(), total=100)], categories=[]
    )
    message = make_message()

    await h.cmd_statistics(message, make_state(), client)

    assert "Unknown: 1.00" in message.answer.await_args.args[0]


async def test_statistics_backend_error_shows_friendly_message() -> None:
    class FailingClient(FakeStatisticsBackendClient):
        async def statistics_by_period(
            self,
            start: datetime | None = None,
            end: datetime | None = None,
            category_id: UUID | None = None,
            tag_id: UUID | None = None,
        ) -> PeriodTotal:
            request = httpx.Request("GET", "http://test/statistics/by-period")
            raise httpx.ConnectError("boom", request=request)

    message = make_message()

    await h.cmd_statistics(message, make_state(), FailingClient())

    assert "couldn't reach" in message.answer.await_args.args[0].lower()


async def test_statistics_empty_period_shows_empty_message() -> None:
    client = FakeStatisticsBackendClient(
        period=PeriodTotal(
            start=datetime(2026, 7, 1, tzinfo=UTC), end=datetime(2026, 7, 31, tzinfo=UTC), total=0
        )
    )
    message = make_message()

    await h.cmd_statistics(message, make_state(), client)

    assert "No expenses in this period." in message.answer.await_args.args[0]


# -- period presets ----------------------------------------------------------


def test_preset_bounds_this_month_is_none() -> None:
    assert h.preset_bounds(STATISTICS_PERIOD_THIS_MONTH_CALLBACK) is None


def test_preset_bounds_last_month_spans_the_prior_calendar_month() -> None:
    now = datetime(2026, 7, 15, tzinfo=UTC)

    bounds = h.preset_bounds(STATISTICS_PERIOD_LAST_MONTH_CALLBACK, now=now)

    assert bounds == (datetime(2026, 6, 1, tzinfo=UTC), datetime(2026, 7, 1, tzinfo=UTC))


def test_preset_bounds_last_month_handles_january_rollover() -> None:
    now = datetime(2026, 1, 15, tzinfo=UTC)

    bounds = h.preset_bounds(STATISTICS_PERIOD_LAST_MONTH_CALLBACK, now=now)

    assert bounds == (datetime(2025, 12, 1, tzinfo=UTC), datetime(2026, 1, 1, tzinfo=UTC))


def test_preset_bounds_last_3_months_spans_three_calendar_months_back() -> None:
    now = datetime(2026, 7, 15, tzinfo=UTC)

    bounds = h.preset_bounds(STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK, now=now)

    assert bounds == (datetime(2026, 4, 1, tzinfo=UTC), datetime(2026, 7, 1, tzinfo=UTC))


async def test_on_period_selected_sends_the_computed_bounds() -> None:
    client = FakeStatisticsBackendClient()
    message = make_message()
    callback = make_callback(STATISTICS_PERIOD_LAST_MONTH_CALLBACK, message)
    state = make_state()

    await h.on_period_selected(callback, state, client)

    call = client.by_period_calls[0]
    assert call["start"] is not None and call["end"] is not None
    assert call["category_id"] is None and call["tag_id"] is None
    callback.answer.assert_awaited_once()
    message.edit_text.assert_awaited_once()


async def test_on_period_selected_this_month_sends_no_bounds() -> None:
    client = FakeStatisticsBackendClient()
    message = make_message()
    callback = make_callback(STATISTICS_PERIOD_THIS_MONTH_CALLBACK, message)

    await h.on_period_selected(callback, make_state(), client)

    call = client.by_period_calls[0]
    assert call["start"] is None and call["end"] is None


async def test_on_period_selected_marks_the_new_preset_active_in_the_keyboard() -> None:
    client = FakeStatisticsBackendClient()
    message = make_message()
    callback = make_callback(STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK, message)

    await h.on_period_selected(callback, make_state(), client)

    markup = message.edit_text.await_args.kwargs["reply_markup"]
    buttons = [button for row in markup.inline_keyboard for button in row]
    active = next(b for b in buttons if b.callback_data == STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK)
    assert active.text.startswith("✅")


# -- drill-down ---------------------------------------------------------------


async def test_by_category_clicked_shows_the_category_picker() -> None:
    groceries = make_category("Groceries")
    client = FakeStatisticsBackendClient(categories=[groceries])
    message = make_message()
    callback = make_callback(STATISTICS_BY_CATEGORY_CALLBACK, message)

    await h.on_by_category_clicked(callback, make_state(), client)

    message.edit_text.assert_awaited_once()
    assert "category" in message.edit_text.await_args.args[0].lower()


async def test_by_category_clicked_with_no_categories_keeps_the_statistics_keyboard() -> None:
    client = FakeStatisticsBackendClient(categories=[])
    message = make_message()
    callback = make_callback(STATISTICS_BY_CATEGORY_CALLBACK, message)
    state = make_state()
    await state.update_data(preset=STATISTICS_PERIOD_LAST_MONTH_CALLBACK)

    await h.on_by_category_clicked(callback, state, client)

    assert "No categories found." in message.edit_text.await_args.args[0]
    markup = message.edit_text.await_args.kwargs["reply_markup"]
    assert markup is not None
    buttons = [button for row in markup.inline_keyboard for button in row]
    active = next(b for b in buttons if b.callback_data == STATISTICS_PERIOD_LAST_MONTH_CALLBACK)
    assert active.text.startswith("✅")


async def test_by_tag_clicked_shows_the_tag_picker() -> None:
    urgent = make_tag("Urgent")
    client = FakeStatisticsBackendClient(tags=[urgent])
    message = make_message()
    callback = make_callback(STATISTICS_BY_TAG_CALLBACK, message)

    await h.on_by_tag_clicked(callback, make_state(), client)

    message.edit_text.assert_awaited_once()
    assert "tag" in message.edit_text.await_args.args[0].lower()


async def test_category_drilldown_sends_the_category_filter_and_current_bounds() -> None:
    groceries = make_category("Groceries")
    expected_bounds = h.preset_bounds(STATISTICS_PERIOD_LAST_MONTH_CALLBACK)
    assert expected_bounds is not None
    expected_start, expected_end = expected_bounds
    client = FakeStatisticsBackendClient(
        period=PeriodTotal(start=expected_start, end=expected_end, total=500),
        categories=[groceries],
    )
    message = make_message()
    callback = make_callback(f"category:{groceries.id.hex}", message)
    state = make_state()
    await state.update_data(preset=STATISTICS_PERIOD_LAST_MONTH_CALLBACK)

    await h.on_category_drilldown(
        callback, CategoryCallback(category_id=groceries.id), state, client
    )

    call = client.by_period_calls[0]
    assert call["category_id"] == groceries.id
    assert call["start"] == expected_start
    assert call["end"] == expected_end
    text = message.edit_text.await_args.args[0]
    assert "Groceries" in text
    assert "Total: 5.00" in text


async def test_tag_drilldown_sends_the_tag_filter() -> None:
    urgent = make_tag("Urgent")
    client = FakeStatisticsBackendClient(tags=[urgent])
    message = make_message()
    callback = make_callback(f"tag:{urgent.id.hex}", message)

    await h.on_tag_drilldown(callback, TagCallback(tag_id=urgent.id), make_state(), client)

    call = client.by_period_calls[0]
    assert call["tag_id"] == urgent.id
    text = message.edit_text.await_args.args[0]
    assert "Urgent" in text


async def test_drilldown_empty_result_shows_empty_message() -> None:
    groceries = make_category("Groceries")
    client = FakeStatisticsBackendClient(
        period=PeriodTotal(
            start=datetime(2026, 7, 1, tzinfo=UTC), end=datetime(2026, 7, 31, tzinfo=UTC), total=0
        ),
        categories=[groceries],
    )
    message = make_message()
    callback = make_callback(f"category:{groceries.id.hex}", message)

    await h.on_category_drilldown(
        callback, CategoryCallback(category_id=groceries.id), make_state(), client
    )

    assert "No expenses in this period." in message.edit_text.await_args.args[0]


async def test_drilldown_returns_state_to_view_so_presets_work_again() -> None:
    groceries = make_category("Groceries")
    client = FakeStatisticsBackendClient(categories=[groceries])
    message = make_message()
    callback = make_callback(f"category:{groceries.id.hex}", message)
    state = make_state()

    await h.on_category_drilldown(
        callback, CategoryCallback(category_id=groceries.id), state, client
    )

    assert await state.get_state() == Statistics.view.state


async def test_by_period_backend_error_shows_friendly_message_on_drilldown() -> None:
    class FailingClient(FakeStatisticsBackendClient):
        async def statistics_by_period(
            self,
            start: datetime | None = None,
            end: datetime | None = None,
            category_id: UUID | None = None,
            tag_id: UUID | None = None,
        ) -> PeriodTotal:
            request = httpx.Request("GET", "http://test/statistics/by-period")
            raise httpx.ConnectError("boom", request=request)

    urgent = make_tag("Urgent")
    message = make_message()
    callback = make_callback(f"tag:{urgent.id.hex}", message)

    await h.on_tag_drilldown(
        callback, TagCallback(tag_id=urgent.id), make_state(), FailingClient(tags=[urgent])
    )

    assert "couldn't reach" in message.edit_text.await_args.args[0].lower()


async def test_by_tag_clicked_with_no_tags_keeps_the_statistics_keyboard() -> None:
    client = FakeStatisticsBackendClient(tags=[])
    message = make_message()
    callback = make_callback(STATISTICS_BY_TAG_CALLBACK, message)

    await h.on_by_tag_clicked(callback, make_state(), client)

    assert "No tags found." in message.edit_text.await_args.args[0]
    assert message.edit_text.await_args.kwargs["reply_markup"] is not None


# -- /cancel ------------------------------------------------------------------


async def test_cancel_command_rerenders_the_last_period_view() -> None:
    client = FakeStatisticsBackendClient()
    message = make_message()
    state = make_state()
    await state.update_data(preset=STATISTICS_PERIOD_LAST_MONTH_CALLBACK)

    await h.on_cancel_command(message, state, client)

    call = client.by_period_calls[0]
    assert call["start"] is not None and call["end"] is not None
    assert await state.get_state() == Statistics.view.state


async def test_cancel_command_defaults_to_this_month_with_no_prior_preset() -> None:
    client = FakeStatisticsBackendClient()
    message = make_message()

    await h.on_cancel_command(message, make_state(), client)

    call = client.by_period_calls[0]
    assert call["start"] is None and call["end"] is None


# -- /chart (U2.4) -------------------------------------------------------------


async def test_chart_command_renders_category_breakdown() -> None:
    groceries = make_category("Groceries")
    rent = make_category("Rent")
    client = FakeStatisticsBackendClient(
        by_category=[
            CategoryTotal(category_id=groceries.id, total=5000),
            CategoryTotal(category_id=rent.id, total=20000),
        ],
        categories=[groceries, rent],
    )
    message = make_message()

    await h.cmd_chart(message, make_state(), client)

    text = message.answer.await_args.args[0]
    assert text.index("Rent") < text.index("Groceries")
    assert "200.00" in text and "50.00" in text


async def test_chart_command_reuses_the_currently_active_preset_bounds() -> None:
    """Proves the AC's "period-picker reuse" — /chart fetches with the exact
    same bounds `preset_bounds()` would give `/statistics` for the same
    preset, taken from the same FSM state key."""
    client = FakeStatisticsBackendClient(
        by_category=[CategoryTotal(category_id=uuid4(), total=100)]
    )
    message = make_message()
    state = make_state()
    await state.update_data(preset=STATISTICS_PERIOD_LAST_MONTH_CALLBACK)

    await h.cmd_chart(message, state, client)

    expected_bounds = h.preset_bounds(STATISTICS_PERIOD_LAST_MONTH_CALLBACK)
    assert expected_bounds is not None
    expected_start, expected_end = expected_bounds
    call = client.by_category_calls[0]
    assert call["start"] == expected_start
    assert call["end"] == expected_end


async def test_chart_command_defaults_to_this_month_with_no_prior_preset() -> None:
    client = FakeStatisticsBackendClient(
        by_category=[CategoryTotal(category_id=uuid4(), total=100)]
    )
    message = make_message()

    await h.cmd_chart(message, make_state(), client)

    call = client.by_category_calls[0]
    assert call["start"] is None and call["end"] is None


async def test_chart_command_zero_total_shows_nothing_to_chart_without_formatting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    formatter_calls: list[object] = []

    def fake_render(totals: object) -> str:
        formatter_calls.append(totals)
        return ""

    monkeypatch.setattr(h, "render_category_breakdown", fake_render)
    client = FakeStatisticsBackendClient(by_category=[CategoryTotal(category_id=uuid4(), total=0)])
    message = make_message()

    await h.cmd_chart(message, make_state(), client)

    assert "Nothing to chart" in message.answer.await_args.args[0]
    assert formatter_calls == []


async def test_chart_command_no_categories_shows_nothing_to_chart() -> None:
    client = FakeStatisticsBackendClient(by_category=[])
    message = make_message()

    await h.cmd_chart(message, make_state(), client)

    assert "Nothing to chart" in message.answer.await_args.args[0]


async def test_chart_command_backend_error_shows_friendly_message() -> None:
    class FailingClient(FakeStatisticsBackendClient):
        async def statistics_by_category(
            self, start: datetime | None = None, end: datetime | None = None
        ) -> list[CategoryTotal]:
            request = httpx.Request("GET", "http://test/statistics/by-category")
            raise httpx.ConnectError("boom", request=request)

    message = make_message()

    await h.cmd_chart(message, make_state(), FailingClient())

    assert "couldn't reach" in message.answer.await_args.args[0].lower()


async def test_chart_command_sets_view_state_with_the_active_preset() -> None:
    client = FakeStatisticsBackendClient(
        by_category=[CategoryTotal(category_id=uuid4(), total=100)]
    )
    message = make_message()
    state = make_state()

    await h.cmd_chart(message, state, client)

    assert await state.get_state() == Statistics.view.state
    assert (await state.get_data())["preset"] == STATISTICS_PERIOD_THIS_MONTH_CALLBACK


# -- language threading (U3.14 AC: RU/UK render for an account set to them) -
# RU/UK alias the EN catalogue until U3.15 ships real translations
# (bot/i18n.py), so these assert the *mechanism* — the injected `language`
# reaches every t() call along the way — not that the rendered text differs
# from English yet.


async def test_statistics_empty_period_renders_in_the_injected_language() -> None:
    client = FakeStatisticsBackendClient()
    message = make_message()

    await h.cmd_statistics(message, make_state(), client, language=Language.RU)

    assert t(Language.RU, "statistics.emptyPeriod") in message.answer.await_args.args[0]


async def test_by_category_clicked_no_categories_renders_in_the_injected_language() -> None:
    client = FakeStatisticsBackendClient(categories=[])
    message = make_message()
    callback = make_callback(STATISTICS_BY_CATEGORY_CALLBACK, message)

    await h.on_by_category_clicked(callback, make_state(), client, language=Language.RU)

    assert t(Language.RU, "statistics.noCategoriesFound") in message.edit_text.await_args.args[0]


async def test_chart_command_zero_total_renders_in_the_injected_language() -> None:
    client = FakeStatisticsBackendClient(by_category=[CategoryTotal(category_id=uuid4(), total=0)])
    message = make_message()

    await h.cmd_chart(message, make_state(), client, language=Language.RU)

    assert message.answer.await_args.args[0] == t(Language.RU, "statistics.nothingToChart")


async def test_chart_button_clicked_renders_the_chart_via_edit_text() -> None:
    client = FakeStatisticsBackendClient(
        by_category=[CategoryTotal(category_id=uuid4(), total=100)]
    )
    message = make_message()
    callback = make_callback(STATISTICS_CHART_CALLBACK, message)

    await h.on_chart_clicked(callback, make_state(), client)

    callback.answer.assert_awaited_once()
    message.edit_text.assert_awaited_once()
    markup = message.edit_text.await_args.kwargs["reply_markup"]
    assert markup is not None
