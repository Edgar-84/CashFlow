"""U1.5 acceptance: the Mini App static mount and the API co-exist.

The plan's Risks section calls out "the static mount can swallow API routes"
as the failure mode this unit must guard against — `app.mount("/", ...)` after
every `include_router()` means the routers must win path resolution. These
tests build a fake `webapp/dist` in a tmp path, hand it to `create_app`, and
assert both halves: the mount serves at `/`, and real API paths still route
to FastAPI (not to the static index).
"""

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi import HTTPException, status
from httpx import ASGITransport, AsyncClient

import database
from api.deps import get_current_user
from main import create_app
from models.user import UserResponse


@pytest.fixture
def dist_dir(tmp_path: Path) -> Path:
    """A minimal Vite-shaped build output (index.html + one hashed asset)."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text(
        "<!doctype html><html><body>mini app shell</body></html>",
        encoding="utf-8",
    )
    assets = dist / "assets"
    assets.mkdir()
    (assets / "app-DEADBEEF.js").write_text("console.log('mini app');", encoding="utf-8")
    return dist


@pytest.fixture
async def static_client(
    dist_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[AsyncClient]:
    async def fake_init_pool(dsn: str) -> None:
        return None

    async def fake_close_pool() -> None:
        return None

    monkeypatch.setattr(database, "init_pool", fake_init_pool)
    monkeypatch.setattr(database, "close_pool", fake_close_pool)

    app = create_app(webapp_dist=dist_dir)

    # Short-circuit the DB-touching auth dependency; the point of these tests
    # is routing (does the static mount swallow the path?), not permissions.
    async def _unauth() -> UserResponse:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="test")

    app.dependency_overrides[get_current_user] = _unauth

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


async def test_root_serves_mini_app_index(static_client: AsyncClient) -> None:
    response = await static_client.get("/")

    assert response.status_code == 200
    assert "mini app shell" in response.text
    assert response.headers["content-type"].startswith("text/html")


async def test_hashed_asset_is_served_from_mount(static_client: AsyncClient) -> None:
    response = await static_client.get("/assets/app-DEADBEEF.js")

    assert response.status_code == 200
    assert "console.log" in response.text


async def test_health_route_wins_over_static_mount(static_client: AsyncClient) -> None:
    # The failure mode the plan calls out: `app.mount("/", StaticFiles(html=True))`
    # after every router would swallow API paths if mount order were wrong.
    # `/health` must still return the JSON body from the FastAPI route, not the
    # static index.
    response = await static_client.get("/health")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {"status": "ok"}


async def test_expenses_route_wins_over_static_mount(static_client: AsyncClient) -> None:
    # `/expenses` requires auth (missing headers → 401 from get_current_user)
    # — the point of this test is that the request reaches the FastAPI router
    # at all, i.e. the static mount did NOT intercept it and return index.html.
    response = await static_client.get("/expenses")

    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/json")


def test_create_app_skips_mount_when_dist_missing(tmp_path: Path) -> None:
    # Bare-host dev + existing tests: no `pnpm build` yet → no mount, no
    # startup error. The route table stays exactly what it was before U1.5.
    missing = tmp_path / "never-built"
    app = create_app(webapp_dist=missing)

    mount_names = [getattr(r, "name", None) for r in app.routes]
    assert "webapp" not in mount_names
