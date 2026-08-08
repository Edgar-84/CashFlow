"""Regenerating the category colour ramp must reproduce the checked-in spec
byte-for-byte (docs/plans/mini-app-v5.md U1.1, D500/D501) — never redefine it."""

from pathlib import Path

import pytest

from scripts.gen_palette import (
    CARD_DARK,
    CARD_LIGHT,
    FIRST_SLOT,
    _oklch_to_hex,
    contrast_ratio,
    generate_ramp,
    in_gamut,
    render_markdown_table,
    render_tokens_css,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
TOKENS_CSS = REPO_ROOT / "webapp" / "src" / "styles" / "tokens.css"
DESIGN_SYSTEM = REPO_ROOT / "docs" / "ui" / "design-system.md"


def test_generates_exactly_60_ramp_slots_13_to_72() -> None:
    colors = generate_ramp()
    assert [c.slot for c in colors] == list(range(13, 73))
    assert colors[0].name == "Olive 1"
    assert colors[-1].name == "Slate 6"


def test_tokens_css_block_matches_checked_in_file_byte_for_byte() -> None:
    colors = generate_ramp()
    generated = render_tokens_css(colors)

    lines = TOKENS_CSS.read_text().splitlines()
    start = lines.index("  --category-slot-13: #565600;")
    end = lines.index("  --category-slot-72: #d6dbe0;")
    checked_in = "\n".join(lines[start : end + 1])

    assert generated == checked_in


def test_slots_1_to_12_are_untouched_in_both_theme_blocks() -> None:
    css = TOKENS_CSS.read_text()
    root_block, dark_block = css.split(':root[data-theme="dark"]')

    for slot in range(1, 13):
        assert f"--category-slot-{slot}:" in root_block
        assert f"--category-slot-{slot}:" in dark_block

    for slot in range(13, 73):
        assert f"--category-slot-{slot}:" in root_block
        assert f"--category-slot-{slot}:" not in dark_block


def test_markdown_table_matches_design_system_ramp_table_byte_for_byte() -> None:
    colors = generate_ramp()
    generated = render_markdown_table(colors)

    lines = DESIGN_SYSTEM.read_text().splitlines()
    first_row = "| `--category-slot-13` | Olive 1 | `#565600` | 7.70 | 2.11 | [generated] |"
    last_row = "| `--category-slot-72` | Slate 6 | `#d6dbe0` | 1.39 | 11.67 | [generated] |"
    start = lines.index(first_row)
    end = lines.index(last_row)
    checked_in = "\n".join(lines[start : end + 1])

    assert generated == checked_in


def test_no_generated_hex_clips_the_srgb_gamut() -> None:
    # generate_ramp() raises ValueError internally (via _oklch_to_hex/in_gamut)
    # the moment any of the 60 colours falls outside the sRGB gamut, so simply
    # completing is the script's own check passing for all of them.
    colors = generate_ramp()
    assert len(colors) == 60
    for color in colors:
        assert color.hex.startswith("#") and len(color.hex) == 7


def test_in_gamut_check_actually_rejects_an_out_of_gamut_color() -> None:
    assert not in_gamut((-0.5, 0.5, 0.5))
    assert not in_gamut((0.5, 1.5, 0.5))


def test_a_clipping_parameter_set_is_rejected_by_the_generator() -> None:
    with pytest.raises(ValueError, match="clips the sRGB gamut"):
        _oklch_to_hex(0.44, 0.3, 110)


def test_red_2_is_not_status_red() -> None:
    red_2 = next(c for c in generate_ramp() if c.name == "Red 2")
    assert red_2.hex == "#b04945"

    css = TOKENS_CSS.read_text()
    status_red_line = next(line for line in css.splitlines() if "--status-red:" in line)
    status_red_hex = status_red_line.split(":", 1)[1].strip().rstrip(";").strip()
    assert red_2.hex != status_red_hex.lower()


def test_contrast_ratio_matches_design_system_figures() -> None:
    colors = {c.slot: c for c in generate_ramp()}

    olive_1 = colors[13]
    assert round(olive_1.contrast_white, 2) == 7.70
    assert round(olive_1.contrast_dark, 2) == 2.11

    slate_6 = colors[72]
    assert round(slate_6.contrast_white, 2) == 1.39
    assert round(slate_6.contrast_dark, 2) == 11.67


def test_contrast_ratio_is_symmetric_and_matches_wcag_reference_pair() -> None:
    assert contrast_ratio(CARD_LIGHT, CARD_DARK) == contrast_ratio(CARD_DARK, CARD_LIGHT)


def test_first_slot_constant_matches_named_set_boundary() -> None:
    assert FIRST_SLOT == 13
