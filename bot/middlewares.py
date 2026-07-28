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

The allowlist itself lives in the `users` table (bot-allowlist-db plan,
D300): a cache miss probes the backend with `GET /users/me` using the
caller's own headers and caches the verdict for `ttl_ok` (allow) or
`ttl_deny` (deny) seconds, so it costs one round-trip per tg_id per few
minutes, not one per update. A probe that fails (5xx or transport error)
drops the update and logs an ERROR — fail closed (D302): the alternative,
letting the update through, would open the handler stack to everyone
precisely during a backend outage.
"""

import logging
import time
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
        internal_token: str,
        *,
        ttl_ok: float = 300,
        ttl_deny: float = 60,
        max_entries: int = 1024,
    ) -> None:
        self._http_client = http_client
        self._internal_token = internal_token
        self._ttl_ok = ttl_ok
        self._ttl_deny = ttl_deny
        self._max_entries = max_entries
        # tg_id -> (allowed, expires_at monotonic seconds)
        self._cache: dict[int, tuple[bool, float]] = {}

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = data.get(EVENT_FROM_USER_KEY)
        tg_id = user.id if user is not None else None
        if tg_id is None:
            logger.warning("Dropped update with no Telegram user")
            return None

        # One client per update (as today), built regardless of cache
        # outcome so an allow always injects a fresh, correctly-scoped client.
        client = BackendClient(self._http_client, tg_id, self._internal_token)

        allowed = self._cached_verdict(tg_id)
        if allowed is None:
            try:
                allowed = await client.get_me() is not None
            except Exception:
                # Deliberately broad (D302): a transport error, a 5xx, or a
                # malformed response body must all fail closed the same way.
                logger.exception("Allowlist probe failed for tg_id=%s", tg_id)
                return None
            self._store_verdict(tg_id, allowed)

        if not allowed:
            logger.warning("Dropped update from non-allowlisted tg_id=%s", tg_id)
            return None

        data["client"] = client
        return await handler(event, data)

    def _cached_verdict(self, tg_id: int) -> bool | None:
        entry = self._cache.get(tg_id)
        if entry is None:
            return None
        allowed, expires_at = entry
        if time.monotonic() >= expires_at:
            del self._cache[tg_id]
            return None
        return allowed

    def _store_verdict(self, tg_id: int, allowed: bool) -> None:
        if tg_id not in self._cache and len(self._cache) >= self._max_entries:
            oldest_tg_id = next(iter(self._cache))
            del self._cache[oldest_tg_id]
        ttl = self._ttl_ok if allowed else self._ttl_deny
        self._cache[tg_id] = (allowed, time.monotonic() + ttl)
