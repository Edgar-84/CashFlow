"""Sends Telegram messages via the Bot API directly through httpx — NOT aiogram
(services/CLAUDE.md: services must not depend on aiogram)."""

from __future__ import annotations

import logging

import httpx

from models.category import CategoryResponse
from models.user import UserResponse

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org"


class NotificationService:
    """Best-effort Telegram sender.

    Any transport/API failure is caught, logged, and swallowed — never raised
    — so a failed send can never fail the expense creation that triggered it
    (root CLAUDE.md, plan Decision log D3).
    """

    def __init__(self, bot_token: str, client: httpx.AsyncClient) -> None:
        self._bot_token = bot_token
        self._client = client

    async def send(self, user: UserResponse, category: CategoryResponse, fill_pct: float) -> None:
        text = f"⚠️ Budget alert: {category.name} is at {fill_pct:.0f}% of the monthly limit."
        log_extra = {"tg_id": user.tg_id, "category_id": str(category.id), "fill_pct": fill_pct}
        try:
            response = await self._client.post(
                f"{TELEGRAM_API_BASE}/bot{self._bot_token}/sendMessage",
                json={"chat_id": user.tg_id, "text": text},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # Deliberately not logging `exc`/`exc.response`/the request: httpx builds
            # HTTPStatusError's message from the full request URL, which embeds the
            # live bot token (`/bot{token}/sendMessage`) — logging it would leak the
            # token to wherever logs are shipped. Log only the safe, structured bits.
            logger.error(
                "Failed to send budget notification: status=%s",
                exc.response.status_code,
                extra=log_extra,
            )
        except httpx.HTTPError:
            # Transport-level failure (connect/timeout/etc.) — no response, and the
            # exception message is not known to embed the token, but avoid logging
            # `exc` here too so this stays safe if httpx's error text ever changes.
            logger.error("Failed to send budget notification: transport error", extra=log_extra)
