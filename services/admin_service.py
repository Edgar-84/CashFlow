from contextlib import AbstractAsyncContextManager
from typing import Any, Protocol
from uuid import UUID

import asyncpg

from models.account import AccountResponse
from models.admin import AdminAccountCreate, AdminAccountRow, AdminUserRow
from models.category import CategoryResponse
from models.enums import Role
from models.errors import ConflictError, NotFoundError
from models.user import UserResponse


class AdminAccountRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real AccountRepository."""

    async def get(self, id: UUID) -> AccountResponse | None: ...
    async def list_for_admin(self) -> list[AdminAccountRow]: ...
    async def create(self, data: dict[str, Any]) -> AccountResponse: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> AccountResponse | None: ...
    def transaction(self) -> AbstractAsyncContextManager[Any]: ...


class AdminUserRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real UserRepository."""

    async def get(self, id: UUID) -> UserResponse | None: ...
    async def list_for_admin(self) -> list[AdminUserRow]: ...
    async def create(self, data: dict[str, Any]) -> UserResponse: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> UserResponse | None: ...


class AdminCategoryRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real CategoryRepository."""

    async def create(self, data: dict[str, Any]) -> CategoryResponse: ...


class AdminService:
    """Cross-account reads and account creation for the system-admin panel
    (D711) — the only service in this project that queries or writes
    `accounts`/`users` without an `account_id` scope, consumed only by
    `api/admin.py`."""

    def __init__(
        self,
        account_repo: AdminAccountRepositoryProtocol,
        user_repo: AdminUserRepositoryProtocol,
        category_repo: AdminCategoryRepositoryProtocol,
    ) -> None:
        self._account_repo = account_repo
        self._user_repo = user_repo
        self._category_repo = category_repo

    async def list_accounts(self) -> list[AdminAccountRow]:
        return await self._account_repo.list_for_admin()

    async def list_users(self) -> list[AdminUserRow]:
        return await self._user_repo.list_for_admin()

    async def create_account(self, data: AdminAccountCreate) -> AdminAccountRow:
        """Creates the account, its first (owner) user and the seeded
        "General" category in one transaction (U4.4) — a failure anywhere
        (most notably a duplicate `owner_tg_id`, `users.tg_id` UNIQUE) must
        leave no partial account behind. The owner is created as `admin`
        (D712: a system admin's account still needs its own in-account
        admin) and its `color_slot` is hardcoded to `1` rather than computed
        via `CategoryService._next_free_color_slot` — this is always the
        first category of a brand-new, empty account, so the two are
        equivalent, and reaching for the per-account `CategoryService` here
        would pull a caller-scoped service into this cross-account surface
        for no behavioural difference (D711/D719)."""
        async with self._account_repo.transaction():
            account = await self._account_repo.create(
                {
                    "name": data.name,
                    "currency": data.currency.value,
                    "language": data.language.value,
                }
            )
            try:
                owner = await self._user_repo.create(
                    {
                        "tg_id": data.owner_tg_id,
                        "name": data.owner_name,
                        "role": Role.ADMIN.value,
                        "account_id": account.id,
                    }
                )
            except asyncpg.UniqueViolationError as exc:
                raise ConflictError(f"User with tg_id {data.owner_tg_id} already exists") from exc
            account = await self._account_repo.update(account.id, {"owner_id": owner.id}) or account
            await self._category_repo.create(
                {"name": "General", "account_id": account.id, "color_slot": 1}
            )
        return AdminAccountRow(
            id=account.id,
            name=account.name,
            currency=account.currency,
            language=account.language,
            is_blocked=account.is_blocked,
            user_count=1,
            created_at=account.created_at,
        )

    async def block_user(
        self, user_id: UUID, is_blocked: bool, caller: UserResponse
    ) -> UserResponse:
        """`PATCH /admin/users/{id}/block` (U4.5). Blocking is one flag on
        `users` — it never touches the caller's own account row (D714 is
        about accounts; this is its user-level mirror: one flag, one place).
        A system admin cannot block their own user row — doing so would
        immediately lock them out via `get_current_user`'s block gate
        (D713), with no in-app path back."""
        # Checked before existence on purpose: user_id == caller.id can only
        # be true for a row that provably exists (the caller's own), so this
        # ordering never masks a real 404 — it just makes the caller's own id
        # a guaranteed 422 rather than an incidental 404/200.
        if is_blocked and user_id == caller.id:
            raise ValueError("A system admin cannot block themselves")
        if await self._user_repo.get(user_id) is None:
            raise NotFoundError(f"User {user_id} not found")
        # get() then update() — a concurrent delete between the two would
        # violate the assert below rather than degrade to 404. No delete
        # route exists on users today, so accepted rather than collapsed
        # into a single UPDATE ... RETURNING.
        updated = await self._user_repo.update(user_id, {"is_blocked": is_blocked})
        assert updated is not None
        return updated

    async def block_account(
        self, account_id: UUID, is_blocked: bool, caller: UserResponse
    ) -> AccountResponse:
        """`PATCH /admin/accounts/{id}/block` (U4.5). Sets `accounts.is_blocked`
        only — it never mass-writes `users.is_blocked` (D714): blocking
        revokes every member via `get_current_user`'s account-level check,
        and unblocking therefore restores exactly the users who were not
        individually blocked, with no bookkeeping of prior state. A system
        admin cannot block their own account, for the same lockout reason as
        `block_user`."""
        # Same ordering rationale as block_user: account_id == caller.account_id
        # can only be true for a row that provably exists.
        if is_blocked and account_id == caller.account_id:
            raise ValueError("A system admin cannot block their own account")
        if await self._account_repo.get(account_id) is None:
            raise NotFoundError(f"Account {account_id} not found")
        # get() then update() — see block_user's note on the same pattern.
        updated = await self._account_repo.update(account_id, {"is_blocked": is_blocked})
        assert updated is not None
        return updated
