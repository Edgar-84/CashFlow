"""Dispatcher factory + polling entrypoint: `uv run python -m bot.bot` (bot/CLAUDE.md)."""

import asyncio
import logging

import httpx
from aiogram import Bot, Dispatcher

from bot.handlers.categories import create_router as create_categories_router
from bot.handlers.expenses import create_router as create_expenses_router
from bot.handlers.tags import create_router as create_tags_router
from bot.middlewares import AllowlistMiddleware
from config import get_settings

logger = logging.getLogger(__name__)


def create_dispatcher(
    http_client: httpx.AsyncClient,
    allowed_tg_ids: list[int],
    internal_token: str,
) -> Dispatcher:
    dp = Dispatcher()
    # Outer middleware on `update`, added after Dispatcher() construction so
    # aiogram's built-in UserContextMiddleware runs first and populates
    # event_from_user (see bot/middlewares.py docstring).
    dp.update.outer_middleware(AllowlistMiddleware(http_client, allowed_tg_ids, internal_token))
    # Feature routers (bot/handlers/) are registered here as M4 units land (U4.3+).
    dp.include_router(create_expenses_router())
    dp.include_router(create_categories_router())
    dp.include_router(create_tags_router())
    return dp


async def main() -> None:
    settings = get_settings()
    bot = Bot(token=settings.bot_token)
    http_client = httpx.AsyncClient(base_url=settings.backend_base_url)
    dp = create_dispatcher(http_client, settings.allowed_tg_ids_list, settings.internal_token)
    logger.info("Starting bot polling")
    try:
        # start_polling closes the bot session itself (close_bot_session=True).
        await dp.start_polling(bot)
    finally:
        await http_client.aclose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
