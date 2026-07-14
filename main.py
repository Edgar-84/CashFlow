from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

import database
from config import get_settings


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

    return app


app = create_app()
