import pytest
from httpx import ASGITransport, AsyncClient

import database
from config import get_settings
from main import create_app


@pytest.fixture(autouse=True)
def _required_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/test")
    monkeypatch.setenv("BOT_TOKEN", "test-bot-token")
    monkeypatch.setenv("BACKEND_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setenv("ALLOWED_TG_IDS", "123456789")
    get_settings.cache_clear()


async def test_health_returns_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_init_pool(dsn: str) -> None:
        return None

    async def fake_close_pool() -> None:
        return None

    monkeypatch.setattr(database, "init_pool", fake_init_pool)
    monkeypatch.setattr(database, "close_pool", fake_close_pool)

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
