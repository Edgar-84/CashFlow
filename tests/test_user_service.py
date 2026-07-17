"""Unit tests for services/user_service.py — mocked repository, no DB (tests/CLAUDE.md)."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest

from models.enums import Role
from models.errors import ConflictError, NotFoundError
from models.user import UserCreate, UserResponse, UserUpdate
from services.user_service import UserService


class FakeUserRepo:
    def __init__(self, users: list[UserResponse] | None = None) -> None:
        self._users: dict[UUID, UserResponse] = {u.id: u for u in (users or [])}
        self._duplicate_tg_ids: set[int] = {u.tg_id for u in (users or [])}

    async def list(self, **filters: Any) -> list[UserResponse]:
        account_id = filters.get("account_id")
        return [u for u in self._users.values() if u.account_id == account_id]

    async def get(self, id: UUID) -> UserResponse | None:
        return self._users.get(id)

    async def create(self, data: dict[str, Any]) -> UserResponse:
        if data["tg_id"] in self._duplicate_tg_ids:
            raise asyncpg.UniqueViolationError("duplicate key value violates unique constraint")
        user = UserResponse(
            id=uuid4(),
            tg_id=data["tg_id"],
            name=data["name"],
            role=Role(data["role"]),
            account_id=data["account_id"],
            created_at=datetime.now(UTC),
        )
        self._users[user.id] = user
        self._duplicate_tg_ids.add(user.tg_id)
        return user

    async def update(self, id: UUID, data: dict[str, Any]) -> UserResponse | None:
        user = self._users.get(id)
        if user is None:
            return None
        updated = user.model_copy(update=data)
        self._users[id] = updated
        return updated

    async def delete(self, id: UUID) -> bool:
        return self._users.pop(id, None) is not None


def make_user(*, account_id: UUID, tg_id: int = 1, role: Role = Role.MEMBER) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=tg_id,
        name="Test User",
        role=role,
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


async def test_list_scopes_by_account() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    mine = make_user(account_id=account_id, tg_id=1)
    other = make_user(account_id=other_account_id, tg_id=2)
    service = UserService(FakeUserRepo([mine, other]))

    result = await service.list(account_id)

    assert result == [mine]


async def test_get_returns_user_in_account() -> None:
    account_id = uuid4()
    user = make_user(account_id=account_id)
    service = UserService(FakeUserRepo([user]))

    result = await service.get(user.id, account_id)

    assert result == user


async def test_get_missing_raises_not_found() -> None:
    service = UserService(FakeUserRepo([]))

    with pytest.raises(NotFoundError):
        await service.get(uuid4(), uuid4())


async def test_get_foreign_account_raises_not_found() -> None:
    # A user existing in a different account must 404, not leak cross-account.
    account_id = uuid4()
    other_account_id = uuid4()
    user = make_user(account_id=other_account_id)
    service = UserService(FakeUserRepo([user]))

    with pytest.raises(NotFoundError):
        await service.get(user.id, account_id)


async def test_create_forces_account_id_from_caller() -> None:
    # UserCreate carries an account_id field, but the service must ignore it
    # and use the admin's own account_id (root CLAUDE.md: never trust
    # client-supplied UUIDs).
    account_id = uuid4()
    spoofed_account_id = uuid4()
    service = UserService(FakeUserRepo([]))
    data = UserCreate(tg_id=42, name="New User", role=Role.MEMBER, account_id=spoofed_account_id)

    created = await service.create(data, account_id)

    assert created.account_id == account_id
    assert created.account_id != spoofed_account_id


async def test_create_duplicate_tg_id_raises_conflict() -> None:
    account_id = uuid4()
    existing = make_user(account_id=account_id, tg_id=42)
    service = UserService(FakeUserRepo([existing]))
    data = UserCreate(tg_id=42, name="Dupe", role=Role.MEMBER, account_id=account_id)

    with pytest.raises(ConflictError):
        await service.create(data, account_id)


async def test_update_changes_fields() -> None:
    account_id = uuid4()
    user = make_user(account_id=account_id)
    service = UserService(FakeUserRepo([user]))

    updated = await service.update(user.id, UserUpdate(name="Renamed"), account_id)

    assert updated.name == "Renamed"


async def test_update_explicit_null_fields_are_ignored_not_nulled() -> None:
    # name/role are NOT NULL columns with no "clear" semantics. An explicit
    # {"name": null, "role": null} must not reach the repo as a real update
    # (would otherwise raise an uncaught asyncpg.NotNullViolationError) —
    # it's treated the same as the field being omitted entirely.
    account_id = uuid4()
    user = make_user(account_id=account_id, tg_id=7, role=Role.MEMBER)
    service = UserService(FakeUserRepo([user]))

    updated = await service.update(user.id, UserUpdate(name=None, role=None), account_id)

    assert updated.name == user.name
    assert updated.role == user.role


async def test_update_mixes_real_value_with_ignored_null() -> None:
    account_id = uuid4()
    user = make_user(account_id=account_id, role=Role.MEMBER)
    service = UserService(FakeUserRepo([user]))

    updated = await service.update(user.id, UserUpdate(name="Renamed", role=None), account_id)

    assert updated.name == "Renamed"
    assert updated.role == user.role


async def test_update_missing_raises_not_found() -> None:
    service = UserService(FakeUserRepo([]))

    with pytest.raises(NotFoundError):
        await service.update(uuid4(), UserUpdate(name="X"), uuid4())


async def test_delete_removes_user() -> None:
    account_id = uuid4()
    user = make_user(account_id=account_id)
    repo = FakeUserRepo([user])
    service = UserService(repo)

    await service.delete(user.id, account_id)

    assert await repo.get(user.id) is None


async def test_delete_missing_raises_not_found() -> None:
    service = UserService(FakeUserRepo([]))

    with pytest.raises(NotFoundError):
        await service.delete(uuid4(), uuid4())
