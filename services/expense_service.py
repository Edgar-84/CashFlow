from typing import Any, Protocol
from uuid import UUID

from models.errors import NotFoundError
from models.expense import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from models.user import UserResponse


class ExpenseRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real ExpenseRepository."""

    async def list(self, **filters: Any) -> list[ExpenseResponse]: ...
    async def get(self, id: UUID) -> ExpenseResponse | None: ...
    async def create(self, data: dict[str, Any]) -> ExpenseResponse: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> ExpenseResponse | None: ...
    async def delete(self, id: UUID) -> bool: ...


class ExpenseService:
    """Expense CRUD, scoped to the calling user's account.

    ``account_id`` is always the authenticated caller's own account, never a
    client-supplied value (root CLAUDE.md: never trust client-supplied
    UUIDs) — callers (routes) pass it explicitly. Ownership enforcement
    (``own_only``, step 6 of the permission matrix) is the route's job via
    ``api.deps.enforce_ownership`` — this service has no notion of
    permissions or the acting user's role.
    """

    def __init__(self, expense_repo: ExpenseRepositoryProtocol) -> None:
        self._expense_repo = expense_repo

    async def list(self, account_id: UUID) -> list[ExpenseResponse]:
        return await self._expense_repo.list(account_id=account_id)

    async def get(self, expense_id: UUID, account_id: UUID) -> ExpenseResponse:
        expense = await self._expense_repo.get(expense_id)
        if expense is None or expense.account_id != account_id:
            raise NotFoundError(f"Expense {expense_id} not found")
        return expense

    async def create(self, data: ExpenseCreate, user: UserResponse) -> ExpenseResponse:
        payload = data.model_dump()
        payload["account_id"] = user.account_id
        payload["user_id"] = user.id
        return await self._expense_repo.create(payload)

    async def update(
        self, expense_id: UUID, data: ExpenseUpdate, account_id: UUID
    ) -> ExpenseResponse:
        current = await self.get(expense_id, account_id)  # 404 if missing or foreign
        payload = data.model_dump(exclude_unset=True)
        # amount/category_id are NOT NULL columns with no "clear" semantics
        # (D30/D32 pattern) — an explicit null must not reach the repo as
        # SET amount = NULL. comment IS nullable (docs/SCHEMA.sql), so an
        # explicit null there is a real "clear the comment", not dropped.
        # tag_ids has no NOT NULL constraint either (junction table) — the
        # repo already treats an explicit null the same as omitted.
        for key in ("amount", "category_id"):
            if key in payload and payload[key] is None:
                del payload[key]
        if not payload:
            return current
        updated = await self._expense_repo.update(expense_id, payload)
        assert updated is not None
        return updated

    async def delete(self, expense_id: UUID, account_id: UUID) -> None:
        await self.get(expense_id, account_id)  # 404 if missing or foreign
        await self._expense_repo.delete(expense_id)
