from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

import database
from api.categories import router as categories_router
from api.expenses import router as expenses_router
from api.tags import router as tags_router
from api.users import router as users_router
from config import get_settings
from models.errors import ConflictError, NotFoundError, PermissionDeniedError


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    await database.init_pool(settings.database_url)
    try:
        yield
    finally:
        await database.close_pool()


def create_app() -> FastAPI:
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
    app.include_router(categories_router)
    app.include_router(tags_router)
    app.include_router(expenses_router)

    return app


app = create_app()
