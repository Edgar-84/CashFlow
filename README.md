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
| `FAMILY_TZ` | optional, defaults to `UTC` — IANA name, e.g. `Europe/Belgrade` | same |
| `MINI_APP_HOST` | ignored (dev has no TLS proxy) | **required** — public hostname the Caddy proxy serves, e.g. `miniapp.example.com`. Must be a DNS A-record you control that points at the server; Caddy uses it as both the vhost and the Let's Encrypt cert subject |
| `MINI_APP_URL` | optional — set only if you register the Mini App against your dev bot for local testing | `https://<MINI_APP_HOST>` — the URL the bot's `/miniapp` menu button opens |
| `INITDATA_MAX_AGE_SEC` | optional, defaults to `86400` (24h) | same — max age of a signed `initData` payload; older payloads are rejected as expired |

How the three ways to run map onto this:

1. **Local stack** — `docker compose up --build`. Uses a throwaway
   Postgres container; only `BOT_TOKEN` and `INTERNAL_TOKEN` are actually
   read from your `.env`.
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
and push `ghcr.io/edgar-84/cashflow` tagged `latest` + `<commit sha>`, copy
`docker-compose.prod.yml` to the server (so server-side config can never
drift from what's in the repo), then SSH in to
`docker compose -f docker-compose.prod.yml pull && ... up -d`. The CI
`verify`/`integration` jobs gate every PR into master first, so CD only
ever deploys a smoke-tested build. `.env` is the one piece that stays
manual — it holds secrets and is never checked into the repo, so CD never
touches it.

### One-time server bootstrap

1. Launch an EC2 instance, install Docker + the Compose plugin.
2. `mkdir -p /opt/bot` — CD copies `docker-compose.prod.yml` into this
   directory itself on every deploy; nothing to copy by hand.
3. Hand-write `/opt/bot/.env` (see "Environments & `.env`" above — prod
   `BOT_TOKEN`, Supabase session-pooler `DATABASE_URL`, a strong
   `INTERNAL_TOKEN`), then `chmod 600 /opt/bot/.env`.
4. Add `CASHFLOW_IMAGE=ghcr.io/edgar-84/cashflow:latest` to that `.env` —
   without it, compose falls back to `cashflow:prod` (a local build) and
   CD's `pull` has nothing to update.
5. Create a GHCR read-only PAT (`read:packages` scope) and
   `docker login ghcr.io -u <github-user> --password-stdin` once on the
   server so `docker compose pull` can fetch a private image.
6. In the GitHub repo, add secrets `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`
   (a key authorized on the server for that user) — both the compose-file
   copy step and the `deploy` job in `.github/workflows/deploy.yml` use
   them.
7. First run: once 1–6 are done, the next push to `master` (e.g. this PR's
   merge) performs the very first deploy automatically — copies the
   compose file, pulls the image, applies migrations via the one-shot
   `migrate` service, starts api+bot. No manual command needed.

### Day-2 ops

- **Rollback**: pin a known-good tag in `/opt/bot/.env`
  (`CASHFLOW_IMAGE=ghcr.io/edgar-84/cashflow:<sha>`) and
  `docker compose -f docker-compose.prod.yml up -d --force-recreate`, or
  `git revert` the bad commit on `master` and let CD redeploy `latest`.
- **Config change**: edit `/opt/bot/.env`, then
  `docker compose -f docker-compose.prod.yml up -d --force-recreate`.
- **Migrations**: every deploy re-runs the one-shot `migrate` service;
  `alembic upgrade head` is idempotent, so schema changes merged to
  master apply automatically — no separate migration step.
- **Logs**: `docker compose -f docker-compose.prod.yml logs -f [api|bot|migrate]`.
  Each service logs
  to json-file with rotation (10m × 3 files) so disk usage stays bounded.
- **Image cleanup**: every deploy runs `docker image prune -f` after
  `up -d`, removing dangling/untagged layers so disk usage doesn't grow
  unbounded on a long-lived server. Only untagged images are removed —
  rollback tags (`<sha>`) already pulled stay local, and any tag not
  cached locally re-pulls from GHCR on demand.

## Mini App deployment

The Telegram Mini App (`webapp/`) ships in the same image as the API — the
Dockerfile's `webapp-builder` stage runs `pnpm build` and the runtime image
copies `webapp/dist` in; FastAPI serves it via `StaticFiles` at `/`, mounted
**after** every API router so `/expenses`, `/health`, etc. still route to
FastAPI (D201, U1.5). The **`proxy`** service in `docker-compose.prod.yml`
runs Caddy in front of the api, terminates TLS with a Let's Encrypt cert, and
publishes ports 80/443 to the internet (D213).

### One-time bootstrap

1. **DNS**: create an A-record for the hostname you'll use (e.g.
   `miniapp.example.com`) pointing at the server's public IP. Wait for
   propagation — Caddy's cert issuance fails until the ACME HTTP-01
   challenge on port 80 resolves back to this server.
2. **Firewall**: open TCP **80** and **443** (and UDP 443 for HTTP/3) to
   the server. Port 80 is required for ACME cert issuance and renewal, not
   just for plaintext redirects.
3. **`.env`**: add `MINI_APP_HOST=<the hostname>` to `/opt/bot/.env`. Without
   it, the compose file falls back to `miniapp.example.invalid`, which will
   fail ACME loudly — safe but useless.
4. **First deploy**: push to `master` (or run `docker compose -f
   docker-compose.prod.yml up -d --force-recreate proxy`). Caddy contacts
   Let's Encrypt on first request, provisions a cert, and stores it in the
   `caddy_data` named volume. Watch `docker compose logs proxy` for
   `certificate obtained successfully` before moving on.
5. **BotFather — register the Mini App**: talk to
   [`@BotFather`](https://t.me/BotFather), `/newapp`, pick your bot, provide
   a title, short description, a 640×360 photo, and set the **URL** to
   `https://<MINI_APP_HOST>`. Give the app a `short_name` (used for
   `t.me/<bot>/<short_name>` deep links).
6. **Menu button**: `/setmenubutton` in BotFather, pick the bot, set the
   button text (e.g. "Open") and the same `https://<MINI_APP_HOST>` URL.
   The chat now has a persistent menu-button next to the compose field that
   opens the Mini App inline.

### Cert renewal

Caddy renews the LE cert automatically ~30 days before expiry; renewal state
lives in the `caddy_data` volume (mounted at `/data` inside the proxy
container) and survives `docker compose up -d --force-recreate`. No cron, no
certbot sidecar. If you ever `docker volume rm cashflow_caddy_data`, the
next request will re-issue a fresh cert (rate-limited by LE — do not do this
casually).

### Rollback

The proxy is stateless config — a bad image change is rolled back the same
way as api/bot: pin `CASHFLOW_IMAGE=ghcr.io/edgar-84/cashflow:<good-sha>`
in `/opt/bot/.env` and `docker compose -f docker-compose.prod.yml up -d
--force-recreate`. The `Caddyfile` itself is checked into the repo and copied
by the same deploy step as the compose file, so reverting a bad Caddyfile is
a plain `git revert` + CD.

### Cache busting

Vite emits hashed asset filenames by default (`assets/index-<hash>.js`),
which is what makes Telegram's aggressive webview cache safe: a new build
changes the asset filenames, `index.html` references the new names, and the
old ones are simply never requested again. Don't add unhashed files to
`webapp/dist` — a `logo.png` at the root would be pinned to the first
version a client saw, forever.

## Tests & checks

```bash
bash scripts/verify.sh                     # format + lint + mypy + unit tests
uv run pytest -m integration               # needs a reachable Postgres
bash scripts/integration_docker.sh         # ...or a throwaway Docker Postgres
```
