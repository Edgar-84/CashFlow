"""HTTP tests for api/statistics.py — PermissionChecker(EXPENSES, READ)-gated
read-only aggregates (U2.6 AC).

Hermetic: the real app, with ExpenseRepository/UserRepository/PermissionRepository
replaced by in-memory fakes via app.dependency_overrides (tests/CLAUDE.md) — no DB.
Expenses are seeded with created_at=now() (test_statistics_service.py's
make_expense default) so they always fall inside the "current month" window
the route computes, regardless of wall-clock time at test run.
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from test_deps import FakeAccountRepo, FakePermissionRepo, make_account
from test_statistics_service import (
    FakeBudgetPlanListRepo,
    FakeExpensePeriodRepo,
    make_expense,
    make_plan,
)
from test_users_api import TgLookupFakeUserRepo, auth_headers

from api import deps, period_params, statistics
from models.budget_plan import BudgetPlanResponse
from models.enums import Resource, Role
from models.expense import ExpenseResponse
from models.permission import PermissionResponse
from models.user import UserResponse


@pytest.fixture
def account_id() -> UUID:
    return uuid4()


@pytest.fixture
def member(account_id: UUID) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=2,
        name="Member",
        role=Role.MEMBER,
        is_blocked=False,
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


@pytest.fixture
def other_member(account_id: UUID) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=4,
        name="Other Member",
        role=Role.MEMBER,
        is_blocked=False,
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


@pytest.fixture
def viewer(account_id: UUID) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=3,
        name="Viewer",
        role=Role.VIEWER,
        is_blocked=False,
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


OverrideRepos = Callable[..., FakeExpensePeriodRepo]


@pytest.fixture
def override_repos(
    app: FastAPI,
    member: UserResponse,
    other_member: UserResponse,
    viewer: UserResponse,
    account_id: UUID,
) -> OverrideRepos:
    def _apply(
        expenses: list[ExpenseResponse] | None = None,
        *,
        plans: list[BudgetPlanResponse] | None = None,
        sums: dict[UUID, int] | None = None,
    ) -> FakeExpensePeriodRepo:
        app.dependency_overrides[deps.get_user_repo] = lambda: TgLookupFakeUserRepo(
            [member, other_member, viewer]
        )
        app.dependency_overrides[deps.get_permission_repo] = lambda: FakePermissionRepo([])
        app.dependency_overrides[deps.get_account_repo] = lambda: FakeAccountRepo(
            [make_account(account_id)]
        )
        repo = FakeExpensePeriodRepo(expenses, sums=sums)
        app.dependency_overrides[deps.get_expense_repo] = lambda: repo
        # get_statistics_service also depends on get_budget_plan_repo (U3.1's
        # by-budget) — every statistics route now resolves it, not just
        # by-budget, so it must be overridden here too or it falls through to
        # a real DB connection.
        app.dependency_overrides[deps.get_budget_plan_repo] = lambda: FakeBudgetPlanListRepo(plans)
        return repo

    return _apply


async def test_by_period_as_member(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    override_repos([make_expense(account_id=account_id, amount=1500)])

    response = await client.get("/statistics/by-period", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert response.json()["total"] == 1500


async def test_by_period_as_viewer(
    client: AsyncClient, override_repos: OverrideRepos, viewer: UserResponse, account_id: UUID
) -> None:
    override_repos([make_expense(account_id=account_id, amount=1500)])

    response = await client.get("/statistics/by-period", headers=auth_headers(viewer.tg_id))

    assert response.status_code == 200
    assert response.json()["total"] == 1500


async def test_by_period_default_matrix_is_not_own_only(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    other_member: UserResponse,
    account_id: UUID,
) -> None:
    # Default matrix: expense read is unqualified for members, not own_only.
    mine = make_expense(account_id=account_id, user_id=member.id, amount=1000)
    theirs = make_expense(account_id=account_id, user_id=other_member.id, amount=2000)
    override_repos([mine, theirs])

    response = await client.get("/statistics/by-period", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert response.json()["total"] == 3000


async def test_by_period_own_only_override_filters_to_own(
    client: AsyncClient,
    app: FastAPI,
    override_repos: OverrideRepos,
    member: UserResponse,
    other_member: UserResponse,
    account_id: UUID,
) -> None:
    # An override permission row can set own_only=True for read (D26/D33) —
    # statistics must restrict the aggregate to the caller's own expenses.
    mine = make_expense(account_id=account_id, user_id=member.id, amount=1000)
    theirs = make_expense(account_id=account_id, user_id=other_member.id, amount=2000)
    override_repos([mine, theirs])
    app.dependency_overrides[deps.get_permission_repo] = lambda: FakePermissionRepo(
        [
            PermissionResponse(
                id=uuid4(),
                user_id=member.id,
                resource=Resource.EXPENSES,
                can_read=True,
                own_only=True,
            )
        ]
    )

    response = await client.get("/statistics/by-period", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert response.json()["total"] == 1000


async def test_by_category_as_member(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    category_id = uuid4()
    override_repos(
        [
            make_expense(account_id=account_id, category_id=category_id, amount=1000),
            make_expense(account_id=account_id, category_id=category_id, amount=500),
        ]
    )

    response = await client.get("/statistics/by-category", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    body = response.json()
    assert body == [{"category_id": str(category_id), "total": 1500}]


async def test_by_tag_as_member(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    tag_id = uuid4()
    override_repos([make_expense(account_id=account_id, amount=1500, tag_ids=[tag_id])])

    response = await client.get("/statistics/by-tag", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    body = response.json()
    assert body == [{"tag_id": str(tag_id), "total": 1500}]


async def test_statistics_without_auth_is_401(
    client: AsyncClient, override_repos: OverrideRepos
) -> None:
    override_repos([])

    response = await client.get("/statistics/by-period")

    assert response.status_code == 401


async def test_by_period_custom_window(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    in_window = datetime(2026, 3, 15, tzinfo=UTC)
    outside_window = datetime(2026, 7, 5, tzinfo=UTC)
    override_repos(
        [
            make_expense(account_id=account_id, amount=1000, created_at=in_window),
            make_expense(account_id=account_id, amount=9999, created_at=outside_window),
        ]
    )

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"start": "2026-01-01T00:00:00Z", "end": "2026-04-01T00:00:00Z"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1000


async def test_by_period_category_and_tag_filter(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    category_id = uuid4()
    tag_id = uuid4()
    override_repos(
        [
            make_expense(
                account_id=account_id, category_id=category_id, amount=1000, tag_ids=[tag_id]
            ),
            make_expense(account_id=account_id, amount=2000),
        ]
    )

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"category_id": str(category_id), "tag_id": str(tag_id)},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1000


async def test_by_period_start_after_end_is_422(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"start": "2026-07-01T00:00:00Z", "end": "2026-06-01T00:00:00Z"},
    )

    assert response.status_code == 422


async def test_by_period_months_back_and_start_is_422(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"months_back": 1, "start": "2026-07-01T00:00:00Z"},
    )

    assert response.status_code == 422


async def test_by_period_months_back_out_of_range_is_422(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"months_back": 3},
    )

    assert response.status_code == 422


async def test_by_period_months_back_1_is_last_month(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    last_month = datetime.now(UTC).replace(day=1) - timedelta(days=1)
    this_month = datetime.now(UTC)
    override_repos(
        [
            make_expense(account_id=account_id, amount=1200, created_at=last_month),
            make_expense(account_id=account_id, amount=9999, created_at=this_month),
        ]
    )

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"months_back": 1},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1200


async def test_by_period_period_offset(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    last_month = datetime.now(UTC).replace(day=1) - timedelta(days=1)
    this_month = datetime.now(UTC)
    override_repos(
        [
            make_expense(account_id=account_id, amount=1200, created_at=last_month),
            make_expense(account_id=account_id, amount=9999, created_at=this_month),
        ]
    )

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"period": "month", "offset": -1},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1200


async def test_by_period_period_and_offset_positive_is_422(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"period": "month", "offset": 1},
    )

    assert response.status_code == 422


async def test_by_period_offset_without_period_is_422(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"offset": -1},
    )

    assert response.status_code == 422


async def test_by_period_start_date_without_custom_is_422(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"period": "month", "start_date": "2026-01-01"},
    )

    assert response.status_code == 422


async def test_by_period_period_and_months_back_is_422(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"period": "month", "months_back": 1},
    )

    assert response.status_code == 422


async def test_by_period_period_and_start_is_422(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"period": "month", "start": "2026-07-01T00:00:00Z"},
    )

    assert response.status_code == 422


async def test_by_period_custom_with_offset_is_422(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={
            "period": "custom",
            "offset": -1,
            "start_date": "2026-01-01",
            "end_date": "2026-01-31",
        },
    )

    assert response.status_code == 422


async def test_by_period_custom_missing_dates_is_422(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"period": "custom"},
    )

    assert response.status_code == 422


async def test_by_category_period_offset_passthrough(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    category_id = uuid4()
    last_month = datetime.now(UTC).replace(day=1) - timedelta(days=1)
    this_month = datetime.now(UTC)
    override_repos(
        [
            make_expense(
                account_id=account_id, category_id=category_id, amount=700, created_at=last_month
            ),
            make_expense(
                account_id=account_id, category_id=category_id, amount=9999, created_at=this_month
            ),
        ]
    )

    response = await client.get(
        "/statistics/by-category",
        headers=auth_headers(member.tg_id),
        params={"period": "month", "offset": -1},
    )

    assert response.status_code == 200
    assert response.json() == [{"category_id": str(category_id), "total": 700}]


async def test_by_category_months_back_passthrough(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    category_id = uuid4()
    last_month = datetime.now(UTC).replace(day=1) - timedelta(days=1)
    this_month = datetime.now(UTC)
    override_repos(
        [
            make_expense(
                account_id=account_id, category_id=category_id, amount=700, created_at=last_month
            ),
            make_expense(
                account_id=account_id, category_id=category_id, amount=9999, created_at=this_month
            ),
        ]
    )

    response = await client.get(
        "/statistics/by-category",
        headers=auth_headers(member.tg_id),
        params={"months_back": 1},
    )

    assert response.status_code == 200
    assert response.json() == [{"category_id": str(category_id), "total": 700}]


def test_statistics_module_imports_shared_validator() -> None:
    """D403: `api/statistics.py` no longer defines its own period validator —
    it imports `validate_period_params` from the shared `api/period_params.py`."""
    assert not hasattr(statistics, "_validate_period")
    assert statistics.validate_period_params is period_params.validate_period_params


async def test_by_period_offset_without_period_message_names_offset(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"offset": -1},
    )

    assert response.status_code == 422
    assert "offset" in response.json()["detail"]


async def test_by_period_conflicting_families_message_names_offset(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(
        "/statistics/by-period",
        headers=auth_headers(member.tg_id),
        params={"period": "month", "months_back": 1},
    )

    assert response.status_code == 422
    assert "period/offset" in response.json()["detail"]


# --- by-budget (U3.1) ---


async def test_by_budget_as_member(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    groceries = uuid4()
    transport = uuid4()
    override_repos(
        [],
        plans=[
            make_plan(account_id=account_id, category_id=groceries, amount=10000),
            make_plan(account_id=account_id, category_id=transport, amount=5000),
        ],
        sums={groceries: 6000, transport: 6000},
    )

    response = await client.get("/statistics/by-budget", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    by_category = {row["category_id"]: row for row in response.json()}
    assert by_category[str(groceries)]["spent"] == 6000
    assert by_category[str(groceries)]["is_exceeded"] is False
    assert by_category[str(transport)]["spent"] == 6000
    assert by_category[str(transport)]["is_exceeded"] is True


async def test_by_budget_no_plans_returns_empty_list(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([], plans=[])

    response = await client.get("/statistics/by-budget", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert response.json() == []


async def test_by_budget_rejects_non_month_period(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    override_repos([], plans=[make_plan(account_id=account_id)])

    response = await client.get(
        "/statistics/by-budget",
        headers=auth_headers(member.tg_id),
        params={"period": "day"},
    )

    assert response.status_code == 422


async def test_by_budget_offset_minus_1_scores_last_months_spend(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    category_id = uuid4()
    override_repos(
        [],
        plans=[make_plan(account_id=account_id, category_id=category_id, amount=10000)],
        sums={category_id: 3000},
    )

    response = await client.get(
        "/statistics/by-budget",
        headers=auth_headers(member.tg_id),
        params={"period": "month", "offset": -1},
    )

    assert response.status_code == 200
    assert response.json() == [
        {
            "budget_plan_id": response.json()[0]["budget_plan_id"],
            "category_id": str(category_id),
            "amount": 10000,
            "spent": 3000,
            "remaining": 7000,
            "fill_pct": 30.0,
            "notify_threshold": 70,
            "is_over_threshold": False,
            "is_exceeded": False,
        }
    ]


async def test_by_budget_own_only_override_does_not_restrict_totals(
    client: AsyncClient,
    app: FastAPI,
    override_repos: OverrideRepos,
    member: UserResponse,
    account_id: UUID,
) -> None:
    """D813: unlike its three siblings, `by-budget` ignores `own_only` — a
    budget limit is an account-level number, so a per-user slice of it would
    be meaningless. An `own_only=True` override must not change the result."""
    category_id = uuid4()
    override_repos(
        [],
        plans=[make_plan(account_id=account_id, category_id=category_id, amount=10000)],
        sums={category_id: 6000},
    )
    app.dependency_overrides[deps.get_permission_repo] = lambda: FakePermissionRepo(
        [
            PermissionResponse(
                id=uuid4(),
                user_id=member.id,
                resource=Resource.EXPENSES,
                can_read=True,
                own_only=True,
            )
        ]
    )

    response = await client.get("/statistics/by-budget", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert response.json()[0]["spent"] == 6000
