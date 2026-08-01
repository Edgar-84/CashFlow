from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import database
from api.budgets import router as budgets_router
from api.categories import router as categories_router
from api.deps import close_http_client
from api.expenses import router as expenses_router
from api.permissions import router as permissions_router
from api.statistics import router as statistics_router
from api.tags import router as tags_router
from api.users import router as users_router
from config import get_settings
from models.errors import ConflictError, NotFoundError, PermissionDeniedError

# Default Mini App build output (D201, U1.5). The Dockerfile's webapp-builder
# stage populates this at image build; bare-host dev without `pnpm build`
# leaves it empty and the mount is skipped.
DEFAULT_WEBAPP_DIST = Path(__file__).parent / "webapp" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    await database.init_pool(settings.database_url)
    try:
        yield
    finally:
        await close_http_client()
        await database.close_pool()


def create_app(webapp_dist: Path | None = None) -> FastAPI:
    app = FastAPI(title="CashFlow", lifespan=lifespan)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.exception_handler(NotFoundError)
    async def not_found_handler(request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(ConflictError)
    async def conflict_handler(request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(PermissionDeniedError)
    async def permission_denied_handler(
        request: Request, exc: PermissionDeniedError
    ) -> JSONResponse:
        return JSONResponse(status_code=403, content={"detail": str(exc)})

    app.include_router(users_router)
    app.include_router(permissions_router)
    app.include_router(categories_router)
    app.include_router(tags_router)
    app.include_router(expenses_router)
    app.include_router(budgets_router)
    app.include_router(statistics_router)

    # Mount the Mini App last so every API router wins path resolution.
    # `html=True` makes StaticFiles serve `index.html` at "/" and on 404 —
    # the SPA-style fallback the Mini App shell needs for direct-link routes.
    dist = webapp_dist if webapp_dist is not None else DEFAULT_WEBAPP_DIST
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="webapp")

    return app


app = create_app()
