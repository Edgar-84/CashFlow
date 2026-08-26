"""Unit tests for bot/handlers/common.py — /start + /help (U2.5 AC: /start
and /help render). No FSM state, no backend calls, so no fakes needed.
"""

from unittest.mock import AsyncMock, Mock

from aiogram.types import Message

from bot.handlers import common as h
from bot.i18n import t
from models.enums import Language


def make_message() -> Mock:
    message = Mock(spec=Message)
    message.answer = AsyncMock()
    return message


async def test_start_renders_welcome_message() -> None:
    message = make_message()

    await h.cmd_start(message)

    message.answer.assert_awaited_once_with(t(Language.EN, "common.welcome"))


async def test_help_renders_command_list() -> None:
    message = make_message()

    await h.cmd_help(message)

    help_text = t(Language.EN, "common.help")
    message.answer.assert_awaited_once_with(help_text)
    assert "/add" in help_text
    assert "/statistics" in help_text
    assert "/cancel" in help_text


async def test_start_uses_the_injected_language() -> None:
    message = make_message()

    await h.cmd_start(message, language=Language.RU)

    message.answer.assert_awaited_once_with(t(Language.RU, "common.welcome"))
