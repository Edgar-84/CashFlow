"""Read-only aggregation over the caller's account expenses, current month only
(services/CLAUDE.md: "statistics_service.py — aggregation by period / category /
tag")."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Protocol
from uuid import UUID

from models.enums import PeriodUnit
from models.expense import ExpenseResponse
from models.statistics import CategoryTotal, PeriodTotal, TagTotal
from services.period import month_bounds, resolve_period


def _month_start_before(edge: datetime, tz: str) -> datetime:
    """The UTC-aware start of the calendar month strictly before `edge`
    (itself a UTC-aware month boundary) — asks `month_bounds` for the month
    containing the instant just before `edge`, reusing its family-tz/DST-aware
    arithmetic instead of duplicating it."""
    start, _ = month_bounds(edge - timedelta(microseconds=1), tz)
    return start


def _window_for_months_back(
    months_back: int | None, now: datetime | None, tz: str
) -> tuple[datetime, datetime]:
    """Family-tz-correct bounds for the `months_back` preset (API Contracts,
    plan Decision log D207): 0/None = current month, 1 = last month only,
    2 = the three months before the current one. Closes D120 — the bot
    previously computed "last month"/"last 3 months" bounds in plain UTC
    because it has no access to family-tz-aware month arithmetic without
    importing `services/` (forbidden, bot/CLAUDE.md)."""
    this_start, this_end = month_bounds(now, tz)
    if not months_back:
        return this_start, this_end
    one_back = _month_start_before(this_start, tz)
    if months_back == 1:
        return one_back, this_start
    two_back = _month_start_before(one_back, tz)
    three_back = _month_start_before(two_back, tz)
    return three_back, this_start


class ExpensePeriodRepositoryProtocol(Protocol):
    """Narrow slice of ExpenseRepositoryProtocol — the only expense_repo method
    needed here. `get_by_period` already attaches tags (repositories/CLAUDE.md,
    plan Decision log D21), which is enough to derive all three aggregates
    without a new repo method (plan Decision log D35)."""

    async def get_by_period(
        self, account_id: UUID, start: datetime, end: datetime, *, tz: str = "UTC"
    ) -> list[ExpenseResponse]: ...


class StatisticsService:
    """Aggregates the caller's account expenses for a period (default: the
    current family-timezone month).

    ``user_id``, when given, restricts the aggregate to that user's own
    expenses — the route passes it when the caller's permission decision has
    ``own_only`` set on expense reads (mirrors D33's `list_expenses` own_only
    filtering; done here pre-aggregation since these methods return totals,
    not raw records, so there is no post-hoc list to filter — plan Decision
    log D35).
    """

    def __init__(
        self, expense_repo: ExpensePeriodRepositoryProtocol, family_tz: str = "UTC"
    ) -> None:
        self._expense_repo = expense_repo
        self._family_tz = family_tz

    async def _expenses(
        self,
        account_id: UUID,
        *,
        user_id: UUID | None,
        now: datetime | None,
        start: datetime | None = None,
        end: datetime | None = None,
        months_back: int | None = None,
        period: PeriodUnit | None = None,
        offset: int = 0,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> tuple[list[ExpenseResponse], datetime, datetime]:
        """Resolves whichever selector family the caller populated (the route
        enforces at most one, per API Contracts D313): caller-supplied
        `start`/`end` win first, exactly as before; otherwise a `period`
        selector (with `offset`, or `start_date`/`end_date` under
        `period=custom`) goes through `resolve_period`; otherwise
        `_window_for_months_back(months_back, now, family_tz)` — which in turn
        reproduces `month_bounds(now, family_tz)` when `months_back` is also
        omitted, so passing nothing at all is unchanged."""
        if start is not None or end is not None:
            default_start, default_end = _window_for_months_back(months_back, now, self._family_tz)
            period_start = start if start is not None else default_start
            period_end = end if end is not None else default_end
        elif period is not None or offset != 0 or start_date is not None or end_date is not None:
            period_start, period_end = resolve_period(
                period,
                offset=offset,
                start_date=start_date,
                end_date=end_date,
                now=now,
                tz=self._family_tz,
            )
        else:
            period_start, period_end = _window_for_months_back(months_back, now, self._family_tz)
        expenses = await self._expense_repo.get_by_period(
            account_id, period_start, period_end, tz=self._family_tz
        )
        if user_id is not None:
            expenses = [e for e in expenses if e.user_id == user_id]
        return expenses, period_start, period_end

    async def by_period(
        self,
        account_id: UUID,
        *,
        user_id: UUID | None = None,
        now: datetime | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
        months_back: int | None = None,
        period: PeriodUnit | None = None,
        offset: int = 0,
        start_date: date | None = None,
        end_date: date | None = None,
        category_id: UUID | None = None,
        tag_id: UUID | None = None,
    ) -> PeriodTotal:
        expenses, period_start, period_end = await self._expenses(
            account_id,
            user_id=user_id,
            now=now,
            start=start,
            end=end,
            months_back=months_back,
            period=period,
            offset=offset,
            start_date=start_date,
            end_date=end_date,
        )
        if category_id is not None:
            expenses = [e for e in expenses if e.category_id == category_id]
        if tag_id is not None:
            expenses = [e for e in expenses if any(tag.id == tag_id for tag in e.tags)]
        return PeriodTotal(
            start=period_start, end=period_end, total=sum(e.amount for e in expenses)
        )

    async def by_category(
        self,
        account_id: UUID,
        *,
        user_id: UUID | None = None,
        now: datetime | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
        months_back: int | None = None,
        period: PeriodUnit | None = None,
        offset: int = 0,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[CategoryTotal]:
        expenses, _, _ = await self._expenses(
            account_id,
            user_id=user_id,
            now=now,
            start=start,
            end=end,
            months_back=months_back,
            period=period,
            offset=offset,
            start_date=start_date,
            end_date=end_date,
        )
        totals: dict[UUID, int] = defaultdict(int)
        for expense in expenses:
            totals[expense.category_id] += expense.amount
        return [CategoryTotal(category_id=cid, total=total) for cid, total in totals.items()]

    async def by_tag(
        self,
        account_id: UUID,
        *,
        user_id: UUID | None = None,
        now: datetime | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
        months_back: int | None = None,
        period: PeriodUnit | None = None,
        offset: int = 0,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[TagTotal]:
        expenses, _, _ = await self._expenses(
            account_id,
            user_id=user_id,
            now=now,
            start=start,
            end=end,
            months_back=months_back,
            period=period,
            offset=offset,
            start_date=start_date,
            end_date=end_date,
        )
        totals: dict[UUID, int] = defaultdict(int)
        for expense in expenses:
            for tag in expense.tags:
                totals[tag.id] += expense.amount
        return [TagTotal(tag_id=tid, total=total) for tid, total in totals.items()]
