"""Shared period-param validation (plan mini-app-v4 Decision log D403) —
extracted from `api/statistics.py::_validate_period` so every router that
takes period-selector query params validates identically instead of
maintaining its own copy that can drift into a different 422 message for
the same mistake."""

from datetime import date, datetime

from fastapi import HTTPException, status

from models.enums import PeriodUnit


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
    under `period=custom`, `offset` combined with `period=custom`,
    `start_date > end_date` — are left to `resolve_period`; its `ValueError`
    is mapped to 422 by the routes. This function only rejects combinations
    `resolve_period` never sees: cross-family conflicts, and
    `offset`/`start_date`/`end_date` used without the `period` they require.
    """
    period_selector_used = (
        period is not None or offset != 0 or start_date is not None or end_date is not None
    )
    families_used = sum(
        [period_selector_used, months_back is not None, start is not None or end is not None]
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
    if (start_date is not None or end_date is not None) and period != PeriodUnit.CUSTOM:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="start_date/end_date require period=custom",
        )
    if start is not None and end is not None and start >= end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="start must be before end"
        )
