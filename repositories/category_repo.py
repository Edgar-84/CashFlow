import asyncpg

from models.category import CategoryResponse
from repositories.base import BaseRepository


class CategoryRepository(BaseRepository[CategoryResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="categories", model=CategoryResponse)
