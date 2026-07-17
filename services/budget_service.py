from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID

import asyncpg

from models.budget_plan import (
    BudgetPlanCreate,
    BudgetPlanResponse,
    BudgetPlanUpdate,
    BudgetProgress,
)
from models.errors import ConflictError, NotFoundError


class BudgetPlanRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real BudgetPlanRepository."""

    async def list(self, **filters: Any) -> list[BudgetPlanResponse]: ...
    async def get(self, id: UUID) -> BudgetPlanResponse | None: ...
    async def create(self, data: dict[str, Any]) -> BudgetPlanResponse: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> BudgetPlanResponse | None: ...
    async def delete(self, id: UUID) -> bool: ...


class ExpenseSumRepositoryProtocol(Protocol):
    """Narrow slice of ExpenseRepositoryProtocol — the only expense_repo method
    the progress calc needs (services/CLAUDE.md: cross-repo work belongs here)."""

    async def sum_by_category_month(
        self, account_id: UUID, start: datetime, end: datetime
    ) -> dict[UUID, int]: ...


def calculate_progress(
    *,
    budget_plan_id: UUID,
    category_id: UUID,
    spent: int,
    limit: int,
    notify_threshold: int,
) -> BudgetProgress:
    """Pure arithmetic — no I/O. `limit <= 0` has no meaningful fill percentage
    (same guard as BudgetPlanRepository.check_limit, plan Decision log D23)."""
    fill_pct = (spent / limit) * 100 if limit > 0 else None
    return BudgetProgress(
        budget_plan_id=budget_plan_id,
        category_id=category_id,
        amount=limit,
        spent=spent,
        remaining=limit - spent,
        fill_pct=fill_pct,
        notify_threshold=notify_threshold,
        is_over_threshold=fill_pct is not None and fill_pct >= notify_threshold,
        is_exceeded=fill_pct is not None and fill_pct >= 100,
    )


def _current_month_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    """UTC-based month bounds — config has no family-timezone setting yet (same
    gap D20/D23 left for the caller of expense_repo's period methods)."""
    now = now or datetime.now(UTC)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0, day=1)
    end = (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )
    return start, end


class BudgetService:
    """Budget plan CRUD + progress calc, scoped to the calling user's account.

    ``account_id`` is always the authenticated caller's own account, never a
    client-supplied value (root CLAUDE.md: never trust client-supplied UUIDs).
    No own_only/permissions knowledge here — budget_plans has no per-user
    ownership concept in the matrix (api/CLAUDE.md), same as categories/tags.
    """

    def __init__(
        self,
        budget_plan_repo: BudgetPlanRepositoryProtocol,
        expense_repo: ExpenseSumRepositoryProtocol,
    ) -> None:
        self._budget_plan_repo = budget_plan_repo
        self._expense_repo = expense_repo

    async def list(self, account_id: UUID) -> list[BudgetPlanResponse]:
        return await self._budget_plan_repo.list(account_id=account_id)

    async def get(self, budget_plan_id: UUID, account_id: UUID) -> BudgetPlanResponse:
        plan = await self._budget_plan_repo.get(budget_plan_id)
        if plan is None or plan.account_id != account_id:
            raise NotFoundError(f"Budget plan {budget_plan_id} not found")
        return plan

    async def create(self, data: BudgetPlanCreate, account_id: UUID) -> BudgetPlanResponse:
        payload = data.model_dump()
        payload["account_id"] = account_id
        try:
            return await self._budget_plan_repo.create(payload)
        except asyncpg.UniqueViolationError as exc:
            # UNIQUE(category_id, account_id, period) — docs/SCHEMA.sql, plan
            # Decision log D23/D24 flagged this as untranslated; closed here.
            raise ConflictError(
                "A budget plan already exists for this category and period"
            ) from exc

    async def update(
        self, budget_plan_id: UUID, data: BudgetPlanUpdate, account_id: UUID
    ) -> BudgetPlanResponse:
        current = await self.get(budget_plan_id, account_id)  # 404 if missing or foreign
        # amount/period/notify_threshold are all NOT NULL columns with no "clear"
        # semantics (same D30/D32 pattern as users/categories/tags) — an explicit
        # null must not reach the repo as SET amount = NULL etc.
        payload = {
            key: value
            for key, value in data.model_dump(exclude_unset=True).items()
            if value is not None
        }
        if not payload:
            return current
        updated = await self._budget_plan_repo.update(budget_plan_id, payload)
        assert updated is not None
        return updated

    async def delete(self, budget_plan_id: UUID, account_id: UUID) -> None:
        await self.get(budget_plan_id, account_id)  # 404 if missing or foreign
        await self._budget_plan_repo.delete(budget_plan_id)

    async def get_progress(
        self, budget_plan_id: UUID, account_id: UUID, *, now: datetime | None = None
    ) -> BudgetProgress:
        plan = await self.get(budget_plan_id, account_id)  # 404 if missing or foreign
        start, end = _current_month_bounds(now)
        sums = await self._expense_repo.sum_by_category_month(account_id, start=start, end=end)
        spent = sums.get(plan.category_id, 0)
        return calculate_progress(
            budget_plan_id=plan.id,
            category_id=plan.category_id,
            spent=spent,
            limit=plan.amount,
            notify_threshold=plan.notify_threshold,
        )
