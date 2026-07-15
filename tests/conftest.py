import os
from collections.abc import AsyncIterator

import asyncpg
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import database
from config import get_settings
from main import create_app

# Fallbacks for local unit runs (no real services needed). In CI these are
# already exported (see .github/workflows/ci.yml) — never override a value
# that's genuinely set, or the integration job's real DATABASE_URL would be
# clobbered.
_ENV_DEFAULTS = {
    "DATABASE_URL": "postgresql://user:pass@localhost/test",
    "BOT_TOKEN": "test-bot-token",
    "BACKEND_BASE_URL": "http://localhost:8000",
    "INTERNAL_TOKEN": "test-internal-token",
    "ALLOWED_TG_IDS": "123456789",
}

# Matches the postgres service in the CI "integration" job — lets
# `pytest -m integration` also work against a local docker Postgres.
_DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/cashflow_test"


@pytest.fixture(autouse=True)
def _test_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in _ENV_DEFAULTS.items():
        monkeypatch.setenv(key, os.environ.get(key, value))
    get_settings.cache_clear()


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest.fixture
async def client(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[AsyncClient]:
    async def fake_init_pool(dsn: str) -> None:
        return None

    async def fake_close_pool() -> None:
        return None

    monkeypatch.setattr(database, "init_pool", fake_init_pool)
    monkeypatch.setattr(database, "close_pool", fake_close_pool)

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


@pytest.fixture(scope="session")
async def db_pool() -> AsyncIterator[asyncpg.Pool]:
    dsn = os.environ.get("DATABASE_URL", _DEFAULT_TEST_DATABASE_URL)
    pool = await asyncpg.create_pool(dsn=dsn)
    try:
        yield pool
    finally:
        await pool.close()


@pytest.fixture
async def db_conn(db_pool: asyncpg.Pool) -> AsyncIterator[asyncpg.Connection]:
    async with db_pool.acquire() as conn:
        tx = conn.transaction()
        await tx.start()
        try:
            yield conn
        finally:
            await tx.rollback()
