import asyncpg

from models.account import AccountResponse
from repositories.base import BaseRepository


class AccountRepository(BaseRepository[AccountResponse]):
    def __init__(self, conn: asyncpg.Connection) -> None:
        super().__init__(conn, table="accounts", model=AccountResponse)
