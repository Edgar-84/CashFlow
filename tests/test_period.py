"""Unit tests for services/period.py — pure logic, no DB (tests/CLAUDE.md).

Single shared home for the month-bounds tests previously duplicated across
test_budget_service.py, test_expense_service.py and test_statistics_service.py
(plan Decision log D107). Also covers `resolve_period` (mini-app-v3 plan,
D300/D303)."""

from datetime import UTC, date, datetime, timedelta

import pytest

from models.enums import PeriodPreset
from services.period import MAX_RANGE_DAYS, month_bounds, resolve_period


@pytest.mark.parametrize(
    "now, expected_start, expected_end",
    [
        (
            datetime(2026, 7, 17, 13, 45, 30, tzinfo=UTC),
            datetime(2026, 7, 1, tzinfo=UTC),
            datetime(2026, 8, 1, tzinfo=UTC),
        ),
        (
            # December -> January year rollover.
            datetime(2026, 12, 31, 23, 59, 59, tzinfo=UTC),
            datetime(2026, 12, 1, tzinfo=UTC),
            datetime(2027, 1, 1, tzinfo=UTC),
        ),
    ],
)
def test_month_bounds_default_utc(
    now: datetime, expected_start: datetime, expected_end: datetime
) -> None:
    start, end = month_bounds(now)

    assert start == expected_start
    assert end == expected_end


def test_month_bounds_family_tz_evening_of_31st_rolls_to_next_month() -> None:
    # 2026-07-31 22:00 UTC is already 2026-08-01 01:00 in Europe/Moscow
    # (UTC+3, no DST) -- the family's "current month" must be August, even
    # though a naive UTC read would still say July.
    now = datetime(2026, 7, 31, 22, 0, tzinfo=UTC)

    start, end = month_bounds(now, tz="Europe/Moscow")

    assert start == datetime(2026, 7, 31, 21, 0, tzinfo=UTC)  # Aug 1 00:00 Moscow
    assert end == datetime(2026, 8, 31, 21, 0, tzinfo=UTC)  # Sep 1 00:00 Moscow


def test_month_bounds_naive_now_rejected() -> None:
    with pytest.raises(ValueError):
        month_bounds(datetime(2026, 7, 17, 13, 45, 30))


# --- resolve_period ---------------------------------------------------------
# `now` = 2026-07-17 12:00 Europe/Belgrade (CEST, UTC+2) throughout, so every
# preset's window is checked against hand-computed UTC bounds, not re-derived
# via the function under test.

BELGRADE = "Europe/Belgrade"
_NOW = datetime(2026, 7, 17, 10, 0, tzinfo=UTC)  # 2026-07-17 12:00 Belgrade


def test_resolve_period_none_matches_month_bounds() -> None:
    assert resolve_period(None, now=_NOW, tz=BELGRADE) == month_bounds(_NOW, BELGRADE)


def test_resolve_period_this_month() -> None:
    start, end = resolve_period(PeriodPreset.THIS_MONTH, now=_NOW, tz=BELGRADE)

    assert start == datetime(2026, 6, 30, 22, 0, tzinfo=UTC)  # Jul 1 00:00 Belgrade
    assert end == datetime(2026, 7, 31, 22, 0, tzinfo=UTC)  # Aug 1 00:00 Belgrade


def test_resolve_period_last_month() -> None:
    start, end = resolve_period(PeriodPreset.LAST_MONTH, now=_NOW, tz=BELGRADE)

    assert start == datetime(2026, 5, 31, 22, 0, tzinfo=UTC)  # Jun 1 00:00 Belgrade
    assert end == datetime(2026, 6, 30, 22, 0, tzinfo=UTC)  # Jul 1 00:00 Belgrade


def test_resolve_period_last_3_months() -> None:
    start, end = resolve_period(PeriodPreset.LAST_3_MONTHS, now=_NOW, tz=BELGRADE)

    # April + May + June — the three months strictly before the current one.
    assert start == datetime(2026, 3, 31, 22, 0, tzinfo=UTC)  # Apr 1 00:00 Belgrade
    assert end == datetime(2026, 6, 30, 22, 0, tzinfo=UTC)  # Jul 1 00:00 Belgrade


def test_resolve_period_today() -> None:
    start, end = resolve_period(PeriodPreset.TODAY, now=_NOW, tz=BELGRADE)

    assert start == datetime(2026, 7, 16, 22, 0, tzinfo=UTC)  # Jul 17 00:00 Belgrade
    assert end == datetime(2026, 7, 17, 22, 0, tzinfo=UTC)  # Jul 18 00:00 Belgrade


def test_resolve_period_yesterday() -> None:
    start, end = resolve_period(PeriodPreset.YESTERDAY, now=_NOW, tz=BELGRADE)

    assert start == datetime(2026, 7, 15, 22, 0, tzinfo=UTC)  # Jul 16 00:00 Belgrade
    assert end == datetime(2026, 7, 16, 22, 0, tzinfo=UTC)  # Jul 17 00:00 Belgrade


def test_resolve_period_today_uses_local_date_not_utc_date() -> None:
    # 2026-08-01 03:30 UTC is still 2026-07-31 23:30 in America/New_York
    # (EDT, UTC-4) -- "today" must be the last day of July, not August 1st,
    # which a naive UTC-date read would report.
    now = datetime(2026, 8, 1, 3, 30, tzinfo=UTC)

    start, end = resolve_period(PeriodPreset.TODAY, now=now, tz="America/New_York")

    assert start == datetime(2026, 7, 31, 4, 0, tzinfo=UTC)  # Jul 31 00:00 New York
    assert end == datetime(2026, 8, 1, 4, 0, tzinfo=UTC)  # Aug 1 00:00 New York


def test_resolve_period_custom_single_day_spans_24h() -> None:
    start, end = resolve_period(
        PeriodPreset.CUSTOM,
        start_date=date(2026, 7, 9),
        end_date=date(2026, 7, 9),
        now=_NOW,
        tz=BELGRADE,
    )

    assert start == datetime(2026, 7, 8, 22, 0, tzinfo=UTC)  # Jul 9 00:00 Belgrade
    assert end == datetime(2026, 7, 9, 22, 0, tzinfo=UTC)  # Jul 10 00:00 Belgrade
    assert end - start == timedelta(hours=24)


def test_resolve_period_custom_range_inclusive_of_end_date() -> None:
    start, end = resolve_period(
        PeriodPreset.CUSTOM,
        start_date=date(2026, 7, 9),
        end_date=date(2026, 7, 17),
        now=_NOW,
        tz=BELGRADE,
    )

    assert start == datetime(2026, 7, 8, 22, 0, tzinfo=UTC)  # Jul 9 00:00 Belgrade
    assert end == datetime(2026, 7, 17, 22, 0, tzinfo=UTC)  # Jul 18 00:00 Belgrade — the
    # day AFTER end_date, since end_date is inclusive of its whole local day.


@pytest.mark.parametrize(
    "day, expected_hours",
    [
        (date(2026, 3, 29), 23),  # Belgrade spring-forward: 02:00 -> 03:00
        (date(2026, 10, 25), 25),  # Belgrade fall-back: 03:00 -> 02:00
    ],
)
def test_resolve_period_custom_single_day_across_dst_switch(day: date, expected_hours: int) -> None:
    start, end = resolve_period(
        PeriodPreset.CUSTOM, start_date=day, end_date=day, now=_NOW, tz=BELGRADE
    )

    assert (end - start).total_seconds() / 3600 == expected_hours


def test_resolve_period_custom_missing_end_date_raises() -> None:
    with pytest.raises(ValueError):
        resolve_period(PeriodPreset.CUSTOM, start_date=date(2026, 7, 9), now=_NOW, tz=BELGRADE)


def test_resolve_period_custom_missing_start_date_raises() -> None:
    with pytest.raises(ValueError):
        resolve_period(PeriodPreset.CUSTOM, end_date=date(2026, 7, 9), now=_NOW, tz=BELGRADE)


def test_resolve_period_custom_reversed_dates_raises() -> None:
    with pytest.raises(ValueError):
        resolve_period(
            PeriodPreset.CUSTOM,
            start_date=date(2026, 7, 17),
            end_date=date(2026, 7, 9),
            now=_NOW,
            tz=BELGRADE,
        )


def test_resolve_period_custom_max_range_days_is_allowed() -> None:
    start_date = date(2026, 1, 1)
    end_date = start_date + timedelta(days=MAX_RANGE_DAYS - 1)  # inclusive span = MAX_RANGE_DAYS

    start, end = resolve_period(
        PeriodPreset.CUSTOM, start_date=start_date, end_date=end_date, now=_NOW, tz=BELGRADE
    )

    assert start < end


def test_resolve_period_custom_over_max_range_days_raises() -> None:
    start_date = date(2026, 1, 1)
    end_date = start_date + timedelta(days=MAX_RANGE_DAYS)  # inclusive span = MAX_RANGE_DAYS + 1

    with pytest.raises(ValueError):
        resolve_period(
            PeriodPreset.CUSTOM, start_date=start_date, end_date=end_date, now=_NOW, tz=BELGRADE
        )


def test_resolve_period_naive_now_rejected() -> None:
    with pytest.raises(ValueError):
        resolve_period(
            PeriodPreset.TODAY,
            now=datetime(2026, 7, 17, 13, 45, 30),
            tz=BELGRADE,
        )
