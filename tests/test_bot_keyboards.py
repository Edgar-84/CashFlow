"""Unit tests for bot/keyboards.py — pure builders, U4.2 AC: keyboards render
expected callback_data."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from bot.i18n import t
from bot.keyboards import (
    CANCEL_CALLBACK,
    CONFIRM_CALLBACK,
    EDIT_FIELD_AMOUNT_CALLBACK,
    EDIT_FIELD_CATEGORY_CALLBACK,
    EDIT_FIELD_COMMENT_CALLBACK,
    EDIT_FIELD_TAGS_CALLBACK,
    SELECTED_PREFIX,
    STATISTICS_BY_CATEGORY_CALLBACK,
    STATISTICS_BY_TAG_CALLBACK,
    STATISTICS_CHART_CALLBACK,
    STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK,
    STATISTICS_PERIOD_LAST_MONTH_CALLBACK,
    STATISTICS_PERIOD_THIS_MONTH_CALLBACK,
    TAGS_DONE_CALLBACK,
    BudgetCallback,
    CategoryCallback,
    ExpenseCallback,
    TagCallback,
    budgets_keyboard,
    categories_keyboard,
    confirm_keyboard,
    edit_field_keyboard,
    expenses_keyboard,
    statistics_keyboard,
    tags_keyboard,
)
from models.budget_plan import BudgetPlanResponse
from models.category import CategoryResponse
from models.enums import Language
from models.tag import TagResponse


def make_category(name: str) -> CategoryResponse:
    return CategoryResponse(id=uuid4(), account_id=uuid4(), name=name, created_at=datetime.now(UTC))


def make_tag(name: str) -> TagResponse:
    return TagResponse(id=uuid4(), account_id=uuid4(), name=name, created_at=datetime.now(UTC))


def make_plan(category_id: UUID) -> BudgetPlanResponse:
    return BudgetPlanResponse(
        id=uuid4(),
        account_id=uuid4(),
        category_id=category_id,
        amount=10000,
        period="monthly",
        notify_threshold=80,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


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


def test_tags_keyboard_renders_the_done_button_in_the_given_language() -> None:
    tags = [make_tag("home")]

    buttons = flatten(tags_keyboard(tags, language=Language.RU))

    assert buttons[-1].text == t(Language.RU, "kb.tagsDone")


def test_tag_callback_round_trips_the_uuid() -> None:
    tag = make_tag("home")
    packed = TagCallback(tag_id=tag.id).pack()

    assert TagCallback.unpack(packed).tag_id == tag.id


def test_budgets_keyboard_renders_one_button_per_plan_with_category_name() -> None:
    groceries = make_category("Groceries")
    rent = make_category("Rent")
    plans = [make_plan(groceries.id), make_plan(rent.id)]
    category_names = {groceries.id: groceries.name, rent.id: rent.name}

    buttons = flatten(budgets_keyboard(plans, category_names))

    assert [b.text for b in buttons] == ["Groceries", "Rent"]
    for button, plan in zip(buttons, plans, strict=True):
        assert button.callback_data == f"budget:{plan.id.hex}"


def test_budgets_keyboard_unknown_category_falls_back_to_placeholder() -> None:
    plan = make_plan(uuid4())

    buttons = flatten(budgets_keyboard([plan], {}))

    assert buttons[0].text == "Unknown"


def test_budgets_keyboard_unknown_category_placeholder_uses_the_given_language() -> None:
    plan = make_plan(uuid4())

    buttons = flatten(budgets_keyboard([plan], {}, language=Language.RU))

    assert buttons[0].text == t(Language.RU, "common.unknown")


def test_budget_callback_round_trips_the_uuid() -> None:
    plan = make_plan(uuid4())
    packed = BudgetCallback(budget_plan_id=plan.id).pack()

    assert BudgetCallback.unpack(packed).budget_plan_id == plan.id


def test_expenses_keyboard_renders_one_button_per_item_labeled_by_caller() -> None:
    id1, id2 = uuid4(), uuid4()

    buttons = flatten(expenses_keyboard([(id1, "07-18 12.50"), (id2, "07-17 5.00")]))

    assert [b.text for b in buttons] == ["07-18 12.50", "07-17 5.00"]
    assert buttons[0].callback_data == f"expense:{id1.hex}"
    assert buttons[1].callback_data == f"expense:{id2.hex}"


def test_expense_callback_round_trips_the_uuid() -> None:
    expense_id = uuid4()
    packed = ExpenseCallback(expense_id=expense_id).pack()

    assert ExpenseCallback.unpack(packed).expense_id == expense_id


def test_confirm_keyboard_renders_confirm_and_cancel() -> None:
    buttons = flatten(confirm_keyboard())

    assert [b.callback_data for b in buttons] == [CONFIRM_CALLBACK, CANCEL_CALLBACK]
    assert [b.text for b in buttons] == ["✅ Confirm", "❌ Cancel"]


def test_confirm_keyboard_uses_the_given_language() -> None:
    buttons = flatten(confirm_keyboard(language=Language.RU))

    assert [b.text for b in buttons] == [
        t(Language.RU, "kb.confirm"),
        t(Language.RU, "kb.cancel"),
    ]


def test_edit_field_keyboard_renders_the_four_editable_fields() -> None:
    buttons = flatten(edit_field_keyboard())

    assert [b.text for b in buttons] == ["Amount", "Category", "Comment", "Tags"]
    assert [b.callback_data for b in buttons] == [
        EDIT_FIELD_AMOUNT_CALLBACK,
        EDIT_FIELD_CATEGORY_CALLBACK,
        EDIT_FIELD_COMMENT_CALLBACK,
        EDIT_FIELD_TAGS_CALLBACK,
    ]


def test_edit_field_keyboard_uses_the_given_language() -> None:
    buttons = flatten(edit_field_keyboard(language=Language.RU))

    assert [b.text for b in buttons] == [
        t(Language.RU, "kb.editField.amount"),
        t(Language.RU, "kb.editField.category"),
        t(Language.RU, "kb.editField.comment"),
        t(Language.RU, "kb.editField.tags"),
    ]


def test_statistics_keyboard_renders_presets_and_drilldown_entries() -> None:
    buttons = flatten(statistics_keyboard(STATISTICS_PERIOD_THIS_MONTH_CALLBACK))

    assert [b.callback_data for b in buttons] == [
        STATISTICS_PERIOD_THIS_MONTH_CALLBACK,
        STATISTICS_PERIOD_LAST_MONTH_CALLBACK,
        STATISTICS_PERIOD_LAST_3_MONTHS_CALLBACK,
        STATISTICS_BY_CATEGORY_CALLBACK,
        STATISTICS_BY_TAG_CALLBACK,
        STATISTICS_CHART_CALLBACK,
    ]
    assert [b.text for b in buttons][:3] == [
        f"{SELECTED_PREFIX}This month",
        "Last month",
        "Last 3 months",
    ]
    assert [b.text for b in buttons][3:] == ["By category…", "By tag…", "📊 Chart"]


def test_statistics_keyboard_marks_the_active_preset_only() -> None:
    buttons = flatten(statistics_keyboard(STATISTICS_PERIOD_LAST_MONTH_CALLBACK))

    assert [b.text for b in buttons][:3] == [
        "This month",
        f"{SELECTED_PREFIX}Last month",
        "Last 3 months",
    ]


def test_statistics_keyboard_uses_the_given_language() -> None:
    buttons = flatten(
        statistics_keyboard(STATISTICS_PERIOD_THIS_MONTH_CALLBACK, language=Language.RU)
    )

    assert [b.text for b in buttons][:3] == [
        f"{SELECTED_PREFIX}{t(Language.RU, 'kb.statistics.thisMonth')}",
        t(Language.RU, "kb.statistics.lastMonth"),
        t(Language.RU, "kb.statistics.last3Months"),
    ]
    assert [b.text for b in buttons][3:] == [
        t(Language.RU, "kb.statistics.byCategory"),
        t(Language.RU, "kb.statistics.byTag"),
        t(Language.RU, "kb.statistics.chart"),
    ]
