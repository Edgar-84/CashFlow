# CashFlow — Expense Tracker

Personal/family expense tracker: a Telegram bot (aiogram 3.x) in front of a
FastAPI backend. The bot is a pure HTTP client — it never touches the
database — so a future Telegram Mini App can reuse the same API unchanged.

**Stack**: Python 3.13 · FastAPI · aiogram 3.x · PostgreSQL (Supabase) via
asyncpg (raw SQL, no ORM) · Pydantic v2 · Alembic · uv

**Key design points**

- Layering: routes → services → repositories; only `repositories/` touches the DB.
- Money is `BIGINT` in minor units (kopecks/cents) end to end — never floats.
- Auth: the bot sends `X-Telegram-User-Id` + `X-Internal-Token` (shared
  secret) on every request; the backend derives the user/account from them.
- Budget-threshold notifications fire on expense creation, best-effort
  (a send failure never fails the expense).

## Setup

```bash
cp .env.example .env   # then fill in the values — see "Environments & .env"
uv sync
```

## Environments & `.env`

**One `.env` per machine, never committed.** There is no `.env.dev` /
`.env.prod` in the repo — the dev/prod difference lives in *which compose
file you run*, not in env-file names. Your laptop has its `.env` in the
project root; the server has its own hand-written `/opt/bot/.env`
(`chmod 600`).

**Two Telegram bots, two tokens.** Create a separate dev bot in BotFather
for local testing. Telegram long polling delivers each update to exactly
one client per token — if your laptop and the server poll with the same
token, messages randomly go to one or the other. The prod bot's token
should exist only in the server's `.env`.

| Variable | Laptop (dev `.env`) | Server (`/opt/bot/.env`) |
| --- | --- | --- |
| `BOT_TOKEN` | **dev** bot token (separate BotFather bot) | **prod** bot token |
| `DATABASE_URL` | ignored by the local stack (pinned to the `db` container); set it to the Supabase **session** pooler URL only for a prod-config test from the laptop | Supabase **session** pooler URL (port 5432, not the transaction pooler) |
| `BACKEND_BASE_URL` | ignored in docker (pinned to `http://api:8000`); `http://localhost:8000` for bare-host runs | ignored (pinned in compose) |
| `INTERNAL_TOKEN` | any random dev value | strong secret — `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `ALLOWED_TG_IDS` | your Telegram id | all family members' ids |
| `FAMILY_TZ` | optional, defaults to `UTC` — IANA name, e.g. `Europe/Belgrade` | same |

How the three ways to run map onto this:

1. **Local stack** — `docker compose up --build`. Uses a throwaway
   Postgres container; only `BOT_TOKEN`, `INTERNAL_TOKEN` and
   `ALLOWED_TG_IDS` are actually read from your `.env`.
2. **Prod config from the laptop** — `docker compose -f
   docker-compose.prod.yml up --build`. Talks to the real Supabase, so
   `DATABASE_URL` in your laptop `.env` must be the session-pooler URL.
   With the dev bot token in your `.env`, this can safely run while the
   real server is live.
3. **Production (EC2)** — deployed by CD from `master` (see "Deployment"
   below); the server's `.env` is created once by hand and edited in place
   when values change, followed by `docker compose up -d --force-recreate`.

## Run

### Docker — full local stack (recommended)

```bash
docker compose up --build
```

Brings up Postgres → Alembic migrations (one-shot) → API on
[localhost:8000](http://localhost:8000/health) → bot. `DATABASE_URL` and
`BACKEND_BASE_URL` are pinned to the compose services; the rest is read
from `.env`.

### Docker — production (AWS, from master)

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

No Postgres container — `DATABASE_URL` in `.env` must point at Supabase's
**session** pooler (port 5432). No ports are published: the bot long-polls
Telegram outbound and reaches the API over the internal compose network.

### Bare host (development)

```bash
uv run alembic upgrade head                # apply migrations
uv run uvicorn main:app --reload           # backend on :8000
uv run python -m bot.bot                   # bot (separate terminal)
```

## Deployment

Merges to `master` auto-deploy via `.github/workflows/deploy.yml`: build
and push `ghcr.io/edgar-84/cashflow` tagged `latest` + `<commit sha>`, then
SSH to the server and `docker compose pull && docker compose up -d`. The
CI `verify`/`integration` jobs gate every PR into master first, so CD only
ever deploys a smoke-tested build. Server bootstrap is a manual, one-time
procedure — not automated.

### One-time server bootstrap

1. Launch an EC2 instance, install Docker + the Compose plugin.
2. `mkdir -p /opt/bot`, copy `docker-compose.prod.yml` there as
   `docker-compose.yml`.
3. Hand-write `/opt/bot/.env` (see "Environments & `.env`" above — prod
   `BOT_TOKEN`, Supabase session-pooler `DATABASE_URL`, a strong
   `INTERNAL_TOKEN`, all family `ALLOWED_TG_IDS`), then
   `chmod 600 /opt/bot/.env`.
4. Add `CASHFLOW_IMAGE=ghcr.io/edgar-84/cashflow:latest` to that `.env` —
   without it, compose falls back to `cashflow:prod` (a local build) and
   CD's `pull` has nothing to update.
5. Create a GHCR read-only PAT (`read:packages` scope) and
   `docker login ghcr.io -u <github-user> --password-stdin` once on the
   server so `docker compose pull` can fetch a private image.
6. In the GitHub repo, add secrets `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`
   (a key authorized on the server for that user) — the `deploy` job in
   `.github/workflows/deploy.yml` uses them.
7. First run: `cd /opt/bot && docker compose up -d` (pulls the image,
   applies migrations via the one-shot `migrate` service, starts api+bot).

### Day-2 ops

- **Rollback**: pin a known-good tag in `/opt/bot/.env`
  (`CASHFLOW_IMAGE=ghcr.io/edgar-84/cashflow:<sha>`) and
  `docker compose up -d --force-recreate`, or `git revert` the bad commit
  on `master` and let CD redeploy `latest`.
- **Config change**: edit `/opt/bot/.env`, then
  `docker compose up -d --force-recreate`.
- **Migrations**: every deploy re-runs the one-shot `migrate` service;
  `alembic upgrade head` is idempotent, so schema changes merged to
  master apply automatically — no separate migration step.
- **Logs**: `docker compose logs -f [api|bot|migrate]`. Each service logs
  to json-file with rotation (10m × 3 files) so disk usage stays bounded.

## Tests & checks

```bash
bash scripts/verify.sh                     # format + lint + mypy + unit tests
uv run pytest -m integration               # needs a reachable Postgres
bash scripts/integration_docker.sh         # ...or a throwaway Docker Postgres
```
