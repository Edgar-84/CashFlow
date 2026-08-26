"""Unit tests for bot/i18n.py — U3.12 AC (EN catalogue, placeholder
handling) plus U3.15 AC: RU/UK ship real content and every language's
catalogue is key-complete against EN's (D702)."""

from bot.i18n import _catalogues, _en, _LeaveUnmatched, t
from models.enums import Language


def test_returns_the_en_string_for_a_plain_key() -> None:
    assert t(Language.EN, "error.tryAgain") == "Try again."


def test_renders_real_ru_content_not_an_en_fallback() -> None:
    assert t(Language.RU, "readonly") == "У вас нет прав на это действие."
    assert t(Language.RU, "error.tryAgain") == "Попробуйте ещё раз."


def test_renders_real_uk_content_not_an_en_fallback() -> None:
    assert t(Language.UK, "readonly") == "У вас немає прав на цю дію."
    assert t(Language.UK, "error.tryAgain") == "Спробуйте ще раз."


def test_fills_a_var_in_a_key_added_by_u3_13() -> None:
    assert t(Language.EN, "expense.saved", amount="12.50") == "Expense saved: 12.50"


def test_extra_var_with_no_matching_placeholder_is_ignored() -> None:
    assert t(Language.EN, "error.tryAgain", unused="x") == "Try again."


def test_leave_unmatched_fills_a_known_var_and_leaves_an_unknown_one_literal() -> None:
    mapping = _LeaveUnmatched({"name": "Ann"})
    assert "{name}".format_map(mapping) == "Ann"
    assert "{missing}".format_map(mapping) == "{missing}"


def test_every_language_has_exactly_ens_key_set() -> None:
    en_keys = set(_en.keys())
    for language, catalogue in _catalogues.items():
        assert set(catalogue.keys()) == en_keys, f"{language} key set diverges from EN"


def test_no_catalogue_contains_markup() -> None:
    for catalogue in _catalogues.values():
        for value in catalogue.values():
            assert "<" not in value and ">" not in value
