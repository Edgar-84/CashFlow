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
    """Aggregates the caller's account expenses for the current month.

    ``user_id``, when given, restricts the aggregate to that user's own
    expenses — the route passes it when the caller's permission decision has
    ``own_only`` set on expense reads (mirrors D33's `list_expenses` own_only
    filtering; done here pre-aggregation since these methods return totals,
    not raw records, so there is no post-hoc list to filter — plan Decision
    log D35).
    """

    def __init__(self, expense_repo: ExpensePeriodRepositoryProtocol) -> None:
        self._expense_repo = expense_repo

    async def _expenses(
        self, account_id: UUID, *, user_id: UUID | None, now: datetime | None
    ) -> tuple[list[ExpenseResponse], datetime, datetime]:
        start, end = month_bounds(now)
        expenses = await self._expense_repo.get_by_period(account_id, start, end)
        if user_id is not None:
            expenses = [e for e in expenses if e.user_id == user_id]
        return expenses, start, end

    async def by_period(
        self, account_id: UUID, *, user_id: UUID | None = None, now: datetime | None = None
    ) -> PeriodTotal:
        expenses, start, end = await self._expenses(account_id, user_id=user_id, now=now)
        return PeriodTotal(start=start, end=end, total=sum(e.amount for e in expenses))

    async def by_category(
        self, account_id: UUID, *, user_id: UUID | None = None, now: datetime | None = None
    ) -> list[CategoryTotal]:
        expenses, _, _ = await self._expenses(account_id, user_id=user_id, now=now)
        totals: dict[UUID, int] = defaultdict(int)
        for expense in expenses:
            totals[expense.category_id] += expense.amount
        return [CategoryTotal(category_id=cid, total=total) for cid, total in totals.items()]

    async def by_tag(
        self, account_id: UUID, *, user_id: UUID | None = None, now: datetime | None = None
    ) -> list[TagTotal]:
        expenses, _, _ = await self._expenses(account_id, user_id=user_id, now=now)
        totals: dict[UUID, int] = defaultdict(int)
        for expense in expenses:
            for tag in expense.tags:
                totals[tag.id] += expense.amount
        return [TagTotal(tag_id=tid, total=total) for tid, total in totals.items()]
