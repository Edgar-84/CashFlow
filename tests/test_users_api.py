"""HTTP tests for api/users.py — admin-only CRUD (U2.2 AC).

Hermetic: the real app, with UserRepository replaced by an in-memory fake via
app.dependency_overrides (tests/CLAUDE.md) — no DB, no network.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from test_user_service import FakeUserRepo

from api import deps
from config import get_settings
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


class TgLookupFakeUserRepo(FakeUserRepo):
    """FakeUserRepo extended with the tg_id lookup get_current_user needs."""

    async def list(self, **filters: Any) -> list[UserResponse]:
        if "tg_id" in filters:
            return [u for u in self._users.values() if u.tg_id == filters["tg_id"]]
        return await super().list(**filters)


def auth_headers(tg_id: int) -> dict[str, str]:
    return {
        "X-Internal-Token": get_settings().internal_token,
        "X-Telegram-User-Id": str(tg_id),
    }


OverrideRepo = Callable[[], TgLookupFakeUserRepo]


@pytest.fixture
def override_repo(
    app: FastAPI, admin: UserResponse, member: UserResponse, viewer: UserResponse
) -> OverrideRepo:
    def _apply() -> TgLookupFakeUserRepo:
        repo = TgLookupFakeUserRepo([admin, member, viewer])
        app.dependency_overrides[deps.get_user_repo] = lambda: repo
        return repo

    return _apply


async def test_list_users_as_admin_returns_account_users(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse
) -> None:
    override_repo()

    response = await client.get("/users", headers=auth_headers(admin.tg_id))

    assert response.status_code == 200
    names = {u["name"] for u in response.json()}
    assert names == {"Admin", "Member", "Viewer"}


async def test_list_users_as_member_is_403(
    client: AsyncClient, override_repo: OverrideRepo, member: UserResponse
) -> None:
    override_repo()

    response = await client.get("/users", headers=auth_headers(member.tg_id))

    assert response.status_code == 403


async def test_list_users_as_viewer_is_403(
    client: AsyncClient, override_repo: OverrideRepo, viewer: UserResponse
) -> None:
    override_repo()

    response = await client.get("/users", headers=auth_headers(viewer.tg_id))

    assert response.status_code == 403


async def test_get_user_as_admin(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse, member: UserResponse
) -> None:
    override_repo()

    response = await client.get(f"/users/{member.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 200
    assert response.json()["id"] == str(member.id)


async def test_get_missing_user_as_admin_is_404(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse
) -> None:
    override_repo()

    response = await client.get(f"/users/{uuid4()}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 404


async def test_get_user_as_member_is_403(
    client: AsyncClient, override_repo: OverrideRepo, member: UserResponse
) -> None:
    override_repo()

    response = await client.get(f"/users/{member.id}", headers=auth_headers(member.tg_id))

    assert response.status_code == 403


async def test_create_user_as_admin(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse, account_id: UUID
) -> None:
    override_repo()

    response = await client.post(
        "/users",
        headers=auth_headers(admin.tg_id),
        json={"tg_id": 999, "name": "New", "role": "member", "account_id": str(uuid4())},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["tg_id"] == 999
    # account_id is forced to the admin's own account, ignoring the spoofed value.
    assert body["account_id"] == str(account_id)


async def test_create_user_duplicate_tg_id_is_409(
    client: AsyncClient,
    override_repo: OverrideRepo,
    admin: UserResponse,
    member: UserResponse,
    account_id: UUID,
) -> None:
    override_repo()

    response = await client.post(
        "/users",
        headers=auth_headers(admin.tg_id),
        json={
            "tg_id": member.tg_id,
            "name": "Dupe",
            "role": "member",
            "account_id": str(account_id),
        },
    )

    assert response.status_code == 409


async def test_create_user_as_member_is_403(
    client: AsyncClient, override_repo: OverrideRepo, member: UserResponse, account_id: UUID
) -> None:
    override_repo()

    response = await client.post(
        "/users",
        headers=auth_headers(member.tg_id),
        json={"tg_id": 999, "name": "New", "role": "member", "account_id": str(account_id)},
    )

    assert response.status_code == 403


async def test_update_user_as_admin(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse, member: UserResponse
) -> None:
    override_repo()

    response = await client.patch(
        f"/users/{member.id}", headers=auth_headers(admin.tg_id), json={"name": "Renamed"}
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"


async def test_update_user_explicit_null_is_ignored_not_500(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse, member: UserResponse
) -> None:
    # name is a NOT NULL column; an explicit null in the PATCH body must be
    # ignored, not crash into an unhandled asyncpg.NotNullViolationError.
    override_repo()

    response = await client.patch(
        f"/users/{member.id}", headers=auth_headers(admin.tg_id), json={"name": None}
    )

    assert response.status_code == 200
    assert response.json()["name"] == member.name


async def test_update_user_as_viewer_is_403(
    client: AsyncClient, override_repo: OverrideRepo, viewer: UserResponse, member: UserResponse
) -> None:
    override_repo()

    response = await client.patch(
        f"/users/{member.id}", headers=auth_headers(viewer.tg_id), json={"name": "Renamed"}
    )

    assert response.status_code == 403


async def test_delete_user_as_admin(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse, member: UserResponse
) -> None:
    repo = override_repo()

    response = await client.delete(f"/users/{member.id}", headers=auth_headers(admin.tg_id))

    assert response.status_code == 204
    assert await repo.get(member.id) is None


async def test_delete_user_as_member_is_403(
    client: AsyncClient, override_repo: OverrideRepo, member: UserResponse
) -> None:
    override_repo()

    response = await client.delete(f"/users/{member.id}", headers=auth_headers(member.tg_id))

    assert response.status_code == 403
