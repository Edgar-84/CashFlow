"""HTTP tests for api/budgets.py — PermissionChecker-gated CRUD + progress (U2.5 AC).

Hermetic: the real app, with BudgetPlanRepository/ExpenseRepository/UserRepository/
PermissionRepository replaced by in-memory fakes via app.dependency_overrides
(tests/CLAUDE.md) — no DB.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from test_budget_service import FakeBudgetPlanRepo, FakeExpenseSumRepo
from test_deps import FakePermissionRepo
from test_users_api import TgLookupFakeUserRepo, auth_headers

from api import deps
from models.budget_plan import BudgetPlanResponse
from models.enums import Role
from models.user import UserResponse


@pytest.fixture
def account_id() -> UUID:
    return uuid4()


@pytest.fixture
def admin(account_id: UUID) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=1,
        name="Admin",
        role=Role.ADMIN,
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


@pytest.fixture
def member(account_id: UUID) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=2,
        name="Member",
        role=Role.MEMBER,
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
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


@pytest.fixture
def category_id() -> UUID:
    return uuid4()


@pytest.fixture
def plan(account_id: UUID, category_id: UUID) -> BudgetPlanResponse:
    return BudgetPlanResponse(
        id=uuid4(),
        category_id=category_id,
        amount=10_000,
        period="monthly",
        notify_threshold=80,
        account_id=account_id,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


OverrideRepos = Callable[..., FakeBudgetPlanRepo]


@pytest.fixture
def override_repos(
    app: FastAPI, admin: UserResponse, member: UserResponse, viewer: UserResponse
) -> OverrideRepos:
    def _apply(
        plans: list[BudgetPlanResponse] | None = None,
        *,
        duplicate_ids: set[UUID] | None = None,
        sums: dict[UUID, int] | None = None,
    ) -> FakeBudgetPlanRepo:
        app.dependency_overrides[deps.get_user_repo] = lambda: TgLookupFakeUserRepo(
            [admin, member, viewer]
        )
        app.dependency_overrides[deps.get_permission_repo] = lambda: FakePermissionRepo([])
        repo = FakeBudgetPlanRepo(plans, duplicate_ids=duplicate_ids)
        app.dependency_overrides[deps.get_budget_plan_repo] = lambda: repo
        app.dependency_overrides[deps.get_expense_repo] = lambda: FakeExpenseSumRepo(sums)
        return repo

    return _apply


async def test_list_budget_plans_as_member(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    plan: BudgetPlanResponse,
) -> None:
    override_repos([plan])

    response = await client.get("/budgets", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert [p["id"] for p in response.json()] == [str(plan.id)]


async def test_get_budget_plan_as_viewer(
    client: AsyncClient,
    override_repos: OverrideRepos,
    viewer: UserResponse,
    plan: BudgetPlanResponse,
) -> None:
    override_repos([plan])

    response = await client.get(f"/budgets/{plan.id}", headers=auth_headers(viewer.tg_id))

    assert response.status_code == 200
    assert response.json()["id"] == str(plan.id)


async def test_get_missing_budget_plan_is_404(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(f"/budgets/{uuid4()}", headers=auth_headers(member.tg_id))

    assert response.status_code == 404


async def test_get_budget_plan_progress(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    plan: BudgetPlanResponse,
    category_id: UUID,
) -> None:
    override_repos([plan], sums={category_id: 8_000})

    response = await client.get(f"/budgets/{plan.id}/progress", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    body = response.json()
    assert body["spent"] == 8_000
    assert body["amount"] == 10_000
    assert body["remaining"] == 2_000
    assert body["fill_pct"] == 80.0
    assert body["is_over_threshold"] is True


async def test_create_budget_plan_as_admin(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, account_id: UUID
) -> None:
    override_repos([])
    category_id = uuid4()

    response = await client.post(
        "/budgets",
        headers=auth_headers(admin.tg_id),
        json={"category_id": str(category_id), "amount": 5_000},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["amount"] == 5_000
    assert body["account_id"] == str(account_id)


async def test_create_budget_plan_as_member_is_403(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    # Default matrix: member is read-only on budget_plans (api/CLAUDE.md).
    override_repos([])

    response = await client.post(
        "/budgets",
        headers=auth_headers(member.tg_id),
        json={"category_id": str(uuid4()), "amount": 5_000},
    )

    assert response.status_code == 403


async def test_create_duplicate_budget_plan_as_admin_is_409(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse
) -> None:
    category_id = uuid4()
    override_repos([], duplicate_ids={category_id})

    response = await client.post(
        "/budgets",
        headers=auth_headers(admin.tg_id),
        json={"category_id": str(category_id), "amount": 5_000},
    )

    assert response.status_code == 409
    assert "detail" in response.json()


async def test_update_budget_plan_as_admin(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    plan: BudgetPlanResponse,
) -> None:
    override_repos([plan])

    response = await client.patch(
        f"/budgets/{plan.id}", headers=auth_headers(admin.tg_id), json={"amount": 20_000}
    )

    assert response.status_code == 200
    assert response.json()["amount"] == 20_000


async def test_update_budget_plan_as_member_is_403(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    plan: BudgetPlanResponse,
) -> None:
    override_repos([plan])

    response = await client.patch(
        f"/budgets/{plan.id}", headers=auth_headers(member.tg_id), json={"amount": 20_000}
    )

    assert response.status_code == 403


async def test_delete_budget_plan_as_admin(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    plan: BudgetPlanResponse,
) -> None:
    repo = override_repos([plan])

    response = await client.delete(f"/budgets/{plan.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 204
    assert await repo.get(plan.id) is None


async def test_delete_budget_plan_as_member_is_403(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    plan: BudgetPlanResponse,
) -> None:
    override_repos([plan])

    response = await client.delete(f"/budgets/{plan.id}", headers=auth_headers(member.tg_id))

    assert response.status_code == 403
