"""tg_id allowlist + BackendClient injection (bot/CLAUDE.md).

Registered as an outer middleware on the dispatcher's `update` observer
(wired in bot.py, U4.2) — it must be added via `dp.update.outer_middleware(...)`
*after* `Dispatcher()` construction, so aiogram's built-in
`UserContextMiddleware` (registered inside `Dispatcher.__init__`) runs first
and populates `event_from_user`; outer middlewares on one observer run in
registration order. Non-allowlisted tg_ids are dropped here — no handler
runs, so no backend call can ever be made for them. Allowlisted callers get
a per-update BackendClient pre-loaded with their auth headers, injected into
handler data as "client" — handlers never build headers themselves.
"""

import logging
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from aiogram import BaseMiddleware
from aiogram.dispatcher.middlewares.user_context import EVENT_FROM_USER_KEY
from aiogram.types import TelegramObject

from bot.client import BackendClient

logger = logging.getLogger(__name__)


class AllowlistMiddleware(BaseMiddleware):
    def __init__(
        self,
        http_client: httpx.AsyncClient,
        allowed_tg_ids: list[int],
        internal_token: str,
    ) -> None:
        self._http_client = http_client
        self._allowed_tg_ids = set(allowed_tg_ids)
        self._internal_token = internal_token

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = data.get(EVENT_FROM_USER_KEY)
        tg_id = user.id if user is not None else None
        if tg_id is None or tg_id not in self._allowed_tg_ids:
            logger.warning("Dropped update from non-allowlisted tg_id=%s", tg_id)
            return None
        data["client"] = BackendClient(self._http_client, tg_id, self._internal_token)
        return await handler(event, data)
