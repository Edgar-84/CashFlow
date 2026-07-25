"""Text category-breakdown renderer (U2.4) — supersedes the matplotlib
PNG-chart approach (plan Decision log D121: no new dependency, no `uv.lock`
change, no event-loop-blocking synchronous render). Pure function, no I/O;
`bot/handlers/statistics.py`'s `/chart` command does the fetching and calls
this to build the message body.
"""

from decimal import Decimal

_BAR_LENGTH = 10
_FILLED_BLOCK = "█"
_EMPTY_BLOCK = "░"


def _format_amount(minor_units: int) -> str:
    return f"{Decimal(minor_units) / 100:.2f}"


def render_category_breakdown(totals: list[tuple[str, int]]) -> str:
    """One line per (name, minor-unit total): name, formatted amount, a
    Unicode block bar, and this category's share of the grand total —
    sorted by amount descending."""
    grand_total = sum(amount for _, amount in totals)
    ordered = sorted(totals, key=lambda pair: pair[1], reverse=True)
    lines = []
    for name, amount in ordered:
        share = amount / grand_total if grand_total else 0
        filled = round(share * _BAR_LENGTH)
        bar = _FILLED_BLOCK * filled + _EMPTY_BLOCK * (_BAR_LENGTH - filled)
        lines.append(f"{name}: {_format_amount(amount)}  {bar} {round(share * 100)}%")
    return "\n".join(lines)
