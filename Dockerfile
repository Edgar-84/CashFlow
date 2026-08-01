# One image for both services (D40): the compose files pick the command
# (`uvicorn main:app ...` for the api, `python -m bot.bot` for the bot).
# The api command also serves the built Mini App via FastAPI StaticFiles at "/"
# (D201, U1.5) — dist is produced by the `webapp-builder` stage below and
# copied into the runtime image. The runtime layer stays Python-only; node
# never ships to the final image.

FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /bin/uv

# Use the image's own CPython; bytecode-compile for faster container start.
ENV UV_PYTHON_DOWNLOADS=0 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM node:22-alpine AS webapp-builder

# corepack activates the pnpm version pinned by webapp/package.json's
# `packageManager` field (11.x, per D212). --frozen-lockfile enforces the
# lockfile the human signed off in U1.1.
RUN corepack enable

WORKDIR /webapp
COPY webapp/package.json webapp/pnpm-lock.yaml webapp/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY webapp/ ./
RUN pnpm run build

FROM python:3.13-slim AS runtime

RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --create-home app

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY --chown=app:app . .
# webapp/dist is .dockerignored so a local `pnpm build` output never rides
# along; the built assets come exclusively from the webapp-builder stage.
COPY --from=webapp-builder --chown=app:app /webapp/dist ./webapp/dist

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

USER app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
