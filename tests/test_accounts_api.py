"""HTTP tests for api/accounts.py — `PATCH /accounts/me`, admin-only (D400/D401, U0.4 AC).

Hermetic: the real app, with AccountRepository/UserRepository replaced by
in-memory fakes via app.dependency_overrides (tests/CLAUDE.md) — no DB.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from test_expense_service import FakeExpenseRepo, make_expense
from test_users_api import TgLookupFakeUserRepo, auth_headers

from api import deps
from models.account import AccountResponse
from models.enums import Currency, Language, Role
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
def account(account_id: UUID) -> AccountResponse:
    return AccountResponse(
        id=account_id,
        name="Test Account",
        currency=Currency.USD,
        language=Language.EN,
        owner_id=None,
        is_blocked=False,
        created_at=datetime.now(UTC),
    )


class FakeAccountRepo:
    def __init__(self, accounts: dict[UUID, AccountResponse]) -> None:
        self._accounts = accounts

    async def get(self, id: UUID) -> AccountResponse | None:
        return self._accounts.get(id)

    async def update(self, id: UUID, data: dict[str, Any]) -> AccountResponse | None:
        current = self._accounts.get(id)
        if current is None:
            return None
        # Mirrors the real repo's RETURNING-row round trip (raw string in,
        # typed enum out via model_validate) rather than model_copy, which
        # would leave `currency` as a plain str and trip Pydantic's
        # serialization warning for an unexpected enum value.
        updated = AccountResponse.model_validate({**current.model_dump(), **data})
        self._accounts[id] = updated
        return updated


OverrideRepo = Callable[[], tuple[TgLookupFakeUserRepo, FakeAccountRepo]]


@pytest.fixture
def override_repo(
    app: FastAPI,
    admin: UserResponse,
    member: UserResponse,
    viewer: UserResponse,
    account: AccountResponse,
) -> OverrideRepo:
    def _apply() -> tuple[TgLookupFakeUserRepo, FakeAccountRepo]:
        user_repo = TgLookupFakeUserRepo([admin, member, viewer])
        account_repo = FakeAccountRepo({account.id: account})
        app.dependency_overrides[deps.get_user_repo] = lambda: user_repo
        app.dependency_overrides[deps.get_account_repo] = lambda: account_repo
        return user_repo, account_repo

    return _apply


async def test_update_currency_as_admin(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse, account: AccountResponse
) -> None:
    override_repo()

    response = await client.patch(
        "/accounts/me", json={"currency": "EUR"}, headers=auth_headers(admin.tg_id)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["currency"] == "EUR"
    assert body["id"] == str(account.id)
    assert body["name"] == account.name


async def test_update_currency_reflected_in_get_users_me(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse
) -> None:
    override_repo()

    await client.patch("/accounts/me", json={"currency": "EUR"}, headers=auth_headers(admin.tg_id))
    response = await client.get("/users/me", headers=auth_headers(admin.tg_id))

    assert response.status_code == 200
    assert response.json()["currency"] == "EUR"


async def test_update_currency_as_member_is_403(
    client: AsyncClient,
    override_repo: OverrideRepo,
    member: UserResponse,
    account: AccountResponse,
) -> None:
    _, account_repo = override_repo()

    response = await client.patch(
        "/accounts/me", json={"currency": "EUR"}, headers=auth_headers(member.tg_id)
    )

    assert response.status_code == 403
    stored = await account_repo.get(account.id)
    assert stored is not None
    assert stored.currency == account.currency


async def test_update_currency_as_viewer_is_403(
    client: AsyncClient, override_repo: OverrideRepo, viewer: UserResponse
) -> None:
    override_repo()

    response = await client.patch(
        "/accounts/me", json={"currency": "EUR"}, headers=auth_headers(viewer.tg_id)
    )

    assert response.status_code == 403


async def test_update_currency_unknown_code_is_422(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse
) -> None:
    override_repo()

    response = await client.patch(
        "/accounts/me", json={"currency": "XYZ"}, headers=auth_headers(admin.tg_id)
    )

    assert response.status_code == 422


async def test_update_language_as_admin(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse, account: AccountResponse
) -> None:
    override_repo()

    response = await client.patch(
        "/accounts/me", json={"language": "ru"}, headers=auth_headers(admin.tg_id)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["language"] == "ru"
    assert body["id"] == str(account.id)


async def test_update_language_reflected_in_get_users_me(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse
) -> None:
    override_repo()

    await client.patch("/accounts/me", json={"language": "ru"}, headers=auth_headers(admin.tg_id))
    response = await client.get("/users/me", headers=auth_headers(admin.tg_id))

    assert response.status_code == 200
    assert response.json()["language"] == "ru"


async def test_update_language_as_member_is_403(
    client: AsyncClient,
    override_repo: OverrideRepo,
    member: UserResponse,
    account: AccountResponse,
) -> None:
    _, account_repo = override_repo()

    response = await client.patch(
        "/accounts/me", json={"language": "ru"}, headers=auth_headers(member.tg_id)
    )

    assert response.status_code == 403
    stored = await account_repo.get(account.id)
    assert stored is not None
    assert stored.language == account.language


async def test_update_language_as_viewer_is_403(
    client: AsyncClient, override_repo: OverrideRepo, viewer: UserResponse
) -> None:
    override_repo()

    response = await client.patch(
        "/accounts/me", json={"language": "ru"}, headers=auth_headers(viewer.tg_id)
    )

    assert response.status_code == 403


async def test_update_language_unknown_code_is_422(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse
) -> None:
    override_repo()

    response = await client.patch(
        "/accounts/me", json={"language": "xx"}, headers=auth_headers(admin.tg_id)
    )

    assert response.status_code == 422


async def test_update_language_leaves_currency_untouched(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse, account: AccountResponse
) -> None:
    override_repo()

    response = await client.patch(
        "/accounts/me", json={"language": "ru"}, headers=auth_headers(admin.tg_id)
    )

    assert response.status_code == 200
    assert response.json()["currency"] == account.currency.value


async def test_update_currency_leaves_language_untouched(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse, account: AccountResponse
) -> None:
    override_repo()

    response = await client.patch(
        "/accounts/me", json={"currency": "EUR"}, headers=auth_headers(admin.tg_id)
    )

    assert response.status_code == 200
    assert response.json()["language"] == account.language.value


async def test_update_currency_and_language_in_one_patch(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse
) -> None:
    override_repo()

    response = await client.patch(
        "/accounts/me",
        json={"currency": "EUR", "language": "uk"},
        headers=auth_headers(admin.tg_id),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["currency"] == "EUR"
    assert body["language"] == "uk"


async def test_update_currency_does_not_change_expense_amounts(
    client: AsyncClient,
    app: FastAPI,
    override_repo: OverrideRepo,
    admin: UserResponse,
    account: AccountResponse,
) -> None:
    # D400: a currency change relabels, it never touches `expenses.amount` —
    # asserted directly against a seeded expense, not just by omission.
    override_repo()
    expense = make_expense(account_id=account.id, amount=5000)
    expense_repo = FakeExpenseRepo([expense])
    app.dependency_overrides[deps.get_expense_repo] = lambda: expense_repo

    response = await client.patch(
        "/accounts/me", json={"currency": "EUR"}, headers=auth_headers(admin.tg_id)
    )

    assert response.status_code == 200
    stored = await expense_repo.get(expense.id)
    assert stored is not None
    assert stored.amount == 5000


async def test_no_path_variant_accepts_an_account_id(
    client: AsyncClient, override_repo: OverrideRepo, admin: UserResponse, account: AccountResponse
) -> None:
    override_repo()

    response = await client.patch(
        f"/accounts/{account.id}", json={"currency": "EUR"}, headers=auth_headers(admin.tg_id)
    )

    # No route is defined for an id-based path: FastAPI 404s if nothing else
    # claims it, or — when the Mini App static mount is present (`main.py`'s
    # catch-all `app.mount("/", ...)`) — Starlette's StaticFiles answers with
    # 405 for a non-GET method on a path it doesn't recognize either way.
    # Either response proves no `PATCH /accounts/{id}` route exists.
    assert response.status_code in (404, 405)


async def test_update_currency_missing_credentials_is_401(
    client: AsyncClient, override_repo: OverrideRepo
) -> None:
    override_repo()

    response = await client.patch("/accounts/me", json={"currency": "EUR"})

    assert response.status_code == 401
