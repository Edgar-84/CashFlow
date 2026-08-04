"""Shared month-bounds helper (plan Decision log D107) — the single copy
replacing the three duplicated `_current_month_bounds` (MVP D34/D35) that
used to live in budget_service, expense_service and statistics_service.

Also home to `resolve_period` (mini-app-v3 plan, D313), which resolves a
`PeriodUnit` + `offset` pair — day/week/month/year shapes plus a custom
range — into the same [start, end) UTC-aware shape `month_bounds` already
returns."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from models.enums import PeriodUnit

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


def _shift_month(local_dt: datetime, months: int) -> datetime:
    """Local midnight on the 1st of the calendar month `months` away from
    `local_dt`'s month (0 = `local_dt`'s own month, negative = back). Pure
    calendar arithmetic on `(year, month)`, so it reproduces `month_bounds`'s
    own start/end exactly at `months=0`/`months=1`."""
    total = local_dt.year * 12 + (local_dt.month - 1) + months
    year, month0 = divmod(total, 12)
    return local_dt.replace(
        year=year, month=month0 + 1, day=1, hour=0, minute=0, second=0, microsecond=0
    )


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
    unit: PeriodUnit | None,
    *,
    offset: int = 0,
    start_date: date | None = None,
    end_date: date | None = None,
    now: datetime | None = None,
    tz: str = "UTC",
) -> tuple[datetime, datetime]:
    """Resolve a `PeriodUnit` + `offset` pair into `[start, end)` UTC-aware
    bounds — the same shape `month_bounds` returns and
    `expense_repo.get_by_period` expects (mini-app-v3 plan, D313).

    `unit=None` reproduces today's behaviour byte-for-byte: the current
    family month, via `month_bounds`. `offset` is `<= 0` for every other
    unit — `0` is the current day/week/month/year, `-1` the previous one, and
    so on; the future is unreachable here, not merely disabled client-side.
    `CUSTOM` resolves wall-clock midnights in `tz` and forbids a non-zero
    `offset`; `end_date` is inclusive of its whole local day, so the actual
    UTC `end` is the *following* local midnight. Weeks start Monday (D315).
    """
    if now is not None and now.tzinfo is None:
        raise ValueError("resolve_period requires a tz-aware `now` (or None)")
    now = now or datetime.now(UTC)

    if unit is None:
        return month_bounds(now, tz)

    if unit == PeriodUnit.CUSTOM:
        if offset != 0:
            raise ValueError("period=custom forbids a non-zero offset")
        if start_date is None or end_date is None:
            raise ValueError("period=custom requires both start_date and end_date")
        if start_date > end_date:
            raise ValueError("period=custom requires start_date <= end_date")
        if (end_date - start_date).days + 1 > MAX_RANGE_DAYS:
            raise ValueError(f"period=custom range exceeds the {MAX_RANGE_DAYS}-day maximum")

        start, _ = _day_bounds(start_date, tz)
        _, end = _day_bounds(end_date, tz)
        return start, end

    if offset > 0:
        raise ValueError("resolve_period: offset must be <= 0 — the future is unreachable")

    local_now = now.astimezone(ZoneInfo(tz))

    if unit == PeriodUnit.DAY:
        target_day = local_now.date() + timedelta(days=offset)
        return _day_bounds(target_day, tz)

    if unit == PeriodUnit.WEEK:
        monday_this_week = local_now.date() - timedelta(days=local_now.weekday())
        target_monday = monday_this_week + timedelta(weeks=offset)
        start_local = _local_midnight(target_monday, tz)
        end_local = _local_midnight(target_monday + timedelta(days=7), tz)
        return start_local.astimezone(UTC), end_local.astimezone(UTC)

    if unit == PeriodUnit.MONTH:
        start_local = _shift_month(local_now, offset)
        end_local = _shift_month(local_now, offset + 1)
        return start_local.astimezone(UTC), end_local.astimezone(UTC)

    # PeriodUnit.YEAR
    year = local_now.year + offset
    start_local = local_now.replace(
        year=year, month=1, day=1, hour=0, minute=0, second=0, microsecond=0
    )
    end_local = local_now.replace(
        year=year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0
    )
    return start_local.astimezone(UTC), end_local.astimezone(UTC)
