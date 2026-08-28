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

The same probe also resolves the caller's account `Language` (D707, U3.12):
it is cached beside the allow verdict (same entry, same TTL) and injected
into handler data as "language", so handlers read it off `data` and never
fetch it themselves. A denied probe (`me is None`, e.g. a clean 401) resolves
to `Language.EN` rather than raising — cheap and correct, since that update
is dropped immediately after regardless of language. This does NOT relax
D302 above: a malformed response body still surfaces as a `ValidationError`
from `client.get_me()`'s own parsing and is caught by the same broad,
deliberately fail-closed `except Exception` a transport error or 5xx is —
a response CashFlow's own backend can't produce correctly is exactly the
kind of probe anomaly D302 says to fail closed on, language included.

A blocked caller (U4.6) is a third outcome, distinct from both of the above:
the probe raises `httpx.HTTPStatusError` with a 403 (D713), never a clean
401 — `client.get_me()` only swallows 401 into `None`, so a 403 reaches this
middleware and is handled explicitly rather than falling into the same broad
`except Exception` a transport error would (that would silently drop the
update, which is exactly what U4.6's AC rules out for a blocked caller: they
must see the suspended message, not silence). The message needs the caller's
real language, but the 403 itself carries none — so the middleware also
keeps a small, separately-evicted `_last_language` map of the language seen
on every *successful* probe, used as the best-known language when a caller
who was previously fine turns out to be blocked. A caller blocked before
their first ever successful probe has no entry there and falls back to EN,
same as `_resolve_language` already does for a denied (401) caller. The
verdict itself is cached like any other denial (`ttl_deny`), and the message
is re-sent on every update while that cache entry stands — this is a
suspension, not a one-time notice. None of this shortens the `ttl_ok` window
an already-cached *allowed* caller keeps for up to five minutes after being
blocked (D715): during that window updates still reach handlers and every
backend call they make still gets a live 403 from `get_current_user`
(D713) — the exposure is a confusing error from the handler's own generic
error mapping, never access, and is accepted, not fixed, by this unit.
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
from bot.i18n import t
from models.enums import Language
from models.user import UserMeResponse

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
        # tg_id -> (allowed, blocked, language, expires_at monotonic seconds)
        self._cache: dict[int, tuple[bool, bool, Language, float]] = {}
        # tg_id -> language from the caller's last *successful* probe (U4.6),
        # unbounded by TTL — the fallback language for the suspended message
        # when the probe that discovers the block carries no language of its
        # own. Evicted the same way `_cache` is, independently of it.
        self._last_language: dict[int, Language] = {}

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

        entry = self._cached_entry(tg_id)
        if entry is None:
            try:
                me = await client.get_me()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 403:
                    language = self._last_language.get(tg_id, Language.EN)
                    self._store_verdict(tg_id, allowed=False, blocked=True, language=language)
                    logger.warning("Dropped update from blocked tg_id=%s", tg_id)
                    await _notify_blocked(event, language)
                    return None
                # Deliberately broad (D302): any other status, a transport
                # error, or a malformed response body must all fail closed
                # the same way.
                logger.exception("Allowlist probe failed for tg_id=%s", tg_id)
                return None
            except Exception:
                logger.exception("Allowlist probe failed for tg_id=%s", tg_id)
                return None
            allowed = me is not None
            language = _resolve_language(me)
            if me is not None:
                self._remember_language(tg_id, language)
            self._store_verdict(tg_id, allowed=allowed, blocked=False, language=language)
        else:
            allowed, blocked, language = entry
            if blocked:
                logger.warning("Dropped update from blocked tg_id=%s", tg_id)
                await _notify_blocked(event, language)
                return None

        if not allowed:
            logger.warning("Dropped update from non-allowlisted tg_id=%s", tg_id)
            return None

        data["client"] = client
        data["language"] = language
        return await handler(event, data)

    def _cached_entry(self, tg_id: int) -> tuple[bool, bool, Language] | None:
        entry = self._cache.get(tg_id)
        if entry is None:
            return None
        allowed, blocked, language, expires_at = entry
        if time.monotonic() >= expires_at:
            del self._cache[tg_id]
            return None
        return allowed, blocked, language

    def _store_verdict(self, tg_id: int, allowed: bool, blocked: bool, language: Language) -> None:
        if tg_id not in self._cache and len(self._cache) >= self._max_entries:
            oldest_tg_id = next(iter(self._cache))
            del self._cache[oldest_tg_id]
        ttl = self._ttl_ok if allowed else self._ttl_deny
        self._cache[tg_id] = (allowed, blocked, language, time.monotonic() + ttl)

    def _remember_language(self, tg_id: int, language: Language) -> None:
        if tg_id not in self._last_language and len(self._last_language) >= self._max_entries:
            oldest_tg_id = next(iter(self._last_language))
            del self._last_language[oldest_tg_id]
        self._last_language[tg_id] = language


def _resolve_language(me: UserMeResponse | None) -> Language:
    # A denied probe (me is None) still needs a language for the cache entry
    # even though the update is about to be dropped anyway (D707): default
    # to EN rather than making the caller special-case it.
    return me.language if me is not None else Language.EN


async def _notify_blocked(event: TelegramObject, language: Language) -> None:
    """Sends the suspended message (U4.6) to whatever this update can reply
    to. Duck-typed rather than `isinstance`-checked against `aiogram.types.Update`
    so a hand-built test double works the same as a real one; an update type
    with no message to answer (a poll, a chat-member change, ...) is a no-op,
    same as the silent drop every other denied update already gets."""
    message = getattr(event, "message", None)
    if message is None:
        callback_query = getattr(event, "callback_query", None)
        message = getattr(callback_query, "message", None) if callback_query is not None else None
    if message is None:
        return
    try:
        await message.answer(t(language, "common.suspended"))
    except Exception:
        # Never let a failure to *notify* about a block surface as a raw
        # traceback (bot/CLAUDE.md) — the update is dropped either way.
        logger.exception("Failed to send suspended notice")
