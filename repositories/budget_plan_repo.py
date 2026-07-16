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
        self, account_id: UUID, category_id: UUID, *, start: datetime, end: datetime
    ) -> float | None:
        """Fill percentage (0.0-100.0+) for the given (account, category) budget
        plan over [start, end). Returns None if no plan exists for that pair,
        or if the plan's amount is non-positive (no meaningful limit to fill).
        """
        row = await self._conn.fetchrow(
            """
            SELECT bp.amount AS limit_amount,
                   COALESCE(SUM(e.amount), 0)::bigint AS spent_amount
            FROM budget_plans bp
            LEFT JOIN expenses e
              ON e.account_id = bp.account_id
             AND e.category_id = bp.category_id
             AND e.created_at >= $3 AND e.created_at < $4
            WHERE bp.account_id = $1 AND bp.category_id = $2
            GROUP BY bp.id
            """,
            account_id,
            category_id,
            start,
            end,
        )
        if row is None or row["limit_amount"] <= 0:
            return None
        return (row["spent_amount"] / row["limit_amount"]) * 100
