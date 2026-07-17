from typing import Any, Protocol
from uuid import UUID

from models.errors import NotFoundError
from models.tag import TagCreate, TagResponse, TagUpdate


class TagRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real TagRepository."""

    async def list(self, **filters: Any) -> list[TagResponse]: ...
    async def get(self, id: UUID) -> TagResponse | None: ...
    async def create(self, data: dict[str, Any]) -> TagResponse: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> TagResponse | None: ...
    async def delete(self, id: UUID) -> bool: ...


class TagService:
    """Tag CRUD, scoped to the calling user's account.

    ``account_id`` is always the authenticated caller's own account, never a
    client-supplied value (root CLAUDE.md: never trust client-supplied
    UUIDs) — callers (routes) pass it explicitly. Unlike categories, tag
    deletion needs no unique-violation/FK-violation translation:
    docs/SCHEMA.sql has no per-account uniqueness on `tags.name` (D19) and
    `expense_tags.tag_id` is `ON DELETE CASCADE`, not `RESTRICT`.
    """

    def __init__(self, tag_repo: TagRepositoryProtocol) -> None:
        self._tag_repo = tag_repo

    async def list(self, account_id: UUID) -> list[TagResponse]:
        return await self._tag_repo.list(account_id=account_id)

    async def get(self, tag_id: UUID, account_id: UUID) -> TagResponse:
        tag = await self._tag_repo.get(tag_id)
        if tag is None or tag.account_id != account_id:
            raise NotFoundError(f"Tag {tag_id} not found")
        return tag

    async def create(self, data: TagCreate, account_id: UUID) -> TagResponse:
        payload = data.model_dump()
        payload["account_id"] = account_id
        return await self._tag_repo.create(payload)

    async def update(self, tag_id: UUID, data: TagUpdate, account_id: UUID) -> TagResponse:
        current = await self.get(tag_id, account_id)  # 404 if missing or foreign
        # name is a NOT NULL column with no "clear" semantics — same D30
        # precedent as categories/users: an explicit null is ignored, not sent.
        payload = {
            key: value
            for key, value in data.model_dump(exclude_unset=True).items()
            if value is not None
        }
        if not payload:
            return current
        updated = await self._tag_repo.update(tag_id, payload)
        assert updated is not None
        return updated

    async def delete(self, tag_id: UUID, account_id: UUID) -> None:
        await self.get(tag_id, account_id)  # 404 if missing or foreign
        await self._tag_repo.delete(tag_id)
