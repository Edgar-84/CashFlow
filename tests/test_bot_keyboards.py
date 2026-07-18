"""Unit tests for bot/keyboards.py — pure builders, U4.2 AC: keyboards render
expected callback_data."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from bot.keyboards import (
    CANCEL_CALLBACK,
    CONFIRM_CALLBACK,
    SELECTED_PREFIX,
    TAGS_DONE_CALLBACK,
    CategoryCallback,
    TagCallback,
    categories_keyboard,
    confirm_keyboard,
    tags_keyboard,
)
from models.category import CategoryResponse
from models.tag import TagResponse


def make_category(name: str) -> CategoryResponse:
    return CategoryResponse(id=uuid4(), account_id=uuid4(), name=name, created_at=datetime.now(UTC))


def make_tag(name: str) -> TagResponse:
    return TagResponse(id=uuid4(), account_id=uuid4(), name=name, created_at=datetime.now(UTC))


def flatten(markup: InlineKeyboardMarkup) -> list[InlineKeyboardButton]:
    return [button for row in markup.inline_keyboard for button in row]


def test_categories_keyboard_renders_one_button_per_category_with_packed_id() -> None:
    categories = [make_category("Food"), make_category("Transport"), make_category("Fun")]

    buttons = flatten(categories_keyboard(categories))

    assert [b.text for b in buttons] == ["Food", "Transport", "Fun"]
    # Lock the wire format handlers will filter on: "category:<uuid hex, no dashes>".
    for button, category in zip(buttons, categories, strict=True):
        assert button.callback_data == f"category:{category.id.hex}"


def test_category_callback_round_trips_the_uuid() -> None:
    category = make_category("Food")
    packed = CategoryCallback(category_id=category.id).pack()

    assert CategoryCallback.unpack(packed).category_id == category.id


def test_tags_keyboard_renders_toggle_buttons_and_done() -> None:
    tags = [make_tag("home"), make_tag("kids")]

    buttons = flatten(tags_keyboard(tags))

    assert [b.text for b in buttons] == ["home", "kids", "Done"]
    assert buttons[0].callback_data == f"tag:{tags[0].id.hex}"
    assert buttons[1].callback_data == f"tag:{tags[1].id.hex}"
    assert buttons[-1].callback_data == TAGS_DONE_CALLBACK


def test_tags_keyboard_marks_selected_tags() -> None:
    tags = [make_tag("home"), make_tag("kids")]
    selected: set[UUID] = {tags[1].id}

    buttons = flatten(tags_keyboard(tags, selected))

    assert buttons[0].text == "home"
    assert buttons[1].text == f"{SELECTED_PREFIX}kids"
    # Selection changes only the label — callback_data stays stable for toggling.
    assert buttons[1].callback_data == f"tag:{tags[1].id.hex}"


def test_tag_callback_round_trips_the_uuid() -> None:
    tag = make_tag("home")
    packed = TagCallback(tag_id=tag.id).pack()

    assert TagCallback.unpack(packed).tag_id == tag.id


def test_confirm_keyboard_renders_confirm_and_cancel() -> None:
    buttons = flatten(confirm_keyboard())

    assert [b.callback_data for b in buttons] == [CONFIRM_CALLBACK, CANCEL_CALLBACK]
