"""Unit tests for services/expense_service.py — mocked repository, no DB (tests/CLAUDE.md)."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest

from models.enums import Role
from models.errors import NotFoundError
from models.expense import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from models.tag import TagResponse
from models.user import UserResponse
from services.expense_service import ExpenseService


def _fake_tag(tag_id: UUID, account_id: UUID) -> TagResponse:
    return TagResponse(id=tag_id, name="tag", account_id=account_id, created_at=datetime.now(UTC))


class FakeExpenseRepo:
    def __init__(self, expenses: list[ExpenseResponse] | None = None) -> None:
        self._expenses: dict[UUID, ExpenseResponse] = {e.id: e for e in (expenses or [])}

    async def list(self, **filters: Any) -> list[ExpenseResponse]:
        account_id = filters.get("account_id")
        return [e for e in self._expenses.values() if e.account_id == account_id]

    async def get(self, id: UUID) -> ExpenseResponse | None:
        return self._expenses.get(id)

    async def create(self, data: dict[str, Any]) -> ExpenseResponse:
        data = dict(data)
        tag_ids: list[UUID] = data.pop("tag_ids", [])
        account_id = data["account_id"]
        expense = ExpenseResponse(
            id=uuid4(),
            amount=data["amount"],
            comment=data.get("comment"),
            category_id=data["category_id"],
            user_id=data["user_id"],
            account_id=account_id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            tags=[_fake_tag(tag_id, account_id) for tag_id in tag_ids],
        )
        self._expenses[expense.id] = expense
        return expense

    async def update(self, id: UUID, data: dict[str, Any]) -> ExpenseResponse | None:
        expense = self._expenses.get(id)
        if expense is None:
            return None
        data = dict(data)
        tag_ids: list[UUID] | None = data.pop("tag_ids", None)
        update_fields: dict[str, Any] = dict(data)
        if tag_ids is not None:
            update_fields["tags"] = [_fake_tag(tag_id, expense.account_id) for tag_id in tag_ids]
        updated = expense.model_copy(update=update_fields)
        self._expenses[id] = updated
        return updated

    async def delete(self, id: UUID) -> bool:
        return self._expenses.pop(id, None) is not None


def make_expense(
    *,
    account_id: UUID,
    user_id: UUID | None = None,
    category_id: UUID | None = None,
    amount: int = 1000,
    comment: str | None = None,
) -> ExpenseResponse:
    return ExpenseResponse(
        id=uuid4(),
        amount=amount,
        comment=comment,
        category_id=category_id or uuid4(),
        user_id=user_id or uuid4(),
        account_id=account_id,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def make_caller(*, account_id: UUID, user_id: UUID | None = None) -> UserResponse:
    return UserResponse(
        id=user_id or uuid4(),
        tg_id=1,
        name="Member",
        role=Role.MEMBER,
        account_id=account_id,
        created_at=datetime.now(UTC),
    )


async def test_list_scopes_by_account() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    mine = make_expense(account_id=account_id)
    other = make_expense(account_id=other_account_id)
    service = ExpenseService(FakeExpenseRepo([mine, other]))

    result = await service.list(account_id)

    assert result == [mine]


async def test_get_returns_expense_in_account() -> None:
    account_id = uuid4()
    expense = make_expense(account_id=account_id)
    service = ExpenseService(FakeExpenseRepo([expense]))

    result = await service.get(expense.id, account_id)

    assert result == expense


async def test_get_missing_raises_not_found() -> None:
    service = ExpenseService(FakeExpenseRepo([]))

    with pytest.raises(NotFoundError):
        await service.get(uuid4(), uuid4())


async def test_get_foreign_account_raises_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    expense = make_expense(account_id=other_account_id)
    service = ExpenseService(FakeExpenseRepo([expense]))

    with pytest.raises(NotFoundError):
        await service.get(expense.id, account_id)


async def test_create_sets_account_and_user_id_from_caller() -> None:
    account_id = uuid4()
    caller = make_caller(account_id=account_id)
    service = ExpenseService(FakeExpenseRepo([]))
    data = ExpenseCreate(amount=500, category_id=uuid4())

    created = await service.create(data, caller)

    assert created.account_id == account_id
    assert created.user_id == caller.id


async def test_create_attaches_tags() -> None:
    account_id = uuid4()
    caller = make_caller(account_id=account_id)
    tag_id = uuid4()
    service = ExpenseService(FakeExpenseRepo([]))
    data = ExpenseCreate(amount=500, category_id=uuid4(), tag_ids=[tag_id])

    created = await service.create(data, caller)

    assert [t.id for t in created.tags] == [tag_id]


async def test_update_changes_amount() -> None:
    account_id = uuid4()
    expense = make_expense(account_id=account_id, amount=1000)
    service = ExpenseService(FakeExpenseRepo([expense]))

    updated = await service.update(expense.id, ExpenseUpdate(amount=2000), account_id)

    assert updated.amount == 2000


async def test_update_explicit_null_amount_is_ignored_not_nulled() -> None:
    # amount is a NOT NULL column with no "clear" semantics (D30/D32 pattern)
    # — an explicit null must not reach the repo as SET amount = NULL.
    account_id = uuid4()
    expense = make_expense(account_id=account_id, amount=1000)
    service = ExpenseService(FakeExpenseRepo([expense]))

    updated = await service.update(expense.id, ExpenseUpdate(amount=None), account_id)

    assert updated.amount == 1000


async def test_update_explicit_null_category_id_is_ignored_not_nulled() -> None:
    account_id = uuid4()
    category_id = uuid4()
    expense = make_expense(account_id=account_id, category_id=category_id)
    service = ExpenseService(FakeExpenseRepo([expense]))

    updated = await service.update(expense.id, ExpenseUpdate(category_id=None), account_id)

    assert updated.category_id == category_id


async def test_update_explicit_null_comment_clears_it() -> None:
    # Unlike amount/category_id, comment IS nullable (docs/SCHEMA.sql) — an
    # explicit null is a real "clear the comment", not dropped.
    account_id = uuid4()
    expense = make_expense(account_id=account_id, comment="lunch")
    service = ExpenseService(FakeExpenseRepo([expense]))

    updated = await service.update(expense.id, ExpenseUpdate(comment=None), account_id)

    assert updated.comment is None


async def test_update_tag_ids_replaces_tags() -> None:
    account_id = uuid4()
    old_tag_id = uuid4()
    new_tag_id = uuid4()
    expense = make_expense(account_id=account_id)
    expense = expense.model_copy(update={"tags": [_fake_tag(old_tag_id, account_id)]})
    service = ExpenseService(FakeExpenseRepo([expense]))

    updated = await service.update(expense.id, ExpenseUpdate(tag_ids=[new_tag_id]), account_id)

    assert [t.id for t in updated.tags] == [new_tag_id]


async def test_update_tag_ids_empty_list_clears_tags() -> None:
    account_id = uuid4()
    expense = make_expense(account_id=account_id)
    expense = expense.model_copy(update={"tags": [_fake_tag(uuid4(), account_id)]})
    service = ExpenseService(FakeExpenseRepo([expense]))

    updated = await service.update(expense.id, ExpenseUpdate(tag_ids=[]), account_id)

    assert updated.tags == []


async def test_update_missing_raises_not_found() -> None:
    service = ExpenseService(FakeExpenseRepo([]))

    with pytest.raises(NotFoundError):
        await service.update(uuid4(), ExpenseUpdate(amount=100), uuid4())


async def test_update_foreign_account_raises_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    expense = make_expense(account_id=other_account_id)
    service = ExpenseService(FakeExpenseRepo([expense]))

    with pytest.raises(NotFoundError):
        await service.update(expense.id, ExpenseUpdate(amount=100), account_id)


async def test_delete_removes_expense() -> None:
    account_id = uuid4()
    expense = make_expense(account_id=account_id)
    repo = FakeExpenseRepo([expense])
    service = ExpenseService(repo)

    await service.delete(expense.id, account_id)

    assert await repo.get(expense.id) is None


async def test_delete_missing_raises_not_found() -> None:
    service = ExpenseService(FakeExpenseRepo([]))

    with pytest.raises(NotFoundError):
        await service.delete(uuid4(), uuid4())


async def test_delete_foreign_account_raises_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    expense = make_expense(account_id=other_account_id)
    service = ExpenseService(FakeExpenseRepo([expense]))

    with pytest.raises(NotFoundError):
        await service.delete(expense.id, account_id)
