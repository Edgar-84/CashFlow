"""FSM StatesGroups (bot/CLAUDE.md).

One StatesGroup per multi-step flow. V1 ships the canonical add-expense flow:
category → amount → [comment] → [tags] → confirm. Later units (U4.4/U4.5)
add their own groups here if their flows need more than one step.
"""

from aiogram.fsm.state import State, StatesGroup


class AddExpense(StatesGroup):
    category = State()
    amount = State()
    comment = State()
    tags = State()
    confirm = State()


class CategoryManage(StatesGroup):
    add_name = State()
    rename_select = State()
    rename_name = State()
    delete_select = State()


class TagManage(StatesGroup):
    add_name = State()
    rename_select = State()
    rename_name = State()
    delete_select = State()
