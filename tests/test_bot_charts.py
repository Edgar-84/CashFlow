"""Unit tests for bot/charts.py's `render_category_breakdown` (U2.4) — pure
function, no I/O, no Telegram/backend involved."""

from bot.charts import render_category_breakdown


def test_render_category_breakdown_one_line_per_category() -> None:
    text = render_category_breakdown([("Groceries", 5000), ("Rent", 20000)])

    lines = text.splitlines()
    assert len(lines) == 2


def test_render_category_breakdown_sorted_by_amount_descending() -> None:
    text = render_category_breakdown([("Groceries", 5000), ("Rent", 20000)])

    lines = text.splitlines()
    assert lines[0].startswith("Rent")
    assert lines[1].startswith("Groceries")


def test_render_category_breakdown_includes_formatted_amount() -> None:
    text = render_category_breakdown([("Rent", 20000)])

    assert "200.00" in text


def test_render_category_breakdown_percentages_sum_to_roughly_100() -> None:
    text = render_category_breakdown([("A", 100), ("B", 200), ("C", 300)])

    percentages = [int(line.rstrip("%").rsplit(" ", 1)[-1]) for line in text.splitlines()]
    assert sum(percentages) in range(99, 102)


def test_render_category_breakdown_includes_a_block_bar() -> None:
    text = render_category_breakdown([("Only", 100)])

    assert "█" in text


def test_render_category_breakdown_empty_input_returns_empty_string() -> None:
    assert render_category_breakdown([]) == ""
