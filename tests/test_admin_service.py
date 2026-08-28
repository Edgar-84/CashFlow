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
from models.errors import ConflictError
from models.user import UserResponse
from services.admin_service import AdminService


class FakeAccountRepo:
    def __init__(self) -> None:
        self._accounts: dict[UUID, AccountResponse] = {}

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
    def __init__(self, existing_tg_ids: set[int] | None = None) -> None:
        self._existing_tg_ids: set[int] = set(existing_tg_ids or set())
        self.created: list[dict[str, Any]] = []

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
