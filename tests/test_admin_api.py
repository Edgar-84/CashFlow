"""HTTP tests for api/admin.py — GET /admin/accounts, GET /admin/users (U4.3 AC).

Hermetic: the real app, with AccountRepository/UserRepository replaced by
in-memory fakes via app.dependency_overrides (tests/CLAUDE.md) — no DB.
"""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from test_users_api import TgLookupFakeUserRepo, auth_headers

from api import deps
from models.account import AccountResponse
from models.admin import AdminAccountRow, AdminUserRow
from models.category import CategoryResponse
from models.enums import Currency, Language, Role
from models.user import UserResponse


@pytest.fixture
def account_id() -> UUID:
    return uuid4()


@pytest.fixture
def other_account_id() -> UUID:
    return uuid4()


@pytest.fixture
def system_admin(account_id: UUID) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=1,
        name="System Admin",
        role=Role.SYSTEM_ADMIN,
        is_blocked=False,
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


@pytest.fixture
def admin(account_id: UUID) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=2,
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
        tg_id=3,
        name="Member",
        role=Role.MEMBER,
        is_blocked=False,
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


@pytest.fixture
def foreign_user(other_account_id: UUID) -> UserResponse:
    # Belongs to a *different* account than system_admin/admin/member — proves
    # GET /admin/users reads across account boundaries (D711).
    return UserResponse(
        id=uuid4(),
        tg_id=4,
        name="Foreign Member",
        role=Role.MEMBER,
        is_blocked=False,
        account_id=other_account_id,
        created_at=datetime.now(UTC),
    )


@pytest.fixture
def account(account_id: UUID) -> AccountResponse:
    return AccountResponse(
        id=account_id,
        name="Home Account",
        currency=Currency.USD,
        language=Language.EN,
        owner_id=None,
        is_blocked=False,
        created_at=datetime.now(UTC),
    )


@pytest.fixture
def other_account(other_account_id: UUID) -> AccountResponse:
    return AccountResponse(
        id=other_account_id,
        name="Foreign Account",
        currency=Currency.EUR,
        language=Language.EN,
        owner_id=None,
        is_blocked=False,
        created_at=datetime.now(UTC),
    )


class AdminFakeUserRepo(TgLookupFakeUserRepo):
    def __init__(self, users: list[UserResponse], account_names: dict[UUID, str]) -> None:
        super().__init__(users)
        self._account_names = account_names

    async def list_for_admin(self) -> list[AdminUserRow]:
        return [
            AdminUserRow(
                id=u.id,
                tg_id=u.tg_id,
                name=u.name,
                role=u.role,
                account_id=u.account_id,
                account_name=self._account_names[u.account_id],
                is_blocked=u.is_blocked,
            )
            for u in self._users.values()
        ]


class AdminFakeAccountRepo:
    def __init__(self, accounts: dict[UUID, AccountResponse], user_counts: dict[UUID, int]) -> None:
        self._accounts = accounts
        self._user_counts = user_counts

    async def get(self, id: UUID) -> AccountResponse | None:
        return self._accounts.get(id)

    async def list_for_admin(self) -> list[AdminAccountRow]:
        return [
            AdminAccountRow(
                id=a.id,
                name=a.name,
                currency=a.currency,
                language=a.language,
                is_blocked=a.is_blocked,
                user_count=self._user_counts.get(a.id, 0),
                created_at=a.created_at,
            )
            for a in self._accounts.values()
        ]

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


class AdminFakeCategoryRepo:
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


OverrideRepo = Callable[[], tuple[AdminFakeUserRepo, AdminFakeAccountRepo, AdminFakeCategoryRepo]]


@pytest.fixture
def override_repo(
    app: FastAPI,
    system_admin: UserResponse,
    admin: UserResponse,
    member: UserResponse,
    foreign_user: UserResponse,
    account: AccountResponse,
    other_account: AccountResponse,
) -> OverrideRepo:
    def _apply() -> tuple[AdminFakeUserRepo, AdminFakeAccountRepo, AdminFakeCategoryRepo]:
        user_repo = AdminFakeUserRepo(
            [system_admin, admin, member, foreign_user],
            {account.id: account.name, other_account.id: other_account.name},
        )
        account_repo = AdminFakeAccountRepo(
            {account.id: account, other_account.id: other_account},
            {account.id: 3, other_account.id: 1},
        )
        category_repo = AdminFakeCategoryRepo()
        app.dependency_overrides[deps.get_user_repo] = lambda: user_repo
        app.dependency_overrides[deps.get_account_repo] = lambda: account_repo
        app.dependency_overrides[deps.get_category_repo] = lambda: category_repo
        return user_repo, account_repo, category_repo

    return _apply


async def test_list_accounts_as_system_admin_returns_every_account(
    client: AsyncClient,
    override_repo: OverrideRepo,
    system_admin: UserResponse,
    account: AccountResponse,
    other_account: AccountResponse,
) -> None:
    override_repo()

    response = await client.get("/admin/accounts", headers=auth_headers(system_admin.tg_id))

    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert ids == {str(account.id), str(other_account.id)}


async def test_list_accounts_includes_user_count(
    client: AsyncClient,
    override_repo: OverrideRepo,
    system_admin: UserResponse,
    account: AccountResponse,
) -> None:
    override_repo()

    response = await client.get("/admin/accounts", headers=auth_headers(system_admin.tg_id))

    assert response.status_code == 200
    row = next(r for r in response.json() if r["id"] == str(account.id))
    assert row["user_count"] == 3


async def test_list_accounts_as_admin_is_403(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse
) -> None:
    override_repo()

    response = await client.get("/admin/accounts", headers=auth_headers(admin.tg_id))

    assert response.status_code == 403


async def test_list_accounts_as_member_is_403(
    client: AsyncClient, override_repo: OverrideRepo, member: UserResponse
) -> None:
    override_repo()

    response = await client.get("/admin/accounts", headers=auth_headers(member.tg_id))

    assert response.status_code == 403


async def test_list_accounts_missing_credentials_is_401(
    client: AsyncClient, override_repo: OverrideRepo
) -> None:
    override_repo()

    response = await client.get("/admin/accounts")

    assert response.status_code == 401


async def test_list_users_as_system_admin_returns_every_user_across_accounts(
    client: AsyncClient,
    override_repo: OverrideRepo,
    system_admin: UserResponse,
    foreign_user: UserResponse,
    other_account: AccountResponse,
) -> None:
    override_repo()

    response = await client.get("/admin/users", headers=auth_headers(system_admin.tg_id))

    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(foreign_user.id) in ids
    foreign_row = next(r for r in response.json() if r["id"] == str(foreign_user.id))
    assert foreign_row["account_name"] == other_account.name


async def test_list_users_as_admin_is_403(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse
) -> None:
    # A plain admin is denied here, unlike require_admin's routes — D711.
    override_repo()

    response = await client.get("/admin/users", headers=auth_headers(admin.tg_id))

    assert response.status_code == 403


async def test_list_users_as_member_is_403(
    client: AsyncClient, override_repo: OverrideRepo, member: UserResponse
) -> None:
    override_repo()

    response = await client.get("/admin/users", headers=auth_headers(member.tg_id))

    assert response.status_code == 403


async def test_list_users_missing_credentials_is_401(
    client: AsyncClient, override_repo: OverrideRepo
) -> None:
    override_repo()

    response = await client.get("/admin/users")

    assert response.status_code == 401


async def test_list_users_blocked_system_admin_is_403_not_200(
    client: AsyncClient,
    override_repo: OverrideRepo,
    system_admin: UserResponse,
) -> None:
    # get_current_user's block gate (D713) applies here too — a suspended
    # system admin must not reach the cross-account surface.
    user_repo, _, _ = override_repo()
    user_repo._users[system_admin.id] = system_admin.model_copy(update={"is_blocked": True})

    response = await client.get("/admin/users", headers=auth_headers(system_admin.tg_id))

    assert response.status_code == 403


def create_account_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"name": "New Family", "owner_tg_id": 555, "owner_name": "Owner"}
    payload.update(overrides)
    return payload


async def test_create_account_as_system_admin_returns_201(
    client: AsyncClient,
    override_repo: OverrideRepo,
    system_admin: UserResponse,
) -> None:
    _, _, category_repo = override_repo()

    response = await client.post(
        "/admin/accounts",
        json=create_account_payload(),
        headers=auth_headers(system_admin.tg_id),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "New Family"
    assert body["user_count"] == 1
    assert body["currency"] == "USD"
    assert body["language"] == "en"
    assert category_repo.created[0]["name"] == "General"


async def test_create_account_duplicate_owner_tg_id_is_409(
    client: AsyncClient,
    override_repo: OverrideRepo,
    system_admin: UserResponse,
    admin: UserResponse,
) -> None:
    override_repo()

    response = await client.post(
        "/admin/accounts",
        json=create_account_payload(owner_tg_id=admin.tg_id),
        headers=auth_headers(system_admin.tg_id),
    )

    assert response.status_code == 409


async def test_create_account_as_admin_is_403(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse
) -> None:
    override_repo()

    response = await client.post(
        "/admin/accounts",
        json=create_account_payload(),
        headers=auth_headers(admin.tg_id),
    )

    assert response.status_code == 403


async def test_create_account_as_member_is_403(
    client: AsyncClient, override_repo: OverrideRepo, member: UserResponse
) -> None:
    override_repo()

    response = await client.post(
        "/admin/accounts",
        json=create_account_payload(),
        headers=auth_headers(member.tg_id),
    )

    assert response.status_code == 403


async def test_create_account_missing_credentials_is_401(
    client: AsyncClient, override_repo: OverrideRepo
) -> None:
    override_repo()

    response = await client.post("/admin/accounts", json=create_account_payload())

    assert response.status_code == 401
