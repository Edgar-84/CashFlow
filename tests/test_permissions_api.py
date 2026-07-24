"""HTTP tests for api/permissions.py — require_admin-gated CRUD (U1.5 AC).

Hermetic: the real app, with PermissionRepository/UserRepository/CategoryRepository
replaced by in-memory fakes via app.dependency_overrides (tests/CLAUDE.md) — no DB.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from test_category_service import FakeCategoryRepo
from test_permission_service import FakePermissionRepo
from test_users_api import TgLookupFakeUserRepo, auth_headers

from api import deps
from models.category import CategoryResponse
from models.enums import Resource, Role
from models.permission import PermissionResponse
from models.user import UserResponse


@pytest.fixture
def account_id() -> UUID:
    return uuid4()


@pytest.fixture
def other_account_id() -> UUID:
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
def foreign_user(other_account_id: UUID) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=4,
        name="Foreign",
        role=Role.MEMBER,
        account_id=other_account_id,
        created_at=datetime.now(UTC),
    )


OverrideRepos = Callable[..., FakePermissionRepo]


@pytest.fixture
def override_repos(
    app: FastAPI,
    admin: UserResponse,
    member: UserResponse,
    viewer: UserResponse,
    foreign_user: UserResponse,
) -> OverrideRepos:
    def _apply(rows: list[PermissionResponse] | None = None) -> FakePermissionRepo:
        users = [admin, member, viewer, foreign_user]
        app.dependency_overrides[deps.get_user_repo] = lambda: TgLookupFakeUserRepo(users)
        repo = FakePermissionRepo(rows, users)
        app.dependency_overrides[deps.get_permission_repo] = lambda: repo
        return repo

    return _apply


def make_permission(*, user_id: UUID, resource: Resource = Resource.EXPENSES) -> PermissionResponse:
    return PermissionResponse(
        id=uuid4(),
        user_id=user_id,
        resource=resource,
        can_create=False,
        can_read=True,
        can_update=False,
        can_delete=False,
        own_only=True,
    )


async def test_list_permissions_as_admin_returns_account_grid(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    member: UserResponse,
    foreign_user: UserResponse,
) -> None:
    own_row = make_permission(user_id=member.id, resource=Resource.CATEGORIES)
    foreign_row = make_permission(user_id=foreign_user.id, resource=Resource.TAGS)
    override_repos([own_row, foreign_row])

    response = await client.get("/permissions", headers=auth_headers(admin.tg_id))

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(own_row.id)]


async def test_list_permissions_as_member_is_403(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get("/permissions", headers=auth_headers(member.tg_id))

    assert response.status_code == 403


async def test_list_permissions_as_viewer_is_403(
    client: AsyncClient, override_repos: OverrideRepos, viewer: UserResponse
) -> None:
    override_repos([])

    response = await client.get("/permissions", headers=auth_headers(viewer.tg_id))

    assert response.status_code == 403


async def test_create_permission_as_admin(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, member: UserResponse
) -> None:
    override_repos([])

    response = await client.post(
        "/permissions",
        headers=auth_headers(admin.tg_id),
        json={"user_id": str(member.id), "resource": "categories", "can_update": True},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["user_id"] == str(member.id)
    assert body["can_update"] is True


async def test_create_permission_as_member_is_403(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.post(
        "/permissions",
        headers=auth_headers(member.tg_id),
        json={"user_id": str(member.id), "resource": "categories"},
    )

    assert response.status_code == 403


async def test_create_duplicate_user_resource_is_409(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, member: UserResponse
) -> None:
    existing = make_permission(user_id=member.id, resource=Resource.EXPENSES)
    override_repos([existing])

    response = await client.post(
        "/permissions",
        headers=auth_headers(admin.tg_id),
        json={"user_id": str(member.id), "resource": "expenses"},
    )

    assert response.status_code == 409


async def test_create_permission_for_foreign_account_user_is_404(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    foreign_user: UserResponse,
) -> None:
    override_repos([])

    response = await client.post(
        "/permissions",
        headers=auth_headers(admin.tg_id),
        json={"user_id": str(foreign_user.id), "resource": "expenses"},
    )

    assert response.status_code == 404


async def test_get_permission_as_admin(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, member: UserResponse
) -> None:
    row = make_permission(user_id=member.id)
    override_repos([row])

    response = await client.get(f"/permissions/{row.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 200
    assert response.json()["id"] == str(row.id)


async def test_get_foreign_account_permission_is_404(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    foreign_user: UserResponse,
) -> None:
    row = make_permission(user_id=foreign_user.id)
    override_repos([row])

    response = await client.get(f"/permissions/{row.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 404


async def test_update_permission_as_admin(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, member: UserResponse
) -> None:
    row = make_permission(user_id=member.id)
    override_repos([row])

    response = await client.patch(
        f"/permissions/{row.id}", headers=auth_headers(admin.tg_id), json={"can_update": True}
    )

    assert response.status_code == 200
    assert response.json()["can_update"] is True


async def test_update_permission_as_viewer_is_403(
    client: AsyncClient, override_repos: OverrideRepos, viewer: UserResponse, member: UserResponse
) -> None:
    row = make_permission(user_id=member.id)
    override_repos([row])

    response = await client.patch(
        f"/permissions/{row.id}", headers=auth_headers(viewer.tg_id), json={"can_update": True}
    )

    assert response.status_code == 403


async def test_delete_permission_as_admin(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, member: UserResponse
) -> None:
    row = make_permission(user_id=member.id)
    repo = override_repos([row])

    response = await client.delete(f"/permissions/{row.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 204
    assert await repo.get(row.id) is None


async def test_delete_foreign_account_permission_is_404(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    foreign_user: UserResponse,
) -> None:
    row = make_permission(user_id=foreign_user.id)
    override_repos([row])

    response = await client.delete(f"/permissions/{row.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 404


# --- end-to-end: a granted override changes a subsequent PermissionChecker
# decision on another resource's route (AC) ------------------------------------


async def test_granted_override_flips_a_subsequent_permission_decision(
    client: AsyncClient,
    override_repos: OverrideRepos,
    app: FastAPI,
    admin: UserResponse,
    member: UserResponse,
    account_id: UUID,
) -> None:
    # Members are read-only on categories by default (api/CLAUDE.md matrix).
    override_repos([])
    category = CategoryResponse(
        id=uuid4(), name="Groceries", account_id=account_id, created_at=datetime.now(UTC)
    )
    app.dependency_overrides[deps.get_category_repo] = lambda: FakeCategoryRepo([category])

    before = await client.patch(
        f"/categories/{category.id}", headers=auth_headers(member.tg_id), json={"name": "Food"}
    )
    assert before.status_code == 403

    grant = await client.post(
        "/permissions",
        headers=auth_headers(admin.tg_id),
        json={"user_id": str(member.id), "resource": "categories", "can_update": True},
    )
    assert grant.status_code == 201

    after = await client.patch(
        f"/categories/{category.id}", headers=auth_headers(member.tg_id), json={"name": "Food"}
    )
    assert after.status_code == 200
    assert after.json()["name"] == "Food"
