"""HTTP tests for api/expenses.py — PermissionChecker-gated CRUD + own_only (U2.4 AC).

Hermetic: the real app, with ExpenseRepository/UserRepository/PermissionRepository
replaced by in-memory fakes via app.dependency_overrides (tests/CLAUDE.md) — no DB.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from test_deps import FakePermissionRepo
from test_expense_service import (
    FakeBudgetPlanRepo,
    FakeCategoryRepo,
    FakeExpenseRepo,
    FakeNotificationService,
    make_expense,
)
from test_users_api import TgLookupFakeUserRepo, auth_headers

from api import deps
from models.category import CategoryResponse
from models.enums import Resource, Role
from models.expense import ExpenseResponse
from models.permission import PermissionResponse
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
def other_member(account_id: UUID) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=4,
        name="Other Member",
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


OverrideRepos = Callable[..., FakeExpenseRepo]


@pytest.fixture
def override_repos(
    app: FastAPI,
    admin: UserResponse,
    member: UserResponse,
    other_member: UserResponse,
    viewer: UserResponse,
) -> OverrideRepos:
    def _apply(expenses: list[ExpenseResponse] | None = None) -> FakeExpenseRepo:
        app.dependency_overrides[deps.get_user_repo] = lambda: TgLookupFakeUserRepo(
            [admin, member, other_member, viewer]
        )
        app.dependency_overrides[deps.get_permission_repo] = lambda: FakePermissionRepo([])
        repo = FakeExpenseRepo(expenses)
        app.dependency_overrides[deps.get_expense_repo] = lambda: repo
        # get_expense_service also wires budget_plan_repo/category_repo (for
        # the notification check) and notification_service (U3.1) — default
        # to "no budget plan" fakes so routes that never exercise create()
        # don't need real DB/network dependencies resolved.
        app.dependency_overrides[deps.get_budget_plan_repo] = lambda: FakeBudgetPlanRepo()
        app.dependency_overrides[deps.get_category_repo] = lambda: FakeCategoryRepo()
        app.dependency_overrides[deps.get_notification_service] = lambda: FakeNotificationService()
        return repo

    return _apply


async def test_list_expenses_as_member_returns_account_expenses(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    other_member: UserResponse,
    account_id: UUID,
) -> None:
    # Default matrix: expense read is unqualified for members (not own_only).
    mine = make_expense(account_id=account_id, user_id=member.id)
    theirs = make_expense(account_id=account_id, user_id=other_member.id)
    override_repos([mine, theirs])

    response = await client.get("/expenses", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert {e["id"] for e in response.json()} == {str(mine.id), str(theirs.id)}


async def test_list_expenses_with_own_only_override_filters_to_own(
    client: AsyncClient,
    app: FastAPI,
    override_repos: OverrideRepos,
    member: UserResponse,
    other_member: UserResponse,
    account_id: UUID,
) -> None:
    # An override permission row can set own_only=True for read too, unlike
    # the default matrix (D26) — list must filter to the caller's own
    # expenses in that case, same as enforce_ownership does for a single record.
    mine = make_expense(account_id=account_id, user_id=member.id)
    theirs = make_expense(account_id=account_id, user_id=other_member.id)
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

    response = await client.get("/expenses", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert [e["id"] for e in response.json()] == [str(mine.id)]


async def test_get_expense_as_viewer(
    client: AsyncClient, override_repos: OverrideRepos, viewer: UserResponse, account_id: UUID
) -> None:
    expense = make_expense(account_id=account_id)
    override_repos([expense])

    response = await client.get(f"/expenses/{expense.id}", headers=auth_headers(viewer.tg_id))

    assert response.status_code == 200
    assert response.json()["id"] == str(expense.id)


async def test_get_missing_expense_is_404(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(f"/expenses/{uuid4()}", headers=auth_headers(member.tg_id))

    assert response.status_code == 404


async def test_create_expense_as_member(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, account_id: UUID
) -> None:
    override_repos([])

    response = await client.post(
        "/expenses",
        headers=auth_headers(member.tg_id),
        json={"amount": 1500, "category_id": str(uuid4())},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["amount"] == 1500
    assert body["account_id"] == str(account_id)
    assert body["user_id"] == str(member.id)


async def test_create_expense_with_tags(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])
    tag_id = str(uuid4())

    response = await client.post(
        "/expenses",
        headers=auth_headers(member.tg_id),
        json={"amount": 1500, "category_id": str(uuid4()), "tag_ids": [tag_id]},
    )

    assert response.status_code == 201
    assert [t["id"] for t in response.json()["tags"]] == [tag_id]


async def test_create_expense_as_viewer_is_403(
    client: AsyncClient, override_repos: OverrideRepos, viewer: UserResponse
) -> None:
    override_repos([])

    response = await client.post(
        "/expenses",
        headers=auth_headers(viewer.tg_id),
        json={"amount": 1500, "category_id": str(uuid4())},
    )

    assert response.status_code == 403


async def test_create_expense_triggers_notification_when_threshold_crossed(
    client: AsyncClient,
    app: FastAPI,
    override_repos: OverrideRepos,
    member: UserResponse,
    account_id: UUID,
) -> None:
    # U3.1: end-to-end wiring of the notification-flow invariant
    # (services/CLAUDE.md) through the real get_expense_service factory.
    override_repos([])
    category_id = uuid4()
    category = CategoryResponse(
        id=category_id, name="Groceries", account_id=account_id, created_at=datetime.now(UTC)
    )
    notification_service = FakeNotificationService()
    app.dependency_overrides[deps.get_budget_plan_repo] = lambda: FakeBudgetPlanRepo(
        fill_pct=90.0, notify_threshold=80
    )
    app.dependency_overrides[deps.get_category_repo] = lambda: FakeCategoryRepo([category])
    app.dependency_overrides[deps.get_notification_service] = lambda: notification_service

    response = await client.post(
        "/expenses",
        headers=auth_headers(member.tg_id),
        json={"amount": 1500, "category_id": str(category_id)},
    )

    assert response.status_code == 201
    assert len(notification_service.sent) == 1


async def test_update_own_expense_as_member(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    account_id: UUID,
) -> None:
    expense = make_expense(account_id=account_id, user_id=member.id)
    override_repos([expense])

    response = await client.patch(
        f"/expenses/{expense.id}", headers=auth_headers(member.tg_id), json={"amount": 2500}
    )

    assert response.status_code == 200
    assert response.json()["amount"] == 2500


async def test_update_other_members_expense_is_403(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    other_member: UserResponse,
    account_id: UUID,
) -> None:
    # Default matrix: member update is own_only — cannot touch another user's expense.
    expense = make_expense(account_id=account_id, user_id=other_member.id)
    override_repos([expense])

    response = await client.patch(
        f"/expenses/{expense.id}", headers=auth_headers(member.tg_id), json={"amount": 2500}
    )

    assert response.status_code == 403


async def test_update_any_expense_as_admin(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    other_member: UserResponse,
    account_id: UUID,
) -> None:
    # Admin is never own_only-restricted (step 2 short-circuits step 6).
    expense = make_expense(account_id=account_id, user_id=other_member.id)
    override_repos([expense])

    response = await client.patch(
        f"/expenses/{expense.id}", headers=auth_headers(admin.tg_id), json={"amount": 2500}
    )

    assert response.status_code == 200


async def test_update_expense_tags_replaces_them(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    account_id: UUID,
) -> None:
    expense = make_expense(account_id=account_id, user_id=member.id)
    override_repos([expense])
    new_tag_id = str(uuid4())

    response = await client.patch(
        f"/expenses/{expense.id}",
        headers=auth_headers(member.tg_id),
        json={"tag_ids": [new_tag_id]},
    )

    assert response.status_code == 200
    assert [t["id"] for t in response.json()["tags"]] == [new_tag_id]


async def test_delete_own_expense_as_member(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    account_id: UUID,
) -> None:
    expense = make_expense(account_id=account_id, user_id=member.id)
    repo = override_repos([expense])

    response = await client.delete(f"/expenses/{expense.id}", headers=auth_headers(member.tg_id))

    assert response.status_code == 204
    assert await repo.get(expense.id) is None


async def test_delete_other_members_expense_is_403(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    other_member: UserResponse,
    account_id: UUID,
) -> None:
    expense = make_expense(account_id=account_id, user_id=other_member.id)
    override_repos([expense])

    response = await client.delete(f"/expenses/{expense.id}", headers=auth_headers(member.tg_id))

    assert response.status_code == 403


async def test_delete_expense_as_viewer_is_403(
    client: AsyncClient,
    override_repos: OverrideRepos,
    viewer: UserResponse,
    account_id: UUID,
) -> None:
    expense = make_expense(account_id=account_id)
    override_repos([expense])

    response = await client.delete(f"/expenses/{expense.id}", headers=auth_headers(viewer.tg_id))

    assert response.status_code == 403
