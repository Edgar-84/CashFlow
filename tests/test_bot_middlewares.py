"""Unit tests for bot/middlewares.py — AllowlistMiddleware, hermetic (no real
Telegram/network). U2 AC (bot-allowlist-db plan): the allowlist is a
`GET /users/me` probe behind a per-tg_id TTL cache, not an in-memory set.
U3.12 AC: that same probe also resolves the caller's `Language`, cached
beside the verdict and injected into handler data — no second round-trip."""

from collections.abc import Callable
from typing import Any
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import httpx
import pytest

from bot.client import BackendClient
from bot.i18n import t
from bot.middlewares import AllowlistMiddleware, _resolve_language
from models.enums import Language

ALLOWED_TG_ID = 555
DENIED_TG_ID = 999
BLOCKED_TG_ID = 777


def _user_json(tg_id: int, *, language: str = "en") -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "tg_id": tg_id,
        "name": "Test User",
        "role": "member",
        "account_id": str(uuid4()),
        "is_blocked": False,
        "created_at": "2026-01-01T00:00:00Z",
        "currency": "USD",
        "language": language,
        "account_name": "Test Account",
        "today": "2026-01-01",
    }


def make_probe_responder(
    *,
    known_tg_ids: set[int],
    captured: list[httpx.Request],
    languages: dict[int, str] | None = None,
) -> Callable[[httpx.Request], httpx.Response]:
    def responder(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        tg_id = int(request.headers["X-Telegram-User-Id"])
        if tg_id in known_tg_ids:
            language = (languages or {}).get(tg_id, "en")
            return httpx.Response(200, json=_user_json(tg_id, language=language))
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
        responder=make_probe_responder(known_tg_ids={ALLOWED_TG_ID}, captured=captured)
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
        responder=make_probe_responder(known_tg_ids={ALLOWED_TG_ID}, captured=captured)
    )

    result, handler_called = await _run(middleware, DENIED_TG_ID)

    assert result is None
    assert handler_called is False


async def test_missing_event_from_user_is_dropped() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(known_tg_ids={ALLOWED_TG_ID}, captured=captured)
    )

    result, handler_called = await _run(middleware, None)

    assert result is None
    assert handler_called is False
    assert captured == []


async def test_second_update_within_ttl_issues_no_second_probe() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(known_tg_ids={ALLOWED_TG_ID}, captured=captured)
    )

    await _run(middleware, ALLOWED_TG_ID)
    result, handler_called = await _run(middleware, ALLOWED_TG_ID)

    assert handler_called is True
    assert result == "handled"
    assert len(captured) == 1


async def test_expired_entry_re_probes() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(known_tg_ids={ALLOWED_TG_ID}, captured=captured),
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
        responder=make_probe_responder(known_tg_ids=set(), captured=captured),
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
        responder=make_probe_responder(known_tg_ids={ALLOWED_TG_ID}, captured=captured)
    )

    with caplog.at_level("WARNING", logger="bot.middlewares"):
        await _run(middleware, DENIED_TG_ID)

    assert any(str(DENIED_TG_ID) in r.getMessage() for r in caplog.records)


async def test_allowlisted_tg_id_injects_resolved_language() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(
            known_tg_ids={ALLOWED_TG_ID}, captured=captured, languages={ALLOWED_TG_ID: "ru"}
        )
    )
    received_language: Language | None = None

    async def handler(event: Any, data: dict[str, Any]) -> str:
        nonlocal received_language
        received_language = data["language"]
        return "handled"

    await middleware(handler, Mock(), {"event_from_user": Mock(id=ALLOWED_TG_ID)})

    assert received_language == Language.RU


async def test_second_update_within_ttl_reuses_cached_language_with_no_second_probe() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(
            known_tg_ids={ALLOWED_TG_ID}, captured=captured, languages={ALLOWED_TG_ID: "uk"}
        )
    )
    languages: list[Language] = []

    async def handler(event: Any, data: dict[str, Any]) -> str:
        languages.append(data["language"])
        return "handled"

    await middleware(handler, Mock(), {"event_from_user": Mock(id=ALLOWED_TG_ID)})
    await middleware(handler, Mock(), {"event_from_user": Mock(id=ALLOWED_TG_ID)})

    assert languages == [Language.UK, Language.UK]
    assert len(captured) == 1


def test_resolve_language_returns_en_when_probe_denied() -> None:
    assert _resolve_language(None) is Language.EN


async def test_denied_tg_id_still_caches_en_language_with_no_second_probe() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(
        responder=make_probe_responder(known_tg_ids=set(), captured=captured)
    )

    await _run(middleware, DENIED_TG_ID)
    await _run(middleware, DENIED_TG_ID)

    assert len(captured) == 1


# -- U4.6: blocked callers ------------------------------------------------


def _blocked_responder(
    *, captured: list[httpx.Request], detail: str = "User is suspended"
) -> Callable[[httpx.Request], httpx.Response]:
    def responder(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(403, json={"detail": detail})

    return responder


def _message_event() -> tuple[Any, AsyncMock]:
    """A `Mock()` event with an aiogram-shaped `.message.answer` — real
    `Update`s carry a populated `message` for a plain text/command update."""
    message = AsyncMock()
    event = Mock(message=message, callback_query=None)
    return event, message


def _callback_query_event() -> tuple[Any, AsyncMock]:
    """A `Mock()` event shaped like an update whose only populated field is
    `callback_query` (an inline-keyboard tap) — `message` is unset (None), as
    a real `Update` would have it."""
    message = AsyncMock()
    callback_query = Mock(message=message)
    event = Mock(message=None, callback_query=callback_query)
    return event, message


async def test_blocked_tg_id_is_dropped_and_sent_the_suspended_message() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(responder=_blocked_responder(captured=captured))
    event, message = _message_event()
    handler_called = False

    async def handler(event: Any, data: dict[str, Any]) -> str:
        nonlocal handler_called
        handler_called = True
        return "handled"

    result = await middleware(handler, event, {"event_from_user": Mock(id=BLOCKED_TG_ID)})

    assert result is None
    assert handler_called is False
    message.answer.assert_awaited_once_with(t(Language.EN, "common.suspended"))


async def test_blocked_tg_id_no_backend_call_beyond_the_probe() -> None:
    """No handler runs, so the client injected into `data` (had the update
    gone through) never gets a chance to make a second backend call — the
    probe itself is the only request the blocked caller's update causes."""
    captured: list[httpx.Request] = []
    middleware = make_middleware(responder=_blocked_responder(captured=captured))
    event, _ = _message_event()

    await middleware(AsyncMock(), event, {"event_from_user": Mock(id=BLOCKED_TG_ID)})

    assert len(captured) == 1


async def test_blocked_caller_who_was_previously_allowed_is_messaged_in_their_real_language() -> (
    None
):
    captured: list[httpx.Request] = []

    def responder(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if len(captured) == 1:
            return httpx.Response(200, json=_user_json(BLOCKED_TG_ID, language="uk"))
        return httpx.Response(403, json={"detail": "User is suspended"})

    # ttl_ok=-1 forces the second update to re-probe instead of reusing the
    # first (allowed) verdict, simulating the caller getting blocked between
    # the two updates.
    middleware = make_middleware(responder=responder, ttl_ok=-1)
    first_event, _ = _message_event()
    second_event, second_message = _message_event()

    await middleware(AsyncMock(), first_event, {"event_from_user": Mock(id=BLOCKED_TG_ID)})
    await middleware(AsyncMock(), second_event, {"event_from_user": Mock(id=BLOCKED_TG_ID)})

    second_message.answer.assert_awaited_once_with(t(Language.UK, "common.suspended"))


async def test_second_update_from_blocked_caller_within_ttl_re_notifies_with_no_second_probe() -> (
    None
):
    captured: list[httpx.Request] = []
    middleware = make_middleware(responder=_blocked_responder(captured=captured))
    first_event, first_message = _message_event()
    second_event, second_message = _message_event()

    await middleware(AsyncMock(), first_event, {"event_from_user": Mock(id=BLOCKED_TG_ID)})
    await middleware(AsyncMock(), second_event, {"event_from_user": Mock(id=BLOCKED_TG_ID)})

    assert len(captured) == 1
    first_message.answer.assert_awaited_once_with(t(Language.EN, "common.suspended"))
    second_message.answer.assert_awaited_once_with(t(Language.EN, "common.suspended"))


async def test_blocked_caller_via_callback_query_is_answered_on_its_message() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(responder=_blocked_responder(captured=captured))
    event, message = _callback_query_event()

    result = await middleware(AsyncMock(), event, {"event_from_user": Mock(id=BLOCKED_TG_ID)})

    assert result is None
    message.answer.assert_awaited_once_with(t(Language.EN, "common.suspended"))


async def test_blocked_update_with_no_respondable_message_is_dropped_without_error() -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(responder=_blocked_responder(captured=captured))
    event = Mock(message=None, callback_query=None)

    result = await middleware(AsyncMock(), event, {"event_from_user": Mock(id=BLOCKED_TG_ID)})

    assert result is None


async def test_blocked_tg_id_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    captured: list[httpx.Request] = []
    middleware = make_middleware(responder=_blocked_responder(captured=captured))
    event, _ = _message_event()

    with caplog.at_level("WARNING", logger="bot.middlewares"):
        await middleware(AsyncMock(), event, {"event_from_user": Mock(id=BLOCKED_TG_ID)})

    assert any(str(BLOCKED_TG_ID) in r.getMessage() for r in caplog.records)
