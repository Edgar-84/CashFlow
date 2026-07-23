"""HTTP tests for api/statistics.py — PermissionChecker(EXPENSES, READ)-gated
read-only aggregates (U2.6 AC).

Hermetic: the real app, with ExpenseRepository/UserRepository/PermissionRepository
replaced by in-memory fakes via app.dependency_overrides (tests/CLAUDE.md) — no DB.
Expenses are seeded with created_at=now() (test_statistics_service.py's
make_expense default) so they always fall inside the "current month" window
the route computes, regardless of wall-clock time at test run.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from test_deps import FakePermissionRepo
from test_statistics_service import FakeExpensePeriodRepo, make_expense
from test_users_api import TgLookupFakeUserRepo, auth_headers

from api import deps
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


OverrideRepos = Callable[..., FakeExpensePeriodRepo]


@pytest.fixture
def override_repos(
    app: FastAPI, member: UserResponse, other_member: UserResponse, viewer: UserResponse
) -> OverrideRepos:
    def _apply(expenses: list[ExpenseResponse] | None = None) -> FakeExpensePeriodRepo:
        app.dependency_overrides[deps.get_user_repo] = lambda: TgLookupFakeUserRepo(
            [member, other_member, viewer]
        )
        app.dependency_overrides[deps.get_permission_repo] = lambda: FakePermissionRepo([])
        repo = FakeExpensePeriodRepo(expenses)
        app.dependency_overrides[deps.get_expense_repo] = lambda: repo
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
