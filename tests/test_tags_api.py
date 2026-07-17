"""HTTP tests for api/tags.py — PermissionChecker-gated CRUD (U2.3 AC).

Hermetic: the real app, with TagRepository/UserRepository/PermissionRepository
replaced by in-memory fakes via app.dependency_overrides (tests/CLAUDE.md) — no DB.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from test_deps import FakePermissionRepo
from test_tag_service import FakeTagRepo
from test_users_api import TgLookupFakeUserRepo, auth_headers

from api import deps
from models.enums import Role
from models.tag import TagResponse
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
def tag(account_id: UUID) -> TagResponse:
    return TagResponse(
        id=uuid4(), name="urgent", account_id=account_id, created_at=datetime.now(UTC)
    )


OverrideRepos = Callable[..., FakeTagRepo]


@pytest.fixture
def override_repos(
    app: FastAPI, admin: UserResponse, member: UserResponse, viewer: UserResponse
) -> OverrideRepos:
    def _apply(tags: list[TagResponse] | None = None) -> FakeTagRepo:
        app.dependency_overrides[deps.get_user_repo] = lambda: TgLookupFakeUserRepo(
            [admin, member, viewer]
        )
        app.dependency_overrides[deps.get_permission_repo] = lambda: FakePermissionRepo([])
        repo = FakeTagRepo(tags)
        app.dependency_overrides[deps.get_tag_repo] = lambda: repo
        return repo

    return _apply


async def test_list_tags_as_member_returns_account_tags(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, tag: TagResponse
) -> None:
    override_repos([tag])

    response = await client.get("/tags", headers=auth_headers(member.tg_id))

    assert response.status_code == 200
    assert [t["id"] for t in response.json()] == [str(tag.id)]


async def test_get_tag_as_viewer(
    client: AsyncClient, override_repos: OverrideRepos, viewer: UserResponse, tag: TagResponse
) -> None:
    override_repos([tag])

    response = await client.get(f"/tags/{tag.id}", headers=auth_headers(viewer.tg_id))

    assert response.status_code == 200
    assert response.json()["id"] == str(tag.id)


async def test_get_missing_tag_is_404(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    override_repos([])

    response = await client.get(f"/tags/{uuid4()}", headers=auth_headers(member.tg_id))

    assert response.status_code == 404


async def test_create_tag_as_admin(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, account_id: UUID
) -> None:
    override_repos([])

    response = await client.post(
        "/tags", headers=auth_headers(admin.tg_id), json={"name": "urgent"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "urgent"
    assert body["account_id"] == str(account_id)


async def test_create_tag_as_member_is_403(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse
) -> None:
    # Default matrix: member is read-only on tags (api/CLAUDE.md).
    override_repos([])

    response = await client.post(
        "/tags", headers=auth_headers(member.tg_id), json={"name": "urgent"}
    )

    assert response.status_code == 403


async def test_create_tag_as_viewer_is_403(
    client: AsyncClient, override_repos: OverrideRepos, viewer: UserResponse
) -> None:
    override_repos([])

    response = await client.post(
        "/tags", headers=auth_headers(viewer.tg_id), json={"name": "urgent"}
    )

    assert response.status_code == 403


async def test_update_tag_as_admin(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, tag: TagResponse
) -> None:
    override_repos([tag])

    response = await client.patch(
        f"/tags/{tag.id}", headers=auth_headers(admin.tg_id), json={"name": "renamed"}
    )

    assert response.status_code == 200
    assert response.json()["name"] == "renamed"


async def test_update_tag_as_member_is_403(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, tag: TagResponse
) -> None:
    override_repos([tag])

    response = await client.patch(
        f"/tags/{tag.id}", headers=auth_headers(member.tg_id), json={"name": "renamed"}
    )

    assert response.status_code == 403


async def test_delete_tag_as_admin(
    client: AsyncClient, override_repos: OverrideRepos, admin: UserResponse, tag: TagResponse
) -> None:
    repo = override_repos([tag])

    response = await client.delete(f"/tags/{tag.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 204
    assert await repo.get(tag.id) is None


async def test_delete_tag_as_member_is_403(
    client: AsyncClient, override_repos: OverrideRepos, member: UserResponse, tag: TagResponse
) -> None:
    override_repos([tag])

    response = await client.delete(f"/tags/{tag.id}", headers=auth_headers(member.tg_id))

    assert response.status_code == 403
