# One image for both services (D40): the compose files pick the command
# (`uvicorn main:app ...` for the api, `python -m bot.bot` for the bot).

FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /bin/uv

# Use the image's own CPython; bytecode-compile for faster container start.
ENV UV_PYTHON_DOWNLOADS=0 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.13-slim AS runtime

RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --create-home app

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY --chown=app:app . .

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

USER app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
