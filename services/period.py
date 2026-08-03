"""Shared month-bounds helper (plan Decision log D107) — the single copy
replacing the three duplicated `_current_month_bounds` (MVP D34/D35) that
used to live in budget_service, expense_service and statistics_service.

Also home to `resolve_period` (mini-app-v3 plan, D300/D303), which resolves
every named period — day, month-shaped, and custom range — into the same
[start, end) UTC-aware shape `month_bounds` already returns."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from models.enums import PeriodPreset

MAX_RANGE_DAYS = 366


def month_bounds(now: datetime | None = None, tz: str = "UTC") -> tuple[datetime, datetime]:
    """Current-month bounds, family-timezone-correct, returned as UTC-aware
    datetimes (comparable with the UTC timestamps repositories store).

    The month is determined by `now`'s wall-clock time in `tz` — a UTC
    instant that's still the 31st in UTC but already the 1st in a UTC+N
    family timezone belongs to the new month. `now` defaults to the current
    instant; if given, it must be tz-aware (a naive datetime has no defined
    instant to convert into `tz`, so it's rejected rather than silently
    assumed to be UTC or local).
    """
    if now is not None and now.tzinfo is None:
        raise ValueError("month_bounds requires a tz-aware `now` (or None)")
    now = now or datetime.now(UTC)
    local_now = now.astimezone(ZoneInfo(tz))
    start_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0, day=1)
    end_local = (
        start_local.replace(year=start_local.year + 1, month=1)
        if start_local.month == 12
        else start_local.replace(month=start_local.month + 1)
    )
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def _month_start_before(edge: datetime, tz: str) -> datetime:
    """The UTC-aware start of the calendar month strictly before `edge`
    (itself a UTC-aware month boundary) — asks `month_bounds` for the month
    containing the instant just before `edge`, reusing its family-tz/DST-aware
    arithmetic instead of duplicating it."""
    start, _ = month_bounds(edge - timedelta(microseconds=1), tz)
    return start


def _local_midnight(d: date, tz: str) -> datetime:
    """The tz-aware instant of local midnight on calendar date `d`."""
    return datetime(d.year, d.month, d.day, tzinfo=ZoneInfo(tz))


def _day_bounds(d: date, tz: str) -> tuple[datetime, datetime]:
    """UTC-aware `[start, end)` for one wall-clock day `d` in `tz`. Each
    midnight is localized independently (not derived by adding a 24h
    `timedelta` to the other) so a DST transition inside the day correctly
    yields a 23h or 25h UTC span rather than a wrong wall-clock end time."""
    start_local = _local_midnight(d, tz)
    end_local = _local_midnight(d + timedelta(days=1), tz)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def resolve_period(
    preset: PeriodPreset | None,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    now: datetime | None = None,
    tz: str = "UTC",
) -> tuple[datetime, datetime]:
    """Resolve a named period into `[start, end)` UTC-aware bounds — the same
    shape `month_bounds` returns and `expense_repo.get_by_period` expects
    (mini-app-v3 plan, D300/D303).

    `preset=None` reproduces today's behaviour byte-for-byte: the current
    family month, via `month_bounds`. The three month-shaped presets delegate
    to `month_bounds` rather than re-deriving month arithmetic. Day presets
    and `CUSTOM` resolve wall-clock midnights in `tz`; `end_date` is inclusive
    of its whole local day, so the actual UTC `end` is the *following* local
    midnight.
    """
    if now is not None and now.tzinfo is None:
        raise ValueError("resolve_period requires a tz-aware `now` (or None)")
    now = now or datetime.now(UTC)

    if preset is None or preset == PeriodPreset.THIS_MONTH:
        return month_bounds(now, tz)

    if preset == PeriodPreset.LAST_MONTH:
        this_start, _ = month_bounds(now, tz)
        one_back = _month_start_before(this_start, tz)
        return one_back, this_start

    if preset == PeriodPreset.LAST_3_MONTHS:
        this_start, _ = month_bounds(now, tz)
        one_back = _month_start_before(this_start, tz)
        two_back = _month_start_before(one_back, tz)
        three_back = _month_start_before(two_back, tz)
        return three_back, this_start

    if preset == PeriodPreset.TODAY:
        today = now.astimezone(ZoneInfo(tz)).date()
        return _day_bounds(today, tz)

    if preset == PeriodPreset.YESTERDAY:
        yesterday = now.astimezone(ZoneInfo(tz)).date() - timedelta(days=1)
        return _day_bounds(yesterday, tz)

    if start_date is None or end_date is None:
        raise ValueError("period=custom requires both start_date and end_date")
    if start_date > end_date:
        raise ValueError("period=custom requires start_date <= end_date")
    if (end_date - start_date).days + 1 > MAX_RANGE_DAYS:
        raise ValueError(f"period=custom range exceeds the {MAX_RANGE_DAYS}-day maximum")

    start, _ = _day_bounds(start_date, tz)
    _, end = _day_bounds(end_date, tz)
    return start, end
