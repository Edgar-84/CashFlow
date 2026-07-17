"""Unit tests for bot/middlewares.py — AllowlistMiddleware, hermetic (no real
Telegram/network), U4.1 AC: non-allowlisted tg_id is dropped before any API
call."""

from typing import Any
from unittest.mock import Mock

import httpx
import pytest

from bot.client import BackendClient
from bot.middlewares import AllowlistMiddleware


def make_middleware(*, allowed_tg_ids: list[int] | None = None) -> AllowlistMiddleware:
    def handler_that_would_call_backend(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no API call should be made for a dropped update")

    http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler_that_would_call_backend), base_url="http://test"
    )
    return AllowlistMiddleware(
        http_client, allowed_tg_ids or [555], internal_token="test-internal-token"
    )


async def test_non_allowlisted_tg_id_is_dropped_before_any_api_call() -> None:
    middleware = make_middleware(allowed_tg_ids=[555])
    handler_called = False

    async def handler(event: Any, data: dict[str, Any]) -> str:
        nonlocal handler_called
        handler_called = True
        return "handled"

    result = await middleware(handler, Mock(), {"event_from_user": Mock(id=999)})

    assert result is None
    assert handler_called is False


async def test_missing_event_from_user_is_dropped() -> None:
    middleware = make_middleware(allowed_tg_ids=[555])

    async def handler(event: Any, data: dict[str, Any]) -> str:
        raise AssertionError("handler should not run without event_from_user")

    result = await middleware(handler, Mock(), {})

    assert result is None


async def test_allowlisted_tg_id_calls_handler_with_injected_client() -> None:
    middleware = make_middleware(allowed_tg_ids=[555])
    received_client: BackendClient | None = None

    async def handler(event: Any, data: dict[str, Any]) -> str:
        nonlocal received_client
        received_client = data["client"]
        return "handled"

    result = await middleware(handler, Mock(), {"event_from_user": Mock(id=555)})

    assert result == "handled"
    assert isinstance(received_client, BackendClient)


async def test_injected_client_carries_headers_for_the_calling_tg_id() -> None:
    captured: list[httpx.Request] = []

    def handler_fn(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=[])

    http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler_fn), base_url="http://test"
    )
    middleware = AllowlistMiddleware(http_client, [555], internal_token="secret-token")

    async def handler(event: Any, data: dict[str, Any]) -> None:
        await data["client"].list_expenses()

    await middleware(handler, Mock(), {"event_from_user": Mock(id=555)})

    assert len(captured) == 1
    assert captured[0].headers["X-Telegram-User-Id"] == "555"
    assert captured[0].headers["X-Internal-Token"] == "secret-token"


async def test_dropped_update_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    middleware = make_middleware(allowed_tg_ids=[555])

    async def handler(event: Any, data: dict[str, Any]) -> None:
        raise AssertionError("handler should not run")

    with caplog.at_level("WARNING", logger="bot.middlewares"):
        await middleware(handler, Mock(), {"event_from_user": Mock(id=999)})

    assert any("999" in r.getMessage() for r in caplog.records)
