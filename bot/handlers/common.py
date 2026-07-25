"""`/start` + `/help`: role-agnostic command list (U2.5). No FSM state, no
backend calls — every account member sees the same text regardless of role;
permission errors on individual commands still come from the API (MVP D27).
"""

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

WELCOME_TEXT = (
    "Welcome to CashFlow! Track shared family expenses, budgets and "
    "statistics right from this chat.\n\nSend /help to see what you can do."
)

HELP_TEXT = "\n\n".join(
    [
        "Expenses:\n"
        "/add — add an expense\n"
        "/expenses — list recent expenses\n"
        "/editexpense — edit an expense\n"
        "/deleteexpense — delete an expense",
        "Categories:\n"
        "/categories — list categories\n"
        "/addcategory — add a category\n"
        "/renamecategory — rename a category\n"
        "/deletecategory — delete a category",
        "Tags:\n"
        "/tags — list tags\n"
        "/addtag — add a tag\n"
        "/renametag — rename a tag\n"
        "/deletetag — delete a tag",
        "Budgets:\n"
        "/budgets — list budget plans\n"
        "/addbudget — add a budget plan\n"
        "/updatebudget — update a budget plan\n"
        "/deletebudget — delete a budget plan",
        "Statistics:\n"
        "/statistics — period statistics, drill down by category/tag\n"
        "/chart — category breakdown for the active period",
        "Anytime:\n/cancel — cancel the current action",
    ]
)


async def cmd_start(message: Message) -> None:
    await message.answer(WELCOME_TEXT)


async def cmd_help(message: Message) -> None:
    await message.answer(HELP_TEXT)


def create_router() -> Router:
    router = Router(name="common")
    router.message.register(cmd_start, Command("start"))
    router.message.register(cmd_help, Command("help"))
    return router
