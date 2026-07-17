"""HTTP tests for api/categories.py — PermissionChecker-gated CRUD (U2.3 AC).

Hermetic: the real app, with CategoryRepository/UserRepository/PermissionRepository
replaced by in-memory fakes via app.dependency_overrides (tests/CLAUDE.md) — no DB.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from test_category_service import FakeCategoryRepo
from test_deps import FakePermissionRepo
from test_users_api import TgLookupFakeUserRepo, auth_headers

from api import deps
from models.category import CategoryResponse
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
def category(account_id: UUID) -> CategoryResponse:
    return CategoryResponse(
        id=uuid4(), name="Groceries", account_id=account_id, created_at=datetime.now(UTC)
    )


OverrideRepos = Callable[..., FakeCategoryRepo]


@pytest.fixture
def override_repos(
    app: FastAPI, admin: UserResponse, member: UserResponse, viewer: UserResponse
) -> OverrideRepos:
    def _apply(
        categories: list[CategoryResponse] | None = None, *, restricted_ids: set[UUID] | None = None
    ) -> FakeCategoryRepo:
        app.dependency_overrides[deps.get_user_repo] = lambda: TgLookupFakeUserRepo(
            [admin, member, viewer]
        )
        app.dependency_overrides[deps.get_permission_repo] = lambda: FakePermissionRepo([])
        repo = FakeCategoryRepo(categories, restricted_ids=restricted_ids)
        app.dependency_overrides[deps.get_category_repo] = lambda: repo
        return repo

    return _apply


async def test_list_categories_as_member_returns_account_categories(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    category: CategoryResponse,
) -> None:
    override_repos([category])

    response = await client.get("/categories", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert [c["id"] for c in response.json()] == [str(category.id)]


async def test_get_category_as_viewer(
    client: AsyncClient,
    override_repos: OverrideRepos,
    viewer: UserResponse,
    category: CategoryResponse,
) -> None:
    override_repos([category])

    response = await client.get(f"/categories/{category.id}", headers=auth_headers(viewer.tg_id))

    assert response.status_code == 200
    assert response.json()["id"] == str(category.id)


async def test_get_missing_category_is_404(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(f"/categories/{uuid4()}", headers=auth_headers(member.tg_id))

    assert response.status_code == 404


async def test_create_category_as_admin(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, account_id: UUID
) -> None:
    override_repos([])

    response = await client.post(
        "/categories", headers=auth_headers(admin.tg_id), json={"name": "Utilities"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Utilities"
    assert body["account_id"] == str(account_id)


async def test_create_category_as_member_is_403(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    # Default matrix: member is read-only on categories (api/CLAUDE.md).
    override_repos([])

    response = await client.post(
        "/categories", headers=auth_headers(member.tg_id), json={"name": "Utilities"}
    )

    assert response.status_code == 403


async def test_create_category_as_viewer_is_403(
    client: AsyncClient, override_repos: OverrideRepos, viewer: UserResponse
) -> None:
    override_repos([])

    response = await client.post(
        "/categories", headers=auth_headers(viewer.tg_id), json={"name": "Utilities"}
    )

    assert response.status_code == 403


async def test_update_category_as_admin(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    category: CategoryResponse,
) -> None:
    override_repos([category])

    response = await client.patch(
        f"/categories/{category.id}", headers=auth_headers(admin.tg_id), json={"name": "Renamed"}
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"


async def test_update_category_as_member_is_403(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    category: CategoryResponse,
) -> None:
    override_repos([category])

    response = await client.patch(
        f"/categories/{category.id}", headers=auth_headers(member.tg_id), json={"name": "Renamed"}
    )

    assert response.status_code == 403


async def test_delete_category_as_admin(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    category: CategoryResponse,
) -> None:
    repo = override_repos([category])

    response = await client.delete(f"/categories/{category.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 204
    assert await repo.get(category.id) is None


async def test_delete_category_as_member_is_403(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    category: CategoryResponse,
) -> None:
    override_repos([category])

    response = await client.delete(f"/categories/{category.id}", headers=auth_headers(member.tg_id))

    assert response.status_code == 403


async def test_delete_referenced_category_as_admin_is_409(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    category: CategoryResponse,
) -> None:
    # RESTRICT delete (D5) must surface as a clean 409, not a 500.
    override_repos([category], restricted_ids={category.id})

    response = await client.delete(f"/categories/{category.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 409
    assert "detail" in response.json()
