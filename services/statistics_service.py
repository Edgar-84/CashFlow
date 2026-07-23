"""Read-only aggregation over the caller's account expenses, current month only
(services/CLAUDE.md: "statistics_service.py — aggregation by period / category /
tag")."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Protocol
from uuid import UUID

from models.expense import ExpenseResponse
from models.statistics import CategoryTotal, PeriodTotal, TagTotal
from services.period import month_bounds


class ExpensePeriodRepositoryProtocol(Protocol):
    """Narrow slice of ExpenseRepositoryProtocol — the only expense_repo method
    needed here. `get_by_period` already attaches tags (repositories/CLAUDE.md,
    plan Decision log D21), which is enough to derive all three aggregates
    without a new repo method (plan Decision log D35)."""

    async def get_by_period(
        self, account_id: UUID, start: datetime, end: datetime
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
    ) -> tuple[list[ExpenseResponse], datetime, datetime]:
        """Caller-supplied `start`/`end` win over the default family-timezone
        current month; each bound defaults independently, so passing neither
        reproduces `month_bounds(now, family_tz)` exactly."""
        default_start, default_end = month_bounds(now, self._family_tz)
        period_start = start if start is not None else default_start
        period_end = end if end is not None else default_end
        expenses = await self._expense_repo.get_by_period(account_id, period_start, period_end)
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
        category_id: UUID | None = None,
        tag_id: UUID | None = None,
    ) -> PeriodTotal:
        expenses, period_start, period_end = await self._expenses(
            account_id, user_id=user_id, now=now, start=start, end=end
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
    ) -> list[CategoryTotal]:
        expenses, _, _ = await self._expenses(
            account_id, user_id=user_id, now=now, start=start, end=end
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
    ) -> list[TagTotal]:
        expenses, _, _ = await self._expenses(
            account_id, user_id=user_id, now=now, start=start, end=end
        )
        totals: dict[UUID, int] = defaultdict(int)
        for expense in expenses:
            for tag in expense.tags:
                totals[tag.id] += expense.amount
        return [TagTotal(tag_id=tid, total=total) for tid, total in totals.items()]
