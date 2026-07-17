import logging
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID

from models.budget_plan import BudgetPlanResponse
from models.category import CategoryResponse
from models.errors import NotFoundError
from models.expense import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from models.user import UserResponse

logger = logging.getLogger(__name__)


class ExpenseRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real ExpenseRepository."""

    async def list(self, **filters: Any) -> list[ExpenseResponse]: ...
    async def get(self, id: UUID) -> ExpenseResponse | None: ...
    async def create(self, data: dict[str, Any]) -> ExpenseResponse: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> ExpenseResponse | None: ...
    async def delete(self, id: UUID) -> bool: ...


class BudgetPlanQueryRepositoryProtocol(Protocol):
    """Narrow slice of budget_plan_repo — just enough for the notification
    check (services/CLAUDE.md's notification-flow invariant): `check_limit`
    for the fill percentage, `list` to recover the plan's `notify_threshold`
    (which `check_limit` itself doesn't return, plan Decision log D23)."""

    async def check_limit(
        self, account_id: UUID, category_id: UUID, *, start: datetime, end: datetime
    ) -> float | None: ...
    async def list(self, **filters: Any) -> list[BudgetPlanResponse]: ...


class CategoryLookupRepositoryProtocol(Protocol):
    """Narrow slice of category_repo — just enough to name the category in
    the notification message."""

    async def get(self, id: UUID) -> CategoryResponse | None: ...


class NotificationSenderProtocol(Protocol):
    """Duck-typed interface for notification_service (tests/CLAUDE.md) — lets
    unit tests pass an in-memory fake instead of the real NotificationService,
    same pattern as the repository protocols above."""

    async def send(
        self, user: UserResponse, category: CategoryResponse, fill_pct: float
    ) -> None: ...


def _current_month_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    """Same convention as services.budget_service._current_month_bounds (D34) —
    UTC-based, config has no family-timezone setting yet."""
    now = now or datetime.now(UTC)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0, day=1)
    end = (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )
    return start, end


class ExpenseService:
    """Expense CRUD, scoped to the calling user's account.

    ``account_id`` is always the authenticated caller's own account, never a
    client-supplied value (root CLAUDE.md: never trust client-supplied
    UUIDs) — callers (routes) pass it explicitly. Ownership enforcement
    (``own_only``, step 6 of the permission matrix) is the route's job via
    ``api.deps.enforce_ownership`` — this service has no notion of
    permissions or the acting user's role.
    """

    def __init__(
        self,
        expense_repo: ExpenseRepositoryProtocol,
        budget_plan_repo: BudgetPlanQueryRepositoryProtocol,
        category_repo: CategoryLookupRepositoryProtocol,
        notification_service: NotificationSenderProtocol,
    ) -> None:
        self._expense_repo = expense_repo
        self._budget_plan_repo = budget_plan_repo
        self._category_repo = category_repo
        self._notification_service = notification_service

    async def list(self, account_id: UUID) -> list[ExpenseResponse]:
        return await self._expense_repo.list(account_id=account_id)

    async def get(self, expense_id: UUID, account_id: UUID) -> ExpenseResponse:
        expense = await self._expense_repo.get(expense_id)
        if expense is None or expense.account_id != account_id:
            raise NotFoundError(f"Expense {expense_id} not found")
        return expense

    async def create(self, data: ExpenseCreate, user: UserResponse) -> ExpenseResponse:
        payload = data.model_dump()
        payload["account_id"] = user.account_id
        payload["user_id"] = user.id
        expense = await self._expense_repo.create(payload)
        await self._check_budget_and_notify(expense, user)
        return expense

    async def _check_budget_and_notify(self, expense: ExpenseResponse, user: UserResponse) -> None:
        """services/CLAUDE.md notification-flow invariant, steps 2-3.

        Wrapped in a blanket try/except: root CLAUDE.md's best-effort rule
        ("send failures... must never fail the expense operation that
        triggered it") is applied to the whole check, not just the HTTP send
        inside NotificationService — a DB hiccup on the budget/category
        lookup must not undo an expense that already committed.
        """
        try:
            start, end = _current_month_bounds()
            fill_pct = await self._budget_plan_repo.check_limit(
                user.account_id, expense.category_id, start=start, end=end
            )
            if fill_pct is None:
                return
            # At most one row for (account_id, category_id) today: DB UNIQUE
            # (category_id, account_id, period) + Period = Literal["monthly"]
            # means there's only ever one period value. Revisit plans[0] if
            # Period ever grows more values (plan Decision log D23).
            plans = await self._budget_plan_repo.list(
                account_id=user.account_id, category_id=expense.category_id
            )
            if not plans or fill_pct < plans[0].notify_threshold:
                return
            # No account_id check here: category_repo.get() alone gives no
            # ownership guarantee. check_limit()/list() above only scoped the
            # *budget_plan* row to (account_id, category_id) — they don't
            # prove the category itself belongs to this account, since
            # neither ExpenseService.create nor BudgetService.create validates
            # category_id against the caller's account (pre-existing gap,
            # D23/D33, not fixed here). Worst case on a foreign category_id:
            # its name appears in a notification for an unrelated account —
            # no cross-account expense/budget data is exposed.
            category = await self._category_repo.get(expense.category_id)
            if category is None:
                return
            await self._notification_service.send(user, category, fill_pct)
        except Exception:
            logger.exception(
                "Budget notification check failed",
                extra={"expense_id": str(expense.id), "account_id": str(user.account_id)},
            )

    async def update(
        self, expense_id: UUID, data: ExpenseUpdate, account_id: UUID
    ) -> ExpenseResponse:
        current = await self.get(expense_id, account_id)  # 404 if missing or foreign
        payload = data.model_dump(exclude_unset=True)
        # amount/category_id are NOT NULL columns with no "clear" semantics
        # (D30/D32 pattern) — an explicit null must not reach the repo as
        # SET amount = NULL. comment IS nullable (docs/SCHEMA.sql), so an
        # explicit null there is a real "clear the comment", not dropped.
        # tag_ids has no NOT NULL constraint either (junction table) — the
        # repo already treats an explicit null the same as omitted.
        for key in ("amount", "category_id"):
            if key in payload and payload[key] is None:
                del payload[key]
        if not payload:
            return current
        updated = await self._expense_repo.update(expense_id, payload)
        assert updated is not None
        return updated

    async def delete(self, expense_id: UUID, account_id: UUID) -> None:
        await self.get(expense_id, account_id)  # 404 if missing or foreign
        await self._expense_repo.delete(expense_id)
