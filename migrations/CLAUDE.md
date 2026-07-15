# migrations/ — Alembic (asyncpg-compatible)

<!-- Loaded only when Claude works inside migrations/. -->

## Purpose
Schema migrations for the Supabase (PostgreSQL) database. Source of truth for
the schema is `docs/SCHEMA.sql`; the first migration is generated from it, and
every subsequent migration is a delta.

## Layout
- `env.py` — Alembic env configured for asyncpg (async engine, run migrations
  in an async context).
- `versions/` — generated migrations. **Do not edit past migrations** — write
  a new one to change something.

## Rules
- **Never edit an already-applied migration.** Add a new one that supersedes it.
- **Never edit `versions/` files without asking.** (Also in root CLAUDE.md.)
- Every schema change: new migration file, `alembic upgrade head` locally,
  then commit both `docs/SCHEMA.sql` (if it moved) and the new version.
- Money columns: `BIGINT` (minor units). Never `NUMERIC`/`FLOAT` for money.
- IDs: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- Timestamps: `TIMESTAMPTZ DEFAULT now()`.
- FKs: explicit `REFERENCES ... ON DELETE {CASCADE|SET NULL|RESTRICT}` — never
  the default (which is `NO ACTION`, easy to trip on).

## Commands
- Generate: `uv run alembic revision -m "short description"` (blank), then
  hand-write the DDL as `op.execute("""...""")`. `--autogenerate` does not
  work in this project — `env.py` sets `target_metadata = None` since there
  is no ORM model layer to diff against (raw SQL, no ORM, per project
  CLAUDE.md). Every migration follows the "First migration" option (1) path.
- Apply: `uv run alembic upgrade head`.
- Downgrade one step: `uv run alembic downgrade -1` (only in dev).

## First migration
Bootstrapped from `docs/SCHEMA.sql` via `alembic revision -m "initial schema"`
(blank) with the DDL pasted into `upgrade()`/`downgrade()` as
`op.execute("""...""")` — see `migrations/versions/`. This is also the
pattern for every future migration (see Commands above: autogenerate is
not usable here).
