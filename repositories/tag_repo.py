import asyncpg

from models.tag import TagResponse
from repositories.base import BaseRepository


class TagRepository(BaseRepository[TagResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="tags", model=TagResponse)
