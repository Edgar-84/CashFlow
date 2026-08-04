from typing import Any, Protocol
from uuid import UUID

from models.errors import NotFoundError
from models.tag import TagCreate, TagResponse, TagUpdate


class TagRepositoryProtocol(Protocol):
    """Duck-typed repository interface (tests/CLAUDE.md) — lets unit tests
    pass an in-memory fake instead of the real TagRepository."""

    async def list_with_usage(
        self, account_id: UUID, *, include_archived: bool
    ) -> list[TagResponse]: ...
    async def list(self, **filters: Any) -> list[TagResponse]: ...
    async def get(self, id: UUID) -> TagResponse | None: ...
    async def create(self, data: dict[str, Any]) -> TagResponse: ...
    async def update(self, id: UUID, data: dict[str, Any]) -> TagResponse | None: ...
    async def delete(self, id: UUID) -> bool: ...
    async def count_expenses(self, tag_id: UUID) -> int: ...


class TagService:
    """Tag CRUD, scoped to the calling user's account.

    ``account_id`` is always the authenticated caller's own account, never a
    client-supplied value (root CLAUDE.md: never trust client-supplied
    UUIDs) — callers (routes) pass it explicitly. docs/SCHEMA.sql has no
    per-account uniqueness on `tags.name` (D19), so unlike categories, tag
    creation/update needs no unique-violation translation. `expense_tags.
    tag_id` is `ON DELETE CASCADE`, not `RESTRICT` — a hard-delete never
    raises, it silently destroys history, which is exactly why `delete()`
    below checks usage first (U0.5).
    """

    def __init__(self, tag_repo: TagRepositoryProtocol) -> None:
        self._tag_repo = tag_repo

    async def list(
        self, account_id: UUID, *, include_archived: bool = False, include_usage: bool = False
    ) -> list[TagResponse]:
        if include_usage:
            return await self._tag_repo.list_with_usage(
                account_id, include_archived=include_archived
            )
        filters: dict[str, Any] = {"account_id": account_id}
        if not include_archived:
            filters["is_active"] = True
        return await self._tag_repo.list(**filters)

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
        # D302 (mirrored from categories, U0.4): archive a tag still attached
        # to an expense instead of hard-deleting it. `expense_tags.tag_id` is
        # `ON DELETE CASCADE`, so a hard delete here would silently drop the
        # join rows and destroy that expense's tag history — this check is
        # the only thing preventing that.
        if await self._tag_repo.count_expenses(tag_id) > 0:
            await self._tag_repo.update(tag_id, {"is_active": False})
            return
        await self._tag_repo.delete(tag_id)
