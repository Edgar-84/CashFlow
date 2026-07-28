"""Unit tests for bot/middlewares.py — AllowlistMiddleware, hermetic (no real
Telegram/network). U2 AC (bot-allowlist-db plan): the allowlist is a
`GET /users/me` probe behind a per-tg_id TTL cache, not an in-memory set."""

from collections.abc import Callable
from typing import Any
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest

from bot.client import BackendClient
from bot.middlewares import AllowlistMiddleware

ALLOWED_TG_ID = 555
DENIED_TG_ID = 999


def _user_json(tg_id: int) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "tg_id": tg_id,
        "name": "Test User",
        "role": "member",
        "account_id": str(uuid4()),
        "created_at": "2026-01-01T00:00:00Z",
    }


def make_probe_responder(
    *, allowed_tg_ids: set[int], captured: list[httpx.Request]
) -> Callable[[httpx.Request], httpx.Response]:
    def responder(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        tg_id = int(request.headers["X-Telegram-User-Id"])
        if tg_id in allowed_tg_ids:
            return httpx.Response(200, json=_user_json(tg_id))
        return httpx.Response(401)

    return responder


def make_middleware(
    *,
    responder: Callable[[httpx.Request], httpx.Response],
    **kwargs: Any,
) -> AllowlistMiddleware:
    http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(responder), base_url="http://test"
    )
    return AllowlistMiddleware(http_client, internal_token="test-internal-token", **kwargs)


async def _run(middleware: AllowlistMiddleware, tg_id: int | None) -> tuple[Any, bool]:
    handler_called = False

    async def handler(event: Any, data: dict[str, Any]) -> str:
        nonlocal handler_called
        handler_called = True
        return "handled"

    data = {"event_from_user": Mock(id=tg_id)} if tg_id is not None else {}
    result = await middleware(handler, Mock(), data)
    return result, handler_called


async def test_allowlisted_tg_id_calls_handler_with_injected_client() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(allowed_tg_ids={ALLOWED_TG_ID}, captured=captured)
    )
    received_client: BackendClient | None = None

    async def handler(event: Any, data: dict[str, Any]) -> str:
        nonlocal received_client
        received_client = data["client"]
        return "handled"

    result = await middleware(handler, Mock(), {"event_from_user": Mock(id=ALLOWED_TG_ID)})

    assert result == "handled"
    assert isinstance(received_client, BackendClient)


async def test_non_allowlisted_tg_id_is_dropped_before_handler() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(allowed_tg_ids={ALLOWED_TG_ID}, captured=captured)
    )

    result, handler_called = await _run(middleware, DENIED_TG_ID)

    assert result is None
    assert handler_called is False


async def test_missing_event_from_user_is_dropped() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(allowed_tg_ids={ALLOWED_TG_ID}, captured=captured)
    )

    result, handler_called = await _run(middleware, None)

    assert result is None
    assert handler_called is False
    assert captured == []


async def test_second_update_within_ttl_issues_no_second_probe() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(allowed_tg_ids={ALLOWED_TG_ID}, captured=captured)
    )

    await _run(middleware, ALLOWED_TG_ID)
    result, handler_called = await _run(middleware, ALLOWED_TG_ID)

    assert handler_called is True
    assert result == "handled"
    assert len(captured) == 1


async def test_expired_entry_re_probes() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(allowed_tg_ids={ALLOWED_TG_ID}, captured=captured),
        ttl_ok=-1,
    )

    await _run(middleware, ALLOWED_TG_ID)
    await _run(middleware, ALLOWED_TG_ID)

    assert len(captured) == 2


async def test_probe_that_raises_drops_update_and_logs_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def responder(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("backend unreachable", request=request)

    middleware = make_middleware(responder=responder)

    with caplog.at_level("ERROR", logger="bot.middlewares"):
        result, handler_called = await _run(middleware, ALLOWED_TG_ID)

    assert result is None
    assert handler_called is False
    assert any(r.levelname == "ERROR" for r in caplog.records)


async def test_probe_5xx_drops_update_and_logs_error(caplog: pytest.LogCaptureFixture) -> None:
    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    middleware = make_middleware(responder=responder)

    with caplog.at_level("ERROR", logger="bot.middlewares"):
        result, handler_called = await _run(middleware, ALLOWED_TG_ID)

    assert result is None
    assert handler_called is False
    assert any(r.levelname == "ERROR" for r in caplog.records)


async def test_cache_never_exceeds_max_entries() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(allowed_tg_ids=set(), captured=captured),
        max_entries=2,
    )

    # Fill the cache past its cap, then re-visit the first tg_id: if the cap
    # were not enforced, tg_id=1's verdict would still be cached and this
    # would issue no new probe. A fresh probe proves it was evicted.
    for tg_id in (1, 2, 3):
        await _run(middleware, tg_id)
    probes_before_revisit = len(captured)

    await _run(middleware, 1)

    assert len(captured) == probes_before_revisit + 1


async def test_injected_client_carries_headers_for_the_calling_tg_id() -> None:
    captured: list[httpx.Request] = []

    def responder(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if request.url.path == "/users/me":
            return httpx.Response(200, json=_user_json(ALLOWED_TG_ID))
        return httpx.Response(200, json=[])

    middleware = make_middleware(responder=responder)

    async def handler(event: Any, data: dict[str, Any]) -> None:
        await data["client"].list_expenses()

    await middleware(handler, Mock(), {"event_from_user": Mock(id=ALLOWED_TG_ID)})

    # captured[0] is the get_me() probe, captured[1] is list_expenses().
    assert len(captured) == 2
    assert captured[1].headers["X-Telegram-User-Id"] == str(ALLOWED_TG_ID)
    assert captured[1].headers["X-Internal-Token"] == "test-internal-token"


async def test_dropped_update_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(allowed_tg_ids={ALLOWED_TG_ID}, captured=captured)
    )

    with caplog.at_level("WARNING", logger="bot.middlewares"):
        await _run(middleware, DENIED_TG_ID)

    assert any(str(DENIED_TG_ID) in r.getMessage() for r in caplog.records)
