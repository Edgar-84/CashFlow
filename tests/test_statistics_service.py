"""Unit tests for services/statistics_service.py — mocked repository, no DB
(tests/CLAUDE.md). Seeded ExpenseResponse fixtures stand in for "seeded data"
(U2.6 AC: by-period/by-category/by-tag aggregates match seeded data)."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from models.expense import ExpenseResponse
from models.tag import TagResponse
from services.statistics_service import StatisticsService


class FakeExpensePeriodRepo:
    def __init__(self, expenses: list[ExpenseResponse] | None = None) -> None:
        self._expenses = list(expenses or [])
        self.calls: list[tuple[UUID, datetime, datetime]] = []

    async def get_by_period(
        self, account_id: UUID, start: datetime, end: datetime
    ) -> list[ExpenseResponse]:
        self.calls.append((account_id, start, end))
        return [
            e for e in self._expenses if e.account_id == account_id and start <= e.created_at < end
        ]


def _tag(tag_id: UUID, account_id: UUID) -> TagResponse:
    return TagResponse(id=tag_id, name="tag", account_id=account_id, created_at=datetime.now(UTC))


def make_expense(
    *,
    account_id: UUID,
    user_id: UUID | None = None,
    category_id: UUID | None = None,
    amount: int = 1000,
    created_at: datetime | None = None,
    tag_ids: list[UUID] | None = None,
) -> ExpenseResponse:
    return ExpenseResponse(
        id=uuid4(),
        amount=amount,
        comment=None,
        category_id=category_id or uuid4(),
        user_id=user_id or uuid4(),
        account_id=account_id,
        created_at=created_at or datetime.now(UTC),
        updated_at=created_at or datetime.now(UTC),
        tags=[_tag(tag_id, account_id) for tag_id in (tag_ids or [])],
    )


# --- by_period ---


async def test_by_period_sums_current_month_expenses() -> None:
    account_id = uuid4()
    now = datetime(2026, 7, 17, tzinfo=UTC)
    in_month = datetime(2026, 7, 5, tzinfo=UTC)
    e1 = make_expense(account_id=account_id, amount=1000, created_at=in_month)
    e2 = make_expense(account_id=account_id, amount=2500, created_at=in_month)
    service = StatisticsService(FakeExpensePeriodRepo([e1, e2]))

    result = await service.by_period(account_id, now=now)

    assert result.total == 3500
    assert type(result.total) is int
    assert result.start == datetime(2026, 7, 1, tzinfo=UTC)
    assert result.end == datetime(2026, 8, 1, tzinfo=UTC)


async def test_by_period_excludes_expenses_outside_current_month() -> None:
    account_id = uuid4()
    now = datetime(2026, 7, 17, tzinfo=UTC)
    outside = make_expense(
        account_id=account_id, amount=9999, created_at=datetime(2026, 6, 30, tzinfo=UTC)
    )
    service = StatisticsService(FakeExpensePeriodRepo([outside]))

    result = await service.by_period(account_id, now=now)

    assert result.total == 0


async def test_by_period_no_expenses_is_zero() -> None:
    service = StatisticsService(FakeExpensePeriodRepo([]))

    result = await service.by_period(uuid4())

    assert result.total == 0


async def test_by_period_own_user_id_filters_to_own_expenses() -> None:
    account_id = uuid4()
    now = datetime(2026, 7, 17, tzinfo=UTC)
    in_month = datetime(2026, 7, 5, tzinfo=UTC)
    mine_user_id = uuid4()
    mine = make_expense(
        account_id=account_id, user_id=mine_user_id, amount=1000, created_at=in_month
    )
    theirs = make_expense(account_id=account_id, amount=5000, created_at=in_month)
    service = StatisticsService(FakeExpensePeriodRepo([mine, theirs]))

    result = await service.by_period(account_id, user_id=mine_user_id, now=now)

    assert result.total == 1000


async def test_by_period_scopes_by_account() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    now = datetime(2026, 7, 17, tzinfo=UTC)
    in_month = datetime(2026, 7, 5, tzinfo=UTC)
    mine = make_expense(account_id=account_id, amount=1000, created_at=in_month)
    other = make_expense(account_id=other_account_id, amount=5000, created_at=in_month)
    repo = FakeExpensePeriodRepo([mine, other])
    service = StatisticsService(repo)

    result = await service.by_period(account_id, now=now)

    assert result.total == 1000
    called_account_id, _, _ = repo.calls[0]
    assert called_account_id == account_id


async def test_by_period_accepts_stub_period_and_filter_params_without_error() -> None:
    """start/end/category_id/tag_id are accepted per the Contracts additive
    delta but not yet wired — this pins today's stub behavior so the next
    unit's test change is a deliberate, visible diff."""
    account_id = uuid4()
    now = datetime(2026, 7, 17, tzinfo=UTC)
    in_month = datetime(2026, 7, 5, tzinfo=UTC)
    expense = make_expense(account_id=account_id, amount=1000, created_at=in_month)
    service = StatisticsService(FakeExpensePeriodRepo([expense]))

    result = await service.by_period(
        account_id,
        now=now,
        start=datetime(2026, 1, 1, tzinfo=UTC),
        end=datetime(2026, 2, 1, tzinfo=UTC),
        category_id=uuid4(),
        tag_id=uuid4(),
    )

    assert result.total == 1000
    assert result.start == datetime(2026, 7, 1, tzinfo=UTC)
    assert result.end == datetime(2026, 8, 1, tzinfo=UTC)


# --- by_category ---


async def test_by_category_groups_totals_by_category() -> None:
    account_id = uuid4()
    now = datetime(2026, 7, 17, tzinfo=UTC)
    in_month = datetime(2026, 7, 5, tzinfo=UTC)
    groceries = uuid4()
    transport = uuid4()
    e1 = make_expense(
        account_id=account_id, category_id=groceries, amount=1000, created_at=in_month
    )
    e2 = make_expense(account_id=account_id, category_id=groceries, amount=500, created_at=in_month)
    e3 = make_expense(
        account_id=account_id, category_id=transport, amount=2000, created_at=in_month
    )
    service = StatisticsService(FakeExpensePeriodRepo([e1, e2, e3]))

    result = await service.by_category(account_id, now=now)

    totals = {r.category_id: r.total for r in result}
    assert totals == {groceries: 1500, transport: 2000}
    assert all(type(r.total) is int for r in result)


async def test_by_category_own_user_id_filters_to_own_expenses() -> None:
    account_id = uuid4()
    now = datetime(2026, 7, 17, tzinfo=UTC)
    in_month = datetime(2026, 7, 5, tzinfo=UTC)
    category_id = uuid4()
    mine_user_id = uuid4()
    mine = make_expense(
        account_id=account_id,
        category_id=category_id,
        user_id=mine_user_id,
        amount=1000,
        created_at=in_month,
    )
    theirs = make_expense(
        account_id=account_id, category_id=category_id, amount=5000, created_at=in_month
    )
    service = StatisticsService(FakeExpensePeriodRepo([mine, theirs]))

    result = await service.by_category(account_id, user_id=mine_user_id, now=now)

    assert [(r.category_id, r.total) for r in result] == [(category_id, 1000)]


# --- by_tag ---


async def test_by_tag_groups_totals_by_tag() -> None:
    account_id = uuid4()
    now = datetime(2026, 7, 17, tzinfo=UTC)
    in_month = datetime(2026, 7, 5, tzinfo=UTC)
    food_tag = uuid4()
    urgent_tag = uuid4()
    e1 = make_expense(account_id=account_id, amount=1000, created_at=in_month, tag_ids=[food_tag])
    e2 = make_expense(
        account_id=account_id, amount=500, created_at=in_month, tag_ids=[food_tag, urgent_tag]
    )
    e3 = make_expense(account_id=account_id, amount=2000, created_at=in_month, tag_ids=[])
    service = StatisticsService(FakeExpensePeriodRepo([e1, e2, e3]))

    result = await service.by_tag(account_id, now=now)

    totals = {r.tag_id: r.total for r in result}
    assert totals == {food_tag: 1500, urgent_tag: 500}
    assert all(type(r.total) is int for r in result)


async def test_by_tag_expense_with_no_tags_is_excluded() -> None:
    account_id = uuid4()
    now = datetime(2026, 7, 17, tzinfo=UTC)
    in_month = datetime(2026, 7, 5, tzinfo=UTC)
    untagged = make_expense(account_id=account_id, amount=2000, created_at=in_month, tag_ids=[])
    service = StatisticsService(FakeExpensePeriodRepo([untagged]))

    result = await service.by_tag(account_id, now=now)

    assert result == []


async def test_by_tag_own_user_id_filters_to_own_expenses() -> None:
    account_id = uuid4()
    now = datetime(2026, 7, 17, tzinfo=UTC)
    in_month = datetime(2026, 7, 5, tzinfo=UTC)
    tag_id = uuid4()
    mine_user_id = uuid4()
    mine = make_expense(
        account_id=account_id,
        user_id=mine_user_id,
        amount=1000,
        created_at=in_month,
        tag_ids=[tag_id],
    )
    theirs = make_expense(account_id=account_id, amount=5000, created_at=in_month, tag_ids=[tag_id])
    service = StatisticsService(FakeExpensePeriodRepo([mine, theirs]))

    result = await service.by_tag(account_id, user_id=mine_user_id, now=now)

    assert [(r.tag_id, r.total) for r in result] == [(tag_id, 1000)]
