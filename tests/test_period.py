"""Unit tests for services/period.py — pure logic, no DB (tests/CLAUDE.md).

Single shared home for the month-bounds tests previously duplicated across
test_budget_service.py, test_expense_service.py and test_statistics_service.py
(plan Decision log D107)."""

from datetime import UTC, datetime

import pytest

from services.period import month_bounds


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
