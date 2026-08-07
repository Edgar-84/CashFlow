"""Shared period-param validation (plan mini-app-v4 Decision log D403) —
extracted from `api/statistics.py::_validate_period` so every router that
takes period-selector query params validates identically instead of
maintaining its own copy that can drift into a different 422 message for
the same mistake."""

from datetime import date, datetime

from fastapi import HTTPException, status

from models.enums import PeriodUnit
from services.period import resolve_period


def _period_selector_used(
    period: PeriodUnit | None, offset: int, start_date: date | None, end_date: date | None
) -> bool:
    """Shared between `validate_period_params` and `resolve_period_params` so
    the two definitions of "did the caller touch the period selector at all"
    can't drift apart (review fix, U0.3)."""
    return period is not None or offset != 0 or start_date is not None or end_date is not None


def validate_period_params(
    *,
    start: datetime | None,
    end: datetime | None,
    months_back: int | None,
    period: PeriodUnit | None,
    offset: int,
    start_date: date | None,
    end_date: date | None,
    offset_param_name: str = "offset",
) -> None:
    """At most one selector family per request (plan Decision log D313):
    `{period + offset}` · `{period=custom + start_date/end_date}` ·
    `{months_back}` · `{start/end}`. Both bounds of `start`/`end` are optional
    independently, but if both are given they must describe a non-empty
    window (plan Decision log D106).

    `offset_param_name` names the offset-shaped query param as the caller
    actually sent it — `"offset"` for the statistics routes, `"period_offset"`
    for `GET /expenses` (D402) — so the 422 message quotes what the caller
    typed rather than a name specific to one router.

    Range/shape errors specific to `period` — missing `start_date`/`end_date`
    under `period=custom`, `start_date > end_date` — are left to
    `resolve_period`; its `ValueError` is mapped to 422 by the routes. This
    function rejects everything `resolve_period` never sees: cross-family
    conflicts, `offset`/`start_date`/`end_date` used without the `period`
    they require, and `offset` combined with `period=custom` — the last one
    is rejected *here*, not left to `resolve_period`'s own check, because
    that one's `ValueError` hardcodes the word "offset" and can't quote
    `period_offset` for `GET /expenses` (review fix, U0.3).
    """
    families_used = sum(
        [
            _period_selector_used(period, offset, start_date, end_date),
            months_back is not None,
            start is not None or end is not None,
        ]
    )
    if families_used > 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"at most one of period/{offset_param_name}, months_back, or start/end may be given"
            ),
        )
    if offset != 0 and period is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{offset_param_name} requires period",
        )
    if offset != 0 and period == PeriodUnit.CUSTOM:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"period=custom forbids a non-zero {offset_param_name}",
        )
    if (start_date is not None or end_date is not None) and period != PeriodUnit.CUSTOM:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="start_date/end_date require period=custom",
        )
    if start is not None and end is not None and start >= end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="start must be before end"
        )


def resolve_period_params(
    *,
    period: PeriodUnit | None,
    offset: int,
    start_date: date | None,
    end_date: date | None,
    offset_param_name: str,
    tz: str,
) -> tuple[datetime, datetime] | None:
    """Validate-then-resolve, for callers with no `months_back`/explicit
    `start`/`end` selector families of their own (`GET /expenses`, D402/D415)
    — the Contracts section's combined shape, deferred by U0.2 (D415) because
    building it there would have been new behaviour for the statistics
    routes, which still resolve their own bounds inside
    `statistics_service.py` and keep calling `validate_period_params`
    directly. Returns `None` when no period selector was given (today's
    "no period filter" behaviour), else the resolved `[start, end)` UTC
    bounds. `resolve_period`'s `ValueError` (e.g. `period=custom` missing a
    date) is left to propagate — the route maps it to 422, same as the
    statistics routes already do for their own `resolve_period` call."""
    validate_period_params(
        start=None,
        end=None,
        months_back=None,
        period=period,
        offset=offset,
        start_date=start_date,
        end_date=end_date,
        offset_param_name=offset_param_name,
    )
    if not _period_selector_used(period, offset, start_date, end_date):
        return None
    return resolve_period(period, offset=offset, start_date=start_date, end_date=end_date, tz=tz)
