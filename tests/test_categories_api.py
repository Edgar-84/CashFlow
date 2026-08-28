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
from test_deps import FakeAccountRepo, FakePermissionRepo, make_account
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
        is_blocked=False,
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


@pytest.fixture
def category(account_id: UUID) -> CategoryResponse:
    return CategoryResponse(
        id=uuid4(), name="Groceries", account_id=account_id, created_at=datetime.now(UTC)
    )


@pytest.fixture
def archived_category(account_id: UUID) -> CategoryResponse:
    return CategoryResponse(
        id=uuid4(),
        name="Old Category",
        account_id=account_id,
        created_at=datetime.now(UTC),
        is_active=False,
    )


OverrideRepos = Callable[..., FakeCategoryRepo]


@pytest.fixture
def override_repos(
    app: FastAPI,
    admin: UserResponse,
    member: UserResponse,
    viewer: UserResponse,
    account_id: UUID,
) -> OverrideRepos:
    def _apply(
        categories: list[CategoryResponse] | None = None,
        *,
        restricted_ids: set[UUID] | None = None,
        expense_counts: dict[UUID, int] | None = None,
        budget_counts: dict[UUID, int] | None = None,
    ) -> FakeCategoryRepo:
        app.dependency_overrides[deps.get_user_repo] = lambda: TgLookupFakeUserRepo(
            [admin, member, viewer]
        )
        app.dependency_overrides[deps.get_permission_repo] = lambda: FakePermissionRepo([])
        app.dependency_overrides[deps.get_account_repo] = lambda: FakeAccountRepo(
            [make_account(account_id)]
        )
        repo = FakeCategoryRepo(
            categories,
            restricted_ids=restricted_ids,
            expense_counts=expense_counts,
            budget_counts=budget_counts,
        )
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


async def test_list_categories_omits_archived_by_default(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    category: CategoryResponse,
    archived_category: CategoryResponse,
) -> None:
    override_repos([category, archived_category])

    response = await client.get("/categories", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert [c["id"] for c in response.json()] == [str(category.id)]


async def test_list_categories_includes_archived_with_flag(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    category: CategoryResponse,
    archived_category: CategoryResponse,
) -> None:
    override_repos([category, archived_category])

    response = await client.get(
        "/categories?include_archived=true", headers=auth_headers(member.tg_id)
    )

    assert response.status_code == 200
    assert {c["id"] for c in response.json()} == {str(category.id), str(archived_category.id)}


async def test_list_categories_with_usage_populates_expense_count(
    client: AsyncClient,
    override_repos: OverrideRepos,
    member: UserResponse,
    category: CategoryResponse,
) -> None:
    override_repos([category], expense_counts={category.id: 5})

    response = await client.get(
        "/categories?include_usage=true", headers=auth_headers(member.tg_id)
    )

    assert response.status_code == 200
    assert response.json()[0]["expense_count"] == 5


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


async def test_create_category_with_ramp_color_slot_reads_back(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse
) -> None:
    override_repos([])

    response = await client.post(
        "/categories",
        headers=auth_headers(admin.tg_id),
        json={"name": "Utilities", "color_slot": 72},
    )

    assert response.status_code == 201
    assert response.json()["color_slot"] == 72


@pytest.mark.parametrize("color_slot", [0, 73])
async def test_create_category_rejects_out_of_range_color_slot(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, color_slot: int
) -> None:
    override_repos([])

    response = await client.post(
        "/categories",
        headers=auth_headers(admin.tg_id),
        json={"name": "Utilities", "color_slot": color_slot},
    )

    assert response.status_code == 422


async def test_create_category_without_color_slot_auto_assigns_slot_1(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse
) -> None:
    override_repos([])

    response = await client.post(
        "/categories", headers=auth_headers(admin.tg_id), json={"name": "Utilities"}
    )

    assert response.status_code == 201
    assert response.json()["color_slot"] == 1


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


async def test_update_category_with_ramp_color_slot_succeeds(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    category: CategoryResponse,
) -> None:
    override_repos([category])

    response = await client.patch(
        f"/categories/{category.id}", headers=auth_headers(admin.tg_id), json={"color_slot": 40}
    )

    assert response.status_code == 200
    assert response.json()["color_slot"] == 40


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


async def test_delete_category_with_expenses_as_admin_archives_not_deletes(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    category: CategoryResponse,
) -> None:
    # D302: a category still referenced by an expense is archived, not
    # deleted — the row and every expense pointing at it must survive.
    repo = override_repos([category], expense_counts={category.id: 1})

    response = await client.delete(f"/categories/{category.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 204
    survivor = await repo.get(category.id)
    assert survivor is not None
    assert survivor.is_active is False


async def test_delete_referenced_category_as_admin_is_409(
    client: AsyncClient,
    override_repos: OverrideRepos,
    admin: UserResponse,
    category: CategoryResponse,
) -> None:
    # Defensive branch (D302 makes it unreachable in practice): the RESTRICT
    # constraint (D5), if it ever fires, must still surface as a clean 409.
    override_repos([category], restricted_ids={category.id})

    response = await client.delete(f"/categories/{category.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 409
    assert "detail" in response.json()
