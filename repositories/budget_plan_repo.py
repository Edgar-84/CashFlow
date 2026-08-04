from __future__ import annotations

from datetime import datetime
from uuid import UUID

import asyncpg

from models.budget_plan import BudgetPlanResponse
from repositories.base import BaseRepository


class BudgetPlanRepository(BaseRepository[BudgetPlanResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="budget_plans", model=BudgetPlanResponse)

    async def check_limit(
        self,
        account_id: UUID,
        category_id: UUID,
        *,
        start: datetime,
        end: datetime,
        tz: str = "UTC",
    ) -> float | None:
        """Fill percentage (0.0-100.0+) for the given (account, category) budget
        plan over [start, end). Returns None if no plan exists for that pair,
        or if the plan's amount is non-positive (no meaningful limit to fill).

        Counts expenses by spent_at (the day the expense happened), not
        created_at — a backdated expense counts toward the budget of the
        month it was spent in, not the month it was typed in (D314).
        spent_at is a bare DATE; start/end are UTC instants representing
        local midnight in `tz`, so they are converted back to `tz`'s
        wall-clock date before comparison (D323 — see expense_repo.
        get_by_period's comment for why a raw UTC-date comparison is wrong).
        """
        row = await self._conn.fetchrow(
            """
            SELECT bp.amount AS limit_amount,
                   COALESCE(SUM(e.amount), 0)::bigint AS spent_amount
            FROM budget_plans bp
            LEFT JOIN expenses e
              ON e.account_id = bp.account_id
             AND e.category_id = bp.category_id
             AND e.spent_at >= ($3 AT TIME ZONE $5)::date
             AND e.spent_at <  ($4 AT TIME ZONE $5)::date
            WHERE bp.account_id = $1 AND bp.category_id = $2
            GROUP BY bp.id
            """,
            account_id,
            category_id,
            start,
            end,
            tz,
        )
        if row is None or row["limit_amount"] <= 0:
            return None
        return (row["spent_amount"] / row["limit_amount"]) * 100
