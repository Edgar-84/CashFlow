import logging
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID

from models.budget_plan import BudgetPlanResponse
from models.category import CategoryResponse
from models.errors import NotFoundError
from models.expense import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from models.tag import TagResponse
from models.user import UserResponse
from services.period import month_bounds

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
    """Narrow slice of category_repo — names the category in the
    notification message AND (U1.1) verifies `category_id` on create/update
    belongs to the caller's account."""

    async def get(self, id: UUID) -> CategoryResponse | None: ...


class TagLookupRepositoryProtocol(Protocol):
    """Narrow slice of tag_repo — just enough to verify each `tag_ids` entry
    on create/update belongs to the caller's account (plan Decision log
    D113, closes MVP D33)."""

    async def get(self, id: UUID) -> TagResponse | None: ...


class NotificationSenderProtocol(Protocol):
    """Duck-typed interface for notification_service (tests/CLAUDE.md) — lets
    unit tests pass an in-memory fake instead of the real NotificationService,
    same pattern as the repository protocols above."""

    async def send(
        self, user: UserResponse, category: CategoryResponse, fill_pct: float
    ) -> None: ...


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
        tag_repo: TagLookupRepositoryProtocol,
        notification_service: NotificationSenderProtocol,
    ) -> None:
        self._expense_repo = expense_repo
        self._budget_plan_repo = budget_plan_repo
        self._category_repo = category_repo
        self._tag_repo = tag_repo
        self._notification_service = notification_service

    async def get(self, expense_id: UUID, account_id: UUID) -> ExpenseResponse:
        expense = await self._expense_repo.get(expense_id)
        if expense is None or expense.account_id != account_id:
            raise NotFoundError(f"Expense {expense_id} not found")
        return expense

    async def create(self, data: ExpenseCreate, user: UserResponse) -> ExpenseResponse:
        await self._validate_category(data.category_id, user.account_id)
        await self._validate_tags(data.tag_ids, user.account_id)
        payload = data.model_dump()
        payload["account_id"] = user.account_id
        payload["user_id"] = user.id
        expense = await self._expense_repo.create(payload)
        await self._check_budget_and_notify(expense, user)
        return expense

    async def _validate_category(self, category_id: UUID, account_id: UUID) -> None:
        """U1.1: `category_id` must belong to the caller's account — foreign
        or nonexistent ids 404, never 403 (no cross-account probing, MVP
        D29 precedent). Closes MVP D33."""
        category = await self._category_repo.get(category_id)
        if category is None or category.account_id != account_id:
            raise NotFoundError(f"Category {category_id} not found")

    async def _validate_tags(self, tag_ids: list[UUID], account_id: UUID) -> None:
        """U1.1: every `tag_ids` entry must belong to the caller's account,
        same 404-not-403 rule as `_validate_category`."""
        for tag_id in tag_ids:
            tag = await self._tag_repo.get(tag_id)
            if tag is None or tag.account_id != account_id:
                raise NotFoundError(f"Tag {tag_id} not found")

    async def _check_budget_and_notify(self, expense: ExpenseResponse, user: UserResponse) -> None:
        """services/CLAUDE.md notification-flow invariant, steps 2-3.

        Wrapped in a blanket try/except: root CLAUDE.md's best-effort rule
        ("send failures... must never fail the expense operation that
        triggered it") is applied to the whole check, not just the HTTP send
        inside NotificationService — a DB hiccup on the budget/category
        lookup must not undo an expense that already committed.
        """
        try:
            start, end = month_bounds()
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
            # No account_id check here: `create()` already validated
            # `expense.category_id` against the caller's account (U1.1,
            # closes D23/D33) before this method ever runs, so a second
            # ownership check would be redundant.
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
        if "category_id" in payload:
            await self._validate_category(payload["category_id"], account_id)
        if payload.get("tag_ids") is not None:
            await self._validate_tags(payload["tag_ids"], account_id)
        if not payload:
            return current
        updated = await self._expense_repo.update(expense_id, payload)
        assert updated is not None
        return updated

    async def delete(self, expense_id: UUID, account_id: UUID) -> None:
        await self.get(expense_id, account_id)  # 404 if missing or foreign
        await self._expense_repo.delete(expense_id)

    # D22 (MVP plan): a method literally named `list` breaks every other
    # method's bare `list[...]` annotation earlier in this class body — must
    # stay the last definition here.
    async def list(self, account_id: UUID) -> list[ExpenseResponse]:
        return await self._expense_repo.list(account_id=account_id)
