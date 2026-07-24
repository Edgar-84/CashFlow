"""Unit tests for services/permission_service.py — mocked repositories, no DB
(tests/CLAUDE.md)."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest

from models.enums import Resource, Role
from models.errors import ConflictError, NotFoundError
from models.permission import PermissionCreate, PermissionResponse, PermissionUpdate
from models.user import UserResponse
from services.permission_service import PermissionService


class FakePermissionRepo:
    """`users` mirrors the JOIN the real repo's list_by_account does in SQL —
    unused by tests that never call `list`."""

    def __init__(
        self,
        rows: list[PermissionResponse] | None = None,
        users: list[UserResponse] | None = None,
    ) -> None:
        self._rows: dict[UUID, PermissionResponse] = {r.id: r for r in (rows or [])}
        self._users: dict[UUID, UserResponse] = {u.id: u for u in (users or [])}

    async def list_by_account(self, account_id: UUID) -> list[PermissionResponse]:
        return [
            row
            for row in self._rows.values()
            if (u := self._users.get(row.user_id)) is not None and u.account_id == account_id
        ]

    async def get(self, id: UUID) -> PermissionResponse | None:
        return self._rows.get(id)

    async def create(self, data: dict[str, Any]) -> PermissionResponse:
        for row in self._rows.values():
            if row.user_id == data["user_id"] and row.resource == data["resource"]:
                raise asyncpg.UniqueViolationError("duplicate key value violates unique constraint")
        row = PermissionResponse(id=uuid4(), **data)
        self._rows[row.id] = row
        return row

    async def update(self, id: UUID, data: dict[str, Any]) -> PermissionResponse | None:
        row = self._rows.get(id)
        if row is None:
            return None
        updated = row.model_copy(update=data)
        self._rows[id] = updated
        return updated

    async def delete(self, id: UUID) -> bool:
        return self._rows.pop(id, None) is not None

    async def get_by_user_and_resource(
        self, user_id: UUID, resource: Resource
    ) -> PermissionResponse | None:
        """The lookup api/deps.py's PermissionChecker performs — lets this fake
        double as both the CRUD repo and the auth-pipeline repo in HTTP tests
        that exercise a granted override end-to-end (tests/test_permissions_api.py)."""
        for row in self._rows.values():
            if row.user_id == user_id and row.resource == resource:
                return row
        return None


class FakeUserRepo:
    def __init__(self, users: list[UserResponse] | None = None) -> None:
        self._users: dict[UUID, UserResponse] = {u.id: u for u in (users or [])}

    async def get(self, id: UUID) -> UserResponse | None:
        return self._users.get(id)


def make_user(*, account_id: UUID, role: Role = Role.MEMBER, tg_id: int = 1) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=tg_id,
        name="Test User",
        role=role,
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


def make_permission(
    *, user_id: UUID, resource: Resource = Resource.EXPENSES, **overrides: Any
) -> PermissionResponse:
    defaults: dict[str, Any] = {
        "id": uuid4(),
        "user_id": user_id,
        "resource": resource,
        "can_create": False,
        "can_read": True,
        "can_update": False,
        "can_delete": False,
        "own_only": True,
    }
    defaults.update(overrides)
    return PermissionResponse(**defaults)


async def test_list_scopes_to_account() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    user = make_user(account_id=account_id)
    other_user = make_user(account_id=other_account_id)
    rows = [
        make_permission(user_id=user.id, resource=Resource.EXPENSES),
        make_permission(user_id=other_user.id, resource=Resource.CATEGORIES),
    ]
    repo = FakePermissionRepo(rows, [user, other_user])
    service = PermissionService(repo, FakeUserRepo([user, other_user]))

    result = await service.list(account_id)

    assert [r.user_id for r in result] == [user.id]


async def test_get_missing_permission_is_not_found() -> None:
    account_id = uuid4()
    repo = FakePermissionRepo()
    service = PermissionService(repo, FakeUserRepo())

    with pytest.raises(NotFoundError):
        await service.get(uuid4(), account_id)


async def test_get_foreign_account_permission_is_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    other_user = make_user(account_id=other_account_id)
    row = make_permission(user_id=other_user.id)
    repo = FakePermissionRepo([row])
    service = PermissionService(repo, FakeUserRepo([other_user]))

    with pytest.raises(NotFoundError):
        await service.get(row.id, account_id)


async def test_create_permission_for_own_account_user() -> None:
    account_id = uuid4()
    user = make_user(account_id=account_id)
    repo = FakePermissionRepo()
    service = PermissionService(repo, FakeUserRepo([user]))

    created = await service.create(
        PermissionCreate(user_id=user.id, resource=Resource.CATEGORIES, can_update=True),
        account_id,
    )

    assert created.user_id == user.id
    assert created.resource == Resource.CATEGORIES
    assert created.can_update is True


async def test_create_permission_for_foreign_account_user_is_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    other_user = make_user(account_id=other_account_id)
    repo = FakePermissionRepo()
    service = PermissionService(repo, FakeUserRepo([other_user]))

    with pytest.raises(NotFoundError):
        await service.create(
            PermissionCreate(user_id=other_user.id, resource=Resource.EXPENSES), account_id
        )


async def test_create_permission_for_unknown_user_is_not_found() -> None:
    account_id = uuid4()
    repo = FakePermissionRepo()
    service = PermissionService(repo, FakeUserRepo())

    with pytest.raises(NotFoundError):
        await service.create(
            PermissionCreate(user_id=uuid4(), resource=Resource.EXPENSES), account_id
        )


async def test_create_duplicate_user_resource_is_conflict() -> None:
    account_id = uuid4()
    user = make_user(account_id=account_id)
    existing = make_permission(user_id=user.id, resource=Resource.EXPENSES)
    repo = FakePermissionRepo([existing])
    service = PermissionService(repo, FakeUserRepo([user]))

    with pytest.raises(ConflictError):
        await service.create(
            PermissionCreate(user_id=user.id, resource=Resource.EXPENSES), account_id
        )


async def test_update_applies_partial_changes() -> None:
    account_id = uuid4()
    user = make_user(account_id=account_id)
    existing = make_permission(user_id=user.id, resource=Resource.EXPENSES, can_update=False)
    repo = FakePermissionRepo([existing])
    service = PermissionService(repo, FakeUserRepo([user]))

    updated = await service.update(existing.id, PermissionUpdate(can_update=True), account_id)

    assert updated.can_update is True
    assert updated.can_create is existing.can_create  # untouched fields unchanged


async def test_update_foreign_account_permission_is_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    other_user = make_user(account_id=other_account_id)
    existing = make_permission(user_id=other_user.id)
    repo = FakePermissionRepo([existing])
    service = PermissionService(repo, FakeUserRepo([other_user]))

    with pytest.raises(NotFoundError):
        await service.update(existing.id, PermissionUpdate(can_update=True), account_id)


async def test_delete_removes_row() -> None:
    account_id = uuid4()
    user = make_user(account_id=account_id)
    existing = make_permission(user_id=user.id)
    repo = FakePermissionRepo([existing])
    service = PermissionService(repo, FakeUserRepo([user]))

    await service.delete(existing.id, account_id)

    assert await repo.get(existing.id) is None


async def test_delete_foreign_account_permission_is_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    other_user = make_user(account_id=other_account_id)
    existing = make_permission(user_id=other_user.id)
    repo = FakePermissionRepo([existing])
    service = PermissionService(repo, FakeUserRepo([other_user]))

    with pytest.raises(NotFoundError):
        await service.delete(existing.id, account_id)
