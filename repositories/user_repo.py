import asyncpg

from models.user import UserResponse
from repositories.base import BaseRepository


class UserRepository(BaseRepository[UserResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="users", model=UserResponse)
