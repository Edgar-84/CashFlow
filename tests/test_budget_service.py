"""Unit tests for services/budget_service.py — mocked repositories, no DB (tests/CLAUDE.md)."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest

from models.budget_plan import BudgetPlanCreate, BudgetPlanResponse, BudgetPlanUpdate
from models.category import CategoryResponse
from models.errors import ConflictError, NotFoundError
from services.budget_service import BudgetService, calculate_progress
from services.period import month_bounds


class FakeBudgetPlanRepo:
    def __init__(
        self,
        plans: list[BudgetPlanResponse] | None = None,
        *,
        duplicate_ids: set[UUID] | None = None,
    ) -> None:
        self._plans: dict[UUID, BudgetPlanResponse] = {p.id: p for p in (plans or [])}
        self._duplicate_ids = duplicate_ids or set()

    async def list(self, **filters: Any) -> list[BudgetPlanResponse]:
        account_id = filters.get("account_id")
        return [p for p in self._plans.values() if p.account_id == account_id]

    async def get(self, id: UUID) -> BudgetPlanResponse | None:
        return self._plans.get(id)

    async def create(self, data: dict[str, Any]) -> BudgetPlanResponse:
        if data["category_id"] in self._duplicate_ids:
            raise asyncpg.UniqueViolationError("duplicate key value violates unique constraint")
        plan = BudgetPlanResponse(
            id=uuid4(),
            category_id=data["category_id"],
            amount=data["amount"],
            period=data.get("period", "monthly"),
            notify_threshold=data.get("notify_threshold", 80),
            account_id=data["account_id"],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        self._plans[plan.id] = plan
        return plan

    async def update(self, id: UUID, data: dict[str, Any]) -> BudgetPlanResponse | None:
        plan = self._plans.get(id)
        if plan is None:
            return None
        updated = plan.model_copy(update=data)
        self._plans[id] = updated
        return updated

    async def delete(self, id: UUID) -> bool:
        return self._plans.pop(id, None) is not None


class FakeExpenseSumRepo:
    def __init__(self, sums: dict[UUID, int] | None = None) -> None:
        self._sums = sums or {}
        self.calls: list[tuple[UUID, datetime, datetime]] = []

    async def sum_by_category_month(
        self, account_id: UUID, start: datetime, end: datetime
    ) -> dict[UUID, int]:
        self.calls.append((account_id, start, end))
        return dict(self._sums)


class FakeCategoryRepo:
    def __init__(self, categories: list[CategoryResponse] | None = None) -> None:
        self._categories: dict[UUID, CategoryResponse] = {c.id: c for c in (categories or [])}

    async def get(self, id: UUID) -> CategoryResponse | None:
        return self._categories.get(id)


def make_category(*, account_id: UUID, category_id: UUID | None = None) -> CategoryResponse:
    return CategoryResponse(
        id=category_id or uuid4(),
        name="Groceries",
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


def make_service(
    budget_plan_repo: FakeBudgetPlanRepo,
    expense_repo: FakeExpenseSumRepo,
    *,
    category_repo: Any = None,
) -> BudgetService:
    return BudgetService(
        budget_plan_repo,
        expense_repo,
        category_repo if category_repo is not None else FakeCategoryRepo(),
    )


def make_plan(
    *,
    account_id: UUID,
    category_id: UUID | None = None,
    amount: int = 10_000,
    notify_threshold: int = 80,
) -> BudgetPlanResponse:
    return BudgetPlanResponse(
        id=uuid4(),
        category_id=category_id or uuid4(),
        amount=amount,
        period="monthly",
        notify_threshold=notify_threshold,
        account_id=account_id,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


# --- calculate_progress: pure logic, int math only ---


@pytest.mark.parametrize(
    "spent, limit, notify_threshold, expected_pct, expected_over, expected_exceeded",
    [
        (0, 10_000, 80, 0.0, False, False),
        (8_000, 10_000, 80, 80.0, True, False),
        (5_000, 10_000, 80, 50.0, False, False),
        (12_000, 10_000, 80, 120.0, True, True),
        (10_000, 10_000, 80, 100.0, True, True),
    ],
)
def test_calculate_progress_parametrized(
    spent: int,
    limit: int,
    notify_threshold: int,
    expected_pct: float,
    expected_over: bool,
    expected_exceeded: bool,
) -> None:
    budget_plan_id = uuid4()
    category_id = uuid4()

    progress = calculate_progress(
        budget_plan_id=budget_plan_id,
        category_id=category_id,
        spent=spent,
        limit=limit,
        notify_threshold=notify_threshold,
    )

    assert progress.fill_pct == expected_pct
    assert progress.is_over_threshold is expected_over
    assert progress.is_exceeded is expected_exceeded
    assert progress.spent == spent
    assert progress.amount == limit
    assert progress.remaining == limit - spent
    assert type(progress.remaining) is int


def test_calculate_progress_zero_limit_returns_none_pct() -> None:
    progress = calculate_progress(
        budget_plan_id=uuid4(), category_id=uuid4(), spent=500, limit=0, notify_threshold=80
    )

    assert progress.fill_pct is None
    assert progress.is_over_threshold is False
    assert progress.is_exceeded is False


def test_calculate_progress_negative_limit_returns_none_pct() -> None:
    progress = calculate_progress(
        budget_plan_id=uuid4(), category_id=uuid4(), spent=0, limit=-100, notify_threshold=80
    )

    assert progress.fill_pct is None


# --- CRUD ---


async def test_list_scopes_by_account() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    mine = make_plan(account_id=account_id)
    other = make_plan(account_id=other_account_id)
    service = make_service(FakeBudgetPlanRepo([mine, other]), FakeExpenseSumRepo())

    result = await service.list(account_id)

    assert result == [mine]


async def test_get_returns_plan_in_account() -> None:
    account_id = uuid4()
    plan = make_plan(account_id=account_id)
    service = make_service(FakeBudgetPlanRepo([plan]), FakeExpenseSumRepo())

    result = await service.get(plan.id, account_id)

    assert result == plan


async def test_get_missing_raises_not_found() -> None:
    service = make_service(FakeBudgetPlanRepo([]), FakeExpenseSumRepo())

    with pytest.raises(NotFoundError):
        await service.get(uuid4(), uuid4())


async def test_get_foreign_account_raises_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    plan = make_plan(account_id=other_account_id)
    service = make_service(FakeBudgetPlanRepo([plan]), FakeExpenseSumRepo())

    with pytest.raises(NotFoundError):
        await service.get(plan.id, account_id)


async def test_create_forces_account_id_from_caller() -> None:
    account_id = uuid4()
    category = make_category(account_id=account_id)
    service = make_service(
        FakeBudgetPlanRepo([]), FakeExpenseSumRepo(), category_repo=FakeCategoryRepo([category])
    )
    data = BudgetPlanCreate(category_id=category.id, amount=10_000)

    created = await service.create(data, account_id)

    assert created.account_id == account_id


async def test_create_duplicate_raises_conflict() -> None:
    # UNIQUE(category_id, account_id, period) — docs/SCHEMA.sql, plan Decision
    # log D23/D24 flagged the raw asyncpg.UniqueViolationError as untranslated.
    account_id = uuid4()
    category = make_category(account_id=account_id)
    repo = FakeBudgetPlanRepo([], duplicate_ids={category.id})
    service = make_service(repo, FakeExpenseSumRepo(), category_repo=FakeCategoryRepo([category]))

    with pytest.raises(ConflictError):
        await service.create(BudgetPlanCreate(category_id=category.id, amount=10_000), account_id)


async def test_update_changes_fields() -> None:
    account_id = uuid4()
    plan = make_plan(account_id=account_id)
    service = make_service(FakeBudgetPlanRepo([plan]), FakeExpenseSumRepo())

    updated = await service.update(plan.id, BudgetPlanUpdate(amount=20_000), account_id)

    assert updated.amount == 20_000


async def test_update_explicit_null_amount_is_ignored_not_nulled() -> None:
    # amount/period/notify_threshold are all NOT NULL (same D30/D32 precedent).
    account_id = uuid4()
    plan = make_plan(account_id=account_id, amount=10_000)
    service = make_service(FakeBudgetPlanRepo([plan]), FakeExpenseSumRepo())

    updated = await service.update(plan.id, BudgetPlanUpdate(amount=None), account_id)

    assert updated.amount == 10_000


async def test_update_explicit_null_period_is_ignored_not_nulled() -> None:
    account_id = uuid4()
    plan = make_plan(account_id=account_id)
    service = make_service(FakeBudgetPlanRepo([plan]), FakeExpenseSumRepo())

    updated = await service.update(plan.id, BudgetPlanUpdate(period=None), account_id)

    assert updated.period == "monthly"


async def test_update_explicit_null_notify_threshold_is_ignored_not_nulled() -> None:
    account_id = uuid4()
    plan = make_plan(account_id=account_id, notify_threshold=80)
    service = make_service(FakeBudgetPlanRepo([plan]), FakeExpenseSumRepo())

    updated = await service.update(plan.id, BudgetPlanUpdate(notify_threshold=None), account_id)

    assert updated.notify_threshold == 80


async def test_update_missing_raises_not_found() -> None:
    service = make_service(FakeBudgetPlanRepo([]), FakeExpenseSumRepo())

    with pytest.raises(NotFoundError):
        await service.update(uuid4(), BudgetPlanUpdate(amount=1), uuid4())


async def test_delete_removes_plan() -> None:
    account_id = uuid4()
    plan = make_plan(account_id=account_id)
    repo = FakeBudgetPlanRepo([plan])
    service = make_service(repo, FakeExpenseSumRepo())

    await service.delete(plan.id, account_id)

    assert await repo.get(plan.id) is None


async def test_delete_missing_raises_not_found() -> None:
    service = make_service(FakeBudgetPlanRepo([]), FakeExpenseSumRepo())

    with pytest.raises(NotFoundError):
        await service.delete(uuid4(), uuid4())


# --- get_progress: orchestrates budget_plan_repo + expense_repo ---


async def test_get_progress_combines_plan_and_spent() -> None:
    account_id = uuid4()
    category_id = uuid4()
    plan = make_plan(
        account_id=account_id, category_id=category_id, amount=10_000, notify_threshold=80
    )
    expense_repo = FakeExpenseSumRepo({category_id: 8_000})
    service = make_service(FakeBudgetPlanRepo([plan]), expense_repo)
    now = datetime(2026, 7, 17, 13, 45, tzinfo=UTC)

    progress = await service.get_progress(plan.id, account_id, now=now)

    assert progress.spent == 8_000
    assert progress.amount == 10_000
    assert progress.remaining == 2_000
    assert progress.fill_pct == 80.0
    assert progress.is_over_threshold is True
    # get_progress must pass the *current-month* bounds through to the repo,
    # not some other window (D34).
    called_account_id, start, end = expense_repo.calls[0]
    assert called_account_id == account_id
    assert (start, end) == month_bounds(now)
    assert start == datetime(2026, 7, 1, tzinfo=UTC)
    assert end == datetime(2026, 8, 1, tzinfo=UTC)


async def test_get_progress_no_expenses_this_month_is_zero_spent() -> None:
    account_id = uuid4()
    category_id = uuid4()
    plan = make_plan(account_id=account_id, category_id=category_id, amount=10_000)
    service = make_service(FakeBudgetPlanRepo([plan]), FakeExpenseSumRepo({}))

    progress = await service.get_progress(plan.id, account_id)

    assert progress.spent == 0
    assert progress.fill_pct == 0.0


async def test_get_progress_missing_plan_raises_not_found() -> None:
    service = make_service(FakeBudgetPlanRepo([]), FakeExpenseSumRepo())

    with pytest.raises(NotFoundError):
        await service.get_progress(uuid4(), uuid4())


# --- U1.1: cross-account validation (closes MVP D33/D23) ------------------


async def test_create_foreign_category_raises_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    foreign_category = make_category(account_id=other_account_id)
    service = make_service(
        FakeBudgetPlanRepo([]),
        FakeExpenseSumRepo(),
        category_repo=FakeCategoryRepo([foreign_category]),
    )
    data = BudgetPlanCreate(category_id=foreign_category.id, amount=10_000)

    with pytest.raises(NotFoundError):
        await service.create(data, account_id)


async def test_create_nonexistent_category_raises_not_found() -> None:
    service = make_service(FakeBudgetPlanRepo([]), FakeExpenseSumRepo())
    data = BudgetPlanCreate(category_id=uuid4(), amount=10_000)

    with pytest.raises(NotFoundError):
        await service.create(data, uuid4())


async def test_create_own_category_passes() -> None:
    account_id = uuid4()
    category = make_category(account_id=account_id)
    service = make_service(
        FakeBudgetPlanRepo([]), FakeExpenseSumRepo(), category_repo=FakeCategoryRepo([category])
    )
    data = BudgetPlanCreate(category_id=category.id, amount=10_000)

    created = await service.create(data, account_id)

    assert created.category_id == category.id
