"""Unit tests for bot/handlers/common.py — /start + /help (U2.5 AC: /start
and /help render). No FSM state, no backend calls, so no fakes needed.
"""

from unittest.mock import AsyncMock, Mock

from aiogram.types import Message

from bot.handlers import common as h


def make_message() -> Mock:
    message = Mock(spec=Message)
    message.answer = AsyncMock()
    return message


async def test_start_renders_welcome_message() -> None:
    message = make_message()

    await h.cmd_start(message)

    message.answer.assert_awaited_once_with(h.WELCOME_TEXT)


async def test_help_renders_command_list() -> None:
    message = make_message()

    await h.cmd_help(message)

    message.answer.assert_awaited_once_with(h.HELP_TEXT)
    assert "/add" in h.HELP_TEXT
    assert "/statistics" in h.HELP_TEXT
    assert "/cancel" in h.HELP_TEXT
