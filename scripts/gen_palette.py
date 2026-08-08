#!/usr/bin/env python3
"""Authoring tool for the category colour ramp (slots 13-72, D500/D501).

Prints the tokens.css custom-property lines and the design-system.md markdown
table rows for the 60 ramp colours. Both checked-in artifacts are expected to
be byte-identical to this script's output — the generator reproduces the
spec, it never redefines it (docs/plans/mini-app-v5.md, Risks). Run with
`python3 scripts/gen_palette.py`.

Parameters (hue families, chroma multipliers, the L/C ladders) come straight
from docs/ui/design-system.md's "Category palette — the ramp" section.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

L_LADDER: tuple[float, ...] = (0.44, 0.54, 0.63, 0.72, 0.81, 0.89)
C_LADDER: tuple[float, ...] = (0.115, 0.135, 0.135, 0.115, 0.085, 0.050)

# (family name, hue in degrees, chroma multiplier)
FAMILIES: tuple[tuple[str, int, float], ...] = (
    ("Olive", 110, 0.842),
    ("Green", 148, 1.0),
    ("Teal", 190, 0.665),
    ("Blue", 250, 1.0),
    ("Violet", 296, 1.0),
    ("Magenta", 332, 1.0),
    ("Red", 25, 1.0),
    ("Orange", 55, 0.955),
    ("Brown", 50, 0.45),
    ("Slate", 240, 0.16),
)

FIRST_SLOT = 13
CARD_LIGHT = "#FFFFFF"
CARD_DARK = "#1C2123"

# The multipliers above are tuned to 3 decimal places against the exact sRGB
# matrix below; a boundary case (Olive step 1) sits ~5e-4 past zero in the
# linear channel, which rounds to the identical byte either side of the
# boundary. This tolerance absorbs that without hiding a real clip.
GAMUT_TOLERANCE = 1e-3


@dataclass(frozen=True)
class RampColor:
    slot: int
    name: str
    hex: str
    contrast_white: float
    contrast_dark: float


def _oklch_to_linear_srgb(
    lightness: float, chroma: float, hue_degrees: float
) -> tuple[float, float, float]:
    hue = math.radians(hue_degrees)
    a = chroma * math.cos(hue)
    b = chroma * math.sin(hue)

    l_ = lightness + 0.3963377774 * a + 0.2158037573 * b
    m_ = lightness - 0.1055613458 * a - 0.0638541728 * b
    s_ = lightness - 0.0894841775 * a - 1.2914855480 * b

    l3, m3, s3 = l_**3, m_**3, s_**3

    r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
    g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
    bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3
    return r, g, bl


def _linear_to_gamma(channel: float) -> float:
    clamped = max(0.0, min(1.0, channel))
    if clamped <= 0.0031308:
        return clamped * 12.92
    return 1.055 * clamped ** (1 / 2.4) - 0.055


def _channel_to_byte(channel: float) -> int:
    return max(0, min(255, round(_linear_to_gamma(channel) * 255)))


def in_gamut(linear_rgb: tuple[float, float, float]) -> bool:
    return all(-GAMUT_TOLERANCE <= c <= 1 + GAMUT_TOLERANCE for c in linear_rgb)


def _oklch_to_hex(lightness: float, chroma: float, hue_degrees: float) -> str:
    linear_rgb = _oklch_to_linear_srgb(lightness, chroma, hue_degrees)
    if not in_gamut(linear_rgb):
        raise ValueError(
            f"OKLCH(L={lightness}, C={chroma}, H={hue_degrees}) clips the sRGB gamut: {linear_rgb}"
        )
    r, g, b = (_channel_to_byte(c) for c in linear_rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def _relative_luminance(hex_color: str) -> float:
    stripped = hex_color.lstrip("#")
    r, g, b = (int(stripped[i : i + 2], 16) / 255 for i in (0, 2, 4))

    def linearize(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    lr, lg, lb = linearize(r), linearize(g), linearize(b)
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb


def contrast_ratio(hex_a: str, hex_b: str) -> float:
    la, lb = _relative_luminance(hex_a), _relative_luminance(hex_b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def generate_ramp() -> list[RampColor]:
    colors: list[RampColor] = []
    slot = FIRST_SLOT
    for family, hue, multiplier in FAMILIES:
        for step in range(6):
            lightness = L_LADDER[step]
            chroma = C_LADDER[step] * multiplier
            hex_color = _oklch_to_hex(lightness, chroma, hue)
            colors.append(
                RampColor(
                    slot=slot,
                    name=f"{family} {step + 1}",
                    hex=hex_color,
                    contrast_white=contrast_ratio(hex_color, CARD_LIGHT),
                    contrast_dark=contrast_ratio(hex_color, CARD_DARK),
                )
            )
            slot += 1
    return colors


def render_tokens_css(colors: list[RampColor]) -> str:
    return "\n".join(f"  --category-slot-{c.slot}: {c.hex};" for c in colors)


def render_markdown_table(colors: list[RampColor]) -> str:
    return "\n".join(
        f"| `--category-slot-{c.slot}` | {c.name} | `{c.hex}` | "
        f"{c.contrast_white:.2f} | {c.contrast_dark:.2f} | [generated] |"
        for c in colors
    )


def main() -> None:
    # print(), not logging: stdout here is the product (copy-pasted into the
    # checked-in files), not a diagnostic trace — root CLAUDE.md's "no print()"
    # targets app/service I/O, which this one-shot authoring CLI isn't.
    colors = generate_ramp()
    print(render_tokens_css(colors))
    print()
    print(render_markdown_table(colors))


if __name__ == "__main__":
    main()
