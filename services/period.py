"""Shared month-bounds helper (plan Decision log D107) — the single copy
replacing the three duplicated `_current_month_bounds` (MVP D34/D35) that
used to live in budget_service, expense_service and statistics_service."""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo


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
