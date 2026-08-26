"""`/start` + `/help`: role-agnostic command list (U2.5). No FSM state, no
backend calls — every account member sees the same text regardless of role;
permission errors on individual commands still come from the API (MVP D27).

Both messages go through `bot/i18n.py::t()` (U3.13); `language` defaults to
`Language.EN` for direct calls (e.g. tests), but aiogram always injects the
caller's real resolved language from `AllowlistMiddleware`'s data (D707)
since dispatch matches by parameter name regardless of the default.
"""

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

from bot.i18n import t
from models.enums import Language


async def cmd_start(message: Message, language: Language = Language.EN) -> None:
    await message.answer(t(language, "common.welcome"))


async def cmd_help(message: Message, language: Language = Language.EN) -> None:
    await message.answer(t(language, "common.help"))


def create_router() -> Router:
    router = Router(name="common")
    router.message.register(cmd_start, Command("start"))
    router.message.register(cmd_help, Command("help"))
    return router
