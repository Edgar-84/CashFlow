"""Unit tests for services/admin_service.py — mocked repositories, no DB
(tests/CLAUDE.md). `list_accounts`/`list_users` are already covered end to
end via tests/test_admin_api.py (U4.3); this file covers `create_account`
(U4.4). The real transactional-rollback guarantee is proven against a real
Postgres in tests/test_account_repo.py — these fakes only need to run the
`async with ...transaction():` block so the service's own logic (payload
shape, the duplicate-tg_id -> ConflictError translation, stopping before the
category write on failure) can be tested hermetically.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest

from models.account import AccountResponse
from models.admin import AdminAccountCreate, AdminAccountRow, AdminUserRow
from models.category import CategoryResponse
from models.enums import Currency, Language, Role
from models.errors import ConflictError, NotFoundError
from models.user import UserResponse
from services.admin_service import AdminService


class FakeAccountRepo:
    def __init__(self, accounts: list[AccountResponse] | None = None) -> None:
        self._accounts: dict[UUID, AccountResponse] = {a.id: a for a in (accounts or [])}

    async def get(self, id: UUID) -> AccountResponse | None:
        return self._accounts.get(id)

    async def list_for_admin(self) -> list[AdminAccountRow]:
        raise NotImplementedError("not exercised by these tests")

    async def create(self, data: dict[str, Any]) -> AccountResponse:
        account = AccountResponse(
            id=uuid4(),
            name=data["name"],
            currency=Currency(data["currency"]),
            language=Language(data["language"]),
            owner_id=None,
            is_blocked=False,
            created_at=datetime.now(UTC),
        )
        self._accounts[account.id] = account
        return account

    async def update(self, id: UUID, data: dict[str, Any]) -> AccountResponse | None:
        account = self._accounts.get(id)
        if account is None:
            return None
        updated = account.model_copy(update=data)
        self._accounts[id] = updated
        return updated

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        yield


class FakeUserRepo:
    def __init__(
        self, existing_tg_ids: set[int] | None = None, users: list[UserResponse] | None = None
    ) -> None:
        self._existing_tg_ids: set[int] = set(existing_tg_ids or set())
        self._users: dict[UUID, UserResponse] = {u.id: u for u in (users or [])}
        self.created: list[dict[str, Any]] = []

    async def get(self, id: UUID) -> UserResponse | None:
        return self._users.get(id)

    async def list_for_admin(self) -> list[AdminUserRow]:
        raise NotImplementedError("not exercised by these tests")

    async def create(self, data: dict[str, Any]) -> UserResponse:
        if data["tg_id"] in self._existing_tg_ids:
            raise asyncpg.UniqueViolationError("duplicate key value violates unique constraint")
        self._existing_tg_ids.add(data["tg_id"])
        self.created.append(data)
        return UserResponse(
            id=uuid4(),
            tg_id=data["tg_id"],
            name=data["name"],
            role=Role(data["role"]),
            is_blocked=False,
            account_id=data["account_id"],
            created_at=datetime.now(UTC),
        )

    async def update(self, id: UUID, data: dict[str, Any]) -> UserResponse | None:
        user = self._users.get(id)
        if user is None:
            return None
        updated = user.model_copy(update=data)
        self._users[id] = updated
        return updated


class FakeCategoryRepo:
    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []

    async def create(self, data: dict[str, Any]) -> CategoryResponse:
        self.created.append(data)
        return CategoryResponse(
            id=uuid4(),
            name=data["name"],
            account_id=data["account_id"],
            created_at=datetime.now(UTC),
            is_active=True,
            color_slot=data.get("color_slot"),
            expense_count=None,
        )


def make_create(**overrides: Any) -> AdminAccountCreate:
    payload: dict[str, Any] = {"name": "New Family", "owner_tg_id": 999, "owner_name": "Owner"}
    payload.update(overrides)
    return AdminAccountCreate(**payload)


async def test_create_account_creates_account_owner_and_general_category() -> None:
    account_repo = FakeAccountRepo()
    user_repo = FakeUserRepo()
    category_repo = FakeCategoryRepo()
    service = AdminService(account_repo, user_repo, category_repo)

    row = await service.create_account(make_create())

    assert row.name == "New Family"
    assert row.user_count == 1
    assert user_repo.created[0]["tg_id"] == 999
    assert user_repo.created[0]["role"] == Role.ADMIN.value
    assert category_repo.created[0]["name"] == "General"
    assert category_repo.created[0]["account_id"] == row.id


async def test_create_account_sets_owner_id_on_account_row() -> None:
    account_repo = FakeAccountRepo()
    service = AdminService(account_repo, FakeUserRepo(), FakeCategoryRepo())

    row = await service.create_account(make_create())

    stored = account_repo._accounts[row.id]
    assert stored.owner_id is not None


async def test_create_account_defaults_currency_and_language() -> None:
    service = AdminService(FakeAccountRepo(), FakeUserRepo(), FakeCategoryRepo())

    row = await service.create_account(make_create())

    assert row.currency == Currency.USD
    assert row.language == Language.EN


async def test_create_account_honours_explicit_currency_and_language() -> None:
    service = AdminService(FakeAccountRepo(), FakeUserRepo(), FakeCategoryRepo())

    row = await service.create_account(make_create(currency=Currency.PLN, language=Language.UK))

    assert row.currency == Currency.PLN
    assert row.language == Language.UK


async def test_create_account_duplicate_owner_tg_id_is_conflict_not_500() -> None:
    category_repo = FakeCategoryRepo()
    service = AdminService(FakeAccountRepo(), FakeUserRepo(existing_tg_ids={999}), category_repo)

    with pytest.raises(ConflictError):
        await service.create_account(make_create(owner_tg_id=999))

    # Stops before the category write once the owner insert fails.
    assert category_repo.created == []


def make_account(**overrides: Any) -> AccountResponse:
    payload: dict[str, Any] = {
        "id": uuid4(),
        "name": "Family",
        "currency": Currency.USD,
        "language": Language.EN,
        "owner_id": None,
        "is_blocked": False,
        "created_at": datetime.now(UTC),
    }
    payload.update(overrides)
    return AccountResponse(**payload)


def make_user(**overrides: Any) -> UserResponse:
    payload: dict[str, Any] = {
        "id": uuid4(),
        "tg_id": 1,
        "name": "User",
        "role": Role.MEMBER,
        "is_blocked": False,
        "account_id": uuid4(),
        "created_at": datetime.now(UTC),
    }
    payload.update(overrides)
    return UserResponse(**payload)


async def test_block_user_sets_is_blocked() -> None:
    target = make_user()
    caller = make_user()
    user_repo = FakeUserRepo(users=[target, caller])
    service = AdminService(FakeAccountRepo(), user_repo, FakeCategoryRepo())

    updated = await service.block_user(target.id, True, caller)

    assert updated.is_blocked is True


async def test_unblock_user_clears_is_blocked() -> None:
    target = make_user(is_blocked=True)
    caller = make_user()
    user_repo = FakeUserRepo(users=[target, caller])
    service = AdminService(FakeAccountRepo(), user_repo, FakeCategoryRepo())

    updated = await service.block_user(target.id, False, caller)

    assert updated.is_blocked is False


async def test_block_user_missing_is_not_found() -> None:
    caller = make_user()
    service = AdminService(FakeAccountRepo(), FakeUserRepo(users=[caller]), FakeCategoryRepo())

    with pytest.raises(NotFoundError):
        await service.block_user(uuid4(), True, caller)


async def test_system_admin_cannot_block_themselves() -> None:
    caller = make_user()
    service = AdminService(FakeAccountRepo(), FakeUserRepo(users=[caller]), FakeCategoryRepo())

    with pytest.raises(ValueError):
        await service.block_user(caller.id, True, caller)


async def test_system_admin_can_unblock_themselves() -> None:
    # The guard is direction-only (blocking, not unblocking) — a caller who
    # somehow ended up blocked (e.g. individually, before becoming a system
    # admin) is not permanently stuck.
    caller = make_user(is_blocked=True)
    service = AdminService(FakeAccountRepo(), FakeUserRepo(users=[caller]), FakeCategoryRepo())

    updated = await service.block_user(caller.id, False, caller)

    assert updated.is_blocked is False


async def test_block_account_sets_is_blocked_only_not_users() -> None:
    account = make_account()
    caller = make_user(account_id=uuid4())  # a different account than the target
    member = make_user(account_id=account.id)  # a member of the account being blocked
    account_repo = FakeAccountRepo([account])
    user_repo = FakeUserRepo(users=[caller, member])
    service = AdminService(account_repo, user_repo, FakeCategoryRepo())

    updated = await service.block_account(account.id, True, caller)

    assert updated.is_blocked is True
    # D714: blocking an account never writes users.is_blocked, even for a
    # user who belongs to the account just blocked.
    member_row = await user_repo.get(member.id)
    assert member_row is not None
    assert member_row.is_blocked is False


async def test_unblock_account_clears_is_blocked() -> None:
    account = make_account(is_blocked=True)
    caller = make_user(account_id=uuid4())
    account_repo = FakeAccountRepo([account])
    service = AdminService(account_repo, FakeUserRepo(users=[caller]), FakeCategoryRepo())

    updated = await service.block_account(account.id, False, caller)

    assert updated.is_blocked is False


async def test_block_account_missing_is_not_found() -> None:
    caller = make_user()
    service = AdminService(FakeAccountRepo(), FakeUserRepo(users=[caller]), FakeCategoryRepo())

    with pytest.raises(NotFoundError):
        await service.block_account(uuid4(), True, caller)


async def test_system_admin_cannot_block_their_own_account() -> None:
    caller = make_user()
    account = make_account(id=caller.account_id)
    service = AdminService(
        FakeAccountRepo([account]), FakeUserRepo(users=[caller]), FakeCategoryRepo()
    )

    with pytest.raises(ValueError):
        await service.block_account(account.id, True, caller)
