from typing import Protocol

from models.admin import AdminAccountRow, AdminUserRow


class AdminAccountRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real AccountRepository."""

    async def list_for_admin(self) -> list[AdminAccountRow]: ...


class AdminUserRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real UserRepository."""

    async def list_for_admin(self) -> list[AdminUserRow]: ...


class AdminService:
    """Cross-account reads for the system-admin panel (D711) — the only
    service in this project that queries `accounts`/`users` without an
    `account_id` scope, consumed only by `api/admin.py`."""

    def __init__(
        self,
        account_repo: AdminAccountRepositoryProtocol,
        user_repo: AdminUserRepositoryProtocol,
    ) -> None:
        self._account_repo = account_repo
        self._user_repo = user_repo

    async def list_accounts(self) -> list[AdminAccountRow]:
        return await self._account_repo.list_for_admin()

    async def list_users(self) -> list[AdminUserRow]:
        return await self._user_repo.list_for_admin()
