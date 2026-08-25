from typing import Any, Protocol
from uuid import UUID

from models.account import AccountResponse, AccountUpdate
from models.enums import Currency


class AccountRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real AccountRepository."""

    async def get(self, id: UUID) -> AccountResponse | None: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> AccountResponse | None: ...


class AccountService:
    """Account settings, always scoped to the caller's own account (D401).

    There is no `/accounts/{id}` and the body never carries an id — the
    account always comes from the authenticated caller's `account_id`
    (root CLAUDE.md: never trust client-supplied UUIDs).
    """

    def __init__(self, account_repo: AccountRepositoryProtocol) -> None:
        self._account_repo = account_repo

    async def update(self, account_id: UUID, data: AccountUpdate) -> AccountResponse:
        # currency is a NOT NULL column with no "clear" semantics — an explicit
        # {"currency": null} is treated as omitted, same as UserService/
        # CategoryService.update do for their own NOT NULL columns.
        # `language` exists on AccountUpdate (U3.1's contract) but PATCH
        # /accounts/me does not accept it yet — that wiring, its admin gate
        # and its tests are U3.2's job (plan mini-app-v7.md), so only
        # `currency` is read out of the payload until then.
        payload = {
            key: (value.value if isinstance(value, Currency) else value)
            for key, value in data.model_dump(exclude_unset=True, include={"currency"}).items()
            if value is not None
        }
        if not payload:
            current = await self._account_repo.get(account_id)
            assert current is not None  # account_id is FK-enforced NOT NULL
            return current
        updated = await self._account_repo.update(account_id, payload)
        assert updated is not None
        return updated
