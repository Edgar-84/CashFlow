"""Unit tests for bot/handlers/statistics.py — read-only `/statistics`
rendering (tests/CLAUDE.md: "Bot handlers are tested by mocking BackendClient
— never a live backend", U4.5 AC: "rendering tests on fixed API responses
(... totals formatted from minor units)").

Hermetic: a FakeStatisticsBackendClient stands in for bot/client.py's
BackendClient (no real backend HTTP); handlers are called directly with mock
Message objects (no real Telegram network).
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import httpx
from aiogram.types import Message

from bot.handlers import statistics as h
from models.category import CategoryResponse
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

    async def statistics_by_period(self) -> PeriodTotal:
        return self.period

    async def statistics_by_category(self) -> list[CategoryTotal]:
        return self.by_category

    async def statistics_by_tag(self) -> list[TagTotal]:
        return self.by_tag

    async def list_categories(self) -> list[CategoryResponse]:
        return self.categories

    async def list_tags(self) -> list[TagResponse]:
        return self.tags


def make_message() -> Mock:
    message = Mock(spec=Message)
    message.answer = AsyncMock()
    return message


async def test_statistics_renders_period_total_from_minor_units() -> None:
    client = FakeStatisticsBackendClient(
        period=PeriodTotal(
            start=datetime(2026, 7, 1, tzinfo=UTC),
            end=datetime(2026, 7, 31, tzinfo=UTC),
            total=123456,
        )
    )
    message = make_message()

    await h.cmd_statistics(message, client)

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

    await h.cmd_statistics(message, client)

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

    await h.cmd_statistics(message, client)

    text = message.answer.await_args.args[0]
    assert "By tag:" in text
    assert "Urgent: 9.99" in text


async def test_statistics_omits_breakdown_sections_when_empty() -> None:
    client = FakeStatisticsBackendClient()
    message = make_message()

    await h.cmd_statistics(message, client)

    text = message.answer.await_args.args[0]
    assert "By category:" not in text
    assert "By tag:" not in text


async def test_statistics_unknown_category_falls_back_to_placeholder() -> None:
    client = FakeStatisticsBackendClient(
        by_category=[CategoryTotal(category_id=uuid4(), total=100)], categories=[]
    )
    message = make_message()

    await h.cmd_statistics(message, client)

    assert "Unknown: 1.00" in message.answer.await_args.args[0]


async def test_statistics_backend_error_shows_friendly_message() -> None:
    class FailingClient(FakeStatisticsBackendClient):
        async def statistics_by_period(self) -> PeriodTotal:
            request = httpx.Request("GET", "http://test/statistics/by-period")
            raise httpx.ConnectError("boom", request=request)

    message = make_message()

    await h.cmd_statistics(message, FailingClient())

    assert "couldn't reach" in message.answer.await_args.args[0].lower()
