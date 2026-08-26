"""Unit tests for bot/i18n.py — U3.12 AC: EN catalogue only, RU/UK fall back
to EN until U3.15; a placeholder with no matching var is left untouched."""

from bot.i18n import _LeaveUnmatched, t
from models.enums import Language


def test_returns_the_en_string_for_a_plain_key() -> None:
    assert t(Language.EN, "error.tryAgain") == "Try again."


def test_falls_back_to_en_for_ru_and_uk() -> None:
    assert t(Language.RU, "readonly") == t(Language.EN, "readonly")
    assert t(Language.UK, "readonly") == t(Language.EN, "readonly")


def test_fills_a_var_in_a_key_added_by_u3_13() -> None:
    assert t(Language.EN, "expense.saved", amount="12.50") == "Expense saved: 12.50"


def test_extra_var_with_no_matching_placeholder_is_ignored() -> None:
    assert t(Language.EN, "error.tryAgain", unused="x") == "Try again."


def test_leave_unmatched_fills_a_known_var_and_leaves_an_unknown_one_literal() -> None:
    mapping = _LeaveUnmatched({"name": "Ann"})
    assert "{name}".format_map(mapping) == "Ann"
    assert "{missing}".format_map(mapping) == "{missing}"
