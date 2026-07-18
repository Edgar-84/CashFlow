"""Unit tests for bot/bot.py — create_dispatcher, hermetic (no real
Telegram/network), U4.2 AC: dispatcher builds."""

from datetime import UTC, datetime
from typing import Any

import httpx
from aiogram import Bot, Dispatcher, Router
from aiogram.dispatcher.middlewares.user_context import UserContextMiddleware
from aiogram.types import Chat, Message, Update, User

from bot.bot import create_dispatcher
from bot.client import BackendClient
from bot.middlewares import AllowlistMiddleware


def make_dispatcher(allowed_tg_ids: list[int] | None = None) -> Dispatcher:
    def reject_any_request(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no API call expected in these tests")

    http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(reject_any_request), base_url="http://test"
    )
    return create_dispatcher(
        http_client, allowed_tg_ids or [555], internal_token="test-internal-token"
    )


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
    dp = make_dispatcher(allowed_tg_ids=[555])
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
    dp = make_dispatcher(allowed_tg_ids=[555])
    router = Router()

    @router.message()
    async def catch_all(message: Message) -> None:
        raise AssertionError("handler must not run for a non-allowlisted tg_id")

    dp.include_router(router)
    bot = Bot(token="42:TEST-token")

    result = await dp.feed_update(bot, make_update(999))

    assert result is None
