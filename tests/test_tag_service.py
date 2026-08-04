"""Unit tests for services/tag_service.py — mocked repository, no DB (tests/CLAUDE.md)."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest

from models.errors import NotFoundError
from models.tag import TagCreate, TagResponse, TagUpdate
from services.tag_service import TagService


class FakeTagRepo:
    def __init__(
        self,
        tags: list[TagResponse] | None = None,
        *,
        expense_counts: dict[UUID, int] | None = None,
    ) -> None:
        self._tags: dict[UUID, TagResponse] = {t.id: t for t in (tags or [])}
        self._expense_counts = expense_counts or {}

    async def list_with_usage(
        self, account_id: UUID, *, include_archived: bool
    ) -> list[TagResponse]:
        return [
            t.model_copy(update={"expense_count": self._expense_counts.get(t.id, 0)})
            for t in self._tags.values()
            if t.account_id == account_id and (include_archived or t.is_active)
        ]

    async def list(self, **filters: Any) -> list[TagResponse]:
        return [
            t
            for t in self._tags.values()
            if all(getattr(t, key) == value for key, value in filters.items())
        ]

    async def get(self, id: UUID) -> TagResponse | None:
        return self._tags.get(id)

    async def create(self, data: dict[str, Any]) -> TagResponse:
        tag = TagResponse(
            id=uuid4(),
            name=data["name"],
            account_id=data["account_id"],
            created_at=datetime.now(UTC),
        )
        self._tags[tag.id] = tag
        return tag

    async def update(self, id: UUID, data: dict[str, Any]) -> TagResponse | None:
        tag = self._tags.get(id)
        if tag is None:
            return None
        updated = tag.model_copy(update=data)
        self._tags[id] = updated
        return updated

    async def delete(self, id: UUID) -> bool:
        return self._tags.pop(id, None) is not None

    async def count_expenses(self, tag_id: UUID) -> int:
        return self._expense_counts.get(tag_id, 0)


def make_tag(*, account_id: UUID, name: str = "urgent", is_active: bool = True) -> TagResponse:
    return TagResponse(
        id=uuid4(),
        name=name,
        account_id=account_id,
        created_at=datetime.now(UTC),
        is_active=is_active,
    )


async def test_list_scopes_by_account() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    mine = make_tag(account_id=account_id)
    other = make_tag(account_id=other_account_id)
    service = TagService(FakeTagRepo([mine, other]))

    result = await service.list(account_id)

    assert result == [mine]


async def test_list_omits_archived_by_default() -> None:
    account_id = uuid4()
    active = make_tag(account_id=account_id, name="Active")
    archived = make_tag(account_id=account_id, name="Archived", is_active=False)
    service = TagService(FakeTagRepo([active, archived]))

    result = await service.list(account_id)

    assert result == [active]


async def test_list_includes_archived_when_requested() -> None:
    account_id = uuid4()
    active = make_tag(account_id=account_id, name="Active")
    archived = make_tag(account_id=account_id, name="Archived", is_active=False)
    service = TagService(FakeTagRepo([active, archived]))

    result = await service.list(account_id, include_archived=True)

    assert {t.id for t in result} == {active.id, archived.id}


async def test_list_without_usage_leaves_expense_count_none() -> None:
    account_id = uuid4()
    tag = make_tag(account_id=account_id)
    service = TagService(FakeTagRepo([tag], expense_counts={tag.id: 3}))

    result = await service.list(account_id)

    assert result[0].expense_count is None


async def test_list_with_usage_populates_expense_count() -> None:
    account_id = uuid4()
    tag = make_tag(account_id=account_id)
    service = TagService(FakeTagRepo([tag], expense_counts={tag.id: 3}))

    result = await service.list(account_id, include_usage=True)

    assert result[0].expense_count == 3


async def test_get_returns_tag_in_account() -> None:
    account_id = uuid4()
    tag = make_tag(account_id=account_id)
    service = TagService(FakeTagRepo([tag]))

    result = await service.get(tag.id, account_id)

    assert result == tag


async def test_get_missing_raises_not_found() -> None:
    service = TagService(FakeTagRepo([]))

    with pytest.raises(NotFoundError):
        await service.get(uuid4(), uuid4())


async def test_get_foreign_account_raises_not_found() -> None:
    account_id = uuid4()
    other_account_id = uuid4()
    tag = make_tag(account_id=other_account_id)
    service = TagService(FakeTagRepo([tag]))

    with pytest.raises(NotFoundError):
        await service.get(tag.id, account_id)


async def test_create_forces_account_id_from_caller() -> None:
    account_id = uuid4()
    service = TagService(FakeTagRepo([]))
    data = TagCreate(name="urgent")

    created = await service.create(data, account_id)

    assert created.account_id == account_id


async def test_update_changes_fields() -> None:
    account_id = uuid4()
    tag = make_tag(account_id=account_id)
    service = TagService(FakeTagRepo([tag]))

    updated = await service.update(tag.id, TagUpdate(name="Renamed"), account_id)

    assert updated.name == "Renamed"


async def test_update_explicit_null_is_ignored_not_nulled() -> None:
    # name is a NOT NULL column with no "clear" semantics (same D30
    # precedent as users/categories) — an explicit null must be ignored.
    account_id = uuid4()
    tag = make_tag(account_id=account_id, name="urgent")
    service = TagService(FakeTagRepo([tag]))

    updated = await service.update(tag.id, TagUpdate(name=None), account_id)

    assert updated.name == "urgent"


async def test_update_missing_raises_not_found() -> None:
    service = TagService(FakeTagRepo([]))

    with pytest.raises(NotFoundError):
        await service.update(uuid4(), TagUpdate(name="X"), uuid4())


async def test_delete_unused_tag_hard_deletes() -> None:
    account_id = uuid4()
    tag = make_tag(account_id=account_id)
    repo = FakeTagRepo([tag])
    service = TagService(repo)

    await service.delete(tag.id, account_id)

    assert await repo.get(tag.id) is None


async def test_delete_tag_with_expenses_archives_instead_of_deleting() -> None:
    # U0.5 (mirrors D302): a tag still attached to an expense is archived,
    # not deleted — `expense_tags.tag_id` is ON DELETE CASCADE, so a
    # hard-delete here would silently destroy that expense's tag history.
    account_id = uuid4()
    tag = make_tag(account_id=account_id)
    repo = FakeTagRepo([tag], expense_counts={tag.id: 1})
    service = TagService(repo)

    await service.delete(tag.id, account_id)

    survivor = await repo.get(tag.id)
    assert survivor is not None
    assert survivor.is_active is False


async def test_delete_missing_raises_not_found() -> None:
    service = TagService(FakeTagRepo([]))

    with pytest.raises(NotFoundError):
        await service.delete(uuid4(), uuid4())
