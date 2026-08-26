"""Unit tests for bot/bot.py — create_dispatcher, hermetic (no real
Telegram/network), U4.2 AC: dispatcher builds. U2 AC (bot-allowlist-db plan):
create_dispatcher no longer takes an allowlist parameter; the allowlist is a
GET /users/me probe made by AllowlistMiddleware."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
from aiogram import Bot, Dispatcher, Router
from aiogram.dispatcher.middlewares.user_context import UserContextMiddleware
from aiogram.types import Chat, Message, Update, User

from bot.bot import create_dispatcher
from bot.client import BackendClient
from bot.middlewares import AllowlistMiddleware


def _user_json(tg_id: int) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "tg_id": tg_id,
        "name": "Test User",
        "role": "member",
        "account_id": str(uuid4()),
        "created_at": "2026-01-01T00:00:00Z",
        "currency": "USD",
        "language": "en",
        "account_name": "Test Account",
        "today": "2026-01-01",
    }


def reject_any_request(request: httpx.Request) -> httpx.Response:
    raise AssertionError("no API call expected in these tests")


def make_probe_responder(known_tg_ids: set[int]) -> Callable[[httpx.Request], httpx.Response]:
    def responder(request: httpx.Request) -> httpx.Response:
        tg_id = int(request.headers["X-Telegram-User-Id"])
        if tg_id in known_tg_ids:
            return httpx.Response(200, json=_user_json(tg_id))
        return httpx.Response(401)

    return responder


def make_dispatcher(
    responder: Callable[[httpx.Request], httpx.Response] = reject_any_request,
) -> Dispatcher:
    http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(responder), base_url="http://test"
    )
    return create_dispatcher(http_client, internal_token="test-internal-token")


def make_update(tg_id: int) -> Update:
    message = Message(
        message_id=1,
        date=datetime.now(UTC),
        chat=Chat(id=tg_id, type="private"),
        from_user=User(id=tg_id, is_bot=False, first_name="Test"),
        text="hi",
    )
    return Update(update_id=1, message=message)


def test_dispatcher_builds() -> None:
    dp = make_dispatcher()

    assert isinstance(dp, Dispatcher)


def test_allowlist_registered_as_outer_update_middleware_after_user_context() -> None:
    dp = make_dispatcher()

    middlewares = list(dp.update.outer_middleware)
    allowlist_index = next(
        i for i, m in enumerate(middlewares) if isinstance(m, AllowlistMiddleware)
    )
    user_context_index = next(
        i for i, m in enumerate(middlewares) if isinstance(m, UserContextMiddleware)
    )
    # UserContextMiddleware must run first: it populates event_from_user,
    # which AllowlistMiddleware reads (bot/middlewares.py docstring).
    assert user_context_index < allowlist_index


async def test_allowlisted_update_reaches_handler_with_injected_client() -> None:
    dp = make_dispatcher(make_probe_responder({555}))
    received: dict[str, Any] = {}
    router = Router()

    @router.message()
    async def catch_all(message: Message, client: BackendClient) -> None:
        received["client"] = client

    dp.include_router(router)
    bot = Bot(token="42:TEST-token")

    await dp.feed_update(bot, make_update(555))

    assert isinstance(received.get("client"), BackendClient)


async def test_non_allowlisted_update_never_reaches_handler() -> None:
    dp = make_dispatcher(make_probe_responder({555}))
    router = Router()

    @router.message()
    async def catch_all(message: Message) -> None:
        raise AssertionError("handler must not run for a non-allowlisted tg_id")

    dp.include_router(router)
    bot = Bot(token="42:TEST-token")

    result = await dp.feed_update(bot, make_update(999))

    assert result is None
